/**
 * InfoTip: a small info button beside a label that opens a short explanation on press (and on tap, where a tooltip
 * never shows). How a figure is counted, what a state means or which threshold applies goes here, not as prose on
 * the page. Put it in a StatRow figure's `about`, a Meter's label line or next to a Section item heading.
 */

import React from 'react';
import { fillWords, pick, type Words } from '../../words/types';
import { useToolkitLocale } from '../engine/hooks';
import { Icon } from '../icons';
import { Popover } from '../overlay/Popover';
import { cx } from '../util';

export const INFOTIP_WORDS = Object.freeze({
  more: { en: 'About {label}', fr: 'À propos de {label}' },
  fallback: { en: 'More information', fr: 'Plus d’informations' },
}) satisfies Readonly<Record<string, Words>>;

export interface InfoTipProps {
  /** The explanation: one or two short sentences. */
  children: React.ReactNode;
  /** What it explains ("Dev stacks"): names the button "About Dev stacks". */
  label?: Words | string;
  className?: string;
}

export function InfoTip({ children, label, className }: InfoTipProps) {
  const locale = useToolkitLocale();
  const name = label === undefined ? pick(INFOTIP_WORDS.fallback, locale)
    : pick(fillWords(INFOTIP_WORDS.more, { label: pick(label, locale) }), locale);
  return (
    <Popover side="bottom" align="start" autoFocus={false} label={name}
      trigger={(
        <button type="button" className={cx('nui-infotip', className)} aria-label={name}>
          <Icon name="info" />
        </button>
      )}
      content={<div className="nui-infotip-body">{children}</div>} />
  );
}
