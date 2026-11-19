const names = {
  red: ['红色', 'red', '赤'], orange: ['橙色', 'orange', 'オレンジ'],
  yellow: ['黄色', 'yellow', '黄色'], green: ['绿色', 'green', '緑'],
  teal: ['青绿色', 'teal', '青緑'], blue: ['蓝色', 'blue', '青'],
  purple: ['紫色', 'purple', '紫'], pink: ['粉色', 'pink', 'ピンク'],
  brown: ['棕色', 'brown', '茶色']
};

function colorFamily(r, g, b) {
  const high = Math.max(r, g, b), low = Math.min(r, g, b), chroma = high - low;
  if (high < 72 || chroma < 28 || chroma < high * .19) return null;
  let hue;
  if (high === r) hue = (g - b) / chroma;
  else if (high === g) hue = 2 + (b - r) / chroma;
  else hue = 4 + (r - g) / chroma;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15 || hue >= 350) return high >= 185 && low >= 95 ? 'pink' : 'red';
  if (hue < 43) return high < 165 ? 'brown' : 'orange';
  if (hue < 69) return 'yellow';
  if (hue < 159) return 'green';
  if (hue < 194) return 'teal';
  if (hue < 254) return 'blue';
  if (hue < 320) return 'purple';
  return 'pink';
}

export function dominantColors(rgba) {
  const weights = new Map();
  let visible = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3] / 255;
    if (alpha < .5) continue;
    visible += alpha;
    const color = colorFamily(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (color) weights.set(color, (weights.get(color) || 0) + alpha);
  }
  if (visible < 24) return [];
  const [first, second, third] = [...weights].sort((a, b) => b[1] - a[1]);
  if (!first) return [];
  // Neutral pixels still count toward the visible area. A colorful accent on a
  // mostly white or dark background should not describe the whole picture.
  if (second && second[1] >= visible * .23 && first[1] + second[1] >= visible * .75
      && (!third || third[1] < second[1] * .6)) return [first[0], second[0]];
  return first[1] >= visible * .58 ? [first[0]] : [];
}

export function addPaletteSummary(summary, colors) {
  if (!colors.length) return summary;
  const palette = colors.map(color => names[color]);
  const zh = palette.map(name => name[0]).join('和');
  const en = palette.map(name => name[1]).join(' and ');
  const ja = palette.map(name => name[2]).join('と');
  const additions = ['整幅画面以' + zh + '为主。', ' The image is mostly ' + en + '.', '全体は' + ja + 'を基調としています。'];
  return summary.map((line, i) => line.endsWith(additions[i]) ? line : line + additions[i]);
}
