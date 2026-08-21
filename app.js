/**
 * app.js
 * How Many Houses? -- a neighborhood-level (ZIP code) housing-price explorer
 * for NYC and the Bay Area, companion to "Building Houses, Yes, But How Many?"
 *
 * Data expected at:
 *   data/nyc_pumas_clean.geojson
 *   data/bayarea_pumas_clean.geojson
 * (produced by get_zip_housing_data.py + build_zip_dataset.py, then
 *  enriched with cbd_distance_km / supply_elasticity by
 *  add_supply_elasticity.py)
 *
 * Depends on: d3 v7 (CDN), formulas.js (loaded before this file)
 */

// ------------------------------------------------------------------
// HARDCODED FIXES / OVERRIDES
// ------------------------------------------------------------------
const NAME_OVERRIDES = {
  // (currently empty -- ZIP-level names are resolved in the Python
  // pipeline via a real neighborhood crosswalk; add entries here only
  // for one-off cosmetic fixes you don't want to wait on a data rerun for)
};

function applyOverrides(features) {
  features.forEach((f) => {
    const geoid = String(f.properties.puma_geoid);
    if (NAME_OVERRIDES[geoid]) {
      f.properties.display = NAME_OVERRIDES[geoid];
    }
  });
}

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------
const state = {
  city: "nyc",           // "nyc" | "bayarea"
  metric: "rent",        // "rent" | "price"
  model: "substitution",  // "independent" | "substitution" -- controls what the MAP visualizes
  elasticity: -1.0,       // demand elasticity, -1.5 to -0.5, 0.1 steps
  targetPrice: null,
  sortKey: null,
  sortAsc: false,
  data: { nyc: null, bayarea: null },
};

const METRIC_FIELD = {
  rent: { current: "median_gross_rent", display: "median_gross_rent_display", label: "Rent" },
  price: { current: "median_home_value", display: "median_home_value_display", label: "Home Price" },
};

// ------------------------------------------------------------------
// Data loading
// ------------------------------------------------------------------
async function loadData() {
  const cacheBust = "?v=" + Date.now();
  const [nyc, bayarea] = await Promise.all([
    fetch("data/nyc_pumas_clean.geojson" + cacheBust).then((r) => r.json()),
    fetch("data/bayarea_pumas_clean.geojson" + cacheBust).then((r) => r.json()),
  ]);
  applyOverrides(nyc.features);
  applyOverrides(bayarea.features);
  state.data.nyc = nyc;
  state.data.bayarea = bayarea;
}

function currentFeatures() {
  const fc = state.data[state.city];
  return fc ? fc.features : [];
}

function priceBounds(features, field) {
  const vals = features
    .map((f) => f.properties[field])
    .filter((v) => typeof v === "number" && !isNaN(v));
  return [Math.min(...vals), Math.max(...vals)];
}

// Returns true only if at least one feature in the current city has a
// usable (finite) supply_elasticity value -- lets the site degrade
// gracefully (hide the substitution option) if older, non-enriched data
// is ever loaded instead of the enriched files.
function hasSupplyElasticityData(features) {
  return features.some((f) => {
    const v = f.properties.supply_elasticity;
    return typeof v === "number" && !isNaN(v);
  });
}

// ------------------------------------------------------------------
// Computation
// ------------------------------------------------------------------
// Per-feature "independent" (naive) calculation -- unchanged math from
// the original single-neighborhood model.
function computeNaive(props) {
  const field = METRIC_FIELD[state.metric];
  const currentPrice = props[field.current];
  const currentUnits = props.total_housing_units;

  const unitsRaw = unitsToReachTargetPrice(
    currentPrice, currentUnits, state.targetPrice, state.elasticity
  );
  const unitsToBuild = unitsRaw === null ? null : Math.max(0, unitsRaw);
  const pct = unitsRaw === null ? null : pctChange(currentUnits, currentUnits + unitsRaw);
  return { unitsToBuild, pct, currentPrice, currentUnits };
}

// Computes BOTH the independent and substitution-adjusted values for
// every feature in one pass -- the reallocation only makes sense computed
// across the whole set of features at once (it's a portfolio-level
// redistribution, not a per-feature formula).
function computeAllValues(features) {
  const naiveResults = features.map((f) => computeNaive(f.properties));
  const naiveUnitsArray = naiveResults.map((r) => r.unitsToBuild);
  const elasticityArray = features.map((f) => f.properties.supply_elasticity);

  const reallocated = reallocateBySupplyElasticity(naiveUnitsArray, elasticityArray);

  return features.map((f, i) => ({
    naive: naiveResults[i],
    reallocatedUnits: reallocated[i],
    supplyElasticity: f.properties.supply_elasticity,
    cbdDistanceKm: f.properties.cbd_distance_km,
  }));
}

function activeUnitsValue(computed) {
  return state.model === "substitution" ? computed.reallocatedUnits : computed.naive.unitsToBuild;
}

// ------------------------------------------------------------------
// Rendering: controls
// ------------------------------------------------------------------
function renderToggle(containerId, options, activeKey, onSelect) {
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  options.forEach(({ key, label }) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.className = key === activeKey ? "active" : "";
    btn.onclick = () => onSelect(key);
    el.appendChild(btn);
  });
}

function refreshControls() {
  renderToggle("city-toggle", [
    { key: "nyc", label: "New York City" },
    { key: "bayarea", label: "Bay Area" },
  ], state.city, (key) => { state.city = key; onCityOrMetricChange(); });

  renderToggle("metric-toggle", [
    { key: "rent", label: "Rent" },
    { key: "price", label: "Home Price" },
  ], state.metric, (key) => { state.metric = key; onCityOrMetricChange(); });

  const modelToggleEl = document.getElementById("model-toggle");
  const modelToggleWrap = document.getElementById("model-toggle-wrap");
  if (hasSupplyElasticityData(currentFeatures())) {
    modelToggleWrap.style.display = "";
    renderToggle("model-toggle", [
      { key: "substitution", label: "With substitution (recommended)" },
      { key: "independent", label: "Independent neighborhoods" },
    ], state.model, (key) => { state.model = key; renderMap(); renderTable(); });
  } else {
    modelToggleWrap.style.display = "none";
    state.model = "independent";
  }

  renderSliders();
}

function onCityOrMetricChange() {
  const field = METRIC_FIELD[state.metric];
  const [lo, hi] = priceBounds(currentFeatures(), field.current);
  state.targetPrice = Math.round((lo + hi) / 2);
  refreshControls();
  renderMap();
  renderTable();
}

function renderSliders() {
  const container = document.getElementById("sliders");
  container.innerHTML = "";

  const field = METRIC_FIELD[state.metric];
  const [lo, hi] = priceBounds(currentFeatures(), field.current);
  const sliderMin = Math.round(lo * 0.5);
  const sliderMax = Math.round(hi * 1.5);
  if (state.targetPrice === null) state.targetPrice = Math.round((lo + hi) / 2);

  addSlider(container, {
    label: `Target ${field.label.toLowerCase()}`,
    min: sliderMin,
    max: sliderMax,
    step: state.metric === "rent" ? 10 : 1000,
    value: state.targetPrice,
    format: (v) => "$" + Math.round(v).toLocaleString(),
    onInput: (v) => { state.targetPrice = v; renderMap(); renderTable(); },
  });

  addSlider(container, {
    label: "Elasticity of demand (\u03B5)",
    min: -1.5,
    max: -0.5,
    step: 0.1,
    value: state.elasticity,
    format: (v) => v.toFixed(1),
    onInput: (v) => { state.elasticity = v; renderMap(); renderTable(); },
  });

  const note = document.createElement("p");
  note.className = "desc";
  note.style.marginTop = "-0.5rem";
  note.innerHTML =
    "Smaller \u03B5 means demand is more price sensitive: reaching a lower price target " +
    "requires a big increase in units, because more renters will come in. A less negative " +
    "\u03B5 means demand is less sensitive: the same price target needs a smaller change in " +
    "stock. A value between \u22121.5 and \u22120.5 is in line with the literature.";
  container.appendChild(note);
}

function addSlider(container, { label, min, max, step, value, format, onInput }) {
  const block = document.createElement("div");
  block.className = "slider-block";
  const labelEl = document.createElement("label");
  const spanText = document.createElement("span");
  spanText.textContent = label;
  const spanVal = document.createElement("span");
  spanVal.className = "val";
  spanVal.textContent = format(value);
  labelEl.appendChild(spanText);
  labelEl.appendChild(spanVal);

  const input = document.createElement("input");
  input.type = "range";
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = value;
  input.oninput = () => {
    const v = parseFloat(input.value);
    spanVal.textContent = format(v);
    onInput(v);
  };

  block.appendChild(labelEl);
  block.appendChild(input);
  container.appendChild(block);
}

// ------------------------------------------------------------------
// Rendering: map
// ------------------------------------------------------------------
let svg, projection, path, tooltipEl;

function initMap() {
  const containerEl = document.getElementById("map-container");
  const width = containerEl.clientWidth || 640;
  const height = Math.round(width * 0.75);

  svg = d3.select("#map-container").append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  projection = d3.geoMercator();
  path = d3.geoPath().projection(projection);

  tooltipEl = document.getElementById("tooltip");
}

function colorScaleFor(values) {
  const max = Math.max(1, ...values.filter((v) => v !== null && !isNaN(v)));
  return d3.scaleSequential(d3.interpolateOrRd).domain([0, max]);
}

function renderMap() {
  const features = currentFeatures();
  if (!features.length) return;

  const width = svg.node().viewBox.baseVal.width;
  const height = svg.node().viewBox.baseVal.height;
  const fc = { type: "FeatureCollection", features };
  projection.fitSize([width - 10, height - 10], fc);

  const allValues = computeAllValues(features);
  const displayValues = allValues.map((c) => activeUnitsValue(c));
  const color = colorScaleFor(displayValues);

  const sel = svg.selectAll("path.puma-path").data(features, (d) => d.properties.puma_geoid);

  sel.join(
    (enter) => enter.append("path")
      .attr("class", "puma-path")
      .attr("d", path)
      .attr("fill", (d, i) => displayValues[i] === null ? "#333" : color(displayValues[i]))
      .on("mousemove", (event, d) => showTooltip(event, d))
      .on("mouseleave", hideTooltip),
    (update) => update
      .attr("d", path)
      .attr("fill", (d, i) => displayValues[i] === null ? "#333" : color(displayValues[i])),
    (exit) => exit.remove()
  );

  renderLegend(color, displayValues);
}

function showTooltip(event, feature) {
  const props = feature.properties;
  const field = METRIC_FIELD[state.metric];
  const naive = computeNaive(props);

  // Recompute the full reallocated set just for this single lookup --
  // acceptable cost at these dataset sizes (a few hundred features),
  // keeps this function self-contained for the tooltip.
  const features = currentFeatures();
  const idx = features.findIndex((f) => f.properties.puma_geoid === props.puma_geoid);
  const allValues = computeAllValues(features);
  const thisComputed = allValues[idx];

  const hasElasticity = typeof props.supply_elasticity === "number" && !isNaN(props.supply_elasticity);

  let rows = `
    <div class="t-row"><span>Current ${field.label.toLowerCase()}</span><span>${props[field.display]}</span></div>
    <div class="t-row"><span>Current units</span><span>${props.total_housing_units.toLocaleString()}</span></div>
    <div class="t-row"><span>Units to build (independent)</span><span>${naive.unitsToBuild === null ? "n/a" : Math.round(naive.unitsToBuild).toLocaleString()}</span></div>
  `;
  if (hasElasticity) {
    rows += `
      <div class="t-row"><span>Units to build (with substitution)</span><span>${thisComputed.reallocatedUnits === null ? "n/a" : Math.round(thisComputed.reallocatedUnits).toLocaleString()}</span></div>
      <div class="t-row"><span>Supply elasticity</span><span>${props.supply_elasticity.toFixed(2)}</span></div>
      <div class="t-row"><span>Distance to job center</span><span>${props.cbd_distance_km.toFixed(1)} km</span></div>
    `;
  }

  tooltipEl.innerHTML = `<div class="t-title">${props.display}</div>${rows}`;
  tooltipEl.style.left = (event.clientX + 16) + "px";
  tooltipEl.style.top = (event.clientY + 16) + "px";
  tooltipEl.classList.add("visible");
}

function hideTooltip() {
  tooltipEl.classList.remove("visible");
}

function renderLegend(color, values) {
  const legend = document.getElementById("legend");
  const max = Math.max(1, ...values.filter((v) => v !== null && !isNaN(v)));
  const stops = d3.range(0, 1.01, 0.1).map((t) => color(t * max));
  const gradientCss = `linear-gradient(to right, ${stops.join(",")})`;

  const modeLabel = state.model === "substitution"
    ? "Units to build (with substitution)"
    : "Units to build (independent)";
  const modeNote = state.model === "substitution"
    ? "Same metro-wide total as the independent model, but redistributed toward neighborhoods where building is easier (per Baum-Snow &amp; Han, 2024)."
    : "Each neighborhood treated as if it had to meet demand entirely on its own, with no spillover to or from nearby areas.";

  legend.innerHTML = `
    <h3>${modeLabel}</h3>
    <div class="legend-gradient" style="background:${gradientCss}"></div>
    <div class="legend-labels"><span>0</span><span>${Math.round(max).toLocaleString()}</span></div>
    <div class="legend-note">${modeNote}</div>
  `;
}

// ------------------------------------------------------------------
// Rendering: table
// ------------------------------------------------------------------
function renderTable() {
  const features = currentFeatures();
  const field = METRIC_FIELD[state.metric];
  const allValues = computeAllValues(features);
  const showSubstitutionCols = hasSupplyElasticityData(features);

  const rows = features.map((f, i) => {
    const c = allValues[i];
    return {
      name: f.properties.display,
      currentPrice: f.properties[field.current],
      currentPriceDisplay: f.properties[field.display],
      units: f.properties.total_housing_units,
      supplyElasticity: c.supplyElasticity,
      independentUnits: c.naive.unitsToBuild,
      substitutionUnits: c.reallocatedUnits,
      pct: c.naive.pct,
    };
  });

  const columns = [
    { key: "name", label: "Neighborhood (ZIP)", type: "str" },
    { key: "currentPriceDisplay", sortKey: "currentPrice", label: `Current ${field.label}`, type: "num" },
    { key: "units", label: "Current Units", type: "num", fmt: (v) => v.toLocaleString() },
    { key: "independentUnits", label: "Units to Build (Independent)", type: "num", fmt: (v) => v === null ? "n/a" : Math.round(v).toLocaleString() },
  ];
  if (showSubstitutionCols) {
    columns.push(
      { key: "substitutionUnits", label: "Units to Build (With Substitution)", type: "num", fmt: (v) => v === null ? "n/a" : Math.round(v).toLocaleString() },
      { key: "supplyElasticity", label: "Supply Elasticity", type: "num", fmt: (v) => (typeof v === "number" && !isNaN(v)) ? v.toFixed(2) : "n/a" }
    );
  }

  if (state.sortKey) {
    rows.sort((a, b) => {
      const ak = a[state.sortKey], bk = b[state.sortKey];
      if (ak === null || ak === undefined) return 1;
      if (bk === null || bk === undefined) return -1;
      if (typeof ak === "string") return state.sortAsc ? ak.localeCompare(bk) : bk.localeCompare(ak);
      return state.sortAsc ? ak - bk : bk - ak;
    });
  }

  const thead = columns.map((c) => {
    const key = c.sortKey || c.key;
    const sortedClass = state.sortKey === key ? (state.sortAsc ? "sorted-asc" : "sorted") : "";
    return `<th class="${sortedClass}" data-key="${key}">${c.label}</th>`;
  }).join("");

  const tbody = rows.map((r) => {
    return "<tr>" + columns.map((c) => {
      const raw = r[c.key];
      const val = c.fmt ? c.fmt(raw) : raw;
      const cls = c.type === "num" ? "num" : "";
      return `<td class="${cls}">${val}</td>`;
    }).join("") + "</tr>";
  }).join("");

  const tableEl = document.getElementById("data-table");
  tableEl.innerHTML = `<thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody>`;

  tableEl.querySelectorAll("th[data-key]").forEach((th) => {
    th.onclick = () => {
      const key = th.dataset.key;
      if (state.sortKey === key) { state.sortAsc = !state.sortAsc; }
      else { state.sortKey = key; state.sortAsc = false; }
      renderTable();
    };
  });
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
async function main() {
  initMap();
  await loadData();
  onCityOrMetricChange();
}

document.addEventListener("DOMContentLoaded", main);
