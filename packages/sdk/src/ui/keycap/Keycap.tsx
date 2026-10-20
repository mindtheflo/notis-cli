/**
 * Keycap (toolkit spec 2.2): how a shortcut reads on screen, the same on every Notis surface. Caps are aria-hidden;
 * screen readers get the spelled-out words ("Command A", "G then I").
 */

import { Fragment, useContext, type ReactNode } from 'react';
import { KEY_JOIN_WORDS, formatKey, formatKeyParts, formatKeySpoken, type KeySpec } from '../../words';
import { useToolkitLocale, useToolkitPlatform } from '../engine/hooks';
import { getSharedInstance } from '../engine/instance';
import type { KeycapOn } from '../engine/keycapContext';

export type { KeycapOn };

export interface KeycapProps {
  keys: KeySpec | readonly KeySpec[];
  /** Surface the caps sit on. Default from the nearest `KeycapSurface`, else 'surface'. */
  on?: KeycapOn;
  className?: string;
}

export function Keycap({ keys, on, className }: KeycapProps) {
  const locale = useToolkitLocale();
  const platform = useToolkitPlatform();
  const inherited = useContext(getSharedInstance().KeycapContext);
  const surface = on ?? inherited ?? 'surface';
  const options = { platform, locale };
  const alternatives = formatKeyParts(keys, options);
  if (!alternatives.length) return null;
  const then = KEY_JOIN_WORDS.then[locale];
  const or = KEY_JOIN_WORDS.or[locale];
  return (
    <span className={className ? `nui-kbd-group ${className}` : 'nui-kbd-group'} data-on={surface}>
      <span className="nui-kbd-caps" aria-hidden="true">
        {alternatives.map((caps, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="nui-kbd-sep">{or}</span>}
            {caps.map((cap, j) => (
              <Fragment key={j}>
                {j > 0 && <span className="nui-kbd-sep">{then}</span>}
                <kbd className="nui-kbd">{cap}</kbd>
              </Fragment>
            ))}
          </Fragment>
        ))}
      </span>
      <span className="nui-sr-only">{formatKeySpoken(keys, options)}</span>
    </span>
  );
}

/** Sets the default `on` of every Keycap below (SelectionBar: pill, menus and the help sheet: discreet). */
export function KeycapSurface({ on, children }: { on: KeycapOn; children?: ReactNode }) {
  const { KeycapContext } = getSharedInstance();
  return <KeycapContext.Provider value={on}>{children}</KeycapContext.Provider>;
}

/** The shortcut as text in the toolkit locale and platform ("⇧E", "Ctrl+A", "G then I"), for tooltips and titles. */
export function useKeyLabel(keys: KeySpec | readonly KeySpec[]): string {
  const locale = useToolkitLocale();
  const platform = useToolkitPlatform();
  return formatKey(keys, { platform, locale });
}
