/**
 * OpenAsMenu (toolkit spec 2.9, round decision alt a): the Notion-style button at the reader's top left. Its menu
 * offers Side peek, Center peek and Full page with a check on the current mode. Hidden when only one mode is allowed.
 */

import { SHELL_WORDS, type Words } from '../../words';
import { Icon } from '../icons';
import { Menu } from '../overlay/Menu';
import { useT } from '../util';
import { normalizeAllowed } from './useOpenMode';
import type { OpenMode } from './openModeStore';

export const OPEN_MODE_WORDS: Readonly<Record<OpenMode, Words>> = Object.freeze({
  side: SHELL_WORDS.sidePeek,
  center: SHELL_WORDS.centerPeek,
  full: SHELL_WORDS.fullPage,
});

export const OPEN_MODE_ICONS: Readonly<Record<OpenMode, string>> = Object.freeze({
  side: 'sidebar-simple',
  center: 'square-center',
  full: 'corners-out',
});

export interface OpenAsMenuProps {
  allowed?: OpenMode | readonly OpenMode[];
  mode: OpenMode;
  onChange(mode: OpenMode): void;
  className?: string;
}

export function OpenAsMenu({ allowed, mode, onChange, className }: OpenAsMenuProps) {
  const t = useT();
  const modes = normalizeAllowed(allowed);
  if (modes.length < 2) return null;
  const name = `${t(SHELL_WORDS.openAs)} ${t(OPEN_MODE_WORDS[mode]).toLowerCase()}`;
  return (
    <Menu label={SHELL_WORDS.openAs} align="start"
      trigger={(
        <button type="button" className={className ? `nui-om-btn ${className}` : 'nui-om-btn'} aria-label={name}
          data-mode={mode} data-part="mode">
          <Icon name={OPEN_MODE_ICONS[mode]} />
          <Icon name="caret-down" className="nui-om-caret" />
        </button>
      )}>
      {modes.map((option) => (
        <Menu.Item key={option} icon={OPEN_MODE_ICONS[option]} checked={option === mode}
          onSelect={() => onChange(option)}>
          {t(OPEN_MODE_WORDS[option])}
        </Menu.Item>
      ))}
    </Menu>
  );
}
