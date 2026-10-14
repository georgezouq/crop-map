import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
maplibregl.setWorkerUrl(workerUrl);
import type { RasterTileSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/tokens.css';
import './style.css';
import {
  t,
  text,
  clearText,
  language,
  setLanguage,
  applyLanguage,
  cropName,
  placeName,
} from './i18n';
import { places } from './places';
import { fieldSelection } from './fields';
import type { Catalog, Crop, History, Region } from './types';

const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const place = el<HTMLSelectElement>('place'),
  crop = el<HTMLSelectElement>('crop');
const yearSelect = el<HTMLSelectElement>('year-select'),
  slider = el<HTMLInputElement>('year-slider');
const early = el<HTMLInputElement>('early-years'),
  status = el('map-status'),
  panel = el('history-panel');
applyLanguage();
const params = new URLSearchParams(location.search);
const basemap = el<HTMLSelectElement>('basemap');
const showCrops = el<HTMLInputElement>('show-crops');
basemap.value = params.get('basemap') === 'imagery' ? 'imagery' : 'map';
showCrops.checked = params.get('overlay') !== '0';
const opacity = el<HTMLInputElement>('opacity');
const defaultOpacity = { map: 80, imagery: 50 };
const opacityValues = { ...defaultOpacity };
const basemapKey = () => (basemap.value === 'imagery' ? 'imagery' : 'map');
const savedOpacity = Number(params.get('opacity'));
if (params.has('opacity') && Number.isFinite(savedOpacity))
  opacityValues[basemapKey()] = Math.round(
    Math.max(0, Math.min(100, savedOpacity)),
  );
opacity.value = String(opacityValues[basemapKey()]);
el('opacity-value').textContent = `${opacity.value}%`;
let catalog: Catalog;
let region: Region = params.get('region') === 'hawaii' ? 'hawaii' : 'conus';
let year = Number(params.get('year')) || 2025;
let selectedCode = params.has('crop') ? Number(params.get('crop')) : null;
let selectedPoint: [number, number] | null = null;
let history: History | null = null;
let controller: AbortController | null = null;
let marker: maplibregl.Marker | null = null;
let basemapError = false;
let tileError = false,
  ready = false,
  requestVersion = 0;

const map = new maplibregl.Map({
  container: 'map',
  center: [-98, 38.5],
  zoom: 3.5,
  minZoom: 2,
  maxZoom: 16,
  maxPitch: 0,
  renderWorldCopies: false,
  attributionControl: false,
  style: {
    version: 8,
    sources: {
      base: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Esri, HERE, Garmin · USDA NASS',
      },
      labels: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#e9f1f2' },
      },
      {
        id: 'base',
        type: 'raster',
        source: 'base',
        paint: { 'raster-opacity': 0.9, 'raster-saturation': -0.4 },
      },
      { id: 'labels', type: 'raster', source: 'labels' },
    ],
  },
});
const fields = fieldSelection(map, setYear);
const styleReady = new Promise<void>((resolve) =>
  map.once('style.load', () => resolve()),
);
new ResizeObserver(() => map.resize()).observe(el('map'));
map.addControl(
  new maplibregl.NavigationControl({ showCompass: false }),
  'top-right',
);
map.addControl(
  new maplibregl.AttributionControl({ compact: true }),
  'bottom-right',
);
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
map.on('error', (event) => {
  const sourceId = (event as typeof event & { sourceId?: string }).sourceId;
  if (sourceId === 'cdl') {
    tileError = true;
    text(status, 'tileError');
    status.classList.add('error');
  } else if (
    sourceId === 'base' ||
    sourceId === 'labels' ||
    sourceId === 'imagery'
  ) {
    basemapError = true;
    if (!tileError) text(status, 'baseError');
  }
});
map.on('idle', () => {
  if (!catalog || !ready || tileError) return;
  text(
    status,
    basemapError
      ? 'baseError'
      : place.value === 'AK'
        ? 'alaskaUnavailable'
        : 'mapReady',
  );
  status.classList.remove('error');
});
status.addEventListener('click', () => {
  if (tileError) updateLayer();
});
function currentClasses(): Crop[] {
  return catalog.regions[region].classes;
}
function availableYears(): number[] {
  return catalog.regions[region].years
    .map((y) => y.year)
    .filter((y) => early.checked || region === 'hawaii' || y >= 2008);
}
function saveUrl() {
  const p = new URLSearchParams({
    region,
    lang: language,
    year: String(year),
    place: place.value,
  });
  if (basemap.value === 'imagery') p.set('basemap', 'imagery');
  if (!showCrops.checked) p.set('overlay', '0');
  if (opacityValues[basemapKey()] !== defaultOpacity[basemapKey()])
    p.set('opacity', String(opacityValues[basemapKey()]));
  if (selectedCode !== null) p.set('crop', String(selectedCode));
  if (early.checked) p.set('early', '1');
  if (selectedPoint) {
    p.set('lon', String(selectedPoint[0]));
    p.set('lat', String(selectedPoint[1]));
  }
  window.history.replaceState(null, '', `?${p}`);
}
function updateYears() {
  const years = availableYears();
  if (!years.includes(year)) year = years.at(-1)!;
  yearSelect.replaceChildren(
    ...years.map((y) => new Option(String(y), String(y))),
  );
  yearSelect.value = String(year);
  slider.min = '0';
  slider.max = String(years.length - 1);
  slider.value = String(years.indexOf(year));
  slider.setAttribute('aria-valuetext', String(year));
  el<HTMLButtonElement>('previous-year').disabled = year === years[0];
  el<HTMLButtonElement>('next-year').disabled = year === years.at(-1);
  const ticks = years.filter(
    (_, i) =>
      i === 0 || i === years.length - 1 || (years.length > 5 && i % 4 === 0),
  );
  el('timeline-ticks').replaceChildren(
    ...ticks.map((y) => {
      const b = document.createElement('button');
      b.textContent = String(y);
      b.onclick = () => setYear(y);
      return b;
    }),
  );
  early.disabled = region === 'hawaii';
  const entry = catalog.regions[region].years.find((y) => y.year === year)!;
  const resolution = [
    ...new Set(
      entry.datasets.map((d) => d.match(/(\d+)m_/)?.[1]).filter(Boolean),
    ),
  ].join(' / ');
  text(el('year-badge'), 'nativeResolution', {
    year,
    resolution: resolution || '—',
  });
  text(
    el('coverage-badge'),
    region === 'hawaii'
      ? 'hawaiiCoverage'
      : year >= 2008
        ? 'conusCoverage'
        : 'partialCoverage',
  );
  const warning = el('coverage-warning');
  warning.hidden = place.value !== 'AK' && year >= 2008;
  text(warning, place.value === 'AK' ? 'alaskaWarning' : 'earlyWarning');
  renderHistory();
  fields.renderYear(year);
}
function renderCrops() {
  if (!currentClasses().some((c) => c.code === selectedCode))
    selectedCode = null;
  crop.replaceChildren(
    new Option(t('allCrops'), ''),
    ...currentClasses().map(
      (c) => new Option(`${cropName(c.name)} · ${c.code}`, String(c.code)),
    ),
  );
  crop.value = selectedCode === null ? '' : String(selectedCode);
  const favorites =
    region === 'conus'
      ? [1, 5, 2, 3, 24, 75]
      : currentClasses()
          .slice(0, 6)
          .map((c) => c.code);
  el('quick-crops').replaceChildren(
    ...favorites.flatMap((code) => {
      const c = currentClasses().find((item) => item.code === code);
      if (!c) return [];
      const b = document.createElement('button');
      b.className = 'crop-chip';
      b.setAttribute('aria-pressed', String(code === selectedCode));
      const dot = document.createElement('i');
      dot.style.backgroundColor = c.color;
      b.append(dot, cropName(c.name));
      b.title = c.name;
      b.onclick = () => {
        selectedCode = selectedCode === code ? null : code;
        renderCrops();
        updateLayer();
      };
      return [b];
    }),
  );
}
function updateLayer() {
  if (!catalog || !ready) return;
  tileError = false;
  status.classList.remove('error');
  text(status, 'loadingYear', { year });
  updateYears();
  saveUrl();
  if (place.value === 'AK') {
    if (map.getLayer('cdl')) map.setLayoutProperty('cdl', 'visibility', 'none');
    text(status, 'alaskaUnavailable');
    return;
  }
  const tiles = [
    `${location.origin}/api/tiles/${region}/${year}/{z}/{x}/{y}.png${selectedCode === null ? '' : `?crop=${selectedCode}`}`,
  ];
  if (map.getSource('cdl')) {
    (map.getSource('cdl') as RasterTileSource).setTiles(tiles);
    map.setLayoutProperty(
      'cdl',
      'visibility',
      showCrops.checked ? 'visible' : 'none',
    );
  } else {
    map.addSource('cdl', {
      type: 'raster',
      tiles,
      tileSize: 256,
      minzoom: 2,
      maxzoom: 16,
      bounds: [-161, 18, -60, 51],
    });
    map.addLayer(
      {
        id: 'cdl',
        type: 'raster',
        source: 'cdl',
        layout: { visibility: showCrops.checked ? 'visible' : 'none' },
        paint: {
          'raster-opacity': Number(el<HTMLInputElement>('opacity').value) / 100,
          'raster-resampling': 'nearest',
          'raster-fade-duration': 0,
        },
      },
      'labels',
    );
  }
}
function setYear(value: number) {
  if (availableYears().includes(value)) {
    year = value;
    updateLayer();
  }
}
function navigatePlace() {
  map.resize();
  const p = places.find((p) => p[0] === place.value)!;
  const next: Region = p[0] === 'HI' ? 'hawaii' : 'conus';
  closeHistory();
  if (next !== region) {
    region = next;
    selectedCode = null;
    renderCrops();
  }
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 0
    : 900;
  if (p[0] === 'US')
    map.fitBounds(
      [
        [-125, 24],
        [-66, 50],
      ],
      { padding: { top: 95, bottom: 175, left: 20, right: 20 }, duration },
    );
  else map.flyTo({ center: [p[2], p[3]], zoom: p[4], duration });
  updateLayer();
}
function closeHistory() {
  fields.clear();
  requestVersion++;
  controller?.abort();
  panel.hidden = true;
  selectedPoint = null;
  history = null;
  marker?.remove();
  marker = null;
  saveUrl();
}
function renderHistory() {
  if (!history) return;
  const errors = history.rows.filter((r) => r.status === 'error').length,
    count = history.rows.filter((r) => r.status === 'ok').length;
  clearText(el('history-summary'));
  el('history-summary').textContent =
    t('historyCount', { count }) +
    (errors ? t('historyErrors', { errors }) : '');
  el<HTMLButtonElement>('retry-history').hidden = errors === 0;
  el<HTMLButtonElement>('export-history').disabled = false;
  el('history-rows').replaceChildren(
    ...[...history.rows].reverse().map((row) => {
      const button = document.createElement('button');
      button.className = `history-row${row.year === year ? ' selected' : ''}`;
      button.setAttribute('aria-pressed', String(row.year === year));
      const date = document.createElement('strong');
      date.textContent = String(row.year);
      const dot = document.createElement('i');
      dot.style.backgroundColor =
        currentClasses().find((c) => c.code === row.code)?.color ?? '#d6d9da';
      const text = document.createElement('span');
      text.textContent =
        row.status === 'error'
          ? t('sampleError')
          : row.status === 'nodata'
            ? t('noData')
            : cropName(row.name);
      const note = document.createElement('small');
      note.textContent = [
        row.status === 'ok' ? t('classCode', { code: row.code ?? '' }) : '—',
        row.status === 'ok' && row.resolution
          ? t('sampleResolution', { resolution: row.resolution })
          : '',
        row.coverage === 'partial' ? t('partial') : '',
      ]
        .filter(Boolean)
        .join(' · ');
      text.append(note);
      button.append(date, dot, text);
      button.onclick = () => {
        if (row.year < 2008) early.checked = true;
        setYear(row.year);
      };
      return button;
    }),
  );
}
async function inspectPoint(lon: number, lat: number) {
  controller?.abort();
  controller = new AbortController();
  const version = ++requestVersion;
  if (place.value === 'AK') {
    text(status, 'alaskaUnavailable');
    return;
  }
  selectedPoint = [Number(lon.toFixed(6)), Number(lat.toFixed(6))];
  const next: Region =
    lon >= -161 && lon <= -154 && lat >= 18 && lat <= 23 ? 'hawaii' : 'conus';
  if (next !== region) {
    region = next;
    place.value = next === 'hawaii' ? 'HI' : 'US';
    selectedCode = null;
    renderCrops();
    updateLayer();
  }
  panel.hidden = false;
  history = null;
  marker?.remove();
  marker = new maplibregl.Marker({ color: '#546247' })
    .setLngLat(selectedPoint)
    .addTo(map);
  marker.getElement().setAttribute('aria-label', t('mapMarker'));
  el('coordinates').textContent =
    `${Math.abs(lat).toFixed(5)}° ${lat < 0 ? 'S' : 'N'}  ·  ${Math.abs(lon).toFixed(5)}° ${lon < 0 ? 'W' : 'E'}`;
  text(el('history-summary'), 'historyLoading');
  el('history-rows').replaceChildren();
  el<HTMLButtonElement>('export-history').disabled = true;
  el<HTMLButtonElement>('retry-history').hidden = true;
  saveUrl();
  void fields.load(
    new URLSearchParams({
      region,
      lon: String(selectedPoint[0]),
      lat: String(selectedPoint[1]),
    }),
    controller.signal,
    () => year,
  );
  try {
    const response = await fetch(
      `/api/history?${new URLSearchParams({ region, lon: String(selectedPoint[0]), lat: String(selectedPoint[1]) })}`,
      { signal: controller.signal },
    );
    if (!response.ok) throw new Error('query failed');
    const result: History = await response.json();
    if (version !== requestVersion) return;
    history = result;
    renderHistory();
  } catch {
    if (version !== requestVersion) return;
    text(el('history-summary'), 'historyError');
    el<HTMLButtonElement>('retry-history').hidden = false;
  }
}
map.on('click', (event) => {
  if (catalog) void inspectPoint(event.lngLat.lng, event.lngLat.lat);
});
place.onchange = navigatePlace;
crop.onchange = () => {
  selectedCode = crop.value === '' ? null : Number(crop.value);
  renderCrops();
  updateLayer();
};
yearSelect.onchange = () => setYear(Number(yearSelect.value));
slider.oninput = () => setYear(availableYears()[Number(slider.value)]!);
early.onchange = updateLayer;
el('previous-year').onclick = () =>
  setYear(availableYears()[availableYears().indexOf(year) - 1]!);
el('next-year').onclick = () =>
  setYear(availableYears()[availableYears().indexOf(year) + 1]!);
el('reset-map').onclick = () => {
  if (catalog) navigatePlace();
};
el('close-history').onclick = closeHistory;
el('retry-field').onclick = () => {
  if (selectedPoint && controller)
    void fields.load(
      new URLSearchParams({
        region,
        lon: String(selectedPoint[0]),
        lat: String(selectedPoint[1]),
      }),
      controller.signal,
      () => year,
    );
};
el('retry-history').onclick = () => {
  if (selectedPoint) void inspectPoint(...selectedPoint);
};
function updateBasemap() {
  basemapError = false;
  const imagery = basemap.value === 'imagery';
  if (imagery && !map.getSource('imagery')) {
    map.addSource('imagery', {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution:
        'Imagery © Esri, Vantor, Earthstar Geographics, and the GIS User Community',
    });
    map.addLayer(
      { id: 'imagery', type: 'raster', source: 'imagery' },
      'labels',
    );
    // Keep classified pixels above reference imagery when both are enabled.
    if (map.getLayer('cdl')) map.moveLayer('cdl', 'labels');
  }
  map.setLayoutProperty('base', 'visibility', imagery ? 'none' : 'visible');
  map.setLayoutProperty('labels', 'visibility', imagery ? 'none' : 'visible');
  if (map.getLayer('imagery'))
    map.setLayoutProperty(
      'imagery',
      'visibility',
      imagery ? 'visible' : 'none',
    );
  el('imagery-note').hidden = !imagery;
  applyOpacity();
  saveUrl();
}
basemap.onchange = updateBasemap;
showCrops.onchange = () => {
  if (map.getLayer('cdl'))
    map.setLayoutProperty(
      'cdl',
      'visibility',
      showCrops.checked && place.value !== 'AK' ? 'visible' : 'none',
    );
  saveUrl();
};
function applyOpacity() {
  const value = opacityValues[basemapKey()];
  opacity.value = String(value);
  el('opacity-value').textContent = `${value}%`;
  if (map.getLayer('cdl'))
    map.setPaintProperty('cdl', 'raster-opacity', value / 100);
}
opacity.oninput = () => {
  opacityValues[basemapKey()] = Number(opacity.value);
  applyOpacity();
  saveUrl();
};
document
  .querySelectorAll<HTMLButtonElement>('.destinations button')
  .forEach((b) => {
    b.onclick = () => {
      if (!catalog) return;
      place.value = b.dataset.place!;
      navigatePlace();
      const point: [number, number] = [
        Number(b.dataset.lon),
        Number(b.dataset.lat),
      ];
      map.flyTo({ center: point, zoom: 10, duration: 900 });
      void inspectPoint(...point);
    };
  });
el('export-history').onclick = () => {
  if (!history) return;
  const quote = (value: unknown) =>
    `"${(typeof value === 'number' ? String(value) : String(value ?? '').replace(/^[=+@-]/, "'$&")).replaceAll('"', '""')}"`;
  const rows = [
    [
      'year',
      'longitude',
      'latitude',
      'region',
      'status',
      'class_code',
      'class_name',
      'sample_resolution_m',
      'coverage',
      'fetched_at',
      'source',
      'catalog_imported_at',
    ],
    ...history.rows.map((r) => [
      r.year,
      history!.lon,
      history!.lat,
      history!.region,
      r.status,
      r.code,
      r.name,
      r.resolution,
      r.coverage,
      r.fetchedAt,
      history!.source,
      history!.catalogImportedAt,
    ]),
  ];
  const url = URL.createObjectURL(
    new Blob(
      ['\uFEFF' + rows.map((r) => r.map(quote).join(',')).join('\r\n')],
      { type: 'text/csv;charset=utf-8' },
    ),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `usda-cdl-${history.lon}-${history.lat}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
async function boot() {
  try {
    const response = await fetch('/api/catalog');
    if (!response.ok) throw new Error('API unavailable');
    catalog = await response.json();
    place.replaceChildren(
      ...places.map((p) => new Option(placeName(p[0], p[1]), p[0])),
    );
    place.value = places.some((p) => p[0] === params.get('place'))
      ? params.get('place')!
      : region === 'hawaii'
        ? 'HI'
        : 'US';
    region = place.value === 'HI' ? 'hawaii' : 'conus';
    early.checked = params.get('early') === '1' || year < 2008;
    renderCrops();
    updateYears();
    [place, crop, yearSelect, slider].forEach((input) => {
      input.disabled = false;
    });
    text(el('catalog-note'), 'catalogDate', {
      date: new Date(catalog.importedAt).toLocaleDateString(language),
    });
    el<HTMLAnchorElement>('download-source').href = catalog.releaseUrl;
    const begin = () => {
      ready = true;
      navigatePlace();
      updateBasemap();
      basemap.disabled = showCrops.disabled = false;
      if (params.has('lon') && params.has('lat')) {
        const lon = Number(params.get('lon')),
          lat = Number(params.get('lat'));
        if (
          Number.isFinite(lon) &&
          Number.isFinite(lat) &&
          Math.abs(lon) <= 180 &&
          Math.abs(lat) <= 85
        ) {
          map.jumpTo({ center: [lon, lat], zoom: 10 });
          void inspectPoint(lon, lat);
        }
      }
    };
    await styleReady;
    applyLanguage();
    begin();
  } catch {
    text(status, 'apiError');
    status.classList.add('error');
    text(el('catalog-note'), 'startAPI');
    status.onclick = () => {
      status.onclick = null;
      void boot();
    };
  }
}
el<HTMLSelectElement>('language').onchange = (event) => {
  setLanguage((event.target as HTMLSelectElement).value);
  if (catalog) {
    const selected = place.value;
    place.replaceChildren(
      ...places.map((p) => new Option(placeName(p[0], p[1]), p[0])),
    );
    place.value = selected;
    renderCrops();
    updateYears();
    text(el('catalog-note'), 'catalogDate', {
      date: new Date(catalog.importedAt).toLocaleDateString(language),
    });
  }
  saveUrl();
};
void boot();
