export const SERVICES = {
  conus: 'https://pdi.scinet.usda.gov/image/rest/services/CDL_WM/ImageServer',
  hawaii:
    'https://pdi.scinet.usda.gov/image/rest/services/CDL_WM_Hawaii/ImageServer',
};

export function regionKey(value) {
  if (!Object.hasOwn(SERVICES, value)) throw new Error('Unsupported region');
  return value;
}

export function yearEntry(catalog, region, year) {
  regionKey(region);
  if (!Number.isInteger(year)) throw new Error('Invalid year');
  const entry = catalog.regions[region].years.find(
    (entry) => entry.year === year,
  );
  if (!entry) throw new Error('Year unavailable for this region');
  return entry;
}

// Lock to explicit raster IDs. An unavailable year must never fall back to the newest raster.
export function mosaicRule(entry) {
  return {
    mosaicMethod: 'esriMosaicLockRaster',
    lockRasterIds: entry.rasterIds,
    mosaicOperation: 'MT_FIRST',
  };
}

export function tileBounds(z, x, y) {
  if (
    ![z, x, y].every(Number.isInteger) ||
    z < 0 ||
    z > 16 ||
    x < 0 ||
    y < 0 ||
    x >= 2 ** z ||
    y >= 2 ** z
  ) {
    throw new Error('Invalid tile coordinates');
  }
  const half = 20037508.342789244;
  const span = (2 * half) / 2 ** z;
  return [
    -half + x * span,
    half - (y + 1) * span,
    -half + (x + 1) * span,
    half - y * span,
  ];
}

export function tileUrl(catalog, region, year, z, x, y, crop) {
  const entry = yearEntry(catalog, region, year);
  const classes = catalog.regions[region].classes;
  if (crop !== null && !classes.some((c) => c.code === crop))
    throw new Error('Unknown crop code');
  const params = new URLSearchParams({
    f: 'image',
    bbox: tileBounds(z, x, y).join(','),
    bboxSR: '3857',
    imageSR: '3857',
    size: '256,256',
    format: 'png32',
    interpolation: 'RSP_NearestNeighbor',
    mosaicRule: JSON.stringify(mosaicRule(entry)),
    renderingRule: JSON.stringify(
      crop === null
        ? {
            rasterFunction: region === 'hawaii' ? 'HI_croptypes' : 'croptypes',
          }
        : {
            rasterFunction: 'Colormap',
            rasterFunctionArguments: {
              Raster: {
                rasterFunction: 'Remap',
                rasterFunctionArguments: {
                  Raster: '$$',
                  InputRanges: [crop, crop + 1],
                  OutputValues: [crop],
                  AllowUnmatched: false,
                },
              },
              Colormap: classes
                .filter((c) => c.code === crop)
                .map((c) => [c.code, ...c.rgb]),
            },
          },
    ),
    noData: '0',
    noDataInterpretation: 'esriNoDataMatchAny',
    transparent: 'true',
  });
  return `${SERVICES[region]}/exportImage?${params}`;
}

export function sampleUrl(catalog, region, year, lon, lat) {
  const entry = yearEntry(catalog, region, year);
  if (
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    lon < -180 ||
    lon > 180 ||
    lat < -85 ||
    lat > 85
  ) {
    throw new Error('Invalid coordinates');
  }
  const ids = entry.footprints
    .filter((f) => pointInRings(lon, lat, f.rings))
    .map((f) => f.rasterId);
  if (!ids.length) return null;
  return `${SERVICES[region]}/getSamples?${new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({
      x: lon,
      y: lat,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryPoint',
    returnGeometry: 'false',
    outFields: 'Year,Name',
    returnFirstValueOnly: 'false',
    mosaicRule: JSON.stringify(mosaicRule({ rasterIds: ids })),
    interpolation: 'RSP_NearestNeighbor',
  })}`;
}

export function pointInRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i],
        [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
  }
  return inside;
}

// getSamples reports a generic 400 inside some empty early-year mosaics.
// identify is an independent, explicitly year-locked NoData check for that case.
export function identifyUrl(sample) {
  const url = new URL(sample);
  url.pathname = url.pathname.replace(/getSamples$/, 'identify');
  // Unlike getSamples, identify defaults to a coarse display resolution.
  // Request below the smallest native pixel size to avoid a pyramid-level NoData check.
  url.searchParams.set(
    'pixelSize',
    JSON.stringify({ x: 1, y: 1, spatialReference: { wkid: 3857 } }),
  );
  url.searchParams.set('returnCatalogItems', 'false');
  url.searchParams.set('returnPixelValues', 'true');
  return url.toString();
}

export function sampleResult(data, year, classes) {
  if (data.error) throw new Error(data.error.message || 'USDA service error');
  if (!Array.isArray(data.samples))
    throw new Error('Invalid USDA sample response');
  const sample = data.samples.find(
    (s) => Number(s.attributes?.Year) === year && /^\d+$/.test(s.value),
  );
  if (!sample || Number(sample.value) === 0)
    return {
      year,
      status: 'nodata',
      code: null,
      name: 'No data',
      resolution: null,
    };
  const code = Number(sample.value);
  const crop = classes.find((c) => c.code === code);
  return {
    year,
    status: 'ok',
    code,
    name: crop?.name ?? `Class ${code}`,
    resolution: sample.resolution ?? null,
  };
}

export async function mapLimit(items, concurrency, worker) {
  const result = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        result[i] = await worker(items[i], i);
      }
    }),
  );
  return result;
}
