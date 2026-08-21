/**
 * formulas.js
 *
 * 1) PER-NEIGHBORHOOD DEMAND MODEL
 *    Q_new = Q_old * (Price_new / Price_old) ^ epsilon
 *    unitsToBuild = Q_new - Q_old
 *    Equivalently: Price_new = Price_old * (Q_new / Q_old) ^ (1/epsilon)
 *
 * 2) ORIGIN-DESTINATION SUBSTITUTION / REALLOCATION MODEL
 *    For each ZIP i with a positive independent shortfall S_i, splits S_i
 *    across ALL ZIPs j (including i itself) weighted by:
 *        weight(i,j) = exp(-distance(i,j) / decayKm) * supplyElasticity(j)
 *    then sums the contributions every destination ZIP receives across
 *    all origins. This directly answers "how does demand pressure spread
 *    between neighborhoods": nearby, easy-to-build ZIPs absorb most of a
 *    given ZIP's excess shortfall, with the amount landing farther away
 *    shrinking geometrically with distance -- rather than pooling every
 *    ZIP's demand into one metro-wide bucket regardless of distance
 *    (which was the behavior of the previous version of this model, and
 *    is recovered here only as the decayKm -> very large limit).
 *
 *    GROUNDING AND ITS LIMITS: the qualitative fact that housing
 *    substitutability decays with distance is well documented (Asquith,
 *    Mast & Reed 2023; Li 2022; Anenberg & Kung 2014; Anenberg & Ringo
 *    2025; reviewed in Furth 2026). However, those studies measure decay
 *    at the scale of individual blocks to roughly a mile -- finer than
 *    the ZIP-to-ZIP distances relevant here (typically several km to
 *    several dozen km). No study directly estimates a decay rate at this
 *    coarser scale, so decayKm is exposed as a user-adjustable parameter
 *    rather than presented as a literature-calibrated constant.
 *
 *    Total is exactly preserved: sum of all reallocated units always
 *    equals sum of all (clipped, non-negative) independent-model units,
 *    regardless of decayKm -- only WHERE construction concentrates
 *    changes, never the metro-wide total.
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

function buildDistanceMatrixKm(centroids) {
  const n = centroids.length;
  const matrix = new Array(n);
  for (let i = 0; i < n; i++) {
    matrix[i] = new Array(n);
    for (let j = 0; j < n; j++) {
      const [lon1, lat1] = centroids[i];
      const [lon2, lat2] = centroids[j];
      matrix[i][j] = haversineKm(lat1, lon1, lat2, lon2);
    }
  }
  return matrix;
}

function reallocateWithDistanceDecay(naiveUnitsArray, elasticityArray, distanceMatrixKm, decayKm) {
  const n = naiveUnitsArray.length;
  const clippedNaive = naiveUnitsArray.map((v) => (v === null || v === undefined || isNaN(v)) ? 0 : Math.max(0, v));
  const received = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    const S_i = clippedNaive[i];
    if (S_i <= 0) continue;

    const rawWeights = new Array(n);
    let sumWeights = 0;
    for (let j = 0; j < n; j++) {
      const e = elasticityArray[j];
      const elasticity = (e === null || e === undefined || isNaN(e)) ? 0 : e;
      const d = distanceMatrixKm[i][j];
      const decay = Math.exp(-d / decayKm);
      const w = decay * elasticity;
      rawWeights[j] = w;
      sumWeights += w;
    }

    if (sumWeights <= 0) {
      received[i] += S_i; // fallback: no usable weights anywhere, keep it local
      continue;
    }

    for (let j = 0; j < n; j++) {
      received[j] += S_i * (rawWeights[j] / sumWeights);
    }
  }

  return received;
}

if (typeof module !== "undefined") {
  module.exports = {
    unitsToReachTargetPrice, pctChange,
    haversineKm, buildDistanceMatrixKm, reallocateWithDistanceDecay,
  };
}
