import sharp from 'sharp';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const input = join(root, 'public/images/logo-circle.png');
const output = join(root, 'public/images/logo-circle-dark.png');

const CREAM = [245, 240, 232];
const GOLD = [232, 197, 71];

const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

for (let i = 0; i < data.length; i += 4) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const lum = (r + g + b) / 3;

  if (lum > 235) {
    data[i + 3] = 0;
    continue;
  }

  if (lum < 80) {
    data[i] = CREAM[0];
    data[i + 1] = CREAM[1];
    data[i + 2] = CREAM[2];
    data[i + 3] = 255;
    continue;
  }

  data[i] = GOLD[0];
  data[i + 1] = GOLD[1];
  data[i + 2] = GOLD[2];
  data[i + 3] = Math.round(180 + (lum / 255) * 75);
}

await sharp(data, {
  raw: { width: info.width, height: info.height, channels: 4 },
})
  .png()
  .toFile(output);

console.log('Created', output);
