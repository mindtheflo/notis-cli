/**
 * Vite config builder for Notis apps.
 *
 * Usage:
 * ```ts
 * // vite.config.ts
 * import { notisViteConfig } from '@notis/sdk/vite';
 * import appConfig from './notis.config';
 * export default notisViteConfig(appConfig);
 * ```
 *
 * Produces a library-mode ES module bundle with React externalized.
 * Output: .notis/output/bundle/app.js + app.css
 */

import * as vite from 'vite';
import type { NotisAppConfig } from './config';
import { notisTailwindContent } from './tailwind';

const externalReact = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'];

export function notisViteConfig(appConfig: NotisAppConfig): vite.UserConfig {
  // Vite 8 preserves external require() calls. App bundles run in a browser
  // with an ESM import map, so bundled CommonJS dependencies must import React.
  // Older pulled apps also receive this SDK; their Vite already does this.
  const externalRequirePlugin = 'esmExternalRequirePlugin' in vite
    && typeof vite.esmExternalRequirePlugin === 'function'
    ? vite.esmExternalRequirePlugin({ external: externalReact })
    : null;
  return {
    plugins: [
      notisTailwindContent(),
      ...(externalRequirePlugin ? [externalRequirePlugin] : []),
      // @vitejs/plugin-react is added by the consumer's vite.config.ts
      // or auto-detected. We provide the config shape only.
    ],
    build: {
      lib: {
        entry: '.notis/_entry.tsx',
        formats: ['es'],
        fileName: () => 'app.js',
      },
      // Keep Vite's compatibility alias: SDK refresh also serves historical
      // Vite 5/6/7 apps, which do not understand rolldownOptions.
      rollupOptions: {
        // On Vite 8 the plugin must own externalization as well as conversion:
        // a top-level external match bypasses its require-to-import transform.
        external: externalRequirePlugin ? [] : externalReact,
        output: {
          globals: {
            react: 'window.React',
            'react-dom': 'window.ReactDOM',
            'react-dom/client': 'window.ReactDOMClient',
            'react/jsx-runtime': 'window.React',
          },
          assetFileNames: 'app[extname]',
          inlineDynamicImports: true,
        },
      },
      outDir: '.notis/output/bundle',
      emptyOutDir: true,
      cssCodeSplit: false,
    },
    resolve: {
      alias: {
        '@': process.cwd(),
      },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  };
}
