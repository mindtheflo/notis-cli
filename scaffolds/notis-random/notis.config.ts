import { defineNotisApp } from '@notis/sdk/config';

export default defineNotisApp({
  name: 'notis-random',
  title: 'Random Number Generator',
  description:
    'Draw a fair random number and keep every result. Pick whole numbers over any range, a continuous decimal range, or a standard polyhedral die from d4 to d20. Each draw uses the browser crypto source with rejection sampling, so every outcome is equally likely, and every roll is saved with the bounds it used so you can look back at the full history.',
  icon: 'phosphor:dice-five',
  accent: 'violet',
  author: { name: 'Notis' },
  categories: ['Personal', 'Productivity'],
  tagline: 'Fair random numbers, with every roll kept.',
  screenshots: [
    {
      path: 'metadata/screenshot-1.png',
      alt: 'Random number generator showing the result dial, mode picker for integer, decimal, and dice, the range inputs, and recent rolls.',
      route: 'home',
      scenario: 'generator-idle',
      focus: '[data-store-screenshot="generator"]',
      theme: 'light',
    },
    {
      path: 'metadata/screenshot-2.png',
      alt: 'The generator in dark mode with the integer range set from 1 to 100 and a list of recent rolls.',
      route: 'home',
      scenario: 'generator-idle',
      focus: '[data-store-screenshot="generator"]',
      theme: 'dark',
    },
    {
      path: 'metadata/screenshot-3.png',
      alt: 'Dice mode selected with a twenty-sided die chosen and a fresh roll shown on the dial.',
      route: 'home',
      scenario: 'generator-dice',
      focus: '[data-store-screenshot="generator"]',
      theme: 'light',
    },
    {
      path: 'metadata/screenshot-4.png',
      alt: 'Roll history listing every past draw with its value, mode, bounds, and how long ago it was rolled.',
      route: 'history',
      scenario: 'history-full',
      focus: '[data-store-screenshot="history"]',
      theme: 'light',
    },
    {
      path: 'metadata/screenshot-5.png',
      alt: 'The same roll history in dark mode.',
      route: 'history',
      scenario: 'history-full',
      focus: '[data-store-screenshot="history"]',
      theme: 'dark',
    },
  ],

  databases: ['rolls'],

  routes: [
    {
      path: '/',
      slug: 'home',
      name: 'Generator',
      icon: 'phosphor:sparkle',
      default: true,
    },
    {
      path: '/history',
      slug: 'history',
      name: 'History',
      icon: 'phosphor:clock-counter-clockwise',
      collection: {
        database: 'rolls',
        titleProperty: 'Value',
        sidebar: {
          mode: 'flat-list',
          allowCreate: false,
        },
      },
    },
  ],

  tools: [
    'LOCAL_NOTIS_DATABASE_QUERY',
    'LOCAL_NOTIS_DATABASE_UPSERT_ROLLS',
  ],
});
