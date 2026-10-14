// Real USDA smoke checks. Run with the local API server listening on 8787.
import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8787';
const get = async (path) => {
  const r = await fetch(base + path, { signal: AbortSignal.timeout(120000) });
  assert.equal(r.status, 200, path);
  return r;
};
const catalog = await (await get('/api/catalog')).json();
assert.equal(catalog.regions.conus.years.length, 29);
assert.ok(!JSON.stringify(catalog).includes('footprints'));
const path = '/api/history?region=conus&lon=-93.6&lat=42.1';
const history = await (await get(path)).json();
assert.equal(history.rows.length, 29);
assert.ok(history.rows.every((r) => r.status !== 'error'));
assert.equal(history.rows.find((r) => r.year === 1997).status, 'nodata');
assert.equal(history.rows.find((r) => r.year === 2024).name, 'Soybeans');
assert.equal(history.rows.find((r) => r.year === 2025).name, 'Corn');
const cached = await (await get(path)).json();
assert.ok(
  cached.rows.filter((r) => r.status === 'ok').every((r) => r.cache === 'hit'),
);
const hawaii = await (
  await get('/api/history?region=hawaii&lon=-156.4&lat=20.8')
).json();
assert.deepEqual(
  hawaii.rows.map((r) => r.year),
  [2023, 2024, 2025],
);
assert.ok(hawaii.rows.every((r) => r.status !== 'error'));
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const images = [];
for (const year of [2008, 2025]) {
  const r = await get(`/api/tiles/conus/${year}/8/61/94.png`);
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.ok(bytes.subarray(0, 8).equals(png));
  images.push(bytes);
}
assert.ok(
  !images[0].equals(images[1]),
  'different years must return different crop imagery',
);
const filter = await get('/api/tiles/conus/2025/8/61/94.png?crop=1');
assert.ok(
  Buffer.from(await filter.arrayBuffer())
    .subarray(0, 8)
    .equals(png),
);
for (const path of [
  '/api/tiles/conus/2099/4/3/6.png',
  '/api/tiles/conus/2025/4/99/6.png',
  '/api/tiles/hawaii/2008/4/3/6.png',
  '/api/history?region=conus&lon=oops&lat=42',
  '/api/history?region=alaska&lon=-152&lat=64',
]) {
  assert.equal((await fetch(base + path)).status, 400, path);
}
assert.equal(
  (await get('/')).headers.get('content-type'),
  'text/html; charset=utf-8',
);
console.log(
  'PASS: real national/Hawaii history, exact year imagery, crop filter, cache hits, invalid inputs, production HTML',
);
