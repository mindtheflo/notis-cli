/**
 * The standard action catalogue (toolkit spec 2.7). Notis owns these words and keys; a Space supplies only `run`.
 * Pure: the React binding (`useActions`) lives in `ui/actions/`.
 */

import { canonicalKey, keyList } from './keys';
import { fillWords, isWords, type KeySpec, type Words } from './types';

/** Phosphor icon name ('archive', 'trash', ...). The toolkit's Icon resolves it. */
export type IconName = string;

/**
 * An icon name, or an icon element (`<Archive size={16} />`). The element is typed structurally so the words stay
 * free of React; menus and the selection bar draw either.
 */
export type ActionIcon = IconName | { readonly type: unknown; readonly props: unknown; readonly key?: unknown };

export type ActionTone = 'default' | 'danger';

export type UndoFn = () => void | Promise<void>;

/** One choice of a picker action (Move to, Assign). */
export interface ActionOption {
  value: string;
  label: Words | string;
  icon?: ActionIcon;
  /** A muted second line or right-hand hint. */
  hint?: Words | string;
}

/**
 * What a run may return besides nothing or an UndoFn.
 * - `cancelled`: the user backed out (a confirm said no): no toast, the selection stays.
 * - `undo`: the toast offers Undo (and binds Z).
 * - `failed`: the items that did not change; they stay selected and the toast says how many.
 * - `toast`: words for this run only (null: no toast).
 * - `reason`: a muted second line under the toast's words: why items failed, or a note on what happened (it shows
 *   alone when the run has no toast words).
 */
export interface ActionResult<T = unknown> {
  cancelled?: boolean;
  undo?: UndoFn;
  failed?: readonly T[];
  toast?: Words | string | null;
  reason?: Words | string | null;
}

export type ActionRunResult<T = unknown> = void | undefined | UndoFn | ActionResult<T>;

/**
 * Throw it from an action's `run`, or from any UndoFn a toast offers, to say why it failed: the failure toast ("That
 * did not work. Try again.", "Could not undo that.") shows `reason` as its second line. Any other throw shows the
 * failure words alone.
 */
export class ActionError extends Error {
  readonly reason: Words | string;
  readonly code = 'notis_action_error';

  constructor(reason: Words | string, options?: { cause?: unknown }) {
    super(typeof reason === 'string' ? reason : reason.en);
    this.name = 'ActionError';
    this.reason = reason;
    if (options && 'cause' in options) (this as { cause?: unknown }).cause = options.cause;
  }
}

/** The reason an ActionError carries, else null. A Space bundles its own copy of the words, so this reads the shape. */
export function actionErrorReason(error: unknown): Words | string | null {
  if (!error || typeof error !== 'object') return null;
  const { name, code, reason } = error as { name?: unknown; code?: unknown; reason?: unknown };
  if (name !== 'ActionError' || code !== 'notis_action_error') return null;
  return typeof reason === 'string' || isWords(reason) ? reason : null;
}

export interface ActionDef<T = unknown> {
  id: string;
  /** Words, or one string for both languages. */
  label: Words | string;
  icon?: ActionIcon;
  key?: KeySpec;
  tone?: ActionTone;
  /** Shown in the selection bar and run on every selected item. Default true. */
  bulk?: boolean;
  appliesTo?: (item: T) => boolean;
  /**
   * Return an UndoFn to make the toast offer Undo (and bind Z), or an ActionResult. A picker action receives the
   * chosen option as `choice`.
   */
  run: (items: T[], choice?: ActionOption) => Promise<ActionRunResult<T>> | ActionRunResult<T>;
  /**
   * Words after a run; default from the catalogue. `null`, `false` or an explicit `toast: undefined` turns the
   * toast off; the function may return null for no toast on that run.
   */
  toast?: ((n: number) => Words | string | null) | null | false;
  /** The other half of a toggle (one key, one button): a mixed selection shows the first listed half. */
  toggle?: string;
  /** Picker choices (Move to, Assign): the list opens a menu of them and passes the pick to `run`. */
  options?: readonly ActionOption[] | ((items: T[]) => readonly ActionOption[]);
  /** The current value of the items (checked in the picker), when they all share one. */
  value?: (items: T[]) => string | null | undefined;
}

export const STANDARD_ACTION_IDS = [
  'complete', 'archive', 'unarchive', 'star', 'unstar', 'later', 'move', 'assign', 'read', 'unread', 'delete',
  'progress', 'pause', 'resume', 'enable', 'disable', 'waiting',
] as const;

export type StandardActionId = typeof STANDARD_ACTION_IDS[number];

export type ActionRef<T = unknown> = StandardActionId | (Partial<ActionDef<T>> & { id: string });

/** A toast with one and many forms; `{n}` in `other` is the count. */
export interface CountedWords {
  one: Words;
  other: Words;
}

export interface StandardAction {
  id: StandardActionId;
  label: Words;
  icon: IconName;
  key: KeySpec | null;
  tone: ActionTone;
  toast: CountedWords | null;
  /** The other half of a toggle on the same key (star/unstar, read/unread). */
  toggle?: StandardActionId;
  /** Opens a picker instead of acting at once. */
  picker?: boolean;
  /** Not offered to Spaces yet (spec 6.10). */
  managerOnly?: boolean;
}

const counted = (oneEn: string, otherEn: string, oneFr: string, otherFr: string): CountedWords => ({
  one: { en: oneEn, fr: oneFr },
  other: { en: otherEn, fr: otherFr },
});

const same = (en: string, fr: string): CountedWords => ({ one: { en, fr }, other: { en, fr } });

export const STANDARD_ACTIONS: Readonly<Record<StandardActionId, StandardAction>> = Object.freeze({
  complete: {
    id: 'complete', label: { en: 'Complete', fr: 'Terminer' }, icon: 'check', key: 'e', tone: 'default',
    toast: counted('1 item completed.', '{n} items completed.', '1 élément terminé.', '{n} éléments terminés.'),
  },
  archive: {
    id: 'archive', label: { en: 'Archive', fr: 'Archiver' }, icon: 'archive', key: 'e', tone: 'default',
    toast: counted('1 item archived.', '{n} items archived.', '1 élément archivé.', '{n} éléments archivés.'),
  },
  unarchive: {
    // Back out of the archive. A Space names its own first stop: `{ id: 'unarchive', label: { en: 'Move to Inbox', ... } }`.
    id: 'unarchive', label: { en: 'Move to triage', fr: 'Déplacer vers le tri' }, icon: 'tray-arrow-up', key: 'shift+e',
    tone: 'default',
    toast: counted('1 item restored.', '{n} items restored.', '1 élément restauré.', '{n} éléments restaurés.'),
  },
  star: {
    id: 'star', label: { en: 'Star', fr: 'Mettre en favori' }, icon: 'star', key: 's', tone: 'default', toggle: 'unstar',
    toast: counted('1 item starred.', '{n} items starred.', '1 élément ajouté aux favoris.',
      '{n} éléments ajoutés aux favoris.'),
  },
  unstar: {
    id: 'unstar', label: { en: 'Unstar', fr: 'Retirer des favoris' }, icon: 'star', key: 's', tone: 'default',
    toggle: 'star', toast: null,
  },
  later: {
    id: 'later', label: { en: 'Later', fr: 'Plus tard' }, icon: 'clock', key: 'h', tone: 'default',
    toast: same('Snoozed until tomorrow.', 'Reporté à demain.'),
  },
  move: {
    id: 'move', label: { en: 'Move to…', fr: 'Déplacer vers…' }, icon: 'arrow-bend-up-right', key: 'm', tone: 'default',
    toast: null, picker: true,
  },
  assign: {
    id: 'assign', label: { en: 'Assign…', fr: 'Attribuer…' }, icon: 'user-plus', key: 'a', tone: 'default',
    toast: null, picker: true,
  },
  read: {
    id: 'read', label: { en: 'Mark as read', fr: 'Marquer comme lu' }, icon: 'envelope-open', key: 'u', tone: 'default',
    toggle: 'unread', toast: null,
  },
  unread: {
    id: 'unread', label: { en: 'Mark as unread', fr: 'Marquer comme non lu' }, icon: 'envelope-simple', key: 'u',
    tone: 'default', toggle: 'read', toast: null,
  },
  delete: {
    id: 'delete', label: { en: 'Delete', fr: 'Supprimer' }, icon: 'trash', key: '#', tone: 'danger',
    toast: counted('1 item deleted.', '{n} items deleted.', '1 élément supprimé.', '{n} éléments supprimés.'),
  },
  progress: {
    id: 'progress', label: { en: 'Start progress', fr: 'Passer en cours' }, icon: 'circle-half', key: null,
    tone: 'default', toast: null,
  },
  pause: {
    id: 'pause', label: { en: 'Pause', fr: 'Mettre en pause' }, icon: 'pause', key: null, tone: 'default',
    toggle: 'resume', toast: null,
  },
  resume: {
    id: 'resume', label: { en: 'Resume', fr: 'Reprendre' }, icon: 'play', key: null, tone: 'default',
    toggle: 'pause', toast: null,
  },
  enable: {
    id: 'enable', label: { en: 'Enable', fr: 'Activer' }, icon: 'toggle-right', key: null, tone: 'default',
    toggle: 'disable', toast: null,
  },
  disable: {
    id: 'disable', label: { en: 'Disable', fr: 'Désactiver' }, icon: 'toggle-left', key: null, tone: 'default',
    toggle: 'enable', toast: null,
  },
  waiting: {
    id: 'waiting', label: { en: 'Waiting', fr: 'En attente' }, icon: 'hourglass', key: 'w', tone: 'default', toast: null,
    managerOnly: true,
  },
});

export function isStandardActionId(id: unknown): id is StandardActionId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(STANDARD_ACTIONS, id);
}

/** The toast after `n` items, count filled in; null when the action has none. */
export function actionToast(id: StandardActionId, n: number): Words | null {
  const toast = STANDARD_ACTIONS[id].toast;
  if (!toast) return null;
  return fillWords(n === 1 ? toast.one : toast.other, { n });
}

/**
 * The catalogue defaults for a ref, with the Space's overrides on top. `run` comes from the Space. An own `toast`
 * key set to undefined, null or false turns the default toast off (the result then carries `toast: null`).
 */
export function resolveActionRef<T>(ref: ActionRef<T>): Partial<ActionDef<T>> & { id: string } {
  if (typeof ref === 'string') return standardDefaults<T>(ref);
  const toastOff = Object.prototype.hasOwnProperty.call(ref, 'toast') && !ref.toast;
  const merged: Partial<ActionDef<T>> & { id: string } = isStandardActionId(ref.id)
    ? { ...standardDefaults<T>(ref.id), ...stripUndefined(ref) }
    : { ...ref };
  if (toastOff) merged.toast = null;
  return merged;
}

/** One string for both languages, or the words as given. */
export function toWords(value: Words | string): Words {
  return typeof value === 'string' ? { en: value, fr: value } : value;
}

function standardDefaults<T>(id: StandardActionId): Partial<ActionDef<T>> & { id: string } {
  const action = STANDARD_ACTIONS[id];
  return {
    id,
    label: action.label,
    icon: action.icon,
    key: action.key ?? undefined,
    tone: action.tone,
    toast: action.toast ? (n: number) => actionToast(id, n)! : undefined,
    ...(action.toggle ? { toggle: action.toggle } : {}),
  };
}

function stripUndefined<V extends object>(value: V): Partial<V> {
  const out: Partial<V> = {};
  for (const [k, v] of Object.entries(value)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

export interface ActionKeyClash {
  key: string;
  ids: string[];
}

/**
 * Actions of one list that share a key. Toggle pairs (star/unstar, read/unread) are one key by design and do not
 * clash. complete and archive both take E, so a list may list only one.
 */
export function actionKeyClashes(refs: readonly ActionRef<unknown>[]): ActionKeyClash[] {
  const byKey = new Map<string, string[]>();
  const toggles = new Map<string, string>();
  for (const ref of refs) {
    const resolved = resolveActionRef(ref);
    if (resolved.toggle) toggles.set(resolved.id, resolved.toggle);
    for (const spec of keyList(resolved.key)) {
      const canonical = canonicalKey(spec);
      const ids = byKey.get(canonical) ?? [];
      if (!ids.includes(resolved.id)) ids.push(resolved.id);
      byKey.set(canonical, ids);
    }
  }
  const clashes: ActionKeyClash[] = [];
  for (const [key, ids] of byKey) {
    const left = ids.filter((id, index) => {
      const partner = toggles.get(id);
      // Keep one member of each toggle pair.
      return !(partner && ids.indexOf(partner) !== -1 && ids.indexOf(partner) < index);
    });
    if (left.length > 1) clashes.push({ key, ids: left });
  }
  return clashes;
}
