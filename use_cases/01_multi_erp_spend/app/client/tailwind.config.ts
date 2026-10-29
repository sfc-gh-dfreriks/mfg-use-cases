import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        sf: {
          primary: '#29B5E8',
          dark: '#11567F',
          light: '#71D3F7',
          deeper: '#0D3B5E',
          pale: '#A3DAF5',
          cyan: '#4DC9F6',
        },
      },
    },
  },
  plugins: [animate],
};

export default config;
