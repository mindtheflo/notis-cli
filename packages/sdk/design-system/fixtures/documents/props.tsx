/**
 * Props tables for the host-delegated components (DocumentEditor, DocumentPage, MarkdownEditor, RecordProperties,
 * HtmlFrame, ReportFrame, ShareControl). The Portal host draws the real thing, so the book shows the SDK fallback
 * and what a Space can pass. The rows follow the prop types in packages/sdk/src/runtime.ts (the API index has no
 * per-prop data); each table names the declaration it was read from. Inline styles only (fixtures are not scanned
 * by Tailwind); spacing, no rules or borders.
 */
import type { SpecimenCopy, SpecimenLang } from '../../specimen';

export interface PropRow {
  name: string;
  type: string;
  doc: SpecimenCopy;
  /** 'yes', or the name of the other prop that can stand in for it. */
  required?: true | string;
}

export interface PropsSpec {
  /** The TypeScript name of the props type. */
  title: string;
  /** `path:line` of its declaration. */
  source: string;
  rows: readonly PropRow[];
}

const HEAD = {
  prop: { en: 'Prop', fr: 'Prop' },
  type: { en: 'Type', fr: 'Type' },
  doc: { en: 'What it does', fr: 'Ce qu’elle fait' },
  required: { en: 'required', fr: 'obligatoire' },
  oneOf: { en: 'or', fr: 'ou' },
} as const;

const mono = '12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace';
const cell = { padding: '6px 24px 6px 0', verticalAlign: 'top', textAlign: 'left' } as const;

/**
 * Below 560 px of its own width a props table reads as a list: the prop and its type on one line, what it does
 * under them, so a phone reads every column without scrolling sideways. Rendered with the table (fixtures are not
 * scanned by Tailwind); the rules are marked important to win over the cells' inline styles.
 */
const NARROW_CSS = '.ds-props-wrap{container-type:inline-size}'
  + '@container (max-width:560px){'
  + '.ds-props-table thead{display:none}'
  + '.ds-props-table tr{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:12px;row-gap:4px;padding:8px 0}'
  + '.ds-props-table td{padding:0!important;min-width:0!important;max-width:none!important}'
  + '.ds-props-table td[data-ds-props-doc]{grid-column:1/-1}'
  + '}';

export function PropsTable({ spec, lang }: { spec: PropsSpec; lang: SpecimenLang }) {
  return (
    <section data-ds-props={spec.title} style={{ display: 'grid', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px' }}>
        <h3 style={{ margin: 0, font: '600 14px/1.4 inherit', color: 'hsl(var(--foreground))' }}>{spec.title}</h3>
        <code style={{ font: mono, color: 'hsl(var(--muted-foreground))' }}>{spec.source}</code>
      </div>
      <style>{NARROW_CSS}</style>
      <div className="ds-props-wrap" style={{ overflowX: 'auto' }}>
        <table className="ds-props-table" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, lineHeight: 1.5 }}>
          <thead>
            <tr style={{ color: 'hsl(var(--muted-foreground))', fontSize: 12 }}>
              <th scope="col" style={{ ...cell, fontWeight: 500 }}>{HEAD.prop[lang]}</th>
              <th scope="col" style={{ ...cell, fontWeight: 500 }}>{HEAD.type[lang]}</th>
              <th scope="col" style={{ ...cell, fontWeight: 500, paddingRight: 0 }}>{HEAD.doc[lang]}</th>
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((row) => (
              <tr key={row.name}>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                  <code style={{ font: mono, color: 'hsl(var(--foreground))' }}>{row.name}</code>
                  {row.required ? (
                    <span style={{ display: 'block', fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>
                      {row.required === true ? HEAD.required[lang] : `${HEAD.required[lang]}, ${HEAD.oneOf[lang]} ${row.required}`}
                    </span>
                  ) : null}
                </td>
                <td style={{ ...cell, minWidth: 140, maxWidth: 300, overflowWrap: 'anywhere' }}>
                  <code style={{ font: mono, color: 'hsl(var(--muted-foreground))' }}>{row.type}</code>
                </td>
                <td data-ds-props-doc="" style={{ ...cell, paddingRight: 0, minWidth: 220, color: 'hsl(var(--foreground))' }}>{row.doc[lang]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const RUNTIME = 'packages/sdk/src/runtime.ts';

const recordKey: PropRow = {
  name: 'recordKey',
  type: 'string',
  required: true,
  doc: {
    en: 'Stable native record key, authorized through this Space’s declared databases.',
    fr: 'Clé stable de l’enregistrement natif, autorisée par les bases de données déclarées de ce Space.',
  },
};

const className: PropRow = {
  name: 'className',
  type: 'string',
  doc: { en: 'Classes on the outer element.', fr: 'Classes ajoutées à l’élément extérieur du composant.' },
};

const readOnly: PropRow = {
  name: 'readOnly',
  type: 'boolean',
  doc: { en: 'Shows the record without editing.', fr: 'Affiche l’enregistrement sans permettre de le modifier.' },
};

const onDirtyChange: PropRow = {
  name: 'onDirtyChange',
  type: '(dirty: boolean) => void',
  doc: {
    en: 'Called when unsaved changes appear and when they are saved.',
    fr: 'Appelée quand des modifications non enregistrées apparaissent, puis quand elles sont enregistrées.',
  },
};

const onSavingChange: PropRow = {
  name: 'onSavingChange',
  type: '(saving: boolean) => void',
  doc: { en: 'Called when a save starts and when it ends.', fr: 'Appelée quand un enregistrement commence, puis quand il se termine.' },
};

export const DOCUMENT_EDITOR_PROPS: PropsSpec = {
  title: 'NotisDocumentEditorProps',
  source: `${RUNTIME}:244`,
  rows: [
    { ...recordKey, required: 'documentId', doc: {
      en: 'Stable native record key, authorized through this Space’s declared databases. A Space passes this.',
      fr: 'Clé stable de l’enregistrement natif, autorisée par les bases de données déclarées de ce Space. Un Space passe celle-ci.',
    } },
    { name: 'documentId', type: 'string', required: 'recordKey', doc: {
      en: 'Legacy Apps only. Spaces use recordKey.',
      fr: 'Applications historiques uniquement. Les Spaces utilisent recordKey.',
    } },
    { name: 'variant', type: "'full' | 'body'", doc: {
      en: "'full' shows the icon, title and cover above the content; 'body' shows the content only.",
      fr: "'full' affiche l’icône, le titre et la couverture au-dessus du contenu\u202f; 'body' n’affiche que le contenu.",
    } },
    { name: 'showProperties', type: 'boolean', doc: {
      en: 'Shows the database properties above the body. Default true.',
      fr: 'Affiche les propriétés de la base de données au-dessus du corps. Vrai par défaut.',
    } },
    readOnly,
    className,
    onDirtyChange,
    onSavingChange,
  ],
};

export const RECORD_PROPERTIES_PROPS: PropsSpec = {
  title: 'NotisRecordPropertiesProps',
  source: `${RUNTIME}:258`,
  rows: [recordKey, readOnly, onSavingChange, className],
};

export const HTML_FRAME_PROPS: PropsSpec = {
  title: 'NotisHtmlFrameProps',
  source: `${RUNTIME}:264`,
  rows: [
    { ...recordKey, required: 'html', doc: {
      en: 'Loads a signed-in record whose page is HTML.',
      fr: 'Charge un enregistrement accessible une fois connecté, dont la page est en HTML.',
    } },
    { name: 'html', type: 'string', required: 'recordKey', doc: {
      en: 'Inline HTML, for declared Site read actions. The host applies its viewer CSP and an opaque-origin sandbox.',
      fr: 'HTML en ligne, pour les actions de lecture déclarées d’un Site. L’hôte applique sa CSP de visionneuse et un bac à sable d’origine opaque.',
    } },
    { name: 'title', type: 'string', doc: { en: 'The frame’s accessible title.', fr: 'Le titre accessible du cadre, lu par les lecteurs d’écran.' } },
    className,
  ],
};

export const REPORT_FRAME_PROPS: PropsSpec = {
  title: 'NotisReportFrameProps',
  source: `${RUNTIME}:268`,
  rows: [recordKey, className],
};

export const SHARE_CONTROL_PROPS: PropsSpec = {
  title: 'NotisShareControlProps',
  source: `${RUNTIME}:269`,
  rows: [
    { ...recordKey, doc: {
      en: 'The record whose Site is shared: private or shared state, copy link and revoke.',
      fr: 'L’enregistrement dont le Site est partagé\u202f: état privé ou partagé, copie du lien et révocation.',
    } },
    className,
  ],
};

export const DOCUMENT_PAGE_PROPS: PropsSpec = {
  title: 'NotisDocumentPageProps',
  source: `${RUNTIME}:307`,
  rows: [
    recordKey,
    { name: 'breadcrumb', type: '{ label; onSelect? }[] | false', doc: {
      en: 'Crumbs before the record title, usually a way back to the list. false hides the breadcrumb.',
      fr: 'Éléments avant le titre de l’enregistrement, souvent un retour vers la liste. false masque le fil d’Ariane.',
    } },
    { name: 'actions', type: 'ReactNode', doc: {
      en: 'Extra toolbar buttons, before Share and the ... menu.',
      fr: 'Boutons supplémentaires dans la barre d’outils, avant Partager et le menu ....',
    } },
    { name: 'menuItems', type: '{ label; onSelect; destructive?; disabled? }[]', doc: {
      en: 'Extra ... menu entries. Plain toolbar buttons on hosts without DocumentPage.',
      fr: 'Entrées supplémentaires du menu .... Simples boutons de la barre d’outils sur les hôtes sans DocumentPage.',
    } },
    { name: 'share', type: 'boolean', doc: {
      en: 'Offers the record’s Site. Off by default.',
      fr: 'Propose le Site de l’enregistrement. Désactivé par défaut.',
    } },
    { name: 'header', type: 'false | { cover?; icon?; title?; compact? }', doc: {
      en: 'Which header parts show. false hides cover, icon and title. compact sets the title at the reader size (20/28).',
      fr: 'Les parties de l’en-tête affichées. false masque la couverture, l’icône et le titre. compact met le titre à la taille du lecteur (20/28).',
    } },
    { name: 'meta', type: 'boolean', doc: {
      en: 'Shows the meta strip (editable, type, database, dates). Default true.',
      fr: 'Affiche la bande d’informations (modifiable, type, base, dates). Vrai par défaut.',
    } },
    { name: 'properties', type: "'panel' | 'hidden' | { include?; exclude?; order? }", doc: {
      en: "'panel' puts them in the Configure panel, 'hidden' shows none, or choose and order them.",
      fr: "'panel' les place dans le panneau Configurer, 'hidden' n’en montre aucune, ou choisis-les et ordonne-les.",
    } },
    { name: 'aboveBody', type: 'ReactNode', doc: { en: 'Rendered between the properties and the body.', fr: 'Affiché entre les propriétés et le corps du document.' } },
    { name: 'belowBody', type: 'ReactNode', doc: { en: 'Rendered under the body.', fr: 'Affiché sous le corps du document.' } },
    { name: 'width', type: "'standard' | 'wide' | 'full'", doc: {
      en: 'Column width: standard (900px), wide (1200px) or full.',
      fr: 'Largeur de la colonne\u202f: standard (900 px), large (1200 px) ou pleine largeur.',
    } },
    { name: 'viewer', type: "'html'", doc: {
      en: 'The record’s one stored .html file is the page, full height under the toolbar.',
      fr: 'Le seul fichier .html enregistré est la page, sur toute la hauteur sous la barre d’outils.',
    } },
    readOnly,
    onDirtyChange,
    onSavingChange,
    { name: 'onSaved', type: '({ recordKey, title }) => void', doc: {
      en: 'Called after a save is confirmed, so the Space can refresh its lists.',
      fr: 'Appelée après la confirmation d’un enregistrement, pour que le Space actualise ses listes.',
    } },
    { name: 'layout', type: '(parts) => ReactNode', doc: {
      en: 'Rearranges Toolbar, Header, Meta, Properties and Body. aboveBody and belowBody are then not drawn.',
      fr: 'Réorganise Toolbar, Header, Meta, Properties et Body. aboveBody et belowBody ne sont alors plus affichés.',
    } },
    className,
  ],
};

export const MARKDOWN_EDITOR_PROPS: PropsSpec = {
  title: 'NotisMarkdownEditorProps',
  source: `${RUNTIME}:366`,
  rows: [
    { name: 'value', type: 'string', required: true, doc: { en: 'The Markdown to edit.', fr: 'Le Markdown à modifier dans l’éditeur.' } },
    { name: 'resourceKey', type: 'string', doc: {
      en: 'Stable identity of the edited resource. Changing it starts a fresh editor.',
      fr: 'Identité stable de la ressource modifiée. La changer ouvre un nouvel éditeur vierge.',
    } },
    { name: 'revision', type: 'string | null', doc: {
      en: 'The stored revision, sent back with each save as expectedRevision.',
      fr: 'La révision enregistrée, renvoyée avec chaque enregistrement comme expectedRevision.',
    } },
    readOnly,
    { name: 'autosaveMs', type: 'number', doc: {
      en: 'Delay before an automatic save after the last edit. Fallback: 1500, at least 250.',
      fr: 'Délai avant l’enregistrement automatique après la dernière modification. Par défaut\u202f: 1500, au moins 250.',
    } },
    { name: 'placeholder', type: 'string', doc: {
      en: 'Shown while the document is empty.',
      fr: 'Affiché tant que le document est vide.',
    } },
    className,
    { name: 'onChange', type: '(markdown: string) => void', doc: { en: 'Called on every edit.', fr: 'Appelée à chaque modification du texte.' } },
    { name: 'onUploadFile', type: '(file: File) => Promise<string>', doc: {
      en: 'Persists an uploaded media or file block and returns its durable URL.',
      fr: 'Enregistre un média ou un fichier importé et renvoie son adresse durable.',
    } },
    { name: 'onSave', type: '({ markdown, expectedRevision }) => Promise<{ revision? } | void>', doc: {
      en: 'The app owns persistence: called after autosaveMs and on Cmd+S.',
      fr: 'L’application gère l’enregistrement\u202f: appelée après autosaveMs et sur Cmd+S.',
    } },
    onDirtyChange,
    onSavingChange,
  ],
};

/** Several props tables, one under the other. */
export function PropsTables({ specs, lang }: { specs: readonly PropsSpec[]; lang: SpecimenLang }) {
  return (
    <div style={{ display: 'grid', gap: 32 }}>
      {specs.map((spec) => <PropsTable key={spec.title} spec={spec} lang={lang} />)}
    </div>
  );
}
