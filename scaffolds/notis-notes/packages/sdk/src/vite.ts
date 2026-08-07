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

import type { NotisAppConfig } from './config';

export function notisViteConfig(appConfig: NotisAppConfig) {
  return {
    plugins: [
      // @vitejs/plugin-react is added by the consumer's vite.config.ts
      // or auto-detected. We provide the config shape only.
    ],
    build: {
      lib: {
        entry: '.notis/_entry.tsx',
        formats: ['es'] as const,
        fileName: () => 'app.js',
      },
      rollupOptions: {
        external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
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
