/**
 * Build-only SDK content discovery and Notis theme colours. Author configuration and PostCSS plugins stay intact:
 * a colour, theme value or opacity step the Space defines itself always wins over the defaults added here.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const tone = (name: string) => `hsl(var(--${name}))`;
const pair = (name: string) => ({ DEFAULT: tone(name), foreground: tone(`${name}-foreground`) });

/**
 * The colours the Notis host sets on every Space page (light and dark), as Tailwind colours, so `bg-accent`,
 * `text-chart-2` and opacity modifiers such as `bg-chart-2/40` or `bg-foreground/12` work in every Space.
 */
export const NOTIS_THEME_COLORS = {
  border: tone('border'), input: tone('input'), ring: tone('ring'),
  background: tone('background'), foreground: tone('foreground'),
  primary: pair('primary'), secondary: pair('secondary'), destructive: pair('destructive'), muted: pair('muted'),
  accent: pair('accent'), popover: pair('popover'), card: pair('card'),
  chart: { 1: tone('chart-1'), 2: tone('chart-2'), 3: tone('chart-3'), 4: tone('chart-4'), 5: tone('chart-5') },
} as const;

/** Tailwind 4 theme block: `default` keeps every colour a Space sets in its own `@theme` or `@config` first. */
const THEME_MARK = '/* notis-theme-colors */';
const themeBlock = () => {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(NOTIS_THEME_COLORS)) {
    if (typeof value === 'string') { lines.push(`  --color-${name}: ${value};`); continue; }
    for (const [key, shade] of Object.entries(value)) lines.push(`  --color-${name}${key === 'DEFAULT' ? '' : `-${key}`}: ${shade};`);
  }
  return `${THEME_MARK}\n@theme default inline {\n${lines.join('\n')}\n}`;
};

/** Tailwind 3 only knows the opacity steps of its scale (5, 10, 15...): every whole percent works, as in Tailwind 4. */
const OPACITY_STEPS = Object.fromEntries(Array.from({ length: 101 }, (_, step) => [String(step), String(step / 100)]));

export function notisTailwindContent() {
  let root = process.cwd();
  let temporary: string | undefined;
  const wrappers = new Map<string, string>();
  const cleanup = () => {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
    temporary = undefined;
    wrappers.clear();
  };
  return {
    name: 'notis-sdk-tailwind-content',
    enforce: 'pre' as const,
    configResolved(config: { root: string }) { root = config.root; },
    transform(source: string, id: string) {
      const stylesheet = id.split('?')[0];
      if (!stylesheet.endsWith('.css')) return null;
      // Tailwind 4 discovers dependency sources through CSS, not config.content.
      // Keep the author's imports, configuration and PostCSS pipeline untouched.
      if (/@import\s+(?:url\(\s*)?(['"])tailwindcss(?:\/[^'"]*)?\1/.test(source)) {
        const sdkSource = dirname(fileURLToPath(import.meta.url));
        const relativeSource = './' + relative(dirname(stylesheet), sdkSource).replaceAll('\\', '/');
        const directive = `@source ${JSON.stringify(relativeSource)};`;
        const added = [source.includes(directive) ? '' : `${directive}\n`, source.includes(THEME_MARK) ? '' : `${themeBlock()}\n`].join('');
        return added ? { code: `${source}\n${added}`, map: null } : null;
      }
      if (!/@tailwind\s/.test(source)) return null;
      const explicit = source.match(/@config\s+(['"])(.*?)\1\s*;/);
      const config = explicit
        ? resolve(dirname(id.split('?')[0]), explicit[2])
        : ['ts', 'js', 'cjs', 'mjs'].map(ext => join(root, `tailwind.config.${ext}`)).find(existsSync);
      if (!config) return null;
      let wrapper = wrappers.get(config);
      if (!wrapper) {
        temporary ||= mkdtempSync(join(tmpdir(), 'notis-tailwind-'));
        wrapper = join(temporary, `config-${wrappers.size}.ts`);
        const sdkGlob = join(dirname(fileURLToPath(import.meta.url)), '**/*.{ts,tsx}').replaceAll('\\', '/');
        writeFileSync(wrapper, `import config from ${JSON.stringify(config)};
import { resolve } from 'node:path';
const defaults = ${JSON.stringify({ colors: NOTIS_THEME_COLORS, opacity: OPACITY_STEPS })};
const theme = config.theme || {};
const extend = theme.extend || {};
const presets = (config.presets || []).filter(preset => preset && typeof preset === 'object').map(preset => preset.theme || {});
// The Space's own colours and opacity steps win: a default fills only what the Space (or its presets) leaves unset,
// one level deep, so a Space's own card keeps the Notis card-foreground. A scale the Space replaces stays as it is.
const fill = (key) => {
  if (typeof theme[key] === 'function' || (key === 'opacity' && theme.opacity)) return extend[key];
  const own = [...presets.flatMap(t => [t[key], (t.extend || {})[key]]), theme[key], extend[key]].filter(v => v && typeof v === 'object');
  const added = {};
  for (const [name, value] of Object.entries(defaults[key])) {
    const set = own.map(o => o[name]).filter(v => v !== undefined);
    if (!set.length) added[name] = value;
    else if (typeof value === 'object' && set.every(v => v && typeof v === 'object')) added[name] = Object.assign({}, value, ...set);
  }
  return typeof extend[key] === 'function' ? (utils) => ({ ...added, ...extend[key](utils) }) : { ...extend[key], ...added };
};
const content = config.content || [];
const files = Array.isArray(content) ? content : (content.files || []);
const base = ${JSON.stringify(root)};
const relativeBase = ${JSON.stringify(dirname(config))};
export default { ...config, theme: { ...theme, extend: { ...extend, colors: fill('colors'), opacity: fill('opacity') } }, content: {
  ...(Array.isArray(content) ? {} : content),
  relative: false,
  files: [...files.map(file => typeof file !== 'string' ? file :
    (file.startsWith('!') ? '!' : '') + resolve(content.relative ? relativeBase : base, file.replace(/^!/, ''))),
    ${JSON.stringify(sdkGlob)}],
} };
`);
        wrappers.set(config, wrapper);
      }
      const directive = `@config ${JSON.stringify('./' + relative(dirname(id.split('?')[0]), wrapper).replaceAll('\\', '/'))};`;
      // Imports must remain before @config. Vite resolves them before PostCSS.
      const code = explicit ? source.replace(explicit[0], directive) : `${source}\n${directive}\n`;
      return { code, map: null };
    },
    closeBundle: cleanup,
    closeWatcher: cleanup,
  };
}
