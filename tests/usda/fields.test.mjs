import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldUrl, fieldResult } from '../../server/fields.mjs';
const polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 0],
    ],
  ],
};
const feature = {
  type: 'Feature',
  geometry: polygon,
  properties: {
    csbid: '191522004396459',
    csbyears: '1522',
    csbacres: 10,
    r15: 1,
    r16: null,
  },
};
const collection = (f) => ({ type: 'FeatureCollection', features: f });
test('field queries intersect the exact point, retain full geometry, and reject invalid inputs', () => {
  const url = new URL(fieldUrl('conus', -93.6, 42.1));
  assert.equal(url.searchParams.get('geometry'), '-93.6,42.1');
  assert.equal(url.searchParams.get('spatialRel'), 'esriSpatialRelIntersects');
  assert.equal(url.searchParams.has('distance'), false);
  assert.equal(url.searchParams.has('maxAllowableOffset'), false);
  assert.equal(fieldUrl('hawaii', -156.4, 20.8), null);
  assert.equal(fieldUrl('conus', -152, 64), null);
  for (const args of [
    ['conus', NaN, 40],
    ['other', -93, 42],
    ['conus', 181, 42],
    ['conus', -93, 91],
  ])
    assert.throws(() => fieldUrl(...args));
});
test('field metadata keeps boundary window, area units, and missing crop years distinct', () => {
  const result = fieldResult(collection([feature]), [
    { code: 1, name: 'Corn' },
  ]);
  assert.deepEqual(result.geometry, polygon);
  assert.ok(Math.abs(result.properties.hectares - 4.0468564224) < 1e-10);
  assert.equal(result.properties.rows.length, 8);
  assert.deepEqual(result.properties.window, { start: 2015, end: 2022 });
  assert.equal(result.properties.rows[0].name, 'Corn');
  assert.equal(result.properties.rows[1].code, null);
  assert.equal(
    result.properties.rows.some((r) => r.year === 2025),
    false,
  );
  const multi = {
    ...feature,
    geometry: {
      type: 'MultiPolygon',
      coordinates: [polygon.coordinates, polygon.coordinates],
    },
  };
  assert.deepEqual(
    fieldResult(collection([multi]), []).geometry,
    multi.geometry,
  );
  assert.equal(fieldResult(collection([]), []), null);
});
test('malformed and incomplete upstream field responses fail rather than become no coverage', () => {
  for (const data of [
    {},
    { error: { message: 'failed' } },
    {
      ...collection([feature]),
      properties: { exceededTransferLimit: true },
    },
    collection([
      {
        ...feature,
        properties: { ...feature.properties, csbyears: '1825' },
      },
    ]),
    collection([
      { ...feature, geometry: { type: 'Polygon', coordinates: [] } },
    ]),
    collection([
      {
        ...feature,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [2, 0],
              [2, 2],
              [1, 1],
            ],
          ],
        },
      },
    ]),
  ])
    assert.throws(() => fieldResult(data, []));
});
