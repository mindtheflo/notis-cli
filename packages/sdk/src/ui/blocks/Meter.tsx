/**
 * Meter: how full something is (memory, disk, seats, a quota), as a label and its figure over a thin track. Flat:
 * no border, no coloured text. The fill is neutral until it reaches the optional limit, then the whole fill turns
 * destructive (state as a full fill, never by text colour).
 */

import type { ReactNode } from 'react';
import { isWords, pick, type Words } from '../../words/types';
import { useToolkitLocale } from '../engine/hooks';
import { formatValue } from '../period/dateFormat';
import { cx } from '../util';

type Text = Words | string;

export interface MeterProps {
  /** What is measured ("Memory"); also the meter's accessible name. */
  label: Text;
  /** How much is used, in the same unit as `max`. */
  value: number;
  /** The capacity. The fill is `value / max`, held between empty and full. */
  max: number;
  /** The figure on the right. Default "8.2 / 36" in the toolkit locale. Text (or words) is also read as the meter's value. */
  valueText?: ReactNode | Words;
  /**
   * A threshold in the unit of `max`: a thin tick on the track (none when the limit is past `max`); at or over it the
   * fill turns destructive. Only for a threshold the data has (a memory reserve, a quota): a full meter is not a
   * problem by itself, so never set `limit` to `max`; when full means someone waits, say that in the page's
   * "Needs action" section instead.
   */
  limit?: number;
  /** What the limit is ("Alert at 30 GiB"), shown muted under the track on the right. */
  limitLabel?: Text;
  /** A muted line under the track on the left ("4 apps running"). */
  hint?: Text;
  className?: string;
}

/** `value / max` held between 0 and 1; 0 when either is not a finite number or `max` is not above 0. */
function ratio(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

/**
 * A label and its figure ("Memory 8.2 / 36") over a 6px rounded track with a neutral fill. With `limit`, a tick
 * marks it and the fill turns destructive once the value reaches it (`data-over`). role="meter", named by the label.
 */
export function Meter({ label, value, max, valueText, limit, limitLabel, hint, className }: MeterProps) {
  const locale = useToolkitLocale();
  const t = (words: Text) => pick(words, locale);
  const name = t(label);
  const fallback = `${formatValue(Number.isFinite(value) ? value : 0, locale)} / ${formatValue(Number.isFinite(max) ? max : 0, locale)}`;
  const shown: ReactNode = valueText === undefined ? fallback
    : typeof valueText === 'string' || isWords(valueText) ? t(valueText) : valueText;
  const spoken = valueText === undefined ? fallback
    : typeof valueText === 'string' || isWords(valueText) ? t(valueText) : undefined;
  // A limit at or under 0 marks no threshold: every value would read as over it.
  const hasLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0;
  const over = hasLimit && Number.isFinite(value) && value >= (limit as number);
  const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
  const now = Math.min(safeMax, Math.max(0, Number.isFinite(value) ? value : 0));
  const hasFoot = hint !== undefined || limitLabel !== undefined;
  return (
    <div className={cx('nui-meter', className)} data-notis-ui="" data-over={over ? '' : undefined}
      role="meter" aria-label={name} aria-valuemin={0} aria-valuemax={safeMax} aria-valuenow={now} aria-valuetext={spoken}>
      <div className="nui-meter-head">
        <span className="nui-meter-label">{name}</span>
        <span className="nui-meter-value">{shown}</span>
      </div>
      <div className="nui-meter-track" aria-hidden="true">
        <span className="nui-meter-fill" style={{ width: `${ratio(value, max) * 100}%` }} />
        {hasLimit && (limit as number) <= safeMax && (
          <span className="nui-meter-limit" style={{ left: `${ratio(limit as number, max) * 100}%` }} />
        )}
      </div>
      {hasFoot && (
        <div className="nui-meter-foot">
          <span className="nui-meter-hint">{hint !== undefined ? t(hint) : ''}</span>
          {limitLabel !== undefined && <span className="nui-meter-limit-label">{t(limitLabel)}</span>}
        </div>
      )}
    </div>
  );
}
Meter.displayName = 'Meter';
