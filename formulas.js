/**
 * formulas.js
 *
 * 1) PER-NEIGHBORHOOD DEMAND MODEL
 *    Q_new = Q_old * (Price_new / Price_old) ^ epsilon
 *    unitsToBuild = Q_new - Q_old
 *
 *    Equivalently, solved for price given a target quantity:
 *      Price_new = Price_old * (Q_new / Q_old) ^ (1/epsilon)
 *    (note the exponent is 1/epsilon here, not epsilon -- this is the
 *    correct algebraic inverse of the quantity formula above.)
 *
 * 2) CROSS-NEIGHBORHOOD SUBSTITUTION / REALLOCATION MODEL
 *    Redistributes the SAME total metro-wide units-needed figure from (1)
 *    across ZIPs, weighted by each ZIP's housing SUPPLY elasticity (how
 *    physically/regulatorily easy it is to add units there -- from
 *    Baum-Snow & Han 2024) times its own independent shortfall.
 *
 *    NOTE: a full cross-neighborhood DEMAND substitution model (modeling
 *    renters actually shifting between specific ZIPs as relative prices
 *    change) is a separate, more involved extension and is not yet
 *    implemented here -- see project discussion for current status.
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
