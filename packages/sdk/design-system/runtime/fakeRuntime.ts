/**
 * The book's fake runtime (design review spec, section 3.6).
 *
 * A Space runtime with fixed identity, the fixture databases and records, and no host UI (`ui` undefined),
 * so host-delegated components render the SDK fallback a Space sees without a host. Actions reject with a
 * fixed `SpaceActionError` so error states are reachable; nothing reaches the network.
 */
import { SpaceActionError, createQueryClient, type NotisRuntime } from '../../src';
import { FIXTURE_DATABASES, fixtureMarkdown, fixtureRecords } from '../fixtures';
import type { SpecimenLang, SpecimenTheme } from '../specimen';

export interface FakeRuntimeOptions {
  lang: SpecimenLang;
  theme: SpecimenTheme;
}

export const FAKE_SPACE_ID = 'space-design-book';
export const FAKE_SPACE_REVISION = 1;
export const FAKE_REQUEST_ID = 'ds-request-0001';

export const FAKE_ACTION_ERROR_MESSAGE = {
  en: 'This action is not available in the design book.',
  fr: "Cette action n’est pas disponible dans le catalogue du design.",
} as const;

/** The fixed error every action rejects with. */
export function fakeActionError(lang: SpecimenLang): SpaceActionError {
  return new SpaceActionError(FAKE_ACTION_ERROR_MESSAGE[lang], FAKE_REQUEST_ID, undefined, 'failed', undefined, 'design_book');
}

function unavailable(what: string): Promise<never> {
  return Promise.reject(new Error(`${what} is not available in the design book.`));
}

export function createFakeRuntime({ lang, theme }: FakeRuntimeOptions): NotisRuntime {
  const records = fixtureRecords(lang);
  return {
    resource: { kind: 'space', id: FAKE_SPACE_ID, revision: FAKE_SPACE_REVISION, name: 'Design book', icon: 'layout' },
    space: {
      id: FAKE_SPACE_ID,
      revision: FAKE_SPACE_REVISION,
      cacheScope: `design-book:${lang}:${theme}`,
      actions: {},
      bindings: {},
    },
    app: { id: FAKE_SPACE_ID, name: 'Design book', icon: 'layout', description: null },
    route: { slug: 'book', path: '/', name: 'Book', default: true },
    databases: FIXTURE_DATABASES,
    context: { locale: lang, selection: null, params: {} },
    queryClient: createQueryClient(),
    ui: undefined,
    callAction: () => Promise.reject(fakeActionError(lang)),
    documentBody: async (request) => {
      if (request.operation !== 'read') throw fakeActionError(lang);
      const record = records.find((item) => item.recordKey === request.recordKey) ?? records[0];
      return { record_key: request.recordKey, title: record.title, revision: 1, schema_revision: 1, content_markdown: fixtureMarkdown(lang) };
    },
    listTools: () => unavailable('listTools'),
    callTool: () => unavailable('callTool'),
    request: () => unavailable('request'),
  };
}
