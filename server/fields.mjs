// Latest CSB layer exposed by the USDA SCINet hosted query service at integration.
// The newer downloadable releases are separate datasets, not silently substituted.
export const FIELD_SOURCE =
  'https://pdi.scinet.usda.gov/hosting/rest/services/Hosted/Crop_Sequence_Boundary_2022/FeatureServer/0';
export const FIELD_WINDOW = { start: 2015, end: 2022 };
export function fieldUrl(region, lon, lat) {
  if (
    !['conus', 'hawaii'].includes(region) ||
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    Math.abs(lon) > 180 ||
    Math.abs(lat) > 85
  )
    throw new Error('Invalid field coordinates or region');
  if (region !== 'conus' || lon < -125 || lon > -66 || lat < 24 || lat > 50)
    return null;
  return `${FIELD_SOURCE}/query?${new URLSearchParams({
    f: 'geojson',
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields:
      'csbid,csbyears,csbacres,cnty,statefips,r15,r16,r17,r18,r19,r20,r21,r22',
    returnGeometry: 'true',
    resultRecordCount: '10',
    orderByFields: 'csbid',
  })}`;
}
export function fieldResult(data, classes) {
  if (
    data.type !== 'FeatureCollection' ||
    !Array.isArray(data.features) ||
    data.error ||
    data.properties?.exceededTransferLimit
  )
    throw new Error('Invalid or incomplete field response');
  if (!data.features.length) return null;
  const feature = data.features[0];
  const p = feature.properties;
  if (
    !p?.csbid ||
    p.csbyears !== '1522' ||
    !Number.isFinite(p.csbacres) ||
    p.csbacres <= 0 ||
    !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)
  )
    throw new Error('Invalid field metadata');
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  if (
    !Array.isArray(polygons) ||
    !polygons.length ||
    !polygons.every(
      (poly) =>
        Array.isArray(poly) &&
        poly.length &&
        poly.every(
          (ring) =>
            Array.isArray(ring) &&
            ring.length >= 4 &&
            ring.every(
              (pt) =>
                Array.isArray(pt) &&
                pt.length >= 2 &&
                Number.isFinite(pt[0]) &&
                Number.isFinite(pt[1]) &&
                Math.abs(pt[0]) <= 180 &&
                Math.abs(pt[1]) <= 85,
            ) &&
            ring[0][0] === ring.at(-1)[0] &&
            ring[0][1] === ring.at(-1)[1],
        ),
    )
  )
    throw new Error('Invalid field geometry');
  const rows = Array.from({ length: 8 }, (_, i) => {
    const year = 2015 + i,
      code = p[`r${String(year).slice(2)}`];
    return {
      year,
      code: Number.isInteger(code) ? code : null,
      name:
        classes.find((c) => c.code === code)?.name ??
        (Number.isInteger(code) ? `Class ${code}` : 'NoData'),
    };
  });
  return {
    type: 'Feature',
    geometry: {
      type: feature.geometry.type,
      coordinates: feature.geometry.coordinates,
    },
    properties: {
      id: p.csbid,
      acres: p.csbacres,
      hectares: p.csbacres * 0.40468564224,
      county: p.cnty,
      stateFips: p.statefips,
      window: FIELD_WINDOW,
      rows,
      source: FIELD_SOURCE,
    },
  };
}
