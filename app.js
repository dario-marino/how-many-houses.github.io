/**
 * app.js
 * How Many Houses? -- a neighborhood-level (PUMA) housing shortage explorer
 * for NYC and the Bay Area, companion to "Building Houses, Yes, But How Many?"
 *
 * Data expected at:
 *   data/nyc_pumas_clean.geojson
 *   data/bayarea_pumas_clean.geojson
 * (produced by build_dataset.py)
 *
 * Depends on: d3 v7 (CDN), formulas.js (loaded before this file)
 */

const DEFAULTS = {
  elasticity: -1.0,     // slider range -1.5 (elastic) to -0.5 (inelastic)
  benchmarkVacancy: 0.08, // 8% gross vacancy benchmark for Section 2
};

const state = {
  city: "nyc",              // "nyc" | "bayarea"
  metric: "rent",           // "rent" | "price"
  section: 1,                // 1 | 2
  elasticity: DEFAULTS.elasticity,
  benchmarkVacancy: DEFAULTS.benchmarkVacancy,
  targetPrice: null,         // set once data loads, per city+metric
  sortKey: null,
  sortAsc: false,
  data: { nyc: null, bayarea: null }, // geojson FeatureCollections
};

const METRIC_FIELD = {
  rent: { current: "median_gross_rent", display: "median_gross_rent_display", label: "Rent" },
  price: { current: "median_home_value", display: "median_home_value_display", label: "Home Price" },
};

// ------------------------------------------------------------------
// Data loading
// ------------------------------------------------------------------
async function loadData() {
  const [nyc, bayarea] = await Promise.all([
    fetch("data/nyc_pumas_clean.geojson").then((r) => r.json()),
    fetch("data/bayarea_pumas_clean.geojson").then((r) => r.json()),
  ]);
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

// ------------------------------------------------------------------
// Computation (delegates to formulas.js)
// ------------------------------------------------------------------
function computeForFeature(props) {
  const field = METRIC_FIELD[state.metric];
  const currentPrice = props[field.current];
  const currentUnits = props.total_housing_units;
  const occupiedUnits = props.occupied_units;

  if (state.section === 1) {
    const unitsRaw = unitsToReachTargetPrice(
      currentPrice, currentUnits, state.targetPrice, state.elasticity
    );
    const unitsToBuild = unitsRaw === null ? null : Math.max(0, unitsRaw);
    const pct = unitsRaw === null ? null : pctChange(currentUnits, currentUnits + unitsRaw);
    return { primary: unitsToBuild, pct, currentPrice, currentUnits };
  } else {
    const { shortageUnits, resultingPrice } = shortageAndResultingPrice(
      currentPrice, currentUnits, occupiedUnits, state.benchmarkVacancy, state.elasticity
    );
    const pct = resultingPrice === null ? null : pctChange(currentPrice, resultingPrice);
    return { primary: shortageUnits, resultingPrice, pct, currentPrice, currentUnits };
  }
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

  renderToggle("section-toggle", [
    { key: 1, label: "1. Units needed at a target price" },
    { key: 2, label: "2. Today's shortage" },
  ], state.section, (key) => { state.section = key; renderAll(); });

  renderSliders();
}

function onCityOrMetricChange() {
  const field = METRIC_FIELD[state.metric];
  const [lo, hi] = priceBounds(currentFeatures(), field.current);
  // default target = current metro median-ish (midpoint of bounds), clamped
  state.targetPrice = Math.round((lo + hi) / 2);
  refreshControls();
  renderAll();
}

function renderSliders() {
  const container = document.getElementById("sliders");
  container.innerHTML = "";

  const field = METRIC_FIELD[state.metric];

  if (state.section === 1) {
    const [lo, hi] = priceBounds(currentFeatures(), field.current);
    const sliderMin = Math.round(lo * 0.5);
    const sliderMax = Math.round(hi * 1.5);
    if (state.targetPrice === null) state.targetPrice = Math.round((lo + hi) / 2);

    addSlider(container, {
      label: `Target ${field.label.toLowerCase()}`,
      min: sliderMin, max: sliderMax,
      step: state.metric === "rent" ? 10 : 5000,
      value: state.targetPrice,
      format: (v) => "$" + Math.round(v).toLocaleString(),
      onInput: (v) => { state.targetPrice = v; renderAll(); },
    });
  } else {
    addSlider(container, {
      label: "Benchmark healthy vacancy rate",
      min: 0.05, max: 0.12, step: 0.01,
      value: state.benchmarkVacancy,
      format: (v) => (v * 100).toFixed(0) + "%",
      onInput: (v) => { state.benchmarkVacancy = v; renderAll(); },
    });
  }

  addSlider(container, {
    label: "Elasticity of demand (\u03B5)",
    min: -1.5, max: -0.5, step: 0.05,
    value: state.elasticity,
    format: (v) => v.toFixed(2),
    onInput: (v) => { state.elasticity = v; renderAll(); },
  });
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
  input.min = min; input.max = max; input.step = step; input.value = value;
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

  const computed = features.map((f) => computeForFeature(f.properties));
  const values = computed.map((c) => c.primary);
  const color = colorScaleFor(values);

  const sel = svg.selectAll("path.puma-path").data(features, (d) => d.properties.puma_geoid);

  sel.join(
    (enter) => enter.append("path")
      .attr("class", "puma-path")
      .attr("d", path)
      .attr("fill", (d, i) => values[i] === null ? "#333" : color(values[i]))
      .on("mousemove", (event, d) => showTooltip(event, d))
      .on("mouseleave", hideTooltip),
    (update) => update
      .attr("d", path)
      .attr("fill", (d, i) => values[i] === null ? "#333" : color(values[i])),
    (exit) => exit.remove()
  );

  renderLegend(color, values);
}

function showTooltip(event, feature) {
  const props = feature.properties;
  const c = computeForFeature(props);
  const field = METRIC_FIELD[state.metric];

  let rows = "";
  if (state.section === 1) {
    rows = `
      <div class="t-row"><span>Current ${field.label.toLowerCase()}</span><span>${props[field.display]}</span></div>
      <div class="t-row"><span>Current units</span><span>${props.total_housing_units.toLocaleString()}</span></div>
      <div class="t-row"><span>Units to build</span><span>${c.primary === null ? "n/a" : Math.round(c.primary).toLocaleString()}</span></div>
    `;
  } else {
    rows = `
      <div class="t-row"><span>Current ${field.label.toLowerCase()}</span><span>${props[field.display]}</span></div>
      <div class="t-row"><span>Vacancy rate</span><span>${(props.vacancy_rate * 100).toFixed(1)}%</span></div>
      <div class="t-row"><span>Shortage (units)</span><span>${c.primary === null ? "n/a" : Math.round(c.primary).toLocaleString()}</span></div>
      <div class="t-row"><span>Price if closed</span><span>${c.resultingPrice === null ? "n/a" : "$" + Math.round(c.resultingPrice).toLocaleString()}</span></div>
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

  const title = state.section === 1 ? "Units to build" : "Unit shortage";

  legend.innerHTML = `
    <h3>${title}</h3>
    <div class="legend-gradient" style="background:${gradientCss}"></div>
    <div class="legend-labels"><span>0</span><span>${Math.round(max).toLocaleString()}</span></div>
    <div class="legend-note">
      ${state.section === 1
        ? "Darker = more new units needed in that PUMA to hit the target price you've set, at the chosen elasticity."
        : "Darker = larger gap between current housing stock and a healthy (" + (state.benchmarkVacancy*100).toFixed(0) + "%) vacancy rate."}
    </div>
  `;
}

// ------------------------------------------------------------------
// Rendering: table
// ------------------------------------------------------------------
function renderTable() {
  const features = currentFeatures();
  const field = METRIC_FIELD[state.metric];

  const rows = features.map((f) => {
    const c = computeForFeature(f.properties);
    return {
      name: f.properties.display,
      currentPrice: f.properties[field.current],
      currentPriceDisplay: f.properties[field.display],
      units: f.properties.total_housing_units,
      vacancy: f.properties.vacancy_rate,
      primary: c.primary,
      resultingPrice: c.resultingPrice,
      pct: c.pct,
    };
  });

  const columns = state.section === 1
    ? [
        { key: "name", label: "Neighborhood (PUMA)", sortable: true, type: "str" },
        { key: "currentPriceDisplay", sortKey: "currentPrice", label: `Current ${field.label}`, sortable: true, type: "num" },
        { key: "units", label: "Current Units", sortable: true, type: "num", fmt: (v) => v.toLocaleString() },
        { key: "primary", label: "Units to Build", sortable: true, type: "num", fmt: (v) => v === null ? "n/a" : Math.round(v).toLocaleString() },
        { key: "pct", label: "% Change in Stock", sortable: true, type: "num", fmt: (v) => v === null ? "n/a" : v.toFixed(1) + "%" },
      ]
    : [
        { key: "name", label: "Neighborhood (PUMA)", sortable: true, type: "str" },
        { key: "currentPriceDisplay", sortKey: "currentPrice", label: `Current ${field.label}`, sortable: true, type: "num" },
        { key: "vacancy", label: "Vacancy Rate", sortable: true, type: "num", fmt: (v) => (v * 100).toFixed(1) + "%" },
        { key: "primary", label: "Shortage (Units)", sortable: true, type: "num", fmt: (v) => v === null ? "n/a" : Math.round(v).toLocaleString() },
        { key: "resultingPrice", label: "Price if Closed", sortable: true, type: "num", fmt: (v) => v === null ? "n/a" : "$" + Math.round(v).toLocaleString() },
      ];

  if (state.sortKey) {
    const col = columns.find((c) => (c.sortKey || c.key) === state.sortKey);
    rows.sort((a, b) => {
      const ak = a[state.sortKey], bk = b[state.sortKey];
      if (ak === null) return 1;
      if (bk === null) return -1;
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
function renderAll() {
  renderSliders();
  renderMap();
  renderTable();
}

async function main() {
  initMap();
  await loadData();
  onCityOrMetricChange(); // sets targetPrice + triggers refreshControls + renderAll
}

document.addEventListener("DOMContentLoaded", main);
