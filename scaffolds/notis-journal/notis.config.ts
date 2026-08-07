import { defineNotisApp } from '@notis/sdk/config';

export default defineNotisApp({
  name: 'notis-journal',
  title: '5 Minutes Journal',
  description:
    'A display-only five-minute journal built from your morning and evening check-ins with Notis. Browse daily mood, energy, motivation, gratitude, intentions, affirmations, highlights, lessons, and free-form reflections, then use Stats to see trends and ritual consistency over time.',
  icon: 'phosphor:notebook',
  accent: 'amber',
  author: { name: 'Florian (Flo) Pariset' },
  categories: ['Personal', 'Productivity'],
  tagline: 'Five intentional minutes with Notis, split between morning and evening.',
  screenshots: [
    {
      path: 'metadata/screenshot-1.png',
      alt: '5 Minutes Journal timeline with a morning check-in: mood scale, energy and motivation, gratitudes, intention, and affirmation.',
      route: 'journal',
      scenario: 'journal-overview',
      focus: '[data-store-screenshot="journal"]',
      theme: 'light',
    },
    {
      path: 'metadata/screenshot-2.png',
      alt: '5 Minutes Journal timeline in dark mode with a morning check-in, mood, energy, motivation, gratitudes, intention, and affirmation.',
      route: 'journal',
      scenario: 'journal-overview',
      focus: '[data-store-screenshot="journal"]',
      theme: 'dark',
    },
    {
      path: 'metadata/screenshot-3.png',
      alt: 'A completed day with both the morning ritual and the evening reflection, highlight, and lesson.',
      route: 'journal',
      scenario: 'journal-evening',
      focus: '[data-store-screenshot="journal"]',
      theme: 'light',
    },
    {
      path: 'metadata/screenshot-4.png',
      alt: 'A completed 5 Minutes Journal day in dark mode with both the morning ritual and evening reflection.',
      route: 'journal',
      scenario: 'journal-evening',
      focus: '[data-store-screenshot="journal"]',
      theme: 'dark',
    },
    {
      path: 'metadata/screenshot-5.png',
      alt: 'Stats page with mood trends, energy and motivation, ritual consistency, and the gratitude wall.',
      route: 'insights',
      scenario: 'journal-stats',
      focus: '[data-store-screenshot="stats"]',
      theme: 'light',
    },
    {
      path: 'metadata/screenshot-6.png',
      alt: '5 Minutes Journal Stats in dark mode with mood trends, ritual consistency, and recent gratitudes.',
      route: 'insights',
      scenario: 'journal-stats',
      focus: '[data-store-screenshot="stats"]',
      theme: 'dark',
    },
  ],
  databases: ['journal_entries'],
  skills: [
    {
      key: 'journal-onboarding',
      path: './skills/journal-onboarding/SKILL.md',
      name: 'journal-onboarding',
      description:
        'Set up the Journal morning and evening automations and run their check-ins.',
    },
  ],
  onboarding: {
    skill: 'journal-onboarding',
    prompt: 'Help me set up my Journal morning and evening check-ins.',
  },
  routes: [
    {
      path: '/',
      slug: 'journal',
      name: 'Journal',
      icon: 'phosphor:notebook',
      default: true,
    },
    {
      path: '/insights',
      slug: 'insights',
      name: 'Stats',
      icon: 'phosphor:chart-line-up',
    },
  ],
  tools: ['LOCAL_NOTIS_DATABASE_QUERY'],
});
