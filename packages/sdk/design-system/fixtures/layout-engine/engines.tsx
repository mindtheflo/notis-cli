/**
 * Keyboard engines for the layout and keyboard specimens. Each state mounts its own core, so the book frame's own
 * keys never mix into what the state shows, and the state picks its language and platform.
 */
import { useState, type ReactNode } from 'react';
import { KeyboardEngine, KeyboardEngineCore, getSharedInstance } from '../../../src/ui';
import type { SpecimenLang } from '../../specimen';

export type SpecimenPlatform = 'mac' | 'other';

export interface OwnEngineProps {
  lang: SpecimenLang;
  /** Default 'mac'. 'other' is Windows and Linux. */
  platform?: SpecimenPlatform;
  /** Default true: a clash throws NotisKeyClash. */
  strict?: boolean;
  onClash?: (message: string) => void;
  children?: ReactNode;
}

/** A KeyboardEngine with its own core, attached to the page like any Notis page. */
export function OwnEngine({ lang, platform = 'mac', strict = true, onClash, children }: OwnEngineProps) {
  const [core] = useState(() => new KeyboardEngineCore({ host: 'preview', locale: lang, platform, strict, onClash }));
  return (
    <KeyboardEngine engine={core} host="preview" locale={lang} platform={platform} strict={strict} onClash={onClash}>
      {children}
    </KeyboardEngine>
  );
}

/**
 * A core that never attached to a page: the only way to an empty registry, because attaching always registers ?.
 * It counts as mounted so its hooks read this state's language and platform.
 */
export function UnattachedEngine({ lang, platform = 'mac', children }: Omit<OwnEngineProps, 'strict' | 'onClash'>) {
  const [core] = useState(() => {
    const own = new KeyboardEngineCore({ host: 'preview', locale: lang, platform, strict: true });
    own.mounted = 1;
    return own;
  });
  const { EngineContext } = getSharedInstance();
  return <EngineContext.Provider value={core}>{children}</EngineContext.Provider>;
}
