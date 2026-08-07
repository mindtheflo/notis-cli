import { notisViteConfig } from '@notis/sdk/vite';
import react from '@vitejs/plugin-react';
import appConfig from './notis.config';

const config = notisViteConfig(appConfig);

export default {
  ...config,
  plugins: [react(), ...(config.plugins || [])],
};
