# US Crop Atlas

**Explore U.S. agriculture, from a national crop map to an individual field and its planting history.**

US Crop Atlas is an open-source map for browsing USDA crop and land-cover data, comparing years, selecting whole fields, and exporting records for further analysis. The nationwide interface supports **English, Español, and 简体中文**.

## Inspiration and attribution

This project is built on and inspired by **[SabhyaC26/crop-map](https://github.com/SabhyaC26/crop-map)** by **Sabhya Chhabria**, an open-source crop map focused on California. Its field-first exploration, MapLibre foundation, visual approach, fonts, and crop illustrations provided the starting point for this work. This repository includes code and assets derived from that project; it is more than a conceptual reference. The original MIT license and copyright notice are preserved in [LICENSE](LICENSE).

Our direction is to bring that approachable map experience to **agricultural data across the United States**, using USDA's national crop layers and crop-sequence boundaries, with historical exploration, exports, and multilingual access. Nationwide coverage follows the underlying datasets: the contiguous 48 states are covered, Hawaii has a separate crop layer, and Alaska is not covered by the connected sources.

This is an independent community project, not an official USDA application. The original California DWR interface remains available as a separate legacy page when its data files are configured.

## What you can do

- Browse annual crop and land-cover maps across the contiguous U.S. and Hawaii.
- Filter by crop, change layer opacity, and navigate by state or example location.
- Move through years with the timeline or select a record from a location's history.
- Click a field to highlight its complete boundary, view its estimated area, and export GeoJSON.
- Read eight years of field-level majority crop records separately from the longer history sampled at the clicked coordinate.
- Export coordinate history as CSV, including source, classification codes, query status, and retrieval timestamps.
- Switch between English, Spanish, and Simplified Chinese without resetting the map, filters, selected field, or year.
- Share a URL containing the language, region, year, crop filter, and selected coordinate.

The interface is localized, including crop names, coverage notes, errors, and accessibility labels. USDA names and codes in CSV/GeoJSON remain in their original form so exports are consistent across languages. Place names drawn into the external basemap are supplied by Esri and are not translated by the app. The legacy California page retains its original interface.

## Quick start

Requirements: **Node.js 22.12+**, npm, and an internet connection. No USDA API key is required for the connected services.

```sh
git clone https://github.com/georgezouq/crop-map.git
cd crop-map/site
npm ci
npm run build
npm start
```

Open **[localhost:8787](http://localhost:8787)**. The annual catalog is included in the repository; the server fetches map tiles, point samples, and field boundaries as you explore.

The production server serves both the built site and the API. Publishing `site/dist` alone to static hosting does **not** provide the nationwide data API.

For development:

```sh
cd site
npm run dev
```

This starts the API on port **8787** and Vite on **5175**. Both ports must be available. Use `npm run api` or `npm run dev:site` to run them separately.

## Coverage and interpretation

| Dataset / region | Connected years | What it represents |
| --- | --- | --- |
| CDL, contiguous 48 states | 2008–2025 | Complete national crop / land-cover coverage |
| CDL, selected contiguous states | 1997–2007 | Partial early coverage; enable “Before 2008” |
| HCDL, Hawaii | 2023–2025 | Separate imagery service and classification catalog |
| CSB, contiguous 48 states | 2015–2022 boundary window | Inferred field polygons, estimated acreage, and eight annual majority crops |
| Alaska | Not available | No coverage in the connected datasets |

### Crop pixels and field boundaries are different

**CDL** is satellite-classified land cover. A location's annual history samples the same coordinate; it is not a field-wide acreage estimate, farm declaration, or official planted-area statistic. Map tiles and samples explicitly lock the relevant annual raster IDs, so missing years do not silently fall back to the latest imagery.

**CSB** polygons represent inferred crop boundaries, not ownership boundaries, tax parcels, or surveyed farm boundaries. Selection uses exact point–polygon intersection and returns the full polygon, including multipart geometry and holes. It does not merge neighboring fields just because their crop colors match. Reported area comes from USDA's `csbacres` attribute; hectares use 1 acre = 0.40468564224 hectares.

The connected hosted CSB service provides the **2015–2022** window. Field history uses its `r15`–`r22` majority-crop attributes. Switching the CDL map to 2025 leaves that explicitly dated boundary unchanged and does not invent 2025 field-level records. USDA also publishes newer [downloadable CSB releases](https://www.nass.usda.gov/Research_and_Science/Crop-Sequence-Boundaries/), including 2018–2025. Those downloads are a separate source; integrating them requires a verified service or a locally hosted spatial index.

If a click has no matching field, coordinate history remains available. No coverage and upstream request failures are presented separately; boundary lookup can be retried independently.

### Historical data is not a publication-time snapshot

The map displays currently available historical releases, which may include revisions. It does not reconstruct what was publicly known on a past date and is not, by itself, a point-in-time dataset for investment backtesting.

Use the **Imagery** basemap and switch off **Crop overlay** to compare a selected point with reference imagery, including roads and field edges. Imagery dates may differ from the selected crop year; this is a visual aid, not ground verification. Annual rows show the source class code and sampling resolution. A crop-classified pixel can include mixed land cover or classification errors, especially at field edges. No matched CSB boundary means the app has only a point classification; it proves neither the presence nor absence of crops.

Native CDL resolution in the contiguous U.S. is 30 m for 2008–2023 and 10 m from 2024; some earlier datasets use 56 m. Resolution, classification changes, and positional differences can affect comparisons. The service-wide `Acreage` and `Count` fields are not used as annual acreage statistics.

## How data loading works

```text
Browser (MapLibre + TypeScript)
        ↓ same-origin /api requests
Local Node server
        ↓ bounded requests + disk cache
USDA imagery, annual samples, and CSB feature service
```

- Imagery is requested only for the visible map tiles.
- Point history queries each year independently. Official raster footprints and year-locked NoData checks distinguish uncovered locations from service errors.
- Field geometry is queried on demand rather than downloading national polygon archives into the browser.
- The server deduplicates concurrent requests and limits upstream concurrency.
- Successful responses are cached on disk for up to **7 days**, with a default limit of approximately **1 GiB**. Cleanup runs at most once per minute, so temporary usage can exceed the limit. Failed responses are not cached as missing data.
- The default cache is `data/cache/usda/`; cached responses survive restarts. The Esri basemap is loaded separately.

**The cache is not a complete offline copy of U.S. agricultural data.** Unvisited tiles, uncached coordinates, and the basemap require a network connection. Downloading raw archives does not automatically make them available as offline map tiles.

### API

| Endpoint | Response |
| --- | --- |
| `GET /api/health` | Server health and catalog import timestamp |
| `GET /api/catalog` | Regions, annual raster IDs, and crop legends; detailed footprints stay server-side |
| `GET /api/tiles/:region/:year/:z/:x/:y.png?crop=1` | Year-specific PNG tile, optionally filtered by class code |
| `GET /api/history?region=conus&lon=-93.6&lat=42.1` | Annual samples and per-year status |
| `GET /api/field?region=conus&lon=-93.6&lat=42.1` | GeoJSON field, boundary period, source, and cache metadata |

Supported region keys are `conus` and `hawaii`. Field responses distinguish `ok`, `nodata`, and `unsupported`; upstream failures return HTTP 502. The API is read-only.

## Configuration and hosting

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | API / production server port |
| `HOST` | `127.0.0.1` | Listening address |
| `CROP_CACHE_DIR` | `data/cache/usda/` | Persistent cache directory |

For a Node host or container, install dependencies, build the site, and start with `HOST=0.0.0.0 npm start` from `site/`. Mount a persistent cache directory if desired. A public installation should provide HTTPS and appropriate access controls or request limits at the hosting layer. The default setup listens only on the local machine.

## Refresh the annual catalog

```sh
cd site
npm run import:usda
npm test
npm run build
```

Restart the Node server after importing. The importer discovers actual annual raster IDs, crop legends, and footprints, validates them, then atomically updates `site/public/data/usda/catalog.json`. It does not guess future years. New classification names should also be added to the translation dictionary.

CSB source configuration and field mappings are in `server/fields.mjs`. Updating the catalog alone does not update the connected CSB boundary window.

## Download raw USDA raster archives

Python 3 and `curl` are needed for the optional downloader. From the repository root:

```sh
# Discover official archive links and write a manifest, without bulk downloading:
python3 pipeline/download-usda.py --years 2008:2025 --hawaii

# Download the listed national 30 m archives and Hawaii data:
python3 pipeline/download-usda.py --years 2008:2025 --hawaii --download
```

Use `--resolution 10` for native 10 m archives from 2024 onward; older years still use 30 m. Downloads support resuming, ZIP validation, and local SHA-256 receipts. The checksum is calculated locally, not an official USDA signature. Files go into `data/raw/usda/`, which is excluded from Git.

Plan storage for the compressed archives, extracted rasters, and any tiles you generate. An offline national map additionally needs raster tiling or a COG-serving workflow; this downloader does not build one.

## Languages and contributions

Language selection follows this order: a supported `?lang=en`, `?lang=es`, or `?lang=zh-CN` URL value; a saved preference; the browser's supported language preferences; then English. Manual choices persist locally. Switching language does not re-fetch agricultural data or change export schemas.

- `site/src/usda/messages.json`: interface translations with matching interpolation placeholders.
- `site/src/usda/crop-names.json`: Spanish and Chinese names for the USDA classes in the imported catalogs.
- `site/src/usda/i18n.ts`: locale selection, formatting, text bindings, and place labels.
- `site/index.html`: English fallback markup and translation keys.

Contributions to data coverage, usability, translations, and reproducible analysis are welcome. Keep source attribution and data-period labels visible. For data changes, document the official source, coverage, resolution, and field mappings; never treat a missing response as a zero value. Run the relevant checks below before submitting a pull request. Include screenshots for interface changes.

## Tests

```sh
cd site
npm test
npm run build
npm audit

# Start npm start in another terminal, then run:
node ../tests/usda/live.mjs
npx playwright install chromium --only-shell
npm run test:browser
node test-fields-browser.mjs
node test-i18n-browser.mjs
node test-accuracy-browser.mjs
```

An installed Chrome can be used with `PLAYWRIGHT_CHANNEL=chrome` before a browser-test command. Tests launch an isolated browser profile.

Unit tests cover data validation, annual raster locking, cache behavior, field parsing, and translation coverage. Live checks exercise actual USDA services. Browser checks cover desktop/mobile maps, whole-field selection, exports, historical navigation, error handling, and language switching. Screenshots and reports are written to `artifacts/usda/` and are excluded from Git. Live checks require network access and can fail when external services are unavailable.

## Repository layout

```text
site/src/usda/           Nationwide map, field selection, history, localization
site/public/data/usda/   Imported USDA annual catalog
server/                 HTTP API, raster/field queries, persistent cache
pipeline/               Catalog importer and raw-data downloader
tests/usda/             Unit tests and live service checks
```

The remaining frontend and pipeline files include the inherited California application and its data-preparation tooling.

## Legacy California map

`/california.html` preserves the original California DWR field-map experience. Its data model differs from the nationwide USDA interface. Prepare the original `basemap.pmtiles`, `fields.pmtiles`, `overview.pmtiles`, and `fields-low.pmtiles` files, or configure hosted equivalents during the build:

```sh
cd site
VITE_BASEMAP_URL=https://tiles.example.com/basemap.pmtiles \
VITE_FIELDS_URL=https://tiles.example.com/fields.pmtiles \
VITE_OVERVIEW_URL=https://tiles.example.com/overview.pmtiles \
VITE_FIELDS_LOW_URL=https://tiles.example.com/fields-low.pmtiles npm run build
```

The original pipeline uses Python, GDAL, tippecanoe, and pmtiles (`make setup`, `make download`, `make all`, and `pipeline/basemap.sh`). These large PMTiles are not required for the nationwide app. The inherited `deploy.sh` targets the California static site; it does not deploy the nationwide API.

## Data sources, credits, and license

- **Original project:** [SabhyaC26/crop-map](https://github.com/SabhyaC26/crop-map), Sabhya Chhabria. Original code and crop-map design are credited above; the original MIT notice is retained.
- **Crop layers:** [USDA NASS Cropland Data Layer](https://www.nass.usda.gov/Research_and_Science/Cropland/SARS1a.php) and [official raster downloads](https://data.nass.usda.gov/Research_and_Science/Cropland/Release/). Connected services: [CDL_WM](https://pdi.scinet.usda.gov/image/rest/services/CDL_WM/ImageServer) and [CDL_WM_Hawaii](https://pdi.scinet.usda.gov/image/rest/services/CDL_WM_Hawaii/ImageServer).
- **Field boundaries:** [USDA NASS Crop Sequence Boundaries](https://www.nass.usda.gov/Research_and_Science/Crop-Sequence-Boundaries/) and the connected [2015–2022 hosted layer](https://pdi.scinet.usda.gov/hosting/rest/services/Hosted/Crop_Sequence_Boundary_2022/FeatureServer/0).
- **Basemap:** [Esri World Light Gray Canvas](https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer), with Esri, HERE, Garmin, OpenStreetMap, and GIS user community attribution. External basemap content remains subject to its provider's terms.
- **Reference imagery:** [Esri World Imagery](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer), attributed to Esri, Vantor, Earthstar Geographics, and the GIS User Community. It is independent of USDA crop-year selection.
- **Legacy California fields:** California Department of Water Resources Statewide Crop Mapping 2023 / Land IQ.
- **Inherited visual assets:** Microsoft Fluent Emoji (MIT), Figtree (SIL Open Font License), and the original OSM / Protomaps basemap (ODbL), under their respective licenses.

Code is distributed under the **[MIT License](LICENSE)**. That license does not replace the terms or attribution requirements of third-party data, fonts, icons, or map services.
