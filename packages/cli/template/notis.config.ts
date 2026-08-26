import { defineNotisApp } from '@notis/sdk/config';

export default defineNotisApp({
  name: 'my-notis-app',
  devSlug: 'my-notis-app',
  title: 'My Notis App',
  description: 'A focused Notis app with one route and one database-backed workflow.',
  icon: 'phosphor:squares-four',
  author: { name: 'Notis User' },
  categories: ['Productivity'],
  tagline: 'A clean starting point for a focused workflow.',

  databases: ['items'],

  routes: [
    { path: '/', slug: 'home', name: 'Home', icon: 'phosphor:house', default: true },
    // Example collection tree route:
    // {
    //   path: '/notes',
    //   slug: 'notes',
    //   name: 'Notes',
    //   collection: {
    //     database: 'notes',
    //     titleProperty: 'Name',
    //     parentProperty: 'Parent',
    //     sidebar: {
    //       mode: 'tree',
    //       allowCreate: true,
    //     },
    //   },
    // },
  ],

  tools: [
    'LOCAL_NOTIS_DATABASE_QUERY',
  ],
});
