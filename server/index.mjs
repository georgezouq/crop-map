import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { DiskCache, fetchJSON, fetchUSDA } from './upstream.mjs';
import {
  identifyUrl,
  mapLimit,
  regionKey,
  sampleResult,
  sampleUrl,
  tileUrl,
  yearEntry,
} from './cdl.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const catalog = JSON.parse(
  await readFile(resolve(root, 'site/public/data/usda/catalog.json'), 'utf8'),
);
// Detailed raster footprints stay server-side; the browser only needs years and the legend.
const publicCatalog = {
  ...catalog,
  regions: Object.fromEntries(
    Object.entries(catalog.regions).map(([key, value]) => [
      key,
      { ...value, years: value.years.map(({ footprints, ...entry }) => entry) },
    ]),
  ),
};
const cache = new DiskCache(
  process.env.CROP_CACHE_DIR ?? resolve(root, 'data/cache/usda'),
);
const dist = resolve(root, 'site/dist');
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let active = 0;
const queue = [];
async function limited(work) {
  if (active >= 8) {
    if (queue.length >= 256) throw new Error('Server busy; please retry');
    await new Promise((done) => queue.push(done));
  } else active++;
  try {
    return await work();
  } finally {
    const next = queue.shift();
    if (next) next();
    else active--;
  }
}
function json(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}
function number(params, name) {
  const value = params.get(name);
  if (value === null || value.trim() === '' || !Number.isFinite(Number(value)))
    throw new Error(`Invalid ${name}`);
  return Number(value);
}

export const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return json(res, 405, { error: 'GET required' });
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/catalog') return json(res, 200, publicCatalog);
    if (url.pathname === '/api/health')
      return json(res, 200, {
        status: 'ok',
        catalogImportedAt: catalog.importedAt,
      });
    const tile = url.pathname.match(
      /^\/api\/tiles\/(conus|hawaii)\/(\d{4})\/(\d+)\/(\d+)\/(\d+)\.png$/,
    );
    if (tile) {
      let target;
      try {
        const crop = url.searchParams.has('crop')
          ? number(url.searchParams, 'crop')
          : null;
        target = tileUrl(
          catalog,
          tile[1],
          +tile[2],
          +tile[3],
          +tile[4],
          +tile[5],
          crop,
        );
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
      const value = await cache.get(target, () =>
        limited(async () => {
          const upstream = await fetchUSDA(target);
          const buffer = Buffer.from(await upstream.arrayBuffer());
          if (!buffer.subarray(0, 8).equals(pngSignature))
            throw new Error('USDA did not return a map image');
          return { body: buffer.toString('base64') };
        }),
      );
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
        'X-Crop-Cache': value.cache,
        'X-Data-Fetched-At': value.fetchedAt,
      });
      return res.end(Buffer.from(value.body, 'base64'));
    }
    if (url.pathname === '/api/history') {
      let region, lon, lat, years;
      try {
        region = regionKey(url.searchParams.get('region'));
        lon = number(url.searchParams, 'lon');
        lat = number(url.searchParams, 'lat');
        years = catalog.regions[region].years;
        sampleUrl(catalog, region, years[0].year, lon, lat);
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
      const rows = await mapLimit(years, 3, async ({ year }) => {
        try {
          const target = sampleUrl(catalog, region, year, lon, lat);
          if (!target)
            return {
              year,
              status: 'nodata',
              code: null,
              name: 'Outside raster coverage',
              resolution: null,
              coverage: yearEntry(catalog, region, year).coverage,
            };
          const value = await cache.get(target, () =>
            limited(async () => {
              try {
                return { data: await fetchJSON(target) };
              } catch (original) {
                const identified = await fetchJSON(identifyUrl(target));
                if (identified.value === 'NoData')
                  return { data: { samples: [] } };
                throw original;
              }
            }),
          );
          return {
            ...sampleResult(value.data, year, catalog.regions[region].classes),
            fetchedAt: value.fetchedAt,
            cache: value.cache,
            coverage: yearEntry(catalog, region, year).coverage,
          };
        } catch {
          return {
            year,
            status: 'error',
            code: null,
            name: 'Request failed',
            resolution: null,
            coverage: yearEntry(catalog, region, year).coverage,
          };
        }
      });
      return json(res, 200, {
        region,
        lon,
        lat,
        rows,
        source: catalog.regions[region].service,
        catalogImportedAt: catalog.importedAt,
      });
    }
    if (url.pathname.startsWith('/api/'))
      return json(res, 404, { error: 'Unknown API route' });
    const path = resolve(
      dist,
      '.' +
        decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
    );
    if (!path.startsWith(dist + sep))
      return json(res, 403, { error: 'Forbidden' });
    try {
      const body = await readFile(path);
      const types = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
      };
      res.writeHead(200, {
        'Content-Type': types[extname(path)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      json(res, 404, {
        error: 'File not found. Run npm run build in site/ first.',
      });
    }
  } catch (error) {
    console.error(error.message);
    if (!res.headersSent)
      json(res, 502, {
        error: 'USDA is temporarily unavailable. Please retry.',
      });
    else res.end();
  }
});
const port = Number(process.env.PORT ?? 8787);
server.listen(port, process.env.HOST ?? '127.0.0.1', () =>
  console.log(`US Crop Atlas: http://localhost:${port}`),
);
