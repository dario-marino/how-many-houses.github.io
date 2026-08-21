/**
 * formulas.js
 *
 * 1) PER-NEIGHBORHOOD DEMAND MODEL
 *    Q_new = Q_old * (Price_new / Price_old) ^ epsilon
 *    unitsToBuild = Q_new - Q_old
 *    Equivalently: Price_new = Price_old * (Q_new / Q_old) ^ (1/epsilon)
 *
 * 2) SUPPLY-ELASTICITY-WEIGHTED REALLOCATION MODEL
 *    Redistributes the SAME total metro-wide units-needed figure from (1)
 *    across ZIPs, weighted by each ZIP's housing SUPPLY elasticity (how
 *    physically/regulatorily easy it is to add units there -- from
 *    Baum-Snow & Han 2024) times its own independent shortfall.
 *
 *    NOTE ON A REMOVED FEATURE: an earlier version of this tool also
 *    applied an origin-destination DISTANCE DECAY on top of this
 *    elasticity weighting (i.e. a ZIP's excess demand was redirected
 *    preferentially to physically NEARBY ZIPs, not just easy-to-build
 *    ones anywhere in the metro). That was removed. The reason: each
 *    ZIP's supply_elasticity value is ITSELF already derived entirely
 *    from that ZIP's distance to the metro's job center (see
 *    add_supply_elasticity.py) -- low near the core, high near the
 *    periphery, by construction. Layering a SECOND, independent distance
 *    term (origin-to-destination) on top of a variable that is already
 *    100% distance-driven caused distance to be double-counted, and the
 *    resulting map degenerated into smooth concentric rings radiating
 *    outward from the urban core -- i.e. it started to look like a pure
 *    distance map rather than a map of genuine variation in ease of
 *    building. Removing the origin-destination decay and reallocating
 *    purely by supply elasticity (still a real, distance-informed,
 *    literature-grounded quantity) avoids this double-counting.
 *
 *    A full cross-neighborhood DEMAND substitution model (i.e. modeling
 *    renters actually shifting between specific ZIPs as relative prices
 *    change) is a separate, more involved extension and is not
 *    implemented here.
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

function reallocateBySupplyElasticity(naiveUnitsArray, supplyElasticityArray) {
  const clipped = naiveUnitsArray.map((v) => (v === null || v === undefined || isNaN(v) ? 0 : Math.max(0, v)));
  const totalNaive = clipped.reduce((a, b) => a + b, 0);

  if (totalNaive <= 0) {
    return clipped.map(() => 0);
  }

  const weights = clipped.map((v, i) => {
    const e = supplyElasticityArray[i];
    const elasticity = (e === null || e === undefined || isNaN(e)) ? 0 : e;
    return v * elasticity;
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  if (totalWeight <= 0) {
    return clipped;
  }

  return weights.map((w) => totalNaive * (w / totalWeight));
}

if (typeof module !== "undefined") {
  module.exports = { unitsToReachTargetPrice, pctChange, reallocateBySupplyElasticity };
}
