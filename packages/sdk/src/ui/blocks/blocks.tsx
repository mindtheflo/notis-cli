/**
 * Building blocks promoted from Spaces (toolkit spec 2.12): Section, Badge, Button, SegmentedControl, NativeSelect,
 * EmptyState, Notice and Metric. Flat look (no boxes, borders or eyebrows; the page title lives in the top bar), styled
 * by `toolkit.css`. Every text prop takes EN/FR words or a plain string.
 */

import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { SHELL_WORDS, fillWords, type Words } from '../../words';
import { Icon, renderIcon } from '../icons';
import { cx, revealInline, useT } from '../util';
import type { Tone } from '../list/Row';

type Text = Words | string;

export const BLOCK_WORDS = Object.freeze({
  previousPage: { en: 'Previous page', fr: 'Page précédente' },
  nextPage: { en: 'Next page', fr: 'Page suivante' },
  pageOf: { en: 'Page {page} of {count}', fr: 'Page {page} sur {count}' },
  rangeOf: { en: '{from} to {to} of {total}', fr: '{from} à {to} sur {total}' },
  pagination: { en: 'Pages', fr: 'Pages' },
  emptyTitle: { en: 'Nothing here yet', fr: 'Rien ici pour l’instant' },
  emptyBody: { en: 'Items show up here as soon as there are some.', fr: 'Les éléments s’affichent ici dès qu’il y en a.' },
}) satisfies Readonly<Record<string, Words>>;

// ---- Section ----

/**
 * What a Section holds, which sets its spacing. bar: a period or filter bar (px 24, pt 12). stats: a full-width
 * StatRow strip. chart: a chart under its head (px 24, pt 32). data: a table or list under its head (pt 40; the head
 * px 24, pb 12; the edge cells 24 in). form: fields across the full width (px 24, pt 24); each field caps its own width.
 */
export type SectionKind = 'bar' | 'stats' | 'chart' | 'data' | 'form';

/** The props of `Section`. */
export interface SectionProps {
  /** What the section holds, which sets its spacing. Default 'data'. */
  kind?: SectionKind;
  /** A data label in the head row (h2, 14px medium); never a page title, which lives in the top bar. */
  title?: Text;
  /** A muted count after the title (12px, tabular). */
  count?: number;
  /** Muted text after the title (a date range, a source): words, or any content. */
  meta?: ReactNode | Words;
  /** A TabRow or SegmentedControl in the head row. A TabRow folds what does not fit into More; in a bar, other controls scroll sideways in the one row; a chart head 560px or narrower puts them on their own line. */
  tabs?: ReactNode;
  /** Ghost icon buttons at the end of the head row (a 32px "+", a view menu). */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/**
 * A full-width page section with no border, ring, background or radius on any kind. The head row (title, count, meta,
 * tabs, actions) shows only when one of them is given.
 */
export function Section({ kind = 'data', title, count, meta, tabs, actions, children, className }: SectionProps) {
  const t = useT();
  const hasMeta = meta !== undefined && meta !== null && meta !== false;
  const head = title !== undefined || typeof count === 'number' || hasMeta || !!tabs || !!actions;
  return (
    <section className={cx('nui-section', className)} data-kind={kind}>
      {head && (
        <div className="nui-section-head">
          {title !== undefined && <h2 className="nui-section-title">{t(title)}</h2>}
          {typeof count === 'number' && <span className="nui-section-count">{count}</span>}
          {hasMeta && <span className="nui-section-meta">{textOrNode(meta, t)}</span>}
          {tabs && <div className="nui-section-tabs">{tabs}</div>}
          {actions && <div className="nui-section-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Words or a plain string in the toolkit locale; any other content as it is. */
function textOrNode(value: ReactNode | Words, t: (words: Words | string) => string): ReactNode {
  return typeof value === 'string' || isWords(value) ? t(value) : value;
}

// ---- Badge ----

export interface BadgeProps {
  tone?: Tone;
  icon?: ReactNode | string;
  /** Words or a plain string are shown in the toolkit locale; any other content as it is. */
  children?: ReactNode | Words;
  className?: string;
}

export function Badge({ tone = 'default', icon, children, className }: BadgeProps) {
  const t = useT();
  return (
    <span className={cx('nui-badge', className)} data-tone={tone === 'default' ? undefined : tone}>
      {icon !== undefined && renderIcon(icon)}
      {textOrNode(children, t)}
    </span>
  );
}

function isWords(value: unknown): value is Words {
  return !!value && typeof value === 'object' && typeof (value as Words).en === 'string'
    && typeof (value as Words).fr === 'string';
}

// ---- Button ----

/**
 * default: a soft neutral fill. primary: the page's main action. secondary: the Portal's secondary fill. ghost: no
 * fill until hover. link: text in the primary colour, underlined on hover. danger: a destructive action.
 */
export type ButtonVariant = 'default' | 'primary' | 'secondary' | 'ghost' | 'link' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode | string;
  /**
   * Makes the button a toggle (aria-pressed): quiet while off, filled while on, whatever the variant. Its hover is
   * lighter than the on fill, so an off toggle under the pointer never reads as on. For several, see ToggleGroup.
   */
  pressed?: boolean;
  children?: ReactNode | Words;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', icon, pressed, children, className, type = 'button', ...rest }, ref) {
  const t = useT();
  return (
    <button ref={ref} type={type} className={cx('nui-btn', className)} aria-pressed={pressed}
      data-variant={variant === 'default' ? undefined : variant} data-size={size === 'md' ? undefined : size} {...rest}>
      {icon !== undefined && renderIcon(icon)}
      {isWords(children) ? t(children) : children}
    </button>
  );
});

// ---- ToggleGroup ----

export interface ToggleGroupProps<V extends string> {
  options: readonly SegmentedOption<V>[];
  /** The options that are on. */
  value: readonly V[];
  /** The options on after a press, in option order. */
  onChange(value: V[]): void;
  /** The group's accessible name. */
  label?: Text;
  /** Default 'sm'. */
  size?: ButtonSize;
  className?: string;
}

/**
 * Several toggles, any number on (filters, chart series): a role="group" of aria-pressed buttons. Each press turns
 * one option on or off; the caller decides what an empty set means (keep the last one on, or turn them all on).
 * For one choice out of several use SegmentedControl.
 */
export function ToggleGroup<V extends string>({ options, value, onChange, label, size = 'sm', className }: ToggleGroupProps<V>) {
  const t = useT();
  const on = new Set<V>(value);
  return (
    <div role="group" className={cx('nui-toggles', className)} aria-label={label !== undefined ? t(label) : undefined}>
      {options.map((option) => {
        const pressed = on.has(option.value);
        return (
          <Button key={option.value} size={size} pressed={pressed} disabled={option.disabled} icon={option.icon}
            onClick={() => onChange(options
              .filter((other) => (other.value === option.value ? !pressed : on.has(other.value)))
              .map((other) => other.value))}>
            {t(option.label)}
            {typeof option.count === 'number' && <span className="nui-btn-count">{option.count}</span>}
          </Button>
        );
      })}
    </div>
  );
}

// ---- SegmentedControl ----

export interface SegmentedOption<V extends string> {
  value: V;
  label: Text;
  icon?: ReactNode | string;
  count?: number;
  disabled?: boolean;
}

export interface SegmentedControlProps<V extends string> {
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange(value: V): void;
  /** The group's accessible name. */
  label?: Text;
  className?: string;
}

/** Pills for a mode switch inside a section (a chart's Bars, Line, Area; the period bar's presets); never a TabRow. */
export function SegmentedControl<V extends string>({ options, value, onChange, label, className }: SegmentedControlProps<V>) {
  const t = useT();
  const groupRef = useRef<HTMLDivElement>(null);
  // In a toolbar that scrolls sideways on a phone, the chosen option stays in view.
  useEffect(() => { revealInline(groupRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')); }, [value]);
  return (
    <div ref={groupRef} role="group" className={cx('nui-seg', className)}
      aria-label={label !== undefined ? t(label) : undefined}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} disabled={option.disabled}
          onClick={() => { if (option.value !== value) onChange(option.value); }}>
          {option.icon !== undefined && renderIcon(option.icon)}
          {t(option.label)}
          {typeof option.count === 'number' && <span className="nui-seg-count">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---- Switch ----

export interface SwitchProps {
  checked: boolean;
  onChange(checked: boolean): void;
  /** Accessible name; shown beside the switch unless `hideLabel`. */
  label: Text;
  /** Keep the label for screen readers only (a row already says what the switch does). */
  hideLabel?: boolean;
  disabled?: boolean;
  /** A change is being saved: the switch shows busy and ignores presses. */
  busy?: boolean;
  /** 'sm' (default, 16px tall, rows and menus) or 'md' (20px, settings). */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * An on/off switch (role switch). Clicks on it never reach the row under it, so it sits inside a list row without
 * opening the row.
 */
export function Switch({ checked, onChange, label, hideLabel = false, disabled = false, busy = false, size = 'sm',
  className }: SwitchProps) {
  const t = useT();
  const name = t(label);
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={hideLabel ? name : undefined}
      aria-busy={busy || undefined} disabled={disabled} data-size={size === 'md' ? 'md' : undefined}
      className={cx('nui-switch', className)}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled || busy) return;
        onChange(!checked);
      }}>
      <span className="nui-switch-track" aria-hidden="true"><span className="nui-switch-thumb" /></span>
      {!hideLabel && <span className="nui-switch-label">{name}</span>}
    </button>
  );
}

// ---- Pagination ----

export interface PaginationProps {
  /** The current page, from 1. */
  page: number;
  /** How many pages; with `total` and `pageSize` it is worked out. */
  pageCount?: number;
  /** Item count: the label then reads "21 to 40 of 134". */
  total?: number;
  pageSize?: number;
  onChange(page: number): void;
  /** A page is loading: the buttons wait. */
  busy?: boolean;
  className?: string;
}

/** Previous and next page buttons with "Page 2 of 5" (or "21 to 40 of 134" when the total is known). */
export function Pagination({ page, pageCount, total, pageSize, onChange, busy = false, className }: PaginationProps) {
  const t = useT();
  const count = Math.max(1, pageCount ?? (total !== undefined && pageSize ? Math.ceil(total / pageSize) : 1));
  const current = Math.min(Math.max(1, Math.floor(page)), count);
  const label = total !== undefined && pageSize
    ? fillWords(BLOCK_WORDS.rangeOf, {
      from: total === 0 ? 0 : (current - 1) * pageSize + 1,
      to: Math.min(total, current * pageSize),
      total,
    })
    : fillWords(BLOCK_WORDS.pageOf, { page: current, count });
  return (
    <nav className={cx('nui-pagination', className)} aria-label={t(BLOCK_WORDS.pagination)}>
      <span className="nui-pagination-label" aria-live="polite">{t(label)}</span>
      <button type="button" className="nui-icon-btn" aria-label={t(BLOCK_WORDS.previousPage)}
        disabled={busy || current <= 1} onClick={() => onChange(current - 1)}>
        <Icon name="caret-left" />
      </button>
      <button type="button" className="nui-icon-btn" aria-label={t(BLOCK_WORDS.nextPage)}
        disabled={busy || current >= count} onClick={() => onChange(current + 1)}>
        <Icon name="caret-right" />
      </button>
    </nav>
  );
}

// ---- NativeSelect ----

export interface NativeSelectOption<V extends string> {
  value: V;
  label: Text;
  disabled?: boolean;
}

export interface NativeSelectProps<V extends string>
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'children'> {
  options: readonly NativeSelectOption<V>[];
  value: V;
  onChange(value: V): void;
  /** Accessible name (no visible label). */
  label?: Text;
}

/** The platform select, styled flat: the right control on phones and in narrow toolbars. */
export function NativeSelect<V extends string>({ options, value, onChange, label, className, ...rest }: NativeSelectProps<V>) {
  const t = useT();
  return (
    <select className={cx('nui-select', className)} value={value} aria-label={label !== undefined ? t(label) : undefined}
      onChange={(event) => onChange(event.target.value as V)} {...rest}>
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>{t(option.label)}</option>
      ))}
    </select>
  );
}

// ---- EmptyState ----

export interface EmptyStateProps {
  /** Default "Nothing here yet". */
  title?: Text;
  body?: Text;
  /** A button under the text. */
  action?: ReactNode;
  icon?: ReactNode | string;
  className?: string;
}

export function EmptyState({ title = BLOCK_WORDS.emptyTitle, body, action, icon, className }: EmptyStateProps) {
  const t = useT();
  return (
    <div className={cx('nui-empty', className)}>
      {icon !== undefined && renderIcon(icon)}
      <p className="nui-empty-title">{t(title)}</p>
      {body !== undefined && <p className="nui-empty-body">{t(body)}</p>}
      {action && <div className="nui-empty-action">{action}</div>}
    </div>
  );
}

// ---- Notice ----

export interface NoticeProps {
  tone?: Tone;
  children?: ReactNode | Words;
  /** Shows a Try again button. */
  onRetry?: () => void;
  /** Other buttons on the right. */
  action?: ReactNode;
  /**
   * The message cannot wait: a screen reader breaks off what it is saying to read it (role="alert"). Keep it for a
   * problem the person must act on now; any tone may be urgent. Default false: role="status", read once the reader is
   * idle, also for danger.
   */
  urgent?: boolean;
  className?: string;
}

/** A one-line message in the page (an error with Try again, a warning, a tip). Only an urgent notice is an alert. */
export function Notice({ tone = 'default', children, onRetry, action, urgent = false, className }: NoticeProps) {
  const t = useT();
  return (
    <div className={cx('nui-notice', className)} data-tone={tone === 'default' ? undefined : tone}
      role={urgent ? 'alert' : 'status'}>
      <div className="nui-notice-text">{isWords(children) ? t(children) : children}</div>
      {action}
      {onRetry && <Button size="sm" onClick={onRetry}>{t(SHELL_WORDS.tryAgain)}</Button>}
    </div>
  );
}

// ---- Metric ----

export interface MetricProps {
  label: Text;
  value: ReactNode;
  /** A change against the comparison period, already formatted ("+12%"). */
  delta?: ReactNode;
  /** Colours the delta: up is good unless `invert`. */
  trend?: 'up' | 'down' | 'flat';
  /** A rising value is bad (costs, errors). */
  invert?: boolean;
  hint?: Text;
  className?: string;
}

export function Metric({ label, value, delta, trend, invert = false, hint, className }: MetricProps) {
  const t = useT();
  const shown = trend === 'flat' || trend === undefined ? undefined : (trend === 'up') !== invert ? 'up' : 'down';
  return (
    <div className={cx('nui-metric', className)}>
      <span className="nui-metric-label">{t(label)}</span>
      <span className="nui-metric-value">{value}</span>
      {delta !== undefined && delta !== null && <span className="nui-metric-delta" data-trend={shown}>{delta}</span>}
      {hint !== undefined && <span className="nui-metric-hint">{t(hint)}</span>}
    </div>
  );
}
