import { mkdir, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SERVICES } from '../server/cdl.mjs';
import { fetchJSON } from '../server/upstream.mjs';

const catalog = {
  schemaVersion: 1,
  importedAt: new Date().toISOString(),
  source: 'USDA NASS Cropland Data Layer',
  sourceUrl:
    'https://www.nass.usda.gov/Research_and_Science/Cropland/SARS1a.php',
  releaseUrl:
    'https://data.nass.usda.gov/Research_and_Science/Cropland/Release/',
  regions: {},
};
for (const [region, service] of Object.entries(SERVICES)) {
  const [query, table] = await Promise.all([
    fetchJSON(
      `${service}/query?f=json&where=1%3D1&outFields=OBJECTID,Name,Year&returnGeometry=true&outSR=4326`,
    ),
    fetchJSON(`${service}/rasterAttributeTable?f=json`),
  ]);
  if (
    query.exceededTransferLimit ||
    !query.features?.length ||
    !table.features?.length
  )
    throw new Error(`Incomplete ${region} catalog`);
  const years = new Map();
  for (const { attributes: a, geometry } of query.features) {
    const year = Number(a.Year);
    if (
      !Number.isInteger(year) ||
      year < 1997 ||
      year > new Date().getUTCFullYear()
    )
      throw new Error('Invalid USDA year');
    const entry = years.get(year) ?? {
      year,
      rasterIds: [],
      datasets: [],
      footprints: [],
      coverage:
        region === 'hawaii' ? 'hawaii' : year >= 2008 ? 'conus' : 'partial',
    };
    if (!geometry?.rings?.length) throw new Error('Missing raster footprint');
    entry.footprints.push({ rasterId: a.OBJECTID, rings: geometry.rings });
    entry.rasterIds.push(a.OBJECTID);
    entry.datasets.push(a.Name);
    years.set(year, entry);
  }
  // Acreage/Count in the service-level table are NOT year-specific: deliberately excluded.
  const classes = table.features
    .map(({ attributes: a }) => ({
      code: a.Value,
      name: a.Class_Names,
      rgb: [a.Red, a.Green, a.Blue],
      color:
        '#' +
        [a.Red, a.Green, a.Blue]
          .map((v) => v.toString(16).padStart(2, '0'))
          .join(''),
    }))
    .filter((c) => c.name && c.code !== 0);
  if (!classes.length)
    throw new Error(`Missing ${region} classification legend`);
  catalog.regions[region] = {
    service,
    years: [...years.values()].sort((a, b) => a.year - b.year),
    classes,
  };
  console.log(
    `${region}: ${years.size} years, ${classes.length} named classes`,
  );
}
const output = fileURLToPath(
  new URL('../site/public/data/usda/catalog.json', import.meta.url),
);
await mkdir(
  fileURLToPath(new URL('../site/public/data/usda/', import.meta.url)),
  { recursive: true },
);
await writeFile(`${output}.tmp`, JSON.stringify(catalog, null, 2) + '\n');
await rename(`${output}.tmp`, output);
console.log(`Imported catalog: ${output}`);
