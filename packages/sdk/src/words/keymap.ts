/**
 * The default key map (toolkit spec 3). Pieces register these ids with these keys and words, so the ? sheet reads
 * the same in every Space and on every Notis page. Action keys come from the catalogue (`STANDARD_ACTIONS`).
 */

import type { KeySpec, Scope, Words } from './types';

export interface KeymapEntry {
  id: string;
  keys: readonly KeySpec[];
  scope: Scope;
  label: Words;
  /** Registered by the Notis host, never by a Space. */
  host?: boolean;
  /** Manager only for now (spec 6.10). */
  managerOnly?: boolean;
  /** Fires while the key is held (J/K stepping). */
  repeat?: boolean;
  /** Not listed in the help sheet. */
  hidden?: boolean;
}

const entry = (id: string, keys: KeySpec[], scope: Scope, en: string, fr: string, extra: Partial<KeymapEntry> = {}):
  KeymapEntry => Object.freeze({ id, keys: Object.freeze(keys), scope, label: Object.freeze({ en, fr }), ...extra });

export const DEFAULT_KEYMAP = Object.freeze({
  // Lists (collection scope).
  'list.next': entry('list.next', ['j', 'arrowdown'], 'collection', 'Next item', 'Élément suivant', { repeat: true }),
  'list.prev': entry('list.prev', ['k', 'arrowup'], 'collection', 'Previous item', 'Élément précédent', { repeat: true }),
  'list.extendDown': entry('list.extendDown', ['shift+j', 'shift+arrowdown'], 'collection',
    'Extend selection down', 'Étendre la sélection vers le bas', { repeat: true }),
  'list.extendUp': entry('list.extendUp', ['shift+k', 'shift+arrowup'], 'collection',
    'Extend selection up', 'Étendre la sélection vers le haut', { repeat: true }),
  'list.open': entry('list.open', ['enter', 'o'], 'collection', 'Open', 'Ouvrir'),
  'list.toggleSelect': entry('list.toggleSelect', ['x'], 'collection', 'Select', 'Sélectionner'),
  'list.selectAll': entry('list.selectAll', ['mod+a'], 'collection', 'Select all', 'Tout sélectionner'),
  // A calendar or a timeline (collection scope): [ and ] step its period only while focus is inside the view, so
  // elsewhere on the page they stay the Tabs' view keys; T works while the view shows.
  'period.prev': entry('period.prev', ['['], 'collection', 'Previous period', 'Période précédente'),
  'period.next': entry('period.next', [']'], 'collection', 'Next period', 'Période suivante'),
  'period.today': entry('period.today', ['t'], 'collection', 'Today', 'Aujourd’hui'),
  // Route scope.
  undo: entry('undo', ['z', 'mod+z'], 'route', 'Undo', 'Annuler'),
  // Tabs: switch the whole content to the previous or next view.
  'view.prev': entry('view.prev', ['['], 'route', 'Previous view', 'Vue précédente'),
  'view.next': entry('view.next', [']'], 'route', 'Next view', 'Vue suivante'),
  // Host (app scope).
  'host.help': entry('host.help', ['?'], 'app', 'Show keyboard shortcuts', 'Afficher les raccourcis clavier',
    { host: true }),
  'host.escape': entry('host.escape', ['escape'], 'app', 'Close, then go back', 'Fermer, puis revenir',
    { host: true }),
  'host.search': entry('host.search', ['/'], 'app', 'Search', 'Rechercher', { host: true }),
  'host.newChat': entry('host.newChat', ['c'], 'app', 'New conversation', 'Nouvelle conversation', { host: true }),
  'host.call': entry('host.call', ['shift+c'], 'app', 'Open voice call', 'Ouvrir l’appel vocal', { host: true }),
  'host.toggleSidebar': entry('host.toggleSidebar', ['mod+s'], 'app', 'Toggle sidebar',
    'Afficher ou masquer la barre latérale', { host: true }),
  'host.voiceMessage': entry('host.voiceMessage', ['mod+d'], 'app', 'Voice message', 'Message vocal', { host: true }),
  'host.modelMenu': entry('host.modelMenu', ['alt+p'], 'app', 'Model menu', 'Menu du modèle', { host: true }),
  'host.speedMenu': entry('host.speedMenu', ['alt+s'], 'app', 'Speed menu', 'Menu de vitesse', { host: true }),
  'host.toggleVoiceCall': entry('host.toggleVoiceCall', ['shift+tab'], 'app', 'Toggle voice call in panel',
    'Afficher ou masquer l’appel vocal dans le panneau', { host: true }),
  'host.commandMenu': entry('host.commandMenu', ['mod+k'], 'app', 'Command menu', 'Menu des commandes',
    { host: true }),
  'host.goInbox': entry('host.goInbox', ['g i'], 'app', 'Go to Inbox', 'Aller à l’Inbox',
    { host: true, managerOnly: true }),
  'host.goStarred': entry('host.goStarred', ['g s'], 'app', 'Go to Starred', 'Aller aux Favoris',
    { host: true, managerOnly: true }),
  'host.goDone': entry('host.goDone', ['g d'], 'app', 'Go to Done', 'Aller à Terminé',
    { host: true, managerOnly: true }),
}) satisfies Readonly<Record<string, KeymapEntry>>;

export type KeymapId = keyof typeof DEFAULT_KEYMAP;
