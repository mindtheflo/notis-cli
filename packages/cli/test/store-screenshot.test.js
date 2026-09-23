import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import {
  composeStoreScreenshot,
  resolveStoreScreenshotAccent,
  storeScreenshotLayout,
} from '../src/runtime/store-screenshot.js';

test('Store screenshot layout keeps a large 16:10 app window', () => {
  const layout = storeScreenshotLayout(2000, 1250);

  assert.equal(layout.cardWidth, 1760);
  assert.equal(layout.cardHeight, 1100);
  assert.equal(layout.cardLeft, 120);
  assert.ok(layout.cardTop > 0);
  assert.ok(layout.radius >= 24);
});

test('Store screenshot accent is explicit or stable from the app name', () => {
  assert.equal(resolveStoreScreenshotAccent('amber', 'Journal'), 'amber');
  assert.equal(
    resolveStoreScreenshotAccent(null, 'Journal'),
    resolveStoreScreenshotAccent(null, 'Journal'),
  );
});

test('narrow and wide captures keep their aspect ratio inside the available frame', () => {
  const portrait = storeScreenshotLayout(2000, 1250, 0.8);
  assert.equal(portrait.cardHeight, 1100);
  assert.equal(portrait.cardWidth, 880);
  const wide = storeScreenshotLayout(2000, 1250, 2);
  assert.equal(wide.cardWidth, 1760);
  assert.equal(wide.cardHeight, 880);
});

test('focused tall captures retain top and bottom content instead of centre-cropping', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'notis-store-tall-'));
  const inputPath = join(dir, 'capture.png');
  const outputPath = join(dir, 'listing.png');
  await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="500" fill="#ff0000"/><rect y="500" width="800" height="500" fill="#0000ff"/></svg>')).png().toFile(inputPath);
  const { card } = await composeStoreScreenshot({ inputPath, outputPath, focused: true });
  const pixel = async (y) => sharp(outputPath).extract({ left: card.left + Math.floor(card.width / 2), top: y, width: 1, height: 1 }).raw().toBuffer();
  const top = await pixel(card.top + 5);
  const bottom = await pixel(card.top + card.height - 6);
  assert.ok(top[0] > 240 && top[2] < 10);
  assert.ok(bottom[2] > 240 && bottom[0] < 10);
  assert.equal(card.width, 880);
  assert.equal(card.height, 1100);
});

test('compositor writes a compact exact-size PNG without redrawing source UI', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'notis-store-screenshot-'));
  const inputPath = join(dir, 'capture.png');
  const outputPath = join(dir, 'listing.png');
  const source = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000">
      <rect width="1600" height="1000" fill="#ffffff"/>
      <rect x="120" y="100" width="1360" height="180" rx="24" fill="#f4f4f5"/>
      <text x="180" y="210" font-size="72" fill="#18181b">Truthful app capture</text>
    </svg>
  `);
  await sharp(source).png().toFile(inputPath);

  const presentation = await composeStoreScreenshot({
    inputPath,
    outputPath,
    accent: 'amber',
    seed: 'journal',
    theme: 'dark',
  });
  const metadata = await sharp(outputPath).metadata();
  const [renderedCorner, sourceCorner] = await Promise.all([
    sharp(outputPath).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer(),
    sharp(fileURLToPath(new URL('../src/runtime/assets/store-screenshot-dark.png', import.meta.url)))
      .resize(2000, 1250, { fit: 'cover', position: 'centre' })
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .raw()
      .toBuffer(),
  ]);

  assert.equal(metadata.width, 2000);
  assert.equal(metadata.height, 1250);
  assert.equal(metadata.format, 'png');
  assert.equal(presentation.mode, 'framed');
  assert.equal(presentation.accent, 'amber');
  assert.equal(presentation.theme, 'dark');
  assert.ok(
    renderedCorner.subarray(0, 3).every((channel, index) => Math.abs(channel - sourceCorner[index]) <= 3),
  );
  assert.ok(statSync(outputPath).size < 2 * 1024 * 1024);
});

test('compositor uses the shared backdrop for a light capture too', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'notis-store-screenshot-light-'));
  const inputPath = join(dir, 'capture.png');
  const outputPath = join(dir, 'listing.png');
  await sharp({
    create: { width: 1600, height: 1000, channels: 4, background: '#ffffff' },
  }).png().toFile(inputPath);

  const presentation = await composeStoreScreenshot({ inputPath, outputPath, theme: 'light' });
  const [pixel, sharedBackdropPixel] = await Promise.all([
    sharp(outputPath).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer(),
    sharp(fileURLToPath(new URL('../src/runtime/assets/store-screenshot-dark.png', import.meta.url)))
      .resize(2000, 1250, { fit: 'cover', position: 'centre' })
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .raw()
      .toBuffer(),
  ]);

  assert.equal(presentation.theme, 'light');
  assert.ok(
    pixel.subarray(0, 3).every((channel, index) => Math.abs(channel - sharedBackdropPixel[index]) <= 3),
  );
});
