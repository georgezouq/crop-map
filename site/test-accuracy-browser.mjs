import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:8787';
const output = new URL('../artifacts/usda/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
});
const page = await browser.newPage({
  locale: 'zh-CN',
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'reduce',
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const pointUrl = `${base}/?region=conus&lang=zh-CN&year=2025&place=WA&lon=-122.29931&lat=48.95943`;
try {
  const historyResponse = page.waitForResponse(
    (r) => r.url().includes('/api/history?'),
    { timeout: 180000 },
  );
  await page.goto(pointUrl);
  const history = await (await historyResponse).json();
  assert.equal(history.rows.find((r) => r.year === 2025).code, 242);
  assert.equal(history.rows.find((r) => r.year === 2025).resolution, 10);
  await page.waitForSelector('.history-row');
  assert.match(
    await page.locator('.history-row').first().innerText(),
    /蓝莓.*分类 242 · 10 米像元/s,
  );
  await page.waitForFunction(() =>
    document.querySelector('#field-status').textContent.includes('未匹配'),
  );
  assert.match(
    await page.locator('#field-description').innerText(),
    /不能据此确认实际种植/,
  );
  assert.match(await page.locator('.history-note').innerText(), /道路及田边/);
  let successfulImagery = 0;
  page.on('response', (r) => {
    if (r.url().includes('/World_Imagery/') && r.ok()) successfulImagery++;
  });
  assert.equal(await page.locator('#show-crops').isChecked(), true);
  assert.equal(await page.locator('#opacity').inputValue(), '80');
  await page.locator('#basemap').selectOption('imagery');
  assert.equal(await page.locator('#show-crops').isChecked(), true);
  assert.equal(await page.locator('#opacity').inputValue(), '50');
  await page.locator('#show-crops').uncheck();
  // Zoom around the selected coordinate to inspect the road/field edge.
  for (let i = 0; i < 6; i++)
    await page.getByRole('button', { name: '放大', exact: true }).click();
  await page.waitForTimeout(8000);
  assert.ok(successfulImagery > 0, 'Esri imagery actually loaded');
  await page
    .locator('#map-status[data-i18n="mapReady"]')
    .waitFor({ state: 'attached' });
  assert.equal(await page.locator('#map-status').isVisible(), false);
  await page.screenshot({
    path: new URL('road-imagery-desktop.jpg', output).pathname,
  });
  const imageryPixels = await page.locator('canvas').screenshot();
  await page.locator('#show-crops').check();
  await page.waitForTimeout(8000);
  assert.notDeepEqual(await page.locator('canvas').screenshot(), imageryPixels);
  await page.screenshot({
    path: new URL('road-overlay-desktop.jpg', output).pathname,
  });
  await page.locator('#opacity').focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowRight');
  await page.locator('#basemap').selectOption('map');
  assert.equal(await page.locator('#opacity').inputValue(), '80');
  await page.locator('#basemap').selectOption('imagery');
  assert.equal(await page.locator('#opacity').inputValue(), '40');
  await page.locator('#show-crops').uncheck();
  await page.locator('#year-select').selectOption('2024');
  await page.locator('#language').selectOption('es');
  assert.equal(await page.locator('#show-crops').isChecked(), false);
  assert.equal(await page.locator('#imagery-note').count(), 0);
  assert.equal(new URL(page.url()).searchParams.get('overlay'), '0');
  await page.reload();
  await page.waitForFunction(
    () => !document.querySelector('#basemap').disabled,
  );
  assert.equal(await page.locator('#basemap').inputValue(), 'imagery');
  assert.equal(await page.locator('#opacity').inputValue(), '40');
  assert.equal(await page.locator('#show-crops').isChecked(), false);
  await page.locator('#language').selectOption('en');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth),
    390,
  );
  assert.equal(
    await page
      .locator('.history-note')
      .evaluate((e) => getComputedStyle(e).display),
    'block',
  );
  await page.locator('#basemap').selectOption('map');
  await page.locator('#basemap').selectOption('imagery');
  await page.screenshot({
    path: new URL('road-imagery-mobile.jpg', output).pathname,
  });
  // An incomplete rendered map must not silently invalidate or relabel a valid point sample.
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.route('**/api/tiles/**', (route) =>
    route.fulfill({ status: 502, body: 'test failure' }),
  );
  await page.goto(pointUrl);
  await page.waitForFunction(() =>
    document.querySelector('#map-status').textContent.includes('显示不完整'),
  );
  await page.waitForSelector('.history-row');
  assert.equal(await page.locator('#map-status').isVisible(), true);
  assert.match(await page.locator('.history-row').first().innerText(), /蓝莓/);
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    checkedAt: new Date().toISOString(),
    livePoint: {
      lon: history.lon,
      lat: history.lat,
      year: 2025,
      code: 242,
      resolution: 10,
    },
    successfulImagery,
    checks: [
      'source classification preserved',
      'overlay defaults on with 50% imagery opacity and 80% map opacity',
      'per-basemap custom opacity survives switching, language, year and reload',
      'unverified raster and field-edge warning',
      'imagery loads and overlay visibly toggles',
      'language/year/URL restore preserve comparison',
      'mobile controls and warning',
      'tile failure distinguished from point result',
    ],
  };
  await writeFile(
    new URL('accuracy-browser-verification.json', output),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
