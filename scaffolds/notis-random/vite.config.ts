import { notisViteConfig } from '@notis/sdk/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type UserConfig } from 'vite';
import appConfig from './notis.config';

const libConfig = notisViteConfig(appConfig) as unknown as UserConfig;

export default defineConfig({
  ...libConfig,
  plugins: [react(), ...((libConfig.plugins as UserConfig['plugins']) ?? [])],
});
