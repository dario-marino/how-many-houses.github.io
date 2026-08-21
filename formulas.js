/**
 * formulas.js
 *
 * Pure math functions. Two families:
 *
 * 1) PER-NEIGHBORHOOD DEMAND MODEL (unchanged from earlier versions)
 *    Given a target price and a demand elasticity, computes how many
 *    units a single ZIP would need to reach that price IN ISOLATION
 *    (i.e. treating every neighborhood as if it had to satisfy its own
 *    demand independently, with no ability for demand to spill over into
 *    -- or supply to be absorbed by -- a neighboring ZIP).
 *
 *      Q_new = Q_current * (P_target / P_current) ^ epsilon
 *      unitsToBuild = Q_new - Q_current
 *
 * 2) CROSS-NEIGHBORHOOD SUBSTITUTION / REALLOCATION MODEL (new)
 *    Addresses the "neighborhoods aren't independent" critique: takes
 *    the SAME total metro-wide units-needed figure implied by (1) above,
 *    summed across every ZIP, and redistributes WHERE that total would
 *    concentrate -- weighted by each ZIP's housing SUPPLY elasticity
 *    (how physically/regulatorily easy it is to add units there), not
 *    its demand elasticity. Supply elasticity is estimated from Baum-Snow
 *    & Han (2024), "The Microgeography of Housing Supply" (JPE), based on
 *    each ZIP's distance to its metro's nearest job center -- see
 *    add_supply_elasticity.py for how that field is computed.
 *
 *    IMPORTANT SCOPE NOTE: this reallocation does NOT solve for a new
 *    equilibrium price in every neighborhood after redistribution -- that
 *    would require a full cross-neighborhood DEMAND substitution model
 *    (i.e. modeling renters actually moving between ZIPs when relative
 *    prices shift), which is a heavier, separate undertaking not
 *    implemented here. This model only answers: "given the same total
 *    metro-wide construction response, where would it concentrate if
 *    supply-side ease of building (not demand) determines the split?"
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
 * reallocateBySupplyElasticity
 *
 * Inputs:
 *   naiveUnitsArray      -- array of per-ZIP "independent" units-to-build
 *                            values (may contain null for ZIPs with no
 *                            price/unit data -- treated as 0 contribution)
 *   supplyElasticityArray -- array of per-ZIP supply elasticities, same
 *                            order/length as naiveUnitsArray (may contain
 *                            null/undefined -- treated as 0 weight)
 *
 * Returns: array of reallocated units-to-build, same length/order, such
 * that sum(returned) === sum(max(0, naiveUnitsArray)) -- i.e. the TOTAL
 * metro-wide construction implied by the independent model is preserved;
 * only its spatial distribution changes.
 *
 * Weighting: weight_i = clippedNaive_i * supplyElasticity_i. This means
 * a ZIP only receives a meaningful allocation if it BOTH (a) shows real
 * demand-side pressure in the independent model, AND (b) is relatively
 * easy to build in. A ZIP with high elasticity but zero independent
 * shortfall (already at/below target price) correctly receives zero --
 * there's no pressure to redirect there. A ZIP with high shortfall but
 * very low elasticity has its pressure partially redirected elsewhere.
 *
 * Fallback: if every weight is zero (e.g. supply elasticity data is
 * entirely missing) but total naive demand is positive, falls back to
 * the naive (independent) values directly -- degrades gracefully rather
 * than dividing by zero or returning nonsense.
 */
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
    // No usable elasticity data at all -- fall back to independent model.
    return clipped;
  }

  return weights.map((w) => totalNaive * (w / totalWeight));
}

if (typeof module !== "undefined") {
  module.exports = { unitsToReachTargetPrice, pctChange, reallocateBySupplyElasticity };
}
