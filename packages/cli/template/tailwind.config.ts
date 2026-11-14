import type { Config } from 'tailwindcss';
import tailwindAnimate from 'tailwindcss-animate';

// The Notis theme colours (bg-accent, text-muted-foreground, bg-chart-2/40...) come from @notis/sdk/vite.
// A colour defined here wins over the Notis one of the same name.
const config: Config = {
  darkMode: 'class',
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [tailwindAnimate],
};

export default config;
