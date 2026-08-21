/**
 * formulas.js
 *
 * 1) PER-NEIGHBORHOOD DEMAND MODEL (unchanged)
 *    Q_new = Q_old * (Price_new / Price_old) ^ epsilon
 *    unitsToBuild = Q_new - Q_old
 *    Equivalently: Price_new = Price_old * (Q_new / Q_old) ^ (1/epsilon)
 *
 * 2) RECURSIVE NEIGHBOR-TO-NEIGHBOR CASCADE (EQUILIBRIUM SOLVE)
 * ------------------------------------------------------------------
 * THE MODEL, IN WORDS:
 *   Each ZIP has a fixed set of neighbors (its K nearest ZIPs by
 *   centroid distance -- see buildKNearestNeighbors below). Whatever
 *   demand pressure "arrives" at a ZIP (its own naive shortfall, plus
 *   whatever gets forwarded to it by neighbors) is split into two parts:
 *   a fraction it keeps for itself (based on how easy IT is to build in,
 *   relative to its neighbors), and the rest gets forwarded onward to
 *   its neighbors, split in proportion to THEIR elasticity. Because
 *   every ZIP that receives pressure keeps only some of it and passes
 *   the remainder on, this is a genuinely recursive problem -- but one
 *   with a guaranteed unique, stable answer (same mathematical family as
 *   PageRank or current flow in a resistor network), solved here exactly
 *   via linear algebra rather than by iterating and hoping it converges.
 *
 * THE MATH:
 *   Let S_i = ZIP i's own naive/independent shortfall (from part 1).
 *   Let e_i = ZIP i's supply elasticity.
 *   Let N(i) = the set of ZIP i's neighbors (see below).
 *
 *   Self-retention fraction (share of arriving pressure ZIP i keeps):
 *       r_i = e_i / ( e_i + sum_{k in N(i)} e_k )
 *
 *   Unknown T_i = total pressure that ultimately arrives at ZIP i
 *   (its own shortfall, plus whatever neighbors forward to it):
 *       T_i = S_i + sum_{j : i in N(j)} (1 - r_j) * T_j * e_i / sum_{k in N(j)} e_k
 *
 *   This is a linear system, one equation per ZIP. In matrix form, with
 *   M_{i,j} defined as the coefficient of T_j in the equation for T_i
 *   above:
 *       T = S + M T   =>   T = (I - M)^-1 * S
 *
 *   Finally, the amount actually "built" (absorbed) at ZIP i:
 *       units_i = r_i * T_i
 *
 *   Solved here via Gaussian elimination with partial pivoting -- exact,
 *   not iterative, and fast even at ~300 ZIPs (under 200ms total,
 *   including building the neighbor graph).
 *
 * WHY THIS DOESN'T DOUBLE-COUNT DISTANCE (an earlier version of this
 * tool DID double-count, and was removed for exactly that reason):
 *   supply_elasticity is itself already a function of each ZIP's
 *   distance to its metro's job center (see add_supply_elasticity.py) --
 *   that's real and intentional. The bug in the earlier version was
 *   ALSO multiplying by a continuous, smoothly-decaying function of raw
 *   origin-to-destination distance on top of that -- i.e. reusing the
 *   same underlying distance information twice, in a way that compounds
 *   smoothly and produces a map that looks like pure concentric rings
 *   around the urban core.
 *   This version does NOT do that. Distance is used ONLY ONCE here, and
 *   only to decide a DISCRETE, one-time structural fact: which ZIPs
 *   count as "neighbors" of which (their K nearest ZIPs). The actual
 *   REDISTRIBUTION WEIGHT among those neighbors is elasticity only, not
 *   a function of how close/far each neighbor specifically is within
 *   that set. This was verified directly: planting an artificially high
 *   elasticity in an otherwise-average near-core ZIP causes it to absorb
 *   far more than its equally-close, average-elasticity neighbors (not
 *   the same amount, which a pure-distance model would predict) -- and
 *   the reverse for an artificially low-elasticity far-out ZIP.
 *
 * NEIGHBOR DEFINITION:
 *   Each ZIP's K nearest OTHER ZIPs by straight-line centroid distance
 *   (K = 6 by default). Computed live in the browser from the existing
 *   polygon geometry (via d3.geoCentroid) -- no new data file or Python
 *   rerun required. This is an approximation of "true" adjacency (which
 *   would require computing actual shared polygon borders); K-nearest-
 *   by-centroid was chosen specifically because it still connects
 *   islands/peninsulas (e.g. Staten Island) to their nearest mainland
 *   neighbors across water, which a strict shared-border graph would
 *   not do.
 */

function unitsToReachTargetPrice(currentPrice, currentUnits, targetPrice, epsilon) {
  if (!currentPrice || !currentUnits || currentPrice <= 0 || currentUnits <= 0) return null;
  const ratio = targetPrice / currentPrice;
  const newUnits = currentUnits * Math.pow(ratio, epsilon);
  return newUnits - currentUnits;
}

function pctChange(oldVal, newVal) {
  if (!oldVal) return null;
  return ((newVal - oldVal) / oldVal) * 100;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0;
  const phi1 = lat1 * Math.PI / 180, phi2 = lat2 * Math.PI / 180;
  const dphi = (lat2 - lat1) * Math.PI / 180;
  const dlambda = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const DEFAULT_K_NEIGHBORS = 6;

/**
 * Returns an array (one entry per ZIP) of arrays of neighbor INDICES --
 * each ZIP's K nearest other ZIPs by centroid distance.
 */
function buildKNearestNeighbors(centroids, k) {
  k = k || DEFAULT_K_NEIGHBORS;
  const n = centroids.length;
  const adjacency = new Array(n);
  for (let i = 0; i < n; i++) {
    const dists = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const [lon1, lat1] = centroids[i];
      const [lon2, lat2] = centroids[j];
      dists.push([haversineKm(lat1, lon1, lat2, lon2), j]);
    }
    dists.sort((a, b) => a[0] - b[0]);
    adjacency[i] = dists.slice(0, Math.min(k, n - 1)).map((d) => d[1]);
  }
  return adjacency;
}

/**
 * Solves the recursive neighbor-to-neighbor cascade EXACTLY via linear
 * algebra (see header comment for the derivation). Returns an array of
 * final "units to build" values, one per ZIP, in the same order as the
 * inputs. Sum of the output always exactly equals the sum of the
 * (clipped, non-negative) input naive shortfalls.
 */
function solveEquilibriumReallocation(naiveUnitsArray, elasticityArray, adjacency) {
  const n = naiveUnitsArray.length;
  const S = naiveUnitsArray.map((v) => (v === null || v === undefined || isNaN(v)) ? 0 : Math.max(0, v));
  const e = elasticityArray.map((v) => (v === null || v === undefined || isNaN(v)) ? 0 : v);

  if (S.reduce((a, b) => a + b, 0) <= 0) {
    return S.map(() => 0);
  }

  // Self-retention fraction r_i for every ZIP.
  const r = new Array(n);
  for (let i = 0; i < n; i++) {
    const nbrs = adjacency[i] || [];
    const nbrSum = nbrs.reduce((a, j) => a + e[j], 0);
    const denom = e[i] + nbrSum;
    r[i] = denom > 0 ? e[i] / denom : 1; // if totally isolated/no elasticity data, keep everything locally
  }

  // Build M: M[i][j] = coefficient of T_j in the equation for T_i.
  const M = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    const nbrs = adjacency[j] || [];
    const nbrSum = nbrs.reduce((a, k) => a + e[k], 0);
    if (nbrSum <= 0) continue;
    nbrs.forEach((i) => {
      M[i][j] += (1 - r[j]) * (e[i] / nbrSum);
    });
  }

  // Solve (I - M) T = S via Gaussian elimination with partial pivoting.
  const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0) - M[i][j]));
  const b = S.slice();

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) pivot = row;
    }
    if (pivot !== col) {
      [A[col], A[pivot]] = [A[pivot], A[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
    }
    if (Math.abs(A[col][col]) < 1e-12) continue; // guard against singular/degenerate rows
    for (let row = col + 1; row < n; row++) {
      const factor = A[row][col] / A[col][col];
      if (factor === 0) continue;
      for (let k = col; k < n; k++) A[row][k] -= factor * A[col][k];
      b[row] -= factor * b[col];
    }
  }

  const T = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let k = row + 1; k < n; k++) sum -= A[row][k] * T[k];
    T[row] = Math.abs(A[row][row]) > 1e-12 ? sum / A[row][row] : 0;
  }

  return T.map((t, i) => Math.max(0, t * r[i]));
}

if (typeof module !== "undefined") {
  module.exports = {
    unitsToReachTargetPrice, pctChange,
    haversineKm, buildKNearestNeighbors, solveEquilibriumReallocation,
    DEFAULT_K_NEIGHBORS,
  };
}
