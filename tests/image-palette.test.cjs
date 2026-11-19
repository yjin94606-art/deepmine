'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const palette = import('../dist/image-palette.mjs');

// Keep swatches as actual RGBA bytes, just as getImageData returns them.
function pixels(...swatches) {
  return Uint8ClampedArray.from(swatches.flatMap(([count, r, g, b, a = 255]) =>
    Array.from({length:count}, () => [r, g, b, a]).flat()));
}

test('one dominant hue survives shading and differing colors at the center', async () => {
  const {dominantColors} = await palette;
  const data = pixels([42, 28, 89, 194], [16, 221, 36, 29], [42, 65, 118, 224]);
  assert.deepEqual(dominantColors(data), ['blue']);
});

test('two clear hues yield a localized sentence without assigning colors to depicted objects', async () => {
  const {dominantColors,addPaletteSummary} = await palette;
  const colors = dominantColors(pixels([54, 45, 134, 76], [37, 32, 82, 193], [9, 220, 220, 220]));
  assert.deepEqual(colors, ['green', 'blue']);
  const summary = ['画中有一个人物。', 'A character appears in the picture.', '人物が描かれています。'];
  const result = addPaletteSummary(summary, colors);
  assert.deepEqual(result, ['画中有一个人物。整幅画面以绿色和蓝色为主。',
    'A character appears in the picture. The image is mostly green and blue.', '人物が描かれています。全体は緑と青を基調としています。']);
  assert.deepEqual(addPaletteSummary(result, colors), result);
});

test('transparency is excluded and sparse visible data yields no guess', async () => {
  const {dominantColors} = await palette;
  assert.deepEqual(dominantColors(pixels([80, 255, 0, 0, 0], [30, 30, 81, 220])), ['blue']);
  assert.deepEqual(dominantColors(pixels([80, 255, 0, 0, 0], [3, 30, 81, 220])), []);
  assert.deepEqual(dominantColors(pixels([100, 242, 65, 122, 0])), []);
});

test('mixed, predominantly neutral, and very dark images keep their subject description alone', async () => {
  const {dominantColors,addPaletteSummary} = await palette;
  const samples = [
    pixels([25, 240, 30, 40], [25, 222, 190, 30], [25, 45, 177, 75], [25, 32, 93, 212]),
    pixels([72, 190, 190, 190], [28, 40, 62, 173]),
    pixels([42, 24, 18, 43], [58, 49, 59, 30])
  ];
  const original = ['这是一幅画。', 'An illustration.', '一枚の絵です。'];
  for (const data of samples) {
    assert.deepEqual(dominantColors(data), []);
    assert.strictEqual(addPaletteSummary(original, dominantColors(data)), original);
  }
});
