/**
 * Runtimes for the documents specimens.
 *
 * `bookRuntime(lang)` is the book's fake Space runtime, one per language, so a state can show a host-delegated
 * fallback in English and French side by side. `legacyAppRuntime(lang)` is a legacy App (resource kind 'app')
 * whose document tool answers from fixtures, so DocumentEditor's read-only preview (the path a Space never
 * takes) is reachable. Nothing here reaches the network. Fixtures are not scanned by Tailwind: inline styles only.
 */
import { useMemo, type ReactNode } from 'react';
import { NotisProvider, createQueryClient, type NotisRuntime } from '../../../src';
import { createFakeRuntime } from '../../runtime/fakeRuntime';
import type { SpecimenLang } from '../../specimen';
import { NOTES_DATABASE } from '../records';
import { isoFromNow } from '../time';
import { fixtureMarkdown } from '../documents';

const LANGS: readonly SpecimenLang[] = ['en', 'fr'];

const spaceRuntimes = new Map<SpecimenLang, NotisRuntime>();

/** The book's fake Space runtime in `lang`, created once per language so hooks keep one cache. */
export function bookRuntime(lang: SpecimenLang): NotisRuntime {
  let runtime = spaceRuntimes.get(lang);
  if (!runtime) {
    runtime = createFakeRuntime({ lang, theme: 'light' });
    spaceRuntimes.set(lang, runtime);
  }
  return runtime;
}

const caption = {
  margin: '0 0 8px',
  font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
  color: 'hsl(var(--muted-foreground))',
} as const;

/** One column per language, each inside its own NotisProvider with the fake Space runtime of that language. */
export function InLanguages({ children, minColumn = 280 }: {
  children: (lang: SpecimenLang) => ReactNode;
  /** Narrowest column before the two languages stack. */
  minColumn?: number;
}) {
  return (
    <div style={{ display: 'grid', gap: 24, gridTemplateColumns: `repeat(auto-fit, minmax(${minColumn}px, 1fr))` }}>
      {LANGS.map((lang) => (
        <section key={lang} data-ds-lang={lang} style={{ minWidth: 0 }}>
          <p style={caption}>{`runtime.context.locale = '${lang}'`}</p>
          <NotisProvider runtime={bookRuntime(lang)}>{children(lang)}</NotisProvider>
        </section>
      ))}
    </div>
  );
}

/** The documents the legacy App's GET_DOCUMENT tool knows, by id. */
export const LEGACY_DOCUMENT_IDS = {
  markdown: 'doc-launch-plan',
  untitled: 'doc-untitled',
  report: 'doc-weekly-report',
  html: 'doc-pricing-page',
  file: 'doc-signed-contract',
  loading: 'doc-still-loading',
  missing: 'doc-deleted',
  error: 'doc-offline',
} as const;

export type LegacyDocumentCase = keyof typeof LEGACY_DOCUMENT_IDS;

const LEGACY_TITLES = {
  report: { en: 'Weekly conversations report', fr: 'Rapport hebdomadaire des conversations' },
  html: { en: 'Pricing page draft', fr: 'Brouillon de la page des tarifs' },
  file: { en: 'Signed contract, Acme Studio', fr: 'Contrat signé, Acme Studio' },
} as const;

/** What the legacy App's tool says when the connection drops. */
export const LEGACY_OFFLINE_MESSAGE = {
  en: 'Notis could not reach this document. Check your connection, then try again.',
  fr: 'Notis n’a pas pu joindre ce document. Vérifie ta connexion, puis réessaie.',
} as const;

function legacyDocument(id: string, lang: SpecimenLang): Record<string, unknown> | null {
  const base = { id, database_slug: 'notes', created_at: isoFromNow(-12), last_edited_time: isoFromNow(-1, -3) };
  switch (id) {
    case LEGACY_DOCUMENT_IDS.markdown:
      return { ...base, title: lang === 'fr' ? 'Plan de lancement' : 'Launch plan', content_type: 'markdown', content_markdown: fixtureMarkdown(lang).replace(/^# .*\n\n/, '') };
    case LEGACY_DOCUMENT_IDS.untitled:
      return { ...base, title: '', content_type: 'markdown', content_markdown: lang === 'fr' ? 'Idées pour la réunion de lundi.' : 'Ideas for Monday’s meeting.' };
    case LEGACY_DOCUMENT_IDS.report:
      return { ...base, title: LEGACY_TITLES.report[lang], content_type: 'view', view_type: 'report' };
    case LEGACY_DOCUMENT_IDS.html:
      return { ...base, title: LEGACY_TITLES.html[lang], content_type: 'view', view_type: 'html' };
    case LEGACY_DOCUMENT_IDS.file:
      return { ...base, title: LEGACY_TITLES.file[lang], content_type: 'file', file_type: 'pdf' };
    default:
      return null;
  }
}

function legacyCallTool(lang: SpecimenLang) {
  return async (name: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    if (name !== 'LOCAL_NOTIS_DATABASE_GET_DOCUMENT') throw new Error(`${name} is not available in the design book.`);
    const id = String(args.document_id ?? '');
    if (id === LEGACY_DOCUMENT_IDS.loading) return new Promise<never>(() => undefined);
    if (id === LEGACY_DOCUMENT_IDS.error) throw new Error(LEGACY_OFFLINE_MESSAGE[lang]);
    const document = legacyDocument(id, lang);
    return document ? { status: 'success', document } : { status: 'error' };
  };
}

const legacyRuntimes = new Map<SpecimenLang, NotisRuntime>();

/** A legacy App runtime (resource kind 'app', no host UI) whose GET_DOCUMENT tool answers from fixtures. */
export function legacyAppRuntime(lang: SpecimenLang): NotisRuntime {
  let runtime = legacyRuntimes.get(lang);
  if (!runtime) {
    const name = lang === 'fr' ? 'Notes de lancement' : 'Launch notes';
    runtime = {
      resource: { kind: 'app', id: 'app-launch-notes', revision: 3, name, icon: 'file-text' },
      app: { id: 'app-launch-notes', name, icon: 'file-text', description: null },
      route: { slug: 'notes', path: '/', name, default: true },
      databases: [NOTES_DATABASE],
      context: { locale: lang, selection: null, params: {} },
      queryClient: createQueryClient(),
      ui: undefined,
      listTools: () => Promise.resolve([]),
      callTool: legacyCallTool(lang) as NotisRuntime['callTool'],
      request: () => Promise.reject(new Error('request is not available in the design book.')),
    };
    legacyRuntimes.set(lang, runtime);
  }
  return runtime;
}

/** Children inside a NotisProvider with the legacy App runtime of `lang`. */
export function LegacyApp({ lang, children }: { lang: SpecimenLang; children: ReactNode }) {
  const runtime = useMemo(() => legacyAppRuntime(lang), [lang]);
  return <NotisProvider runtime={runtime}>{children}</NotisProvider>;
}

/** What the note read says when it fails in the book. */
export const NOTE_READ_FAILED = {
  en: 'Notis could not open this note. Check your connection, then try again.',
  fr: 'Notis n’a pas pu ouvrir cette note. Vérifie ta connexion, puis réessaie.',
} as const;

/** How the document body read behaves in a `noteBodyRuntime`. */
export type NoteBodyBehaviour = 'hangs' | 'fails';

const bodyRuntimes = new Map<string, NotisRuntime>();

/**
 * The book's Space runtime in `lang` whose document body read never answers (`hangs`) or fails (`fails`), with
 * its own cache scope and query client so it never shares a cached body with `bookRuntime`.
 */
export function noteBodyRuntime(lang: SpecimenLang, behaviour: NoteBodyBehaviour): NotisRuntime {
  const key = `${lang}:${behaviour}`;
  let runtime = bodyRuntimes.get(key);
  if (!runtime) {
    const base = createFakeRuntime({ lang, theme: 'light' });
    runtime = {
      ...base,
      space: { ...base.space!, cacheScope: `design-book:${lang}:body-${behaviour}` },
      queryClient: createQueryClient(),
      documentBody: behaviour === 'hangs'
        ? () => new Promise<never>(() => undefined)
        : () => Promise.reject(new Error(NOTE_READ_FAILED[lang])),
    };
    bodyRuntimes.set(key, runtime);
  }
  return runtime;
}
