/**
 * app.js
 * How Many Houses? -- a neighborhood-level (PUMA) housing-price explorer
 * for NYC and the Bay Area, companion to "Building Houses, Yes, But How Many?"
 *
 * Data expected at:
 *   data/nyc_pumas_clean.geojson
 *   data/bayarea_pumas_clean.geojson
 *
 * Depends on: d3 v7 (CDN), formulas.js (loaded before this file)
 */

// ------------------------------------------------------------------
// HARDCODED FIXES / OVERRIDES
// ------------------------------------------------------------------
// One-off cosmetic corrections, keyed by puma_geoid (7-char Census GEOID
// string). Add a new line here any time a naming issue shows up -- no
// Python rerun needed, just edit this file and refresh.
const NAME_OVERRIDES = {
  "3604501": "North Shore (Staten Island CD 1)",
  "3604502": "Mid-Island (Staten Island CD 2)",
  "3604503": "South Shore (Staten Island CD 3)",
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
  city: "nyc",         // "nyc" | "bayarea"
  metric: "rent",      // "rent" | "price"
  elasticity: -1.0,     // -1.5 (elastic) to -0.5 (inelastic), 0.1 steps
  targetPrice: null,    // set per city+metric once data loads
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
  const [nyc, bayarea] = await Promise.all([
    fetch("data/nyc_pumas_clean.geojson").then((r) => r.json()),
    fetch("data/bayarea_pumas_clean.geojson").then((r) => r.json()),
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

// ------------------------------------------------------------------
// Computation (delegates to formulas.js)
// ------------------------------------------------------------------
function computeForFeature(props) {
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

// Called ONLY on structural changes (city/metric switch, or initial load).
// This is the only place that should ever rebuild the slider DOM -- never
// call this from a slider's own oninput handler, or dragging breaks (the
// browser cancels a drag gesture if the element under the pointer gets
// replaced mid-drag).
function refreshControls() {
  renderToggle("city-toggle", [
    { key: "nyc", label: "New York City" },
    { key: "bayarea", label: "Bay Area" },
  ], state.city, (key) => { state.city = key; onCityOrMetricChange(); });

  renderToggle("metric-toggle", [
    { key: "rent", label: "Rent" },
    { key: "price", label: "Home Price" },
  ], state.metric, (key) => { state.metric = key; onCityOrMetricChange(); });

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

// Builds the slider DOM. Called only from refreshControls() (structural),
// never from a slider's own oninput.
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
    // IMPORTANT: only repaint the map/table on input -- never rebuild
    // the sliders themselves, or dragging will break.
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
  // This handler ONLY updates state + the label text + repaints the map
  // and table. It never touches the slider's own DOM node, so both
  // click-to-jump and click-and-drag work exactly like a normal
  // <input type="range">.
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
  const values = computed.map((c) => c.unitsToBuild);
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

  const rows = `
    <div class="t-row"><span>Current ${field.label.toLowerCase()}</span><span>${props[field.display]}</span></div>
    <div class="t-row"><span>Current units</span><span>${props.total_housing_units.toLocaleString()}</span></div>
    <div class="t-row"><span>Units to build</span><span>${c.unitsToBuild === null ? "n/a" : Math.round(c.unitsToBuild).toLocaleString()}</span></div>
  `;

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

  legend.innerHTML = `
    <h3>Units to build</h3>
    <div class="legend-gradient" style="background:${gradientCss}"></div>
    <div class="legend-labels"><span>0</span><span>${Math.round(max).toLocaleString()}</span></div>
    <div class="legend-note">
      Darker = more new units needed in that PUMA to hit the target price you've set, at the chosen elasticity.
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
      unitsToBuild: c.unitsToBuild,
      pct: c.pct,
    };
  });

  const columns = [
    { key: "name", label: "Neighborhood (PUMA)", type: "str" },
    { key: "currentPriceDisplay", sortKey: "currentPrice", label: `Current ${field.label}`, type: "num" },
    { key: "units", label: "Current Units", type: "num", fmt: (v) => v.toLocaleString() },
    { key: "unitsToBuild", label: "Units to Build", type: "num", fmt: (v) => v === null ? "n/a" : Math.round(v).toLocaleString() },
    { key: "pct", label: "% Change in Stock", type: "num", fmt: (v) => v === null ? "n/a" : v.toFixed(1) + "%" },
  ];

  if (state.sortKey) {
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
async function main() {
  initMap();
  await loadData();
  onCityOrMetricChange(); // sets targetPrice + builds controls + renders map/table
}

document.addEventListener("DOMContentLoaded", main);
