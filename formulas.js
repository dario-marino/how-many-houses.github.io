/**
 * formulas.js
 *
 * Pure math functions implementing the "elasticity-scaling" methodology.
 * Kept separate from DOM/D3 code so they can be unit-tested in isolation
 * (see formulas.test.js) and reused identically by both the Rent tool
 * and the Home Price tool -- the two tools only differ in which price
 * field feeds P_current.
 *
 * SECTION 1 -- "units needed to reach a target price"
 *   Q_new = Q_current * (P_target / P_current) ^ epsilon
 *   unitsToBuild = Q_new - Q_current
 *
 *   Note: if P_target > P_current and epsilon is negative, Q_new < Q_current,
 *   i.e. a HIGHER target price implies FEWER units needed (less pressure to
 *   build) -- and vice versa. This is the correct sign behavior for a
 *   downward-sloping demand curve: raising the price target you're trying
 *   to "reach" from above means the market needs less new supply to get
 *   there, while pushing the target price DOWN (more affordable) requires
 *   MORE new supply. unitsToBuild will be negative when the target price is
 *   already above the current price (no new supply is "needed" to sustain
 *   a higher price) -- the UI clips this at 0 for display ("no shortfall").
 *
 * SECTION 2 -- "today's shortage, and price if it were closed"
 *   Q_healthy = occupiedUnits / (1 - benchmarkVacancy)
 *   shortageUnits = max(0, Q_healthy - Q_current)
 *   P_new = P_current * (Q_healthy / Q_current) ^ (1 / epsilon)
 */

function unitsToReachTargetPrice(currentPrice, currentUnits, targetPrice, epsilon) {
  if (!currentPrice || !currentUnits || currentPrice <= 0 || currentUnits <= 0) return null;
  const ratio = targetPrice / currentPrice;
  const newUnits = currentUnits * Math.pow(ratio, epsilon);
  return newUnits - currentUnits;
}

function shortageAndResultingPrice(currentPrice, currentUnits, occupiedUnits, benchmarkVacancy, epsilon) {
  if (!currentPrice || !currentUnits || currentUnits <= 0) {
    return { healthyUnits: null, shortageUnits: null, resultingPrice: null };
  }
  const healthyUnits = occupiedUnits / (1 - benchmarkVacancy);

  // If current vacancy is already AT or ABOVE the healthy benchmark, there is
  // no shortage to close -- report 0 units needed and leave price unchanged,
  // rather than computing a hypothetical (and confusing) price for a
  // scenario where units would need to be REMOVED to hit the benchmark
  // exactly. The "price if closed" framing only makes sense when there is
  // an actual gap to close.
  if (healthyUnits <= currentUnits) {
    return { healthyUnits, shortageUnits: 0, resultingPrice: currentPrice };
  }

  const shortageUnits = healthyUnits - currentUnits;
  const qRatio = healthyUnits / currentUnits;
  const resultingPrice = currentPrice * Math.pow(qRatio, 1 / epsilon);
  return { healthyUnits, shortageUnits, resultingPrice };
}

function pctChange(oldVal, newVal) {
  if (!oldVal) return null;
  return ((newVal - oldVal) / oldVal) * 100;
}

if (typeof module !== "undefined") {
  module.exports = { unitsToReachTargetPrice, shortageAndResultingPrice, pctChange };
}
