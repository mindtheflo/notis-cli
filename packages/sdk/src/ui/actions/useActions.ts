/**
 * `useActions` (toolkit spec 2.7): binds the standard action catalogue to a Space's handlers. Notis owns the words,
 * icons, keys and toasts; the Space supplies only `run`. A standard id without a `run` is hidden.
 *
 * Actions resolve live: labels, tones, icons and toggles follow the refs on every render (a locale change or a new
 * label shows at once), and `run`, `appliesTo`, `toast`, `options` and `value` are read when used.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  STANDARD_ACTIONS, actionErrorReason, isStandardActionId, resolveActionRef, toWords,
  type ActionDef, type ActionIcon, type ActionOption, type ActionRef, type ActionResult, type ActionTone,
  type KeySpec, type StandardActionId, type UndoFn, type Words,
} from '../../words';
import { ACTION_WORDS, failedItemsWords } from './actionWords';
import { useToast, type ActionToastState, type ToastOptions } from './useToast';

export interface ResolvedAction<T> {
  id: string;
  label: Words;
  icon?: ActionIcon;
  key?: KeySpec;
  tone: ActionTone;
  bulk: boolean;
  appliesTo?: (item: T) => boolean;
  run: ActionDef<T>['run'];
  /** Null when the toast is turned off. */
  toast?: ((n: number) => Words | string | null) | null;
  /** The other half of a toggle (star/unstar, read/unread, pause/resume, enable/disable). */
  toggle?: string;
  /** Opens a picker instead of acting at once (move, assign, or any action with `options`). */
  picker: boolean;
  /** The picker choices for `items` (empty when the action has none). */
  options?: (items: T[]) => readonly ActionOption[];
  /** The value the items share (checked in the picker). */
  value?: (items: T[]) => string | null | undefined;
}

export type ActionHandlers<T> = Partial<Record<StandardActionId, ActionDef<T>['run']>>;

export interface UseActionsOptions {
  /** A run or its Undo threw or rejected (the toast already says so); an Undo reports `{ id: 'undo' }`. */
  onError?: (error: unknown, action: { id: string }) => void;
}

/**
 * What a run did. `done`: it ran (`failed` lists the items that did not change). `cancelled`: the run said so, or
 * nothing applied. `failed`: it threw. `busy`: the same action was still running, so this call was ignored.
 */
export interface ActionOutcome<T> {
  status: 'done' | 'cancelled' | 'failed' | 'busy';
  done: T[];
  failed: T[];
}

export interface ActionsController<T> {
  /** Every action that has a run, in the given order. */
  actions: ResolvedAction<T>[];
  /**
   * The actions that apply to `items`. Toggle pairs show one half: the first listed half that fits every item,
   * else (a mixed selection) the first listed half that fits some, which then runs on those only. Any other
   * action needs at least one item it applies to.
   */
  available(items: readonly T[]): ResolvedAction<T>[];
  /** Runs `action` on the items it applies to, then shows its toast (with Undo when it returned one). */
  run(action: ResolvedAction<T> | string, items: readonly T[], choice?: ActionOption): Promise<ActionOutcome<T>>;
  /** Ids of the actions running now (the selection bar shows them busy and ignores a second press). */
  busy: ReadonlySet<string>;
  isBusy(id: string): boolean;
  toast: ActionToastState | null;
  /** Shows other words in the same toast (a note, a refusal), replacing the one on screen. */
  notify(words: Words | string, options?: ToastOptions): void;
  undo(): Promise<void>;
  dismiss(): void;
}

export function resolveActions<T>(refs: readonly ActionRef<T>[], handlers: ActionHandlers<T> = {}): ResolvedAction<T>[] {
  const out: ResolvedAction<T>[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const def = resolveActionRef(ref);
    if (seen.has(def.id)) continue;
    const standard = isStandardActionId(def.id) ? STANDARD_ACTIONS[def.id] : null;
    if (standard?.managerOnly) continue;
    const run = def.run ?? (standard ? handlers[standard.id] : undefined);
    if (!run || !def.label) continue;
    seen.add(def.id);
    const options = def.options;
    out.push({
      id: def.id,
      label: toWords(def.label),
      icon: def.icon,
      key: def.key,
      tone: def.tone ?? 'default',
      bulk: def.bulk ?? true,
      appliesTo: def.appliesTo,
      run,
      toast: def.toast ? def.toast : def.toast === undefined ? undefined : null,
      toggle: def.toggle ?? standard?.toggle,
      picker: !!standard?.picker || !!options,
      options: options ? (items: T[]) => (typeof options === 'function' ? options(items) : options) : undefined,
      value: def.value,
    });
  }
  return out;
}

/** The actions of `actions` that apply to `items` (see `ActionsController.available`). */
export function availableActions<T>(actions: readonly ResolvedAction<T>[], items: readonly T[]): ResolvedAction<T>[] {
  if (!items.length) return [];
  const result: ResolvedAction<T>[] = [];
  const fitsAll = (action: ResolvedAction<T>) => !action.appliesTo || items.every(action.appliesTo);
  const fitsSome = (action: ResolvedAction<T>) => !action.appliesTo || items.some(action.appliesTo);
  const handled = new Set<string>();
  for (const action of actions) {
    if (handled.has(action.id)) continue;
    const partner = action.toggle ? actions.find((other) => other.id === action.toggle) : undefined;
    if (partner) {
      handled.add(action.id);
      handled.add(partner.id);
      // The pair in list order: the first half that fits every item, else the first that fits some.
      const pair = actions.indexOf(partner) < actions.indexOf(action) ? [partner, action] : [action, partner];
      const pickedAll = pair.find(fitsAll);
      const picked = pickedAll ?? pair.find(fitsSome);
      if (picked) result.push(picked);
      continue;
    }
    if (fitsSome(action)) result.push(action);
  }
  return result;
}

function isActionResult<T>(value: unknown): value is ActionResult<T> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function iconSignature(icon: ActionIcon | undefined): string {
  if (icon === undefined) return '';
  return typeof icon === 'string' ? icon : 'node';
}

function wordsSignature(words: Words): string {
  return `${words.en}\u0001${words.fr}`;
}

export function useActions<T>(refs: readonly ActionRef<T>[], handlers: ActionHandlers<T> = {},
  options: UseActionsOptions = {}): ActionsController<T> {
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const busyRef = useRef(new Set<string>());
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const toaster = useToast({ onError: (error) => optionsRef.current.onError?.(error, { id: 'undo' }) });
  const { notify } = toaster;
  const refsRef = useRef(refs);
  refsRef.current = refs;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // Resolved on every render; the array keeps its identity while nothing visible changed.
  const resolved = resolveActions<T>(refs, handlers);
  const signature = resolved.map((action) => [
    action.id, wordsSignature(action.label), iconSignature(action.icon), keySignature(action.key), action.tone,
    action.bulk ? 1 : 0, action.toggle ?? '', action.picker ? 1 : 0, action.appliesTo ? 1 : 0, action.options ? 1 : 0,
    action.value ? 1 : 0, action.toast === null ? 0 : 1,
  ].join('\u0002')).join('\u0003');
  const actions = useMemo(() => resolved.map((action) => {
    const live = () => resolveActions<T>(refsRef.current, handlersRef.current).find((item) => item.id === action.id)
      ?? action;
    return {
      ...action,
      run: ((items: T[], choice?: ActionOption) => live().run(items, choice)) as ActionDef<T>['run'],
      appliesTo: action.appliesTo ? (item: T) => (live().appliesTo ?? action.appliesTo!)(item) : undefined,
      toast: action.toast === null ? null : (n: number) => {
        const current = live().toast;
        return current ? current(n) : null;
      },
      options: action.options ? (items: T[]) => (live().options ?? action.options!)(items) : undefined,
      value: action.value ? (items: T[]) => (live().value ?? action.value!)(items) : undefined,
    } satisfies ResolvedAction<T>;
  }), [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const markBusy = useCallback((id: string, on: boolean) => {
    if (on) busyRef.current.add(id);
    else busyRef.current.delete(id);
    setBusy(new Set(busyRef.current));
  }, []);

  const run = useCallback(async (actionOrId: ResolvedAction<T> | string, items: readonly T[],
    choice?: ActionOption): Promise<ActionOutcome<T>> => {
    const action = typeof actionOrId === 'string' ? actions.find((item) => item.id === actionOrId) : actionOrId;
    if (!action) return { status: 'cancelled', done: [], failed: [] };
    if (busyRef.current.has(action.id)) return { status: 'busy', done: [], failed: [] };
    const targets = action.appliesTo ? items.filter(action.appliesTo) : [...items];
    if (!targets.length) return { status: 'cancelled', done: [], failed: [] };
    markBusy(action.id, true);
    try {
      const result = await action.run(targets, choice);
      const undo = typeof result === 'function' ? result as UndoFn
        : isActionResult<T>(result) && typeof result.undo === 'function' ? result.undo : null;
      const detail = isActionResult<T>(result) && typeof result !== 'function' ? result : null;
      if (detail?.cancelled) return { status: 'cancelled', done: [], failed: [] };
      const failedSet = new Set<T>(detail?.failed ?? []);
      const failed = targets.filter((item) => failedSet.has(item));
      const done = targets.filter((item) => !failedSet.has(item));
      const reason = detail?.reason ? toWords(detail.reason) : null;
      if (failed.length && !done.length) {
        notify(ACTION_WORDS.failed, { tone: 'danger', reason });
        return { status: 'failed', done, failed };
      }
      if (failed.length) {
        notify(failedItemsWords(failed.length), { tone: 'danger', undo, reason });
        return { status: 'done', done, failed };
      }
      let words: Words | null;
      if (detail && Object.prototype.hasOwnProperty.call(detail, 'toast')) {
        words = detail.toast ? toWords(detail.toast) : null;
      } else {
        const custom = action.toast ? action.toast(done.length) : null;
        // A custom action with Undo but no toast words: its label stands in (unless the toast is turned off).
        words = custom ? toWords(custom) : undo && action.toast !== null ? action.label : null;
      }
      // A reason with no toast words shows alone.
      if (words) notify(words, { undo, reason });
      else if (reason) notify(reason, { undo });
      return { status: 'done', done, failed };
    } catch (error) {
      notify(ACTION_WORDS.failed, { tone: 'danger', reason: actionErrorReason(error) });
      optionsRef.current.onError?.(error, { id: action.id });
      return { status: 'failed', done: [], failed: targets };
    } finally {
      markBusy(action.id, false);
    }
  }, [actions, notify, markBusy]);

  const available = useCallback((items: readonly T[]) => availableActions(actions, items), [actions]);
  const isBusy = useCallback((id: string) => busyRef.current.has(id), []);

  return {
    actions, available, run, busy, isBusy, toast: toaster.toast, notify, undo: toaster.undo, dismiss: toaster.dismiss,
  };
}

function keySignature(key: KeySpec | undefined): string {
  if (key === undefined) return '';
  return Array.isArray(key) ? key.join(',') : String(key);
}
