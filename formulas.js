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
 *   Each ZIP has a fixed set of neighbors -- REAL geographic contiguity
 *   (do the polygons actually share a border), computed once in Python
 *   from the underlying ZIP boundary shapefiles (see compute_adjacency.py)
 *   and loaded here as a precomputed adjacency list. Whatever demand
 *   pressure "arrives" at a ZIP (its own naive shortfall, plus whatever
 *   gets forwarded to it by neighbors) is split into two parts: a
 *   fraction it keeps for itself (based on how easy IT is to build in,
 *   relative to its neighbors), and the rest gets forwarded onward to
 *   its neighbors, split in proportion to THEIR elasticity. Because
 *   every ZIP that receives pressure keeps only some of it and passes
 *   the remainder on, this is a genuinely recursive problem -- but one
 *   with a guaranteed unique, stable answer (same mathematical family as
 *   PageRank or current flow in a resistor network), solved here exactly
 *   via linear algebra rather than by iterating and hoping it converges.
 *
 * WHY REAL CONTIGUITY, NOT "K NEAREST NEIGHBORS":
 *   An earlier version of this tool used each ZIP's K nearest OTHER ZIPs
 *   by straight-line distance to define "neighbors." This is not the
 *   standard approach in spatial economics -- the field default since
 *   Anselin (1988) is CONTIGUITY (do the polygons actually share a
 *   border), and there is a specific finding (Smith 2009) that denser
 *   distance-based weight matrices tend to perform WORSE than sparser
 *   contiguity-based ones. Raising K to try to "spread things out more"
 *   also has a real cost: at large K, most ZIPs become directly
 *   connected to most other ZIPs, which washes out local structure and
 *   pushes the model back toward one big undifferentiated pool -- not
 *   what a genuine neighbor-to-neighbor cascade is supposed to capture.
 *   Real contiguity avoids this: it's naturally sparse (a typical ZIP
 *   borders only 4-8 others), with no arbitrary parameter to tune.
 *
 * THE ISLAND / FERRY PROBLEM:
 *   Pure contiguity has one known issue, also documented in this
 *   literature (Bivand & Wong describe exactly this with a ferry
 *   crossing between counties): a true island (e.g. Staten Island) has
 *   no shared LAND border with anything, so it would be fully isolated
 *   in a naive contiguity graph, even though it's obviously part of the
 *   same housing market via a real bridge/tunnel/ferry. This is fixed in
 *   compute_adjacency.py by finding any disconnected components and
 *   connecting each one to its nearest neighboring component via the
 *   single closest pair of ZIPs across the gap -- the minimum possible
 *   number of added connections, each approximating where a real
 *   bridge/tunnel would actually be built (at the narrowest crossing).
 *
 * THE MATH (unchanged from the prior version):
 *   Let S_i = ZIP i's own naive/independent shortfall (from part 1).
 *   Let e_i = ZIP i's supply elasticity.
 *   Let N(i) = the set of ZIP i's real contiguous (+ bridged) neighbors.
 *
 *   Self-retention fraction (share of arriving pressure ZIP i keeps):
 *       r_i = e_i / ( e_i + sum_{k in N(i)} e_k )
 *
 *   Unknown T_i = total pressure that ultimately arrives at ZIP i:
 *       T_i = S_i + sum_{j : i in N(j)} (1 - r_j) * T_j * e_i / sum_{k in N(j)} e_k
 *
 *   In matrix form: T = S + M T  =>  T = (I - M)^-1 * S
 *   Final answer (units actually built): units_i = r_i * T_i
 *   Solved via Gaussian elimination with partial pivoting -- exact, not
 *   iterative.
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

/**
 * Solves the recursive neighbor-to-neighbor cascade EXACTLY via linear
 * algebra. `adjacency` here is an array (one entry per ZIP, matching the
 * order of naiveUnitsArray/elasticityArray) of arrays of neighbor
 * INDICES -- built by mapping the real, precomputed ZIP-code-keyed
 * adjacency list (loaded from data/adjacency/*.json) onto the current
 * feature array's index order (see app.js: buildIndexAdjacency()).
 *
 * Returns an array of final "units to build" values, one per ZIP, in
 * the same order as the inputs. Sum of the output always exactly equals
 * the sum of the (clipped, non-negative) input naive shortfalls.
 */
function solveEquilibriumReallocation(naiveUnitsArray, elasticityArray, adjacency) {
  const n = naiveUnitsArray.length;
  const S = naiveUnitsArray.map((v) => (v === null || v === undefined || isNaN(v)) ? 0 : Math.max(0, v));
  const e = elasticityArray.map((v) => (v === null || v === undefined || isNaN(v)) ? 0 : v);

  if (S.reduce((a, b) => a + b, 0) <= 0) {
    return S.map(() => 0);
  }

  const r = new Array(n);
  for (let i = 0; i < n; i++) {
    const nbrs = adjacency[i] || [];
    const nbrSum = nbrs.reduce((a, j) => a + e[j], 0);
    const denom = e[i] + nbrSum;
    r[i] = denom > 0 ? e[i] / denom : 1;
  }

  const M = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    const nbrs = adjacency[j] || [];
    const nbrSum = nbrs.reduce((a, k) => a + e[k], 0);
    if (nbrSum <= 0) continue;
    nbrs.forEach((i) => {
      M[i][j] += (1 - r[j]) * (e[i] / nbrSum);
    });
  }

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
    if (Math.abs(A[col][col]) < 1e-12) continue;
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
    unitsToReachTargetPrice, pctChange, solveEquilibriumReallocation,
  };
}
