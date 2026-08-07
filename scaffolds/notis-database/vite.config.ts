import { notisViteConfig } from '@notis/sdk/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type UserConfig } from 'vite';
import appConfig from './notis.config';

// Two-mode config: dev (`vite`) serves the mock-runtime preview from
// `index.html` + `src/dev-main.tsx`, while production (`vite build`)
// emits the Notis portal bundle from `.notis/_entry.tsx`.
export default defineConfig(({ command }): UserConfig => {
  if (command === 'serve') {
    return {
      plugins: [react()],
      resolve: { alias: { '@': __dirname } },
    };
  }

  const libConfig = notisViteConfig(appConfig) as unknown as UserConfig;
  return {
    ...libConfig,
    plugins: [react(), ...((libConfig.plugins as UserConfig['plugins']) ?? [])],
  };
});
