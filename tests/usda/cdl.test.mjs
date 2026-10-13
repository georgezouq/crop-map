import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  tileBounds,
  tileUrl,
  sampleUrl,
  sampleResult,
  mapLimit,
  pointInRings,
  yearEntry,
} from '../../server/cdl.mjs';
import { DiskCache } from '../../server/upstream.mjs';
const catalog = JSON.parse(
  await readFile(
    new URL('../../site/public/data/usda/catalog.json', import.meta.url),
  ),
);

test('catalog has every national year, Hawaii separately, and no synthetic Alaska', () => {
  assert.deepEqual(Object.keys(catalog.regions), ['conus', 'hawaii']);
  assert.deepEqual(
    catalog.regions.conus.years
      .filter((y) => y.coverage === 'conus')
      .map((y) => y.year),
    Array.from({ length: 18 }, (_, i) => 2008 + i),
  );
  assert.deepEqual(
    catalog.regions.hawaii.years.map((y) => y.year),
    [2023, 2024, 2025],
  );
  for (const region of Object.values(catalog.regions))
    for (const entry of region.years) {
      assert.deepEqual(
        entry.rasterIds,
        entry.footprints.map((f) => f.rasterId),
      );
    }
  assert.ok(!JSON.stringify(catalog).includes('Acreage'));
});
test('tile coordinates follow Web Mercator and reject overflow or injection', () => {
  const [west, south, east, north] = tileBounds(1, 0, 0);
  assert.equal(east, 0);
  assert.equal(south, 0);
  assert.ok(west < -20037508);
  assert.ok(north > 20037508);
  for (const coords of [
    [2, -1, 0],
    [2, 4, 0],
    [2, 0, 4],
    [17, 0, 0],
    [1.5, 0, 0],
  ])
    assert.throws(() => tileBounds(...coords));
});
test('map and history lock the same year rather than use the default mosaic', () => {
  for (const year of [2008, 2023, 2025]) {
    const tile = new URL(tileUrl(catalog, 'conus', year, 4, 3, 6, null));
    const sample = new URL(sampleUrl(catalog, 'conus', year, -93.6, 42.1));
    assert.deepEqual(
      JSON.parse(tile.searchParams.get('mosaicRule')),
      JSON.parse(sample.searchParams.get('mosaicRule')),
    );
    assert.deepEqual(
      JSON.parse(tile.searchParams.get('mosaicRule')).lockRasterIds,
      yearEntry(catalog, 'conus', year).rasterIds,
    );
  }
  assert.throws(() => tileUrl(catalog, 'hawaii', 2008, 4, 3, 6, null));
  assert.throws(() => tileUrl(catalog, 'conus', 2026, 4, 3, 6, null));
  assert.throws(() => tileUrl(catalog, 'conus', 2025, 4, 3, 6, 999));
});
test('crop filter remaps other categories to NoData, with nearest-neighbor rendering', () => {
  const url = new URL(tileUrl(catalog, 'conus', 2025, 4, 3, 6, 1));
  const rule = JSON.parse(url.searchParams.get('renderingRule'));
  assert.equal(
    rule.rasterFunctionArguments.Raster.rasterFunctionArguments.AllowUnmatched,
    false,
  );
  assert.deepEqual(
    rule.rasterFunctionArguments.Raster.rasterFunctionArguments.InputRanges,
    [1, 2],
  );
  assert.equal(url.searchParams.get('interpolation'), 'RSP_NearestNeighbor');
});
test('uncovered early years are NoData without an invalid upstream request', () => {
  assert.equal(sampleUrl(catalog, 'conus', 1997, -93.6, 42.1), null);
  assert.equal(sampleUrl(catalog, 'conus', 2025, -152, 64), null);
  assert.ok(sampleUrl(catalog, 'conus', 1997, -100, 47));
  assert.throws(() => sampleUrl(catalog, 'conus', 2025, NaN, 42));
  const rings = [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
    [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
      [4, 4],
    ],
  ];
  assert.equal(pointInRings(2, 2, rings), true);
  assert.equal(pointInRings(5, 5, rings), false);
});
test('sample decoding distinguishes valid crops, NoData, malformed responses, and service errors', () => {
  const classes = catalog.regions.conus.classes;
  assert.equal(
    sampleResult(
      { samples: [{ value: '1', attributes: { Year: 2025 }, resolution: 10 }] },
      2025,
      classes,
    ).name,
    'Corn',
  );
  assert.equal(
    sampleResult(
      { samples: [{ value: 'NoData', attributes: { Year: 2025 } }] },
      2025,
      classes,
    ).status,
    'nodata',
  );
  assert.equal(
    sampleResult(
      { samples: [{ value: '1', attributes: { Year: 2024 } }] },
      2025,
      classes,
    ).status,
    'nodata',
  );
  assert.throws(() =>
    sampleResult({ error: { message: 'failed' } }, 2025, classes),
  );
  assert.throws(() => sampleResult({}, 2025, classes));
});
test('bounded history jobs preserve every year and chronological order', async () => {
  let active = 0,
    max = 0;
  const values = await mapLimit(
    Array.from({ length: 29 }, (_, i) => i),
    3,
    async (i) => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return i;
    },
  );
  assert.equal(max, 3);
  assert.deepEqual(
    values,
    Array.from({ length: 29 }, (_, i) => i),
  );
});
test('disk cache deduplicates, survives restart, expires, and never stores failed requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'crop-cache-test-'));
  let calls = 0;
  try {
    const cache = new DiskCache(dir);
    const loader = async () => {
      calls++;
      return { data: 42 };
    };
    await Promise.all([cache.get('key', loader), cache.get('key', loader)]);
    assert.equal(calls, 1);
    assert.equal((await new DiskCache(dir).get('key', loader)).cache, 'hit');
    assert.equal(calls, 1);
    await new DiskCache(dir, { ttl: 0 }).get('key', loader);
    assert.equal(calls, 2);
    await assert.rejects(
      cache.get('failure', async () => {
        throw Error('offline');
      }),
    );
    assert.equal((await cache.get('failure', loader)).cache, 'miss');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
