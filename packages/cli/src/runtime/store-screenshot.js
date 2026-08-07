import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const STORE_SCREENSHOT_ASPECT = 16 / 10;
const SHARED_BACKDROP_PATH = fileURLToPath(
  new URL('./assets/store-screenshot-dark.png', import.meta.url),
);

const ACCENT_PALETTES = {
  blue: { glow: '#4f7cff', glow2: '#274690' },
  violet: { glow: '#9b87f5', glow2: '#5038a1' },
  emerald: { glow: '#34d399', glow2: '#176b55' },
  amber: { glow: '#f2a94a', glow2: '#8b4f20' },
  rose: { glow: '#fb7185', glow2: '#8f3048' },
  sky: { glow: '#38bdf8', glow2: '#176887' },
  fuchsia: { glow: '#d946ef', glow2: '#772786' },
  teal: { glow: '#2dd4bf', glow2: '#176e68' },
};

const ACCENT_NAMES = Object.keys(ACCENT_PALETTES);

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || 'notis-app')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function resolveStoreScreenshotAccent(accent, seed = 'notis-app') {
  if (accent && ACCENT_PALETTES[accent]) {
    return accent;
  }
  return ACCENT_NAMES[stableHash(seed) % ACCENT_NAMES.length];
}

export function storeScreenshotLayout(width = 2000, height = 1250) {
  const horizontalInset = Math.max(48, Math.round(width * 0.06));
  const verticalInset = Math.max(40, Math.round(height * 0.06));
  let cardWidth = width - horizontalInset * 2;
  let cardHeight = Math.round(cardWidth / STORE_SCREENSHOT_ASPECT);
  const maximumCardHeight = height - verticalInset * 2;
  if (cardHeight > maximumCardHeight) {
    cardHeight = maximumCardHeight;
    cardWidth = Math.round(cardHeight * STORE_SCREENSHOT_ASPECT);
  }
  const cardLeft = Math.round((width - cardWidth) / 2);
  const cardTop = Math.round((height - cardHeight) / 2) - Math.round(height * 0.008);
  return {
    width,
    height,
    cardWidth,
    cardHeight,
    cardLeft,
    cardTop,
    radius: Math.max(18, Math.round(width * 0.016)),
  };
}

async function backdropImage(layout) {
  return sharp(SHARED_BACKDROP_PATH)
    .resize(layout.width, layout.height, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
}

function roundedRectSvg(width, height, radius, { fill = '#ffffff', stroke = null } = {}) {
  const strokeAttribute = stroke
    ? ` fill="none" stroke="${stroke}" stroke-width="2"`
    : ` fill="${fill}"`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${radius}" ry="${radius}"${strokeAttribute}/></svg>`,
  );
}

/**
 * Composite a truthful browser capture into the deterministic Store frame.
 * The source pixels are only resized/cropped; the app UI is never redrawn.
 */
export async function composeStoreScreenshot({
  inputPath,
  outputPath,
  width = 2000,
  height = 1250,
  accent = null,
  seed = 'notis-app',
  focused = false,
  theme = 'light',
}) {
  const resolvedTheme = theme === 'dark' ? 'dark' : 'light';
  const layout = storeScreenshotLayout(width, height);
  const resolvedAccent = resolveStoreScreenshotAccent(accent, seed);

  const roundedCapture = await sharp(inputPath)
    .resize(layout.cardWidth, layout.cardHeight, {
      fit: 'cover',
      position: focused ? 'top' : 'centre',
    })
    .composite([{
      input: roundedRectSvg(layout.cardWidth, layout.cardHeight, layout.radius),
      blend: 'dest-in',
    }])
    .png()
    .toBuffer();

  const border = roundedRectSvg(
    layout.cardWidth,
    layout.cardHeight,
    layout.radius,
    { stroke: resolvedTheme === 'dark' ? '#FFFFFF2A' : '#0F172A22' },
  );

  await sharp(await backdropImage(layout))
    .composite([
      { input: roundedCapture, left: layout.cardLeft, top: layout.cardTop },
      { input: border, left: layout.cardLeft, top: layout.cardTop },
    ])
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true,
    })
    .toFile(outputPath);

  return {
    mode: 'framed',
    accent: resolvedAccent,
    focused: Boolean(focused),
    theme: resolvedTheme,
    card: {
      left: layout.cardLeft,
      top: layout.cardTop,
      width: layout.cardWidth,
      height: layout.cardHeight,
      radius: layout.radius,
    },
  };
}
