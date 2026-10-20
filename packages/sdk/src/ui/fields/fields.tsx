/**
 * Editable fields: facts that edit in place. A form is an `EditableFields` around `FieldRow`s; each row holds a
 * control (`FieldText`, `FieldLongText`, `FieldSelect`, `FieldMultiSelect`, `FieldDisclosure`) or any custom node
 * (a slot). The caller owns the values and the dirty state; once something changed the form shows Save and Cancel.
 * `FieldList` lays rows out the same way without the form (facts that save on their own, a read-only sheet).
 * Styled by the fields section of toolkit.css.
 *
 * Keys: Cmd/Ctrl+Enter saves (also from inside a field); Escape in a field leaves the field, Escape again cancels
 * (an escape layer above the reader and the selection, so unsaved edits go before the reader closes).
 *
 * A save that throws or rejects keeps the draft (the form never resets it) and shows a polite status line in the bar
 * until the next save, a cancel or a clean form. Save shows Saving while the returned promise runs.
 *
 * The bar is sticky at the bottom. Only while it sits in the corner of the floating Notis button (bottom right of the
 * window, from the host's --notis-fab-safe-* vars) does it keep Save clear of the button (data-fab).
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode, type RefObject,
} from 'react';
import { SHELL_WORDS, fillWords, type Words } from '../../words';
import { Button } from '../blocks';
import { ESCAPE_PRIORITY } from '../engine/core';
import { closestComposed } from '../engine/dom';
import { useEscapeLayer, useShortcut } from '../engine/hooks';
import { Icon, renderIcon } from '../icons';
import { Keycap } from '../keycap';
import { Menu, Popover } from '../overlay';
import { cx, flag, useIsoLayoutEffect, useLabelValue, useLatest, useStableId, useT } from '../util';
import { FIELD_WORDS } from './fieldWords';

type Text = Words | string;

/** Escape cancels unsaved edits before the selection clears and the reader closes. */
export const FIELDS_ESCAPE_PRIORITY = ESCAPE_PRIORITY.selection + 50;
export const FIELDS_SAVE_KEYS = 'mod+enter';

// ---- form ----

export interface EditableFieldsProps {
  /** Something differs from the saved values: shows Save and Cancel and arms the keys. */
  dirty: boolean;
  saving?: boolean;
  /** Save stays visible but cannot run (a required value is missing). */
  saveDisabled?: boolean;
  /** A rejection (or a throw) keeps the draft and shows FIELD_WORDS.saveFailed, unless `error` says more. */
  onSave: () => void | Promise<unknown>;
  onCancel: () => void;
  /** Shown in the bar, above the buttons (a validation or save error), as a polite status line. */
  error?: ReactNode;
  /** Accessible name of the form. */
  label?: Text;
  /** Under the rows, above the bar (a section the caller draws). */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function EditableFields({
  dirty, saving = false, saveDisabled = false, onSave, onCancel, error, label, footer, children, className,
}: EditableFieldsProps) {
  const t = useT();
  const id = useStableId('nui-fields');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // A clean form (saved elsewhere, or cancelled) has nothing that failed.
  useEffect(() => { if (!dirty) setFailed(false); }, [dirty]);

  const busy = saving || pending;
  const latest = useLatest({ dirty, busy, saveDisabled, onSave, onCancel });
  const save = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setFailed(false);
    try {
      const result = latest.current.onSave();
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        setPending(true);
        await result;
      }
    } catch {
      // A deliberate failure path (C1): the status line says so; nothing goes to the console.
      if (mounted.current) setFailed(true);
    } finally {
      running.current = false;
      if (mounted.current) setPending(false);
    }
  }, [latest]);
  const cancel = useCallback(() => {
    setFailed(false);
    latest.current.onCancel();
  }, [latest]);

  useEscapeLayer(`fields.cancel.${id}`, () => {
    const current = latest.current;
    if (!current.dirty || current.busy) return false;
    cancel();
    return true;
  }, { priority: FIELDS_ESCAPE_PRIORITY, enabled: dirty });

  const shown = error || (failed ? t(FIELD_WORDS.saveFailed) : null);
  const canSave = dirty && !busy && !saveDisabled;
  const barShown = Boolean(dirty || shown);
  const inFabCorner = useInFabCorner(barRef, barShown);
  return (
    <div
      className={cx('nui-fields', className)}
      role="group"
      aria-label={label ? t(label) : undefined}
      data-dirty={flag(dirty)}
      data-saving={flag(busy)}
    >
      <dl className="nui-fields-list">{children}</dl>
      {footer}
      {barShown ? (
        <div
          ref={barRef}
          className="nui-fields-bar"
          role="group"
          aria-label={t(FIELD_WORDS.unsaved)}
          data-fab={flag(inFabCorner)}
        >
          {/* Present while the bar shows, so a failure that lands later is read out (politely, not as an alert). */}
          <div className="nui-fields-error" role="status">{shown}</div>
          {dirty ? <span className="nui-fields-note">{t(FIELD_WORDS.unsaved)}</span> : null}
          {dirty ? (
            <>
              <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
                {t(FIELD_WORDS.cancel)}
                <Keycap keys="escape" />
              </Button>
              <Button variant="primary" size="sm" onClick={() => { void save(); }} disabled={!canSave}
                aria-keyshortcuts="Meta+Enter Control+Enter">
                {busy ? t(FIELD_WORDS.saving) : t(FIELD_WORDS.save)}
                <Keycap keys={FIELDS_SAVE_KEYS} on="pill" />
              </Button>
            </>
          ) : null}
          {dirty ? <SaveKey id={id} enabled={canSave} onSave={save} /> : null}
        </div>
      ) : null}
    </div>
  );
}

export interface FieldListProps {
  /** Accessible name of the rows (a group); leave it out when a heading next to them already names them. */
  label?: Text;
  children: ReactNode;
  className?: string;
}

/**
 * `FieldRow`s laid out as in a form, without Save and Cancel: facts that save on their own (a select that applies at
 * once) or a read-only sheet. The rows take the same columns and the same narrow-width stacking as in a form.
 */
export function FieldList({ label, children, className }: FieldListProps) {
  const t = useT();
  return (
    <div className={cx('nui-fields', className)} role={label ? 'group' : undefined} aria-label={label ? t(label) : undefined}>
      <dl className="nui-fields-list">{children}</dl>
    </div>
  );
}

/** The floating Notis button's corner from the host vars, in px (0 without the button). */
function fabCorner(el: HTMLElement): { end: number; bottom: number } {
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  const px = (...names: string[]) => {
    for (const name of names) {
      // A var() the engine left unresolved reads NaN, so the host var behind it answers.
      const value = parseFloat(style?.getPropertyValue(name) ?? '');
      if (Number.isFinite(value)) return value;
    }
    return 0;
  };
  return { end: px('--nui-fab-safe-end', '--notis-fab-safe-end'), bottom: px('--nui-fab-safe-bottom', '--notis-fab-safe-bottom') };
}

/** The element overlaps the floating button's corner of the window (bottom right). */
function overlapsFabCorner(el: HTMLElement): boolean {
  const view = el.ownerDocument.defaultView;
  const corner = fabCorner(el);
  if (!view || corner.end <= 0) return false;
  const page = el.ownerDocument.documentElement;
  const width = page.clientWidth || view.innerWidth;
  const height = page.clientHeight || view.innerHeight;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return rect.right > width - corner.end && rect.bottom > height - (corner.bottom > 0 ? corner.bottom : corner.end)
    && rect.top < height;
}

/**
 * Whether the shown save bar sits in the floating Notis button's corner: stuck at the bottom of a reader at the right of
 * the window, or ending there. Followed on scroll (the page, or the Space's shadow root), resize and size changes.
 */
function useInFabCorner(ref: RefObject<HTMLElement | null>, shown: boolean): boolean {
  const [inCorner, setInCorner] = useState(false);
  useIsoLayoutEffect(() => {
    const bar = ref.current;
    const view = bar?.ownerDocument.defaultView;
    if (!shown || !bar || !view) {
      setInCorner(false);
      return undefined;
    }
    let frame = 0;
    const check = () => {
      frame = 0;
      setInCorner(overlapsFabCorner(bar));
    };
    const schedule = () => {
      if (!frame && typeof requestAnimationFrame !== 'undefined') frame = requestAnimationFrame(check);
    };
    check();
    const listen = { capture: true, passive: true } as const;
    const rootNode = bar.getRootNode();
    const scrollTargets: EventTarget[] = rootNode === bar.ownerDocument ? [view] : [view, rootNode];
    for (const target of scrollTargets) target.addEventListener('scroll', schedule, listen);
    view.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(bar);
    if (bar.parentElement) observer?.observe(bar.parentElement);
    return () => {
      if (frame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame);
      for (const target of scrollTargets) target.removeEventListener('scroll', schedule, listen);
      view.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  }, [ref, shown]);
  return inCorner;
}

/** Registered only while the form is dirty, so two forms on a page never hold the key at once. */
function SaveKey({ id, enabled, onSave }: { id: string; enabled: boolean; onSave: () => Promise<void> }) {
  const latest = useLatest({ enabled, onSave });
  useShortcut({
    id: `fields.save.${id}`,
    keys: FIELDS_SAVE_KEYS,
    scope: 'detail',
    label: FIELD_WORDS.save,
    allowInFields: true,
    when: () => latest.current.enabled,
    run: () => { void latest.current.onSave(); },
  });
  return null;
}

// ---- row ----

/** What a row tells the control in it: the id of its hint line, and whether its value is wrong. */
interface FieldRowState {
  describedBy?: string;
  invalid: boolean;
}

const FieldRowContext = createContext<FieldRowState | null>(null);

export interface FieldRowProps {
  label: Text;
  /** One muted line under the value. The control in the row is described by it (aria-describedby). */
  hint?: ReactNode;
  /** Label above the value at every width (long text). */
  stacked?: boolean;
  /** Marks a value that differs from the saved one. */
  changed?: boolean;
  /**
   * The value is wrong: the hint reads as the error (destructive text) and a text control in the row is marked
   * aria-invalid. Put what is wrong in `hint`.
   */
  invalid?: boolean;
  children: ReactNode;
  className?: string;
}

export function FieldRow({ label, hint, stacked, changed, invalid = false, children, className }: FieldRowProps) {
  const t = useT();
  const hintId = useStableId('nui-field-hint');
  const describedBy = hint ? hintId : undefined;
  const state = useMemo<FieldRowState>(() => ({ describedBy, invalid }), [describedBy, invalid]);
  return (
    <div className={cx('nui-field-row', className)} data-stacked={flag(stacked)} data-changed={flag(changed)}
      data-invalid={flag(invalid)}>
      <dt className="nui-field-label">
        <span>{t(label)}</span>
        {changed ? <span className="nui-field-dot" role="img" aria-label={t(FIELD_WORDS.changed)} /> : null}
      </dt>
      <dd className="nui-field-value">
        <FieldRowContext.Provider value={state}>{children}</FieldRowContext.Provider>
        {hint ? <span id={hintId} className="nui-field-hint">{hint}</span> : null}
      </dd>
    </div>
  );
}

/** aria-invalid and aria-describedby of a text control: its own props first, else its row's. */
function useTextDescription(invalid: boolean | undefined, describedBy: string | undefined) {
  const row = useContext(FieldRowContext);
  return {
    'aria-invalid': (invalid ?? row?.invalid) ? true : undefined,
    'aria-describedby': (describedBy ?? row?.describedBy) || undefined,
  };
}

/** The row's hint describes a button control too (no aria-invalid: it is not valid on a button). */
function useRowDescribedBy(): string | undefined {
  return useContext(FieldRowContext)?.describedBy;
}

// ---- text ----

/**
 * Escape leaves the field (the next Escape cancels the form); the engine leaves Escape to a focused field. Focus moves
 * to the pane that holds the field (a reader, a popover), never to the page body. Inside a Popover or Menu the engine
 * closes the layer instead, so this does not run there.
 */
function blurOnEscape(event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
  if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return;
  const field = event.currentTarget;
  const holder = field.parentElement
    ? closestComposed(field.parentElement, '[data-notis-escape-owned][tabindex]') as HTMLElement | null : null;
  if (holder && typeof holder.focus === 'function') holder.focus({ preventScroll: true });
  else field.blur();
}

export interface FieldTextProps {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name (the row label). */
  label: Text;
  placeholder?: Text;
  readOnly?: boolean;
  /** 'title' for the name at the top of a reader. */
  size?: 'default' | 'title';
  maxLength?: number;
  /** The value is wrong (aria-invalid). Default: the row's `invalid`. */
  invalid?: boolean;
  /** Ids of what describes the field (aria-describedby). Default: the row's hint. */
  describedBy?: string;
  className?: string;
}

export function FieldText({
  value, onChange, label, placeholder, readOnly, size = 'default', maxLength, invalid, describedBy, className,
}: FieldTextProps) {
  const t = useT();
  const description = useTextDescription(invalid, describedBy);
  return (
    <input
      type="text"
      className={cx('nui-field-input', className)}
      data-size={size === 'default' ? undefined : size}
      value={value}
      aria-label={t(label)}
      {...description}
      placeholder={placeholder ? t(placeholder) : undefined}
      readOnly={readOnly}
      maxLength={maxLength}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      onKeyDown={blurOnEscape}
    />
  );
}

export interface FieldLongTextProps extends Omit<FieldTextProps, 'size'> {
  /**
   * Height in lines where the browser cannot fit the box to its text (no `field-sizing`); default 4. Elsewhere the box
   * fits its text, one line at least.
   */
  rows?: number;
}

export function FieldLongText({
  value, onChange, label, placeholder, readOnly, maxLength, rows = 4, invalid, describedBy, className,
}: FieldLongTextProps) {
  const t = useT();
  const description = useTextDescription(invalid, describedBy);
  return (
    <textarea
      className={cx('nui-field-textarea', className)}
      value={value}
      rows={rows}
      aria-label={t(label)}
      {...description}
      placeholder={placeholder ? t(placeholder) : undefined}
      readOnly={readOnly}
      maxLength={maxLength}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
      onKeyDown={blurOnEscape}
    />
  );
}

// ---- choices ----

export interface FieldOption<V extends string> {
  value: V;
  label: Text;
  icon?: ReactNode | string;
  /** Muted words after the label (a cost, a short explanation). */
  hint?: Text;
  disabled?: boolean;
}

function OptionFace<V extends string>({ option }: { option: FieldOption<V> }) {
  const t = useT();
  return (
    <>
      {option.icon !== undefined ? renderIcon(option.icon) : null}
      <span className="nui-field-text">{t(option.label)}</span>
    </>
  );
}

export interface FieldSelectProps<V extends string> {
  value: V | null;
  options: readonly FieldOption<V>[];
  onChange: (value: V) => void;
  /** Accessible name of the button and its menu. */
  label: Text;
  /** Shown when no option matches `value`. */
  placeholder?: Text;
  readOnly?: boolean;
  /** Shown above the options (an upgrade note). */
  menuHeader?: ReactNode;
  className?: string;
}

export function FieldSelect<V extends string>({
  value, options, onChange, label, placeholder, readOnly, menuHeader, className,
}: FieldSelectProps<V>) {
  const t = useT();
  const labelled = useLabelValue();
  const describedBy = useRowDescribedBy();
  const selected = options.find((option) => option.value === value) ?? null;
  const face = selected ? <OptionFace option={selected} /> : (
    <span className="nui-field-text nui-field-placeholder">{t(placeholder ?? FIELD_WORDS.choose)}</span>
  );
  const name = labelled(t(label), selected ? t(selected.label) : t(placeholder ?? FIELD_WORDS.empty));
  if (readOnly) return <span className={cx('nui-field-static', className)}>{face}</span>;
  return (
    <Menu
      label={label}
      align="start"
      trigger={(
        <button type="button" className={cx('nui-field-trigger', className)} aria-label={name} aria-describedby={describedBy}>
          {face}
          <span className="nui-field-caret" aria-hidden="true">{renderIcon('caret-down')}</span>
        </button>
      )}
    >
      {menuHeader}
      {options.map((option) => (
        <Menu.Item
          key={option.value}
          icon={option.icon}
          checked={option.value === value}
          disabled={option.disabled}
          onSelect={() => { if (option.value !== value) onChange(option.value); }}
        >
          {t(option.label)}
          {option.hint ? <span className="nui-field-hint">{` ${t(option.hint)}`}</span> : null}
        </Menu.Item>
      ))}
    </Menu>
  );
}

export interface FieldMultiSelectProps<V extends string> {
  values: readonly V[];
  options: readonly FieldOption<V>[];
  /** Called with the next values, in the options' order. */
  onChange: (values: V[]) => void;
  label: Text;
  placeholder?: Text;
  /** The last value cannot be removed; `onNeedOne` runs instead. */
  minOne?: boolean;
  onNeedOne?: () => void;
  readOnly?: boolean;
  /** A search box above the options, for long lists (case and accents ignored). Implied by `onAdd`. */
  searchable?: boolean;
  /**
   * Offers to add the typed text as a new option (Add "text") when no option is named exactly that. Return the new
   * option's value to select it, and add the option to `options`. A rejection keeps the typed text and says it failed.
   */
  onAdd?: (text: string) => V | void | Promise<V | void>;
  className?: string;
}

/** Applies a toggle of `value` (pure, for the control and its tests). */
export function toggleFieldValue<V extends string>(
  values: readonly V[], value: V, order: readonly V[], minOne = false,
): V[] | null {
  if (values.includes(value)) {
    if (minOne && values.length <= 1) return null;
    return values.filter((current) => current !== value);
  }
  return order.filter((candidate) => candidate === value || values.includes(candidate));
}

export function FieldMultiSelect<V extends string>({
  values, options, onChange, label, placeholder, minOne, onNeedOne, readOnly, searchable, onAdd, className,
}: FieldMultiSelectProps<V>) {
  const t = useT();
  const labelled = useLabelValue();
  const describedBy = useRowDescribedBy();
  const latest = useLatest({ values, options, onChange, minOne, onNeedOne });
  const selected = options.filter((option) => values.includes(option.value));
  const names = selected.map((option) => t(option.label)).join(', ');
  // Names up to two; beyond, the icons alone (the names stay in the accessible name).
  const face = selected.length === 0 ? (
    <span className="nui-field-text nui-field-placeholder">{t(placeholder ?? FIELD_WORDS.choose)}</span>
  ) : selected.length > 2 && selected.every((option) => option.icon !== undefined) ? (
    <span className="nui-field-static" aria-hidden="true">
      {selected.map((option) => <span key={option.value} className="nui-field-static">{renderIcon(option.icon!)}</span>)}
    </span>
  ) : (
    <span className="nui-field-static" aria-hidden="true">
      {selected.map((option) => <span key={option.value} className="nui-field-static"><OptionFace option={option} /></span>)}
    </span>
  );
  if (readOnly) return <span className={cx('nui-field-static', className)} aria-label={names || undefined}>{face}</span>;
  const order = options.map((option) => option.value);
  const trigger: ReactElement = (
    <button type="button" className={cx('nui-field-trigger', className)}
      aria-label={labelled(t(label), names || t(FIELD_WORDS.empty))} aria-describedby={describedBy}>
      {face}
      <span className="nui-field-caret" aria-hidden="true">{renderIcon('caret-down')}</span>
    </button>
  );
  if (searchable || onAdd) {
    // Read at the time of the toggle: an added option may land in `options` while its add is still running.
    const toggle = (value: V) => {
      const current = latest.current;
      const currentOrder = current.options.map((option) => option.value);
      const next = toggleFieldValue(current.values, value,
        currentOrder.includes(value) ? currentOrder : [...currentOrder, value], current.minOne);
      if (next === null) current.onNeedOne?.();
      else current.onChange(next);
    };
    const added = (value: V) => {
      if (!latest.current.values.includes(value)) toggle(value);
    };
    return (
      <Popover
        label={label}
        align="start"
        className="nui-field-search-panel"
        trigger={trigger}
        content={({ close }) => (
          <OptionSearch label={label} values={values} options={options} onToggle={toggle} onAdd={onAdd}
            onAdded={added} close={close} />
        )}
      />
    );
  }
  return (
    <Menu label={label} align="start" trigger={trigger}>
      {options.map((option) => (
        <Menu.Item
          key={option.value}
          icon={option.icon}
          checked={values.includes(option.value)}
          disabled={option.disabled}
          closeOnSelect={false}
          onSelect={() => {
            const next = toggleFieldValue(values, option.value, order, minOne);
            if (next === null) onNeedOne?.();
            else onChange(next);
          }}
        >
          {t(option.label)}
        </Menu.Item>
      ))}
    </Menu>
  );
}

// ---- option search (the search box of a multi-select) ----

/** Folds case and accents, so "ete" finds "Été". */
function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

type SearchEntry<V extends string> = { kind: 'option'; option: FieldOption<V> } | { kind: 'add' };

interface OptionSearchProps<V extends string> {
  label: Text;
  values: readonly V[];
  options: readonly FieldOption<V>[];
  onToggle: (value: V) => void;
  onAdd?: (text: string) => V | void | Promise<V | void>;
  onAdded: (value: V) => void;
  close: () => void;
}

/** The entry's identity, so the active entry stays put while the options or the search change. */
function entryKey<V extends string>(entry: SearchEntry<V>): string {
  return entry.kind === 'add' ? 'add' : `option:${entry.option.value}`;
}

/**
 * A combobox over the options: typing filters them, Up and Down move, Enter toggles the active one (or adds the typed
 * text), Escape and Shift+Tab go back to the trigger, Tab goes on from it. Choosing clears the search and keeps the
 * chosen option active, so several can be toggled in a row.
 */
function OptionSearch<V extends string>({ label, values, options, onToggle, onAdd, onAdded, close }: OptionSearchProps<V>) {
  const t = useT();
  const listId = useStableId('nui-field-options');
  const [query, setQuery] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const needle = foldText(query);
  const text = query.trim();
  const entries: SearchEntry<V>[] = options
    .filter((option) => !needle || foldText(t(option.label)).includes(needle))
    .map((option) => ({ kind: 'option', option }));
  if (onAdd && text && !options.some((option) => foldText(t(option.label)) === needle)) entries.push({ kind: 'add' });
  const usable = (entry: SearchEntry<V> | undefined): boolean =>
    !!entry && (entry.kind === 'add' ? !adding : !entry.option.disabled);
  const activeIndex = activeKey === null ? -1 : entries.findIndex((entry) => entryKey(entry) === activeKey);
  const current = activeIndex >= 0 && usable(entries[activeIndex]) ? activeIndex : entries.findIndex(usable);
  const optionId = (index: number) => `${listId}-${index}`;

  useIsoLayoutEffect(() => {
    const el = current < 0 ? null : listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const move = (step: 1 | -1) => {
    const count = entries.length;
    if (current < 0) return;
    for (let offset = 1; offset < count; offset += 1) {
      const index = (((current + step * offset) % count) + count) % count;
      const entry = entries[index];
      if (entry && usable(entry)) {
        setActiveKey(entryKey(entry));
        return;
      }
    }
  };

  const add = async () => {
    if (!onAdd || adding || !text) return;
    setAdding(true);
    setFailed(null);
    try {
      const value = await onAdd(text);
      // Selected even when the panel closed meanwhile: the add was asked for.
      if (typeof value === 'string') onAdded(value as V);
      if (mounted.current) {
        setQuery('');
        setActiveKey(typeof value === 'string' ? `option:${value}` : null);
      }
    } catch {
      // A deliberate failure path (C1): the search status says so; nothing goes to the console.
      if (mounted.current) setFailed(text);
    } finally {
      if (mounted.current) setAdding(false);
    }
  };

  const choose = (entry: SearchEntry<V> | undefined) => {
    if (!entry || !usable(entry)) return;
    if (entry.kind === 'add') {
      void add();
      return;
    }
    onToggle(entry.option.value);
    setQuery('');
    setActiveKey(entryKey(entry));
    setFailed(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && plain) {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' && plain) {
      event.preventDefault();
      choose(entries[current]);
    } else if (event.key === 'Escape') {
      // With the list showing the engine leaves Escape to this field (aria-expanded); without it the panel closed.
      if (event.defaultPrevented) return;
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      // close() focuses the trigger: Shift+Tab stays there, Tab goes on from it.
      if (event.shiftKey) event.preventDefault();
      close();
    }
  };

  const status = failed !== null ? t(fillWords(FIELD_WORDS.addFailed, { text: failed }))
    : entries.length === 0 ? t(FIELD_WORDS.noMatch) : '';
  return (
    <>
      <input
        type="text"
        role="combobox"
        className="nui-field-search"
        value={query}
        aria-label={t(SHELL_WORDS.search)}
        placeholder={t(SHELL_WORDS.search)}
        aria-autocomplete="list"
        aria-expanded={entries.length > 0}
        aria-controls={entries.length ? listId : undefined}
        aria-activedescendant={current >= 0 ? optionId(current) : undefined}
        autoComplete="off"
        spellCheck={false}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setQuery(event.target.value);
          setActiveKey(null);
          setFailed(null);
        }}
        onKeyDown={onKeyDown}
      />
      {entries.length ? (
        <div ref={listRef} id={listId} role="listbox" aria-label={t(label)} aria-multiselectable="true"
          className="nui-field-options">
          {entries.map((entry, index) => {
            const disabled = !usable(entry);
            const isAdd = entry.kind === 'add';
            return (
              <div
                key={entryKey(entry)}
                id={optionId(index)}
                role="option"
                aria-selected={!isAdd && values.includes(entry.option.value)}
                aria-disabled={disabled || undefined}
                data-index={index}
                data-active={flag(index === current)}
                className="nui-menu-item nui-field-option"
                // The search keeps focus; the pointer only moves the active option.
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => { if (!disabled && index !== current) setActiveKey(entryKey(entry)); }}
                onClick={() => choose(entry)}
              >
                {isAdd ? <Icon name="plus" /> : renderIcon(entry.option.icon)}
                <span className="nui-menu-label">
                  {isAdd ? t(fillWords(FIELD_WORDS.add, { text })) : t(entry.option.label)}
                </span>
                {isAdd ? null : <Icon name="check" className="nui-menu-check" />}
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="nui-field-search-status" role="status">{status}</div>
    </>
  );
}

// ---- disclosure (a value with a bigger editor) ----

export interface FieldDisclosureProps {
  /**
   * The value as words (shown closed, and on the button while open). A long one (a long day, a schedule) wraps
   * in a narrow reader instead of losing its end.
   */
  summary: ReactNode;
  /** Accessible name of the button. */
  label: Text;
  /** The editor, shown under the summary while open. */
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  readOnly?: boolean;
  className?: string;
}

export function FieldDisclosure({
  summary, label, children, open, defaultOpen = false, onOpenChange, readOnly, className,
}: FieldDisclosureProps) {
  const t = useT();
  const labelled = useLabelValue();
  const describedBy = useRowDescribedBy();
  const panelId = useStableId('nui-field-panel');
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const isOpen = open ?? ownOpen;
  const setOpen = (next: boolean) => {
    if (open === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  if (readOnly) return <span className={cx('nui-field-static', className)}>{summary}</span>;
  return (
    <>
      <button
        type="button"
        className={cx('nui-field-trigger', className)}
        data-wrap=""
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-label={labelled(t(label), typeof summary === 'string' ? summary : t(FIELD_WORDS.edit))}
        aria-describedby={describedBy}
        onClick={() => setOpen(!isOpen)}
      >
        <span className="nui-field-text">{summary}</span>
        <span className="nui-field-caret" aria-hidden="true">{renderIcon(isOpen ? 'caret-up' : 'caret-down')}</span>
      </button>
      {isOpen ? <div id={panelId} className="nui-field-panel">{children}</div> : null}
    </>
  );
}
