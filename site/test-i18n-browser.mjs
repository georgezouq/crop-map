import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:8787';
const output = new URL('../artifacts/usda/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
});
const page = await browser.newPage({
  locale: 'en-US',
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'reduce',
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const expected = {
  en: {
    title: 'This land through time',
    corn: 'Corn',
    field: 'Whole field selected',
    zoom: 'Zoom in',
  },
  es: {
    title: 'La historia de este campo',
    corn: 'Maíz',
    field: 'Campo completo',
    zoom: 'Acercar',
  },
  'zh-CN': {
    title: '这片土地的历史',
    corn: '玉米',
    field: '已选中整块',
    zoom: '放大',
  },
};
async function ready() {
  await page.waitForFunction(
    () => !document.querySelector('#year-select').disabled,
  );
}
try {
  await page.goto(base + '/?place=IA&year=2025&lon=-93.6&lat=42.1');
  await ready();
  await page.waitForSelector('#field-card[data-field-id]');
  await page.waitForFunction(
    () => document.querySelectorAll('.history-row').length === 29,
    null,
    { timeout: 120000 },
  );
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  const fieldId = await page
    .locator('#field-card')
    .getAttribute('data-field-id');
  await page.locator('#crop').selectOption('1');
  await page.waitForFunction(
    () =>
      document
        .querySelector('#map-status')
        .textContent.includes('Click a field'),
    null,
    { timeout: 60000 },
  );
  const requests = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) requests.push(r.url());
  });
  let csvOriginal;
  let geometryOriginal;
  for (const lang of ['es', 'zh-CN', 'en']) {
    const before = requests.length;
    await page.locator('#language').selectOption(lang);
    const e = expected[lang];
    assert.equal(await page.locator('html').getAttribute('lang'), lang);
    assert.equal(await page.locator('.history-header h2').innerText(), e.title);
    assert.ok(
      (await page.locator('#field-status').innerText()).includes(e.field),
    );
    assert.ok(
      (await page.locator('#crop option:checked').innerText()).includes(e.corn),
    );
    assert.equal(
      await page.locator('.maplibregl-ctrl-zoom-in').getAttribute('aria-label'),
      e.zoom,
    );
    assert.equal(await page.locator('#year-select').inputValue(), '2025');
    assert.equal(
      await page.locator('#field-card').getAttribute('data-field-id'),
      fieldId,
    );
    assert.equal(await page.locator('#crop').inputValue(), '1');
    assert.equal(new URL(page.url()).searchParams.get('lang'), lang);
    assert.equal(
      requests.length,
      before,
      'Language changes must not refetch data',
    );
    if (lang === 'es')
      assert.ok(
        (await page.locator('#field-status').innerText()).includes('15,56'),
      );
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#export-history').click();
    const file = new URL(`i18n-${lang}.csv`, output).pathname;
    await (await downloadEvent).saveAs(file);
    const csv = await readFile(file, 'utf8');
    assert.ok(csv.includes('"Corn"'));
    if (csvOriginal) assert.equal(csv, csvOriginal);
    else csvOriginal = csv;
    const geoEvent = page.waitForEvent('download');
    await page.locator('#export-field').click();
    const geoFile = new URL(`i18n-${lang}.geojson`, output).pathname;
    await (await geoEvent).saveAs(geoFile);
    const geo = await readFile(geoFile, 'utf8');
    if (geometryOriginal) assert.equal(geo, geometryOriginal);
    else geometryOriginal = geo;
    // Desktop and mobile screenshots, with full page width and readable controls.
    await page
      .locator('#history-panel')
      .evaluate((element) => (element.scrollTop = 0));
    await page.screenshot({
      path: new URL(`desktop-${lang}.jpg`, output).pathname,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#focus-field').click();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      390,
    );
    assert.ok(await page.locator('#language').isVisible());
    await page.screenshot({
      path: new URL(`mobile-${lang}.jpg`, output).pathname,
    });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.locator('#focus-field').click();
  }
  // Preference persistence, URL precedence, unsupported locale fallback.
  await page.locator('#language').selectOption('es');
  await page.goto(base);
  await ready();
  assert.equal(await page.locator('html').getAttribute('lang'), 'es');
  await page.goto(base + '/?lang=zh-CN');
  await ready();
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  await page.goto(base + '/?lang=unsupported');
  await ready();
  assert.equal(await page.locator('html').getAttribute('lang'), 'es');
  // Switch while failures are visible, so error bindings also update.
  await page.route('**/api/field?**', (route) =>
    route.fulfill({ status: 502, json: { error: 'test' } }),
  );
  await page.goto(base + '/?lang=en&place=IA&lon=-93.6&lat=42.1');
  await page.locator('#retry-field').waitFor();
  await page.locator('#language').selectOption('es');
  assert.ok(
    (await page.locator('#field-status').innerText()).includes(
      'no disponibles temporalmente',
    ),
  );
  assert.equal(
    await page.locator('#retry-field').innerText(),
    'Reintentar límites',
  );
  await page.unroute('**/api/field?**');
  await page.locator('#place').selectOption('AK');
  assert.ok(
    (await page.locator('#coverage-warning').innerText()).includes(
      'Alaska está fuera',
    ),
  );
  await page.locator('#language').selectOption('zh-CN');
  assert.ok(
    (await page.locator('#coverage-warning').innerText()).includes('阿拉斯加'),
  );
  const other = await browser.newPage({ locale: 'es-MX' });
  await other.goto(base);
  await other.waitForFunction(() => !document.querySelector('#place').disabled);
  assert.equal(await other.locator('html').getAttribute('lang'), 'es');
  await other.close();
  const fallback = await browser.newPage({ locale: 'fr-FR' });
  await fallback.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('disabled');
      },
    });
  });
  await fallback.goto(base);
  await fallback.waitForFunction(
    () => !document.querySelector('#place').disabled,
  );
  assert.equal(await fallback.locator('html').getAttribute('lang'), 'en');
  await fallback.locator('#language').selectOption('es');
  assert.equal(new URL(fallback.url()).searchParams.get('lang'), 'es');
  await fallback.close();
  assert.deepEqual(errors, []);
  const report = {
    passed: true,
    checkedAt: new Date().toISOString(),
    languages: Object.keys(expected),
    checks: [
      'UI and crop names',
      'accessible controls',
      'unchanged selected field, filters and year',
      'no data refetch on language change',
      'identical CSV and GeoJSON across languages',
      'localized numbers',
      'URL precedence and saved preference',
      'browser-language detection and English fallback',
      'disabled localStorage',
      'localized errors and coverage',
      'desktop/mobile layouts',
    ],
  };
  await writeFile(
    new URL('i18n-verification.json', output),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
