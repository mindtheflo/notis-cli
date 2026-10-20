import { useCallback, useState } from 'react';
import { defineSpecimen, type SpecimenCopy, type SpecimenLang } from '../../specimen';
import { Markdown, NotisProvider, ViewSkeleton, useNativeDocumentBody, useNotisRuntime } from '../../../src';
import { Button, Notice } from '../../../src/ui/index';
import { w } from '../../../src/words/index';
import { InLanguages, bookRuntime, noteBodyRuntime } from '../../fixtures/documents/runtimes';
import { clickOn, waitFor } from '../../fixtures/documents/interact';
import { Code, Example, Readout, Stack } from '../../fixtures/documents/layout';
import { PropsTable, type PropsSpec } from '../../fixtures/documents/props';

/** The note every state reads: task-1 of the fixture tasks database (Ship the new onboarding). */
const RECORD_KEY = 'tasks:task-1';
const READ = { readAction: 'read_note' } as const;

const LOADING_NOTE = w('Loading the note', 'Chargement de la note');

const COPY = {
  revision: { en: 'revision', fr: 'révision' },
  noHost: {
    en: 'undefined: no host here, so host-delegated components draw their fallback',
    fr: 'undefined : pas d’hôte ici, les composants délégués à l’hôte affichent leur version de repli',
  },
  guarded: {
    en: 'replaced by the Space guard (declared actions only)',
    fr: 'remplacés par la protection du Space (actions déclarées uniquement)',
  },
  noActions: { en: 'none declared', fr: 'aucune déclarée' },
  sendEmail: { en: 'Send an email with Gmail', fr: 'Envoyer un e-mail avec Gmail' },
  archive: { en: 'Archive this note', fr: 'Archiver cette note' },
  rejected: { en: 'The call rejected with:', fr: 'L’appel a échoué avec :' },
  reported: { en: 'onProtocolError received:', fr: 'onProtocolError a reçu :' },
  notCalled: { en: 'not called yet', fr: 'pas encore appelé' },
  noCalls: { en: 'nothing yet', fr: 'rien pour l’instant' },
  nullRuntime: {
    en: 'The host has not given the runtime yet: the view shows its skeleton until it does.',
    fr: 'L’hôte n’a pas encore fourni le runtime : la vue affiche son squelette en attendant.',
  },
} satisfies Record<string, SpecimenCopy>;

/** The props of NotisProvider, read from packages/sdk/src/provider.tsx. */
const NOTIS_PROVIDER_PROPS: PropsSpec = {
  title: 'NotisProvider',
  source: 'packages/sdk/src/provider.tsx:28',
  rows: [
    {
      name: 'runtime', type: 'NotisRuntime | null', required: true,
      doc: {
        en: 'The runtime the host injects. null while it is not ready (hooks wait); leaving it out throws. In a Space the provider wraps it in the Space guard.',
        fr: 'Le runtime que l’hôte fournit. null tant qu’il n’est pas prêt (les hooks attendent) ; l’omettre lève une erreur. Dans un Space, le fournisseur l’enveloppe dans la protection du Space.',
      },
    },
    {
      name: 'children', type: 'ReactNode', required: true,
      doc: { en: 'The view. Every hook and component under it reads this runtime.', fr: 'La vue. Chaque hook et composant en dessous lit ce runtime.' },
    },
    {
      name: 'onProtocolError', type: '(error: Error) => void',
      doc: {
        en: 'Told when the Space guard refuses a call (an account tool, a backend request, an undeclared action). Keep it stable: a new function rebuilds the guard.',
        fr: 'Prévenu quand la protection du Space refuse un appel (un outil du compte, une requête au serveur, une action non déclarée). Garde-la stable : une nouvelle fonction reconstruit la protection.',
      },
    },
    {
      name: 'shortcutsAvailable', type: '() => boolean',
      doc: {
        en: 'Whether the view’s keyboard shortcuts may run now (false while a host dialog has focus).',
        fr: 'Indique si les raccourcis clavier de la vue peuvent s’exécuter (false quand une fenêtre de l’hôte a le focus).',
      },
    },
  ],
};

/** What children read from the provider: the runtime's identity, locale, databases and transports. */
function RuntimeFacts({ lang }: { lang: SpecimenLang }) {
  const runtime = useNotisRuntime();
  if (!runtime) return null;
  const actions = Object.keys(runtime.space?.actions ?? {});
  const facts: Array<[string, string]> = [
    ['resource', `${runtime.resource?.kind ?? 'app'}, ${runtime.resource?.name ?? runtime.app.name}, ${COPY.revision[lang]} ${runtime.resource?.revision ?? 1}`],
    ['route', `${runtime.route.name} (${runtime.route.path})`],
    ['context.locale', runtime.context.locale ?? 'en'],
    ['databases', runtime.databases.map((database) => `${database.title} (${database.slug})`).join(', ')],
    ['space.actions', actions.length ? actions.join(', ') : COPY.noActions[lang]],
    ['ui', runtime.ui ? 'host UI' : COPY.noHost[lang]],
    ['callTool, request, listTools', runtime.resource?.kind === 'space' ? COPY.guarded[lang] : 'host transport'],
  ];
  return (
    <dl className="m-0 grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-y-2">
      {facts.map(([name, value]) => (
        <div key={name} className="contents">
          <dt className="font-mono text-xs leading-6 text-muted-foreground">{name}</dt>
          <dd className="m-0 mb-2 text-foreground sm:mb-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A note read through the provider: skeleton while it loads, a retryable notice when it fails, then the body. */
function NoteBody({ size }: { size?: 'sm' | 'base' }) {
  const { body, loading, error, refetch } = useNativeDocumentBody('notes', RECORD_KEY, READ);
  if (loading) return <ViewSkeleton variant="detail" rows={6} label={LOADING_NOTE} />;
  if (error) return <Notice tone="danger" onRetry={() => { void refetch(); }}>{error.message}</Notice>;
  if (!body) return null;
  return (
    <article className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      {body.title ? <h2 className="m-0 text-xl font-semibold text-foreground">{body.title}</h2> : null}
      <Markdown value={body.content_markdown.replace(/^# .*\n\n/, '')} size={size} />
    </article>
  );
}

const CODE_BODY = `const { body, loading, error } = useNativeDocumentBody('notes', '${RECORD_KEY}', { readAction: 'read_note' });`;

/** One refused call: the button, then what the promise rejected with. */
function RefusedCall({ lang, kind }: { lang: SpecimenLang; kind: 'tool' | 'action' }) {
  const runtime = useNotisRuntime();
  const [rejected, setRejected] = useState<string | null>(null);
  const call = () => {
    if (!runtime) return;
    const pending = kind === 'tool'
      ? runtime.callTool('GMAIL_SEND_EMAIL', { to: 'sam@acme.studio', subject: 'June launch' })
      : runtime.callAction?.('archive_note', { recordKey: RECORD_KEY }, { readOnly: true }) ?? Promise.resolve();
    pending.then(() => setRejected(null), (error: unknown) => setRejected(error instanceof Error ? error.message : String(error)));
  };
  const code = kind === 'tool'
    ? "runtime.callTool('GMAIL_SEND_EMAIL', { to, subject })"
    : "runtime.callAction('archive_note', { recordKey }, { readOnly: true })";
  return (
    <Example caption={<Code>{code}</Code>}>
      <Stack gap={8}>
        <div>
          <Button size="sm" icon={kind === 'tool' ? 'envelope-simple' : 'archive'} data-ds-call={kind} onClick={call}>
            {kind === 'tool' ? COPY.sendEmail[lang] : COPY.archive[lang]}
          </Button>
        </div>
        <Readout label={COPY.rejected[lang]}>{rejected ?? COPY.notCalled[lang]}</Readout>
      </Stack>
    </Example>
  );
}

/** A provider with onProtocolError: the guard refuses account-wide calls and reports each refusal. */
function GuardedCalls({ lang }: { lang: SpecimenLang }) {
  const [reports, setReports] = useState<string[]>([]);
  const onProtocolError = useCallback((error: Error) => setReports((previous) => [...previous, error.message]), []);
  return (
    <NotisProvider runtime={bookRuntime(lang)} onProtocolError={onProtocolError}>
      <Stack gap={24}>
        <RefusedCall lang={lang} kind="tool" />
        <RefusedCall lang={lang} kind="action" />
        <div data-ds-reports={reports.length}>
          <Readout label={COPY.reported[lang]}>{reports.length ? null : COPY.noCalls[lang]}</Readout>
          {reports.length ? (
            <ol className="m-0 mt-2 grid gap-1 pl-5 text-sm text-foreground">
              {reports.map((message, index) => <li key={index}>{message}</li>)}
            </ol>
          ) : null}
        </div>
      </Stack>
    </NotisProvider>
  );
}

/** Children of a provider whose runtime is still null: what the hooks return and what the view shows. */
function WithoutRuntime({ lang }: { lang: SpecimenLang }) {
  const runtime = useNotisRuntime();
  const { body, loading, error } = useNativeDocumentBody('notes', RECORD_KEY, READ);
  const hook = `{ loading: ${String(loading)}, body: ${body ? 'loaded' : 'undefined'}, error: ${error ? 'Error' : 'null'} }`;
  return (
    <Stack gap={16}>
      <Stack gap={4}>
        <Readout label={<Code>{'useNotisRuntime()'}</Code>}>{String(runtime)}</Readout>
        <Readout label={<Code>{'useNativeDocumentBody(...)'}</Code>}>{hook}</Readout>
      </Stack>
      <p className="m-0 text-sm text-muted-foreground">{COPY.nullRuntime[lang]}</p>
      {runtime ? null : <ViewSkeleton variant="detail" rows={4} label={LOADING_NOTE} locale={lang} />}
    </Stack>
  );
}

export const specimen = defineSpecimen({
  id: 'notis-provider',
  name: 'NotisProvider',
  group: 'documents',
  from: '@notis/sdk',
  covers: ['NotisProvider'],
  summary: 'Gives the host’s runtime to a view: every hook and component under it reads that Space, its locale and its data. In a Space it also guards the calls a view may make.',
  states: [
    {
      id: 'runtime',
      label: 'What children read: useNotisRuntime() inside the provider',
      render: ({ lang }) => (
        <Example caption={<Code>{'<NotisProvider runtime={runtime}><View /></NotisProvider>'}</Code>} width={760}>
          <NotisProvider runtime={bookRuntime(lang)}><RuntimeFacts lang={lang} /></NotisProvider>
        </Example>
      ),
    },
    {
      id: 'document-body',
      label: 'A hook reading through the provider: the note body',
      render: ({ lang }) => (
        <Example caption={<Code>{CODE_BODY}</Code>} width={760}>
          <NotisProvider runtime={bookRuntime(lang)}><NoteBody /></NotisProvider>
        </Example>
      ),
    },
    {
      id: 'loading',
      label: 'Loading: the read has not answered yet',
      render: ({ lang }) => (
        <Example caption={<Code>{'loading: true  ->  <ViewSkeleton variant="detail" label={...} />'}</Code>} width={760}>
          <NotisProvider runtime={noteBodyRuntime(lang, 'hangs')}><NoteBody /></NotisProvider>
        </Example>
      ),
    },
    {
      id: 'error',
      label: 'Error: the read failed (the notice retries it)',
      render: ({ lang }) => (
        <Example caption={<Code>{'error  ->  <Notice tone="danger" onRetry={refetch}>{error.message}</Notice>'}</Code>} width={760}>
          <NotisProvider runtime={noteBodyRuntime(lang, 'fails')}><NoteBody /></NotisProvider>
        </Example>
      ),
    },
    {
      id: 'languages',
      label: 'Two providers on one page: each subtree follows its own runtime and locale',
      render: () => (
        <InLanguages minColumn={360}>
          {(lang) => (
            <Stack gap={20}>
              <RuntimeFacts lang={lang} />
              <NoteBody size="sm" />
            </Stack>
          )}
        </InLanguages>
      ),
    },
    {
      id: 'protocol-guard',
      label: 'In a Space: account tools and undeclared actions are refused and reported to onProtocolError',
      render: ({ lang }) => (
        <Example caption={<Code>{'<NotisProvider runtime={runtime} onProtocolError={report}>'}</Code>} width={760}>
          <GuardedCalls lang={lang} />
        </Example>
      ),
      interact: async (root) => {
        await clickOn(root, '[data-ds-call="tool"]');
        await clickOn(root, '[data-ds-call="action"]');
        await waitFor(root, '[data-ds-reports="2"]');
      },
    },
    {
      id: 'no-runtime',
      label: 'runtime={null}: the host is not ready yet',
      render: ({ lang }) => (
        <Example caption={<Code>{'<NotisProvider runtime={null}><View /></NotisProvider>'}</Code>} width={760}>
          <NotisProvider runtime={null}><WithoutRuntime lang={lang} /></NotisProvider>
        </Example>
      ),
    },
    {
      id: 'narrow',
      label: 'At 390 px: what children read and the note body',
      width: 390,
      render: ({ lang }) => (
        <NotisProvider runtime={bookRuntime(lang)}>
          <Stack gap={24}>
            <RuntimeFacts lang={lang} />
            <NoteBody />
          </Stack>
        </NotisProvider>
      ),
    },
    {
      id: 'props',
      label: 'Props',
      render: ({ lang }) => <PropsTable spec={NOTIS_PROVIDER_PROPS} lang={lang} />,
    },
  ],
});
