import { defineNotisApp } from '@notis/sdk/config';

export default defineNotisApp({
  name: 'demo-dice',
  devSlug: 'demo-dice',
  title: 'Demo Dice',
  description: 'Fixture app standing in for a published Store app in the public registry.',
  tagline: 'Roll dice from a published Store app.',
  icon: 'phosphor:dice-five',
  accent: 'emerald',
  categories: ['Personal'],
  screenshots: [
    { path: 'metadata/screenshot-1.png', alt: 'Dice roller [main] view.' },
  ],
  routes: [
    { path: '/', title: 'Roll', export: 'RollPage' },
  ],
});
