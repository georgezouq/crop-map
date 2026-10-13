import type { Map, GeoJSONSource } from 'maplibre-gl';
import { LngLatBounds } from 'maplibre-gl';
import type { FieldResult } from './types';

const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const empty = { type: 'FeatureCollection' as const, features: [] };
export function fieldSelection(map: Map, setYear: (year: number) => void) {
  let result: FieldResult | null = null;
  let version = 0;
  function draw() {
    const data = result?.feature ?? empty;
    if (map.getSource('selected-field')) {
      (map.getSource('selected-field') as GeoJSONSource).setData(data);
      return;
    }
    map.addSource('selected-field', { type: 'geojson', data });
    map.addLayer({
      id: 'selected-field-fill',
      type: 'fill',
      source: 'selected-field',
      paint: { 'fill-color': '#087e8b', 'fill-opacity': 0.2 },
    });
    map.addLayer({
      id: 'selected-field-halo',
      type: 'line',
      source: 'selected-field',
      paint: { 'line-color': '#ffffff', 'line-width': 6 },
    });
    map.addLayer({
      id: 'selected-field-outline',
      type: 'line',
      source: 'selected-field',
      paint: { 'line-color': '#087e8b', 'line-width': 3 },
    });
  }
  function focus() {
    if (!result?.feature) return;
    const g = result.feature.geometry;
    const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
    const bounds = new LngLatBounds();
    rings.flat().forEach((p) => bounds.extend([p[0]!, p[1]!]));
    const mobile = innerWidth <= 1100;
    const height = map.getContainer().clientHeight;
    map.fitBounds(bounds, {
      padding: mobile
        ? {
            top: 75,
            left: 30,
            right: 30,
            bottom: Math.min(
              height - 155,
              el('history-panel').offsetHeight + 185,
            ),
          }
        : { top: 100, left: 60, right: 365, bottom: 200 },
      maxZoom: 15,
      duration: 0,
    });
  }
  function renderYear(year: number) {
    if (!result?.feature) return;
    const p = result.feature.properties;
    const row = p.rows.find((r) => r.year === year);
    el('field-description').textContent =
      `${p.county} · CSB ${p.id}\n边界期：${p.window.start}–${p.window.end}（推算作物边界）\n${row ? `${year} 地块主作物：${row.name}` : `${year} 不在边界记录期内；下方为单点样本。`}`;
    el('field-rows').replaceChildren(
      ...[...p.rows].reverse().map((r) => {
        const button = document.createElement('button');
        button.className = 'field-row';
        button.textContent = `${r.year} · ${r.name}`;
        button.setAttribute('aria-pressed', String(r.year === year));
        button.onclick = () => setYear(r.year);
        return button;
      }),
    );
  }
  function clear() {
    version++;
    result = null;
    el('field-card').removeAttribute('data-field-id');
    el('field-status').textContent = '';
    el('field-description').textContent = '';
    ['focus-field', 'export-field', 'retry-field', 'field-history'].forEach(
      (id) => (el(id).hidden = true),
    );
    el<HTMLDetailsElement>('field-history').open = false;
    if (map.getSource('selected-field')) draw();
  }
  async function load(
    query: URLSearchParams,
    signal: AbortSignal,
    getYear: () => number,
  ) {
    clear();
    const id = version;
    el('field-status').textContent = '正在查找整块边界…';
    try {
      const response = await fetch(`/api/field?${query}`, { signal });
      if (!response.ok) throw Error('Field request failed');
      const data: FieldResult = await response.json();
      if (id !== version || signal.aborted) return;
      result = data;
      if (data.feature) {
        const p = data.feature.properties;
        el('field-card').dataset.fieldId = p.id;
        el('field-status').textContent =
          `已选中整块 · ${p.hectares.toFixed(2)} 公顷 / ${p.acres.toFixed(2)} 英亩`;
        ['focus-field', 'export-field', 'field-history'].forEach(
          (id) => (el(id).hidden = false),
        );
        renderYear(getYear());
        draw();
        focus();
      } else {
        el('field-status').textContent =
          data.status === 'unsupported'
            ? '该地区暂无 CSB 地块边界'
            : '此处未匹配到地块边界';
        el('field-description').textContent =
          '保留点击位置的历史样本。可尝试点击附近农田内部。';
      }
    } catch {
      if (id !== version || signal.aborted) return;
      el('field-status').textContent = '地块边界暂时无法读取';
      el('field-description').textContent = '坐标历史可独立查询，请重试边界。';
      el('retry-field').hidden = false;
    }
  }
  el('focus-field').onclick = focus;
  el('export-field').onclick = () => {
    if (!result?.feature) return;
    const feature = {
      ...result.feature,
      properties: {
        ...result.feature.properties,
        fetchedAt: result.fetchedAt,
      },
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(feature, null, 2)], {
        type: 'application/geo+json',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `usda-csb-${feature.properties.id}.geojson`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return { load, clear, renderYear };
}
