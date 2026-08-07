import { defineNotisApp } from '@notis/sdk/config';

export default defineNotisApp({
  name: 'notis-notes',
  title: 'Notis Notes',
  description:
    'A home for every note Notis captures. Organise them into a nested folder tree, then read them as a gallery of cards, as a sortable table of all their properties, or on a calendar laid out by due date or by when they were created. Rename, refile, and archive notes in bulk, and create a new one without leaving the view.',
  icon: 'phosphor:note-pencil',
  accent: 'emerald',
  author: { name: 'Notis' },
  categories: ['Productivity', 'Personal'],
  tagline: 'Folder-based notes with gallery, table, and calendar views.',
  screenshots: [
    {
      path: 'metadata/screenshot-1.png',
      alt: 'Notes gallery showing cards for each note with its folder, status, and a preview of the text.',
      route: 'notis-notes',
      scenario: 'notes-gallery',
      focus: '[data-store-screenshot="notes"]',
      theme: 'light',
    },
    {
      path: 'metadata/screenshot-2.png',
      alt: 'The same notes gallery in dark mode.',
      route: 'notis-notes',
      scenario: 'notes-gallery',
      focus: '[data-store-screenshot="notes"]',
      theme: 'dark',
    },
    {
      path: 'metadata/screenshot-3.png',
      alt: 'Table view listing every note with its folder, status, and due date in sortable columns.',
      route: 'notis-notes',
      scenario: 'notes-table',
      focus: '[data-store-screenshot="notes"]',
      theme: 'light',
    },
    {
      path: 'metadata/screenshot-4.png',
      alt: 'Calendar view placing notes on the month grid, with a picker to lay them out by created date or by any date property.',
      route: 'notis-notes',
      scenario: 'notes-calendar',
      focus: '[data-store-screenshot="notes"]',
      theme: 'light',
    },
    {
      path: 'metadata/screenshot-5.png',
      alt: 'The notes calendar in dark mode with notes spread across the month and today highlighted.',
      route: 'notis-notes',
      scenario: 'notes-calendar',
      focus: '[data-store-screenshot="notes"]',
      theme: 'dark',
    },
  ],
  // The starter folder tree ships with the app; the notes themselves never do.
  databases: [{ slug: 'note_folders', seedDocuments: true }, 'notes'],
  routes: [
    {
      path: '/',
      slug: 'notis-notes',
      name: 'Notes',
      icon: 'phosphor:note-pencil',
      default: true,
      collection: {
        database: 'note_folders',
        titleProperty: 'Name',
        parentProperty: 'Parent',
        sidebar: {
          mode: 'tree',
          allowCreate: true,
        },
      },
    },
  ],
  tools: [
    'LOCAL_NOTIS_DATABASE_QUERY',
    'LOCAL_NOTIS_DATABASE_GET_DATABASE',
    'LOCAL_NOTIS_DATABASE_UPSERT_NOTES',
  ],
});
