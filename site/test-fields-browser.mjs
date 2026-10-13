import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:8787';
const output = new URL('../artifacts/usda/', import.meta.url);
await mkdir(output, { recursive: true });
const fixture = await (
  await fetch(`${base}/api/field?region=conus&lon=-93.6&lat=42.1`)
).json();
assert.equal(fixture.status, 'ok');
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'reduce',
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
async function openPoint(lon = -93.6, lat = 42.1) {
  await page.goto(
    `${base}/?region=conus&year=2025&place=IA&lon=${lon}&lat=${lat}`,
  );
}
async function selected() {
  await page.waitForSelector('#field-card[data-field-id="191522004396459"]');
}
try {
  await openPoint();
  await selected();
  // Click a different interior point in the rendered field, through the real map canvas.
  const marker = await page.locator('.maplibregl-marker').boundingBox();
  const canvas = page.locator('.maplibregl-canvas'),
    box = await canvas.boundingBox();
  const req = page.waitForResponse((r) => r.url().includes('/api/field?'));
  await canvas.click({
    position: {
      x: marker.x + marker.width / 2 - box.x + 25,
      y: marker.y + marker.height - box.y - 35,
    },
  });
  const second = await (await req).json();
  assert.equal(second.feature?.properties.id, fixture.feature.properties.id);
  await selected();
  assert.notEqual(new URL(page.url()).searchParams.get('lon'), '-93.6');
  await page.waitForFunction(
    () =>
      document.querySelector('#map-status').textContent.includes('点击地图'),
    null,
    { timeout: 60000 },
  );
  await page.waitForFunction(
    () => document.querySelectorAll('.history-row').length === 29,
    null,
    { timeout: 120000 },
  );
  await page.screenshot({
    path: new URL('desktop-field.jpg', output).pathname,
  });
  await page.getByRole('button', { name: '关闭历史记录' }).click();
  assert.equal(
    await page.locator('#field-card').getAttribute('data-field-id'),
    null,
  );
  assert.equal(await page.locator('.maplibregl-marker').count(), 0);
  await openPoint(-100, 30);
  await page.waitForFunction(() =>
    document.querySelector('#field-status').textContent.includes('未匹配'),
  );
  assert.equal(
    await page.locator('#field-card').getAttribute('data-field-id'),
    null,
  );
  // A slow earlier selection must not overwrite the next click or reappear after closing.
  let arrivals = 0;
  await page.route('**/api/field?**', async (route) => {
    arrivals++;
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ json: fixture }).catch(() => {});
  });
  await openPoint();
  await page.waitForFunction(() =>
    document.querySelector('#field-status').textContent.includes('查找'),
  );
  await page.getByRole('button', { name: '关闭历史记录' }).click();
  await page.waitForTimeout(2000);
  assert.equal(
    await page.locator('#field-card').getAttribute('data-field-id'),
    null,
  );
  assert.equal(await page.locator('#history-panel').isVisible(), false);
  assert.ok(arrivals > 0);
  await page.unroute('**/api/field?**');
  // Failed boundary request stays distinct from no coverage and offers its own retry.
  await page.route('**/api/field?**', (route) =>
    route.fulfill({ status: 502, json: { error: 'test failure' } }),
  );
  await openPoint();
  await page.getByRole('button', { name: '重试边界', exact: true }).waitFor();
  assert.ok(
    (await page.locator('#field-status').innerText()).includes('暂时无法读取'),
  );
  await page.unroute('**/api/field?**');
  await page.getByRole('button', { name: '重试边界', exact: true }).click();
  await selected();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '查看整块', exact: true }).click();
  await page.waitForTimeout(1500);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth),
    390,
  );
  const mapBox = await page.locator('#map').boundingBox();
  const panelBox = await page.locator('#history-panel').boundingBox();
  assert.ok(
    panelBox.y > mapBox.y + 120,
    'Visible map remains above mobile detail sheet',
  );
  await page.screenshot({
    path: new URL('mobile-field.jpg', output).pathname,
  });
  await page.getByLabel('探索地区', { exact: true }).selectOption('HI');
  assert.equal(await page.locator('#history-panel').isVisible(), false);
  assert.equal(
    await page.locator('#field-card').getAttribute('data-field-id'),
    null,
  );
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    checkedAt: new Date().toISOString(),
    checks: [
      'real map click selects same entire field at different interior point',
      'full GeoJSON polygon',
      'clear selection',
      'no field fallback',
      'late response after close discarded',
      'error and retry',
      'mobile layout and focus',
      'region switch clears field',
    ],
  };
  await writeFile(
    new URL('field-browser-verification.json', output),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
