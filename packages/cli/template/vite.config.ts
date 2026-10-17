import { notisViteConfig } from '@notis/sdk/vite';
import react from '@vitejs/plugin-react';
import workspace from './notis.config';

const config = notisViteConfig(workspace);

export default {
  ...config,
  plugins: [react(), ...(config.plugins || [])],
};
