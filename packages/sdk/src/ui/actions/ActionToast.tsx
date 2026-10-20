/**
 * ActionToast (toolkit spec 2.7): the words after an action, a muted reason line when there is one, Undo when the
 * action returned an UndoFn, and a Dismiss button when `onDismiss` is given. While Undo is offered, Z (and Mod+Z)
 * undo at route scope; while the Undo runs its button says so and Z does nothing.
 */

import { DEFAULT_KEYMAP, SHELL_WORDS } from '../../words';
import { useShortcuts } from '../engine/hooks';
import { Icon } from '../icons';
import { Keycap } from '../keycap';
import { useT } from '../util';
import { ACTION_WORDS } from './actionWords';
import type { ActionToastState } from './useToast';

export interface ActionToastProps {
  toast: ActionToastState | null;
  onUndo(): void;
  /** Draws a Dismiss button that hides the toast (hidden while an Undo runs). */
  onDismiss?(): void;
  /** Owner override for the Z key (default the nearest ShortcutScope). */
  owner?: string;
}

export function ActionToast({ toast, onUndo, onDismiss, owner }: ActionToastProps) {
  const t = useT();
  const entry = DEFAULT_KEYMAP.undo;
  const canUndo = !!toast?.undo;
  const undoing = !!toast?.undoing;
  // Registered only while Undo is offered, so two lists on a page never hold Z at once. A running Undo keeps Z, so a
  // second press neither undoes twice nor reaches another handler.
  useShortcuts(canUndo ? [{
    id: entry.id,
    keys: [...entry.keys],
    scope: entry.scope,
    label: entry.label,
    ...(owner ? { owner } : {}),
    when: () => canUndo,
    run: () => {
      if (!canUndo) return false;
      if (!undoing) onUndo();
      return true;
    },
  }] : []);

  if (!toast) return null;
  return (
    <div className="nui-toast-wrap">
      <div className="nui-toast" role="status" aria-live="polite" data-tone={toast.tone === 'danger' ? 'danger' : undefined}>
        <span className="nui-toast-text">
          <span className="nui-toast-words">{t(toast.words)}</span>
          {toast.reason && <span className="nui-toast-reason">{t(toast.reason)}</span>}
        </span>
        {toast.undo && (
          <button type="button" className="nui-toast-btn" aria-disabled={undoing || undefined}
            aria-busy={undoing || undefined} onClick={() => { if (!undoing) onUndo(); }}>
            {t(undoing ? ACTION_WORDS.undoing : SHELL_WORDS.undo)}
            {!undoing && <Keycap keys="z" on="discreet" />}
          </button>
        )}
        {onDismiss && !undoing && (
          <button type="button" className="nui-toast-x" aria-label={t(ACTION_WORDS.dismiss)} onClick={onDismiss}>
            <Icon name="x" />
          </button>
        )}
      </div>
    </div>
  );
}
