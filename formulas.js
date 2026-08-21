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
 *        weight(i,j) = exp(-distance(i,j) / SPILLOVER_DECAY_KM) * supplyElasticity(j)
 *    then sums the contributions every destination ZIP receives across
 *    all origins.
 *
 *    SPILLOVER_DECAY_KM IS HARDCODED, NOT USER-ADJUSTABLE.
 *    Value: 0.805 (units: kilometers -- distances from buildDistanceMatrixKm()
 *    below are computed via the haversine formula using Earth's radius in
 *    km, so this constant must also be expressed in km to be dimensionally
 *    consistent). 0.805 km = 805 meters.
 *
 *    Source: Anenberg & Ringo (2025), as quoted in Furth (2026, Mercatus
 *    Center, "Substitutability in the Demand for Housing over Small
 *    Distances"): "Anenberg and Ringo identify strong search congestion
 *    effects within 805 meters, falling by a factor of perhaps 3 in the
 *    ring between 805 and 1,609 meters, and fading gradually to as far as
 *    16 kilometers." 805 meters (0.805 km) is used directly as the decay
 *    scale here -- it is the paper's own stated threshold for "strong"
 *    spillover effects. No study estimates a decay rate at true
 *    ZIP-to-ZIP scale directly, so this remains the best available anchor
 *    rather than a precise replication of any single study's intended
 *    geography.
 *    Source: https://www.mercatus.org/research/research-papers/substitutability-demand-housing-over-small-distances
 *
 *    Total is exactly preserved: sum of all reallocated units always
 *    equals sum of all (clipped, non-negative) independent-model units --
 *    only WHERE construction concentrates changes, never the metro-wide
 *    total.
 */

const SPILLOVER_DECAY_KM = 0.805; // = 805 meters

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
  const R = 6371.0; // Earth's radius in KILOMETERS -- output of this
                     // function is therefore in km, matching the units
                     // of SPILLOVER_DECAY_KM above.
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
  decayKm = decayKm || SPILLOVER_DECAY_KM;
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
      received[i] += S_i;
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
    SPILLOVER_DECAY_KM,
  };
}
