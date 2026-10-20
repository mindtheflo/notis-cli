/**
 * The one translated `?` sheet (toolkit spec 2.1), built from the live registry: only shortcuts that answer here
 * and now are listed, "This Space" first, then "Notis". Rendered once by the host.
 */

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { HELP_WORDS } from '../../words';
import { Keycap, KeycapSurface } from '../keycap/Keycap';
import { usePinnedLayerRoot } from '../overlay/layerRoot';
import { ESCAPE_PRIORITY } from './core';
import { useEngineCore, useEscapeLayer, useHelpSheet, useRegistryVersion, useToolkitLocale } from './hooks';
import { ROOT_OWNER } from './registry';
import type { ShortcutGroup } from './types';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), '
  + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function deepActiveElement(doc: Document): HTMLElement | null {
  let active = doc.activeElement as HTMLElement | null;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement as HTMLElement;
  return active;
}

export interface HelpSheetProps {
  /**
   * Where the sheet mounts. Default: the pinned overlay layer root (LayerRootProvider), else the top-level
   * container of the page the engine listens on. The sheet is rendered once by the host, never by a Space.
   */
  container?: Element | DocumentFragment | null;
}

export function HelpSheet({ container }: HelpSheetProps) {
  const { isOpen } = useHelpSheet();
  const core = useEngineCore();
  const pinned = usePinnedLayerRoot();
  if (!isOpen) return null;
  const target = container ?? pinned ?? core.attachedDocument()?.body ?? null;
  if (!target) return null;
  return createPortal(<HelpSheetPanel />, target);
}

function HelpSheetPanel() {
  const core = useEngineCore();
  const locale = useToolkitLocale();
  const { close } = useHelpSheet();
  useRegistryVersion();
  const panelRef = useRef<HTMLDivElement>(null);

  useEscapeLayer('help-sheet', () => { close(); return true; }, { priority: ESCAPE_PRIORITY.help });

  // '?' closes the sheet too; the sheet is modal, so only modal-scope keys reach it.
  useEffect(() => core.register({
    id: 'help.close',
    keys: '?',
    scope: 'modal',
    label: HELP_WORDS.close,
    hidden: true,
    run: () => { core.closeHelp(); },
  }, ROOT_OWNER) ?? undefined, [core]);

  // Focus moves in, and back to where it was on close.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    const previous = deepActiveElement(panel.ownerDocument);
    panel.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const trapTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) { event.preventDefault(); panel.focus(); return; }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = deepActiveElement(panel.ownerDocument);
    if (event.shiftKey && (active === first || active === panel)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };

  const entries = core.registry.helpEntries();
  const groups: Array<{ group: ShortcutGroup; title: string }> = [
    { group: 'space', title: HELP_WORDS.groupSpace[locale] },
    { group: 'notis', title: HELP_WORDS.groupNotis[locale] },
  ];
  const titleId = 'nui-help-title';

  return (
    <div className="nui-root nui-help" data-notis-escape-owned="" lang={locale}>
      <div className="nui-help-backdrop" aria-hidden="true" />
      <div
        ref={panelRef}
        className="nui-help-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <div className="nui-help-head">
          <h2 id={titleId} className="nui-help-title">{HELP_WORDS.title[locale]}</h2>
          <button type="button" className="nui-icon-btn" aria-label={HELP_WORDS.close[locale]} onClick={close}>
            <svg className="nui-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div className="nui-help-body">
          <KeycapSurface on="discreet">
            {entries.length === 0 && <p className="nui-help-empty">{HELP_WORDS.empty[locale]}</p>}
            {groups.map(({ group, title }) => {
              const rows = entries.filter((entry) => entry.group === group);
              if (!rows.length) return null;
              return (
                <section key={group} className="nui-help-group" aria-label={title}>
                  <h3 className="nui-help-group-title">{title}</h3>
                  <ul className="nui-help-list">
                    {rows.map((row) => (
                      <li key={row.id} className="nui-help-row" data-shortcut-id={row.id}>
                        <span className="nui-help-label">{row.label[locale]}</span>
                        <Keycap keys={row.keys} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </KeycapSurface>
        </div>
      </div>
    </div>
  );
}
