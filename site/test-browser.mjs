import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8787';
const output = fileURLToPath(new URL('../artifacts/usda/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
try {
  await page.goto(base);
  await page.waitForFunction(
    () => !document.querySelector('#year-select').disabled,
  );
  await page.waitForFunction(
    () =>
      document.querySelector('#map-status').textContent.includes('点击地图'),
    null,
    { timeout: 60000 },
  );
  assert.equal(await page.locator('#year-select option').count(), 18);
  assert.equal(await page.locator('#place option').count(), 52);
  await page.screenshot({
    path: output + '/desktop-atlas.jpg',
    type: 'jpeg',
    quality: 90,
  });

  await page.getByRole('button', { name: /玉米带/ }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.history-row').length === 29,
    null,
    { timeout: 120000 },
  );
  assert.ok(
    (await page.locator('#history-summary').innerText()).includes(
      '26 年有分类记录',
    ),
  );
  await page.getByLabel('作物年份', { exact: true }).selectOption('2024');
  await page.waitForFunction(
    () =>
      document.querySelector('#map-status').textContent.includes('点击地图'),
    null,
    { timeout: 60000 },
  );
  assert.ok(
    (await page.locator('.history-row.selected').innerText()).includes(
      'Soybeans',
    ),
  );
  await page.screenshot({
    path: output + '/desktop-history.jpg',
    type: 'jpeg',
    quality: 90,
  });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV', exact: true }).click();
  const download = await downloadEvent;
  await download.saveAs(output + '/browser-export.csv');
  const csv = await readFile(output + '/browser-export.csv', 'utf8');
  assert.equal(csv.trim().split(/\r?\n/).length, 30);
  assert.ok(csv.includes('"-93.6"'));
  assert.ok(csv.includes('"Soybeans"'));
  assert.ok(csv.includes('fetched_at'));

  await page.getByRole('button', { name: '关闭历史记录' }).click();
  await page.getByLabel('作物年份', { exact: true }).selectOption('2008');
  assert.ok(await page.getByRole('button', { name: '上一年' }).isDisabled());
  await page.getByLabel('显示 2008 年以前（部分覆盖）').check();
  await page.getByLabel('作物年份', { exact: true }).selectOption('1997');
  assert.ok(await page.locator('#coverage-warning').isVisible());
  await page.getByLabel('探索地区', { exact: true }).selectOption('HI');
  assert.equal(await page.locator('#year-select option').count(), 3);
  assert.ok(await page.getByLabel('显示 2008 年以前（部分覆盖）').isDisabled());
  await page.getByLabel('探索地区', { exact: true }).selectOption('AK');
  assert.ok(
    (await page.locator('#coverage-warning').innerText()).includes('阿拉斯加'),
  );

  await page.getByLabel('探索地区', { exact: true }).selectOption('US');
  await page.getByLabel('显示 2008 年以前（部分覆盖）').uncheck();
  await page.getByLabel('作物年份', { exact: true }).selectOption('2025');
  await page.getByLabel('作物 / 土地覆盖', { exact: true }).selectOption('1');
  await page.waitForFunction(
    () =>
      document.querySelector('#map-status').textContent.includes('点击地图'),
    null,
    { timeout: 60000 },
  );
  assert.ok(page.url().includes('crop=1'));
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('#crop').disabled);
  assert.equal(await page.locator('#crop').inputValue(), '1');
  await page.getByLabel('作物 / 土地覆盖', { exact: true }).selectOption('');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '地区全景', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('#map-status').textContent.includes('点击地图'),
    null,
    { timeout: 60000 },
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth),
    390,
  );
  assert.deepEqual(
    await page.evaluate(() =>
      [...document.images]
        .filter((img) => !img.complete || !img.naturalWidth)
        .map((img) => img.src),
    ),
    [],
  );
  await page.screenshot({
    path: output + '/mobile-atlas.jpg',
    type: 'jpeg',
    quality: 90,
  });
  const canvas = page.locator('.maplibregl-canvas');
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width / 2, y: box.height * 0.4 } });
  await page.waitForFunction(
    () => document.querySelectorAll('.history-row').length === 29,
    null,
    { timeout: 120000 },
  );
  assert.ok(
    await page
      .getByRole('button', { name: '导出 CSV', exact: true })
      .isEnabled(),
  );
  await page.screenshot({
    path: output + '/mobile-history.jpg',
    type: 'jpeg',
    quality: 90,
  });
  assert.deepEqual(errors, [], 'No browser runtime or resource errors');
  const result = {
    passed: true,
    checkedAt: new Date().toISOString(),
    desktop: '1440×960',
    mobile: '390×844',
    checks: [
      'national map',
      '29-year point history',
      'year switching',
      'CSV download',
      'early coverage',
      'Hawaii',
      'Alaska',
      'crop filter',
      'URL restoration',
      'mobile point selection',
      'no horizontal overflow',
      'no broken images',
      'no console errors',
    ],
  };
  await writeFile(
    output + '/browser-verification.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
