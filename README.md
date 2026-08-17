# How Many Houses? — Neighborhood Housing Shortage Explorer

A companion visualization to *"Building Houses, Yes, But How Many?"* — lets a
reader set a target rent or home price and see how many housing units each
NYC or Bay Area neighborhood (PUMA) would need to get there, plus a second
view of today's shortage relative to a healthy vacancy benchmark.

## Folder structure (drop into a new GitHub repo/Pages folder)

```
your-repo-name.github.io/
├── index.html
├── style.css
├── app.js
├── formulas.js
└── data/
    ├── nyc_pumas_clean.geojson       <- produced by build_dataset.py
    └── bayarea_pumas_clean.geojson   <- produced by build_dataset.py
```

## Setup steps

1. Run `get_housing_puma_data.py` (pulls raw ACS + PUMA boundary data from
   the Census API into a local `data/` folder).
2. Run `build_dataset.py` (cleans names, flags top-coded home values, merges
   attributes into the PUMA polygons) — this produces
   `data/processed/nyc_pumas_clean.geojson` and
   `data/processed/bayarea_pumas_clean.geojson`.
3. Copy those two `*_clean.geojson` files into this site's `data/` folder
   (same level as `index.html`).
4. Open `index.html` directly in a browser, or push the whole folder to a
   GitHub Pages repo — no build step, no server required (everything is
   static HTML/CSS/JS, loaded via `fetch()`).

## What's interactive

- **City toggle**: New York City (55 PUMAs) ⇄ Bay Area (62 PUMAs, 9 counties).
- **Metric toggle**: Rent ⇄ Home Price — same methodology, different price series.
- **Section 1 — "Units needed at a target price"**: drag the target price
  slider and the elasticity slider (−1.5 to −0.5); the choropleth and table
  recompute live.
- **Section 2 — "Today's shortage"**: adjust the benchmark healthy vacancy
  rate (5–12%) and elasticity; shows the unit shortage and the price that
  would result if it were closed.
- **Sortable table** beneath the map mirrors whatever section/metric/city is
  currently selected — click any column header to sort.

## Methodology summary

Both tools use the same constant-elasticity demand-curve algebra, calibrated
off a single observed point (current price, current housing stock) per PUMA:

```
Section 1:  Q_new = Q_current * (P_target / P_current) ^ epsilon
            units_to_build = max(0, Q_new - Q_current)

Section 2:  Q_healthy = occupied_units / (1 - benchmark_vacancy)
            shortage  = max(0, Q_healthy - Q_current)
            P_new     = P_current * (Q_healthy / Q_current) ^ (1/epsilon)
```

See `formulas.js` for the implementation and inline documentation, and the
in-page methodology note at the bottom of `index.html` for the reader-facing
version.
