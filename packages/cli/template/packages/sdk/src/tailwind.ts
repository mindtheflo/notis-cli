/** Build-only SDK content discovery. Author configuration and PostCSS plugins stay intact. */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
        return source.includes(directive) ? null : { code: `${source}\n${directive}\n`, map: null };
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
const content = config.content || [];
const files = Array.isArray(content) ? content : (content.files || []);
const base = ${JSON.stringify(root)};
const relativeBase = ${JSON.stringify(dirname(config))};
export default { ...config, content: {
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
