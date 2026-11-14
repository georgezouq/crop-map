import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = new URL('../../', import.meta.url);
const messages = JSON.parse(
  await readFile(new URL('site/src/usda/messages.json', root)),
);
const names = JSON.parse(
  await readFile(new URL('site/src/usda/crop-names.json', root)),
);
const catalog = JSON.parse(
  await readFile(new URL('site/public/data/usda/catalog.json', root)),
);
const html = await readFile(new URL('site/index.html', root), 'utf8');
test('all messages have three languages with matching interpolation variables', () => {
  const variables = (value) =>
    [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [key, translations] of Object.entries(messages)) {
    assert.deepEqual(Object.keys(translations).sort(), ['en', 'es', 'zh-CN']);
    for (const value of Object.values(translations)) {
      assert.ok(value.trim(), key);
      assert.deepEqual(variables(value), variables(translations.en), key);
    }
  }
  for (const match of html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g))
    assert.ok(messages[match[1]], match[1]);
});
test('every USDA class in both regional catalogs has Spanish and Chinese display names', () => {
  for (const region of Object.values(catalog.regions))
    for (const crop of region.classes) {
      assert.ok(names[crop.name.trim()]?.es, crop.name);
      assert.ok(names[crop.name.trim()]?.['zh-CN'], crop.name);
    }
  assert.equal(
    names['Dbl Crop WinWht/Soybeans'].es,
    'Doble cultivo: trigo de invierno / soja',
  );
  assert.equal(names['Coffee (HI only)']['zh-CN'], '咖啡（仅夏威夷）');
});
