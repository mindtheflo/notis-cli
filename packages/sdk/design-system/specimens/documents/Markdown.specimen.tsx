import type { AnchorHTMLAttributes } from 'react';
import { defineSpecimen, type SpecimenCopy } from '../../specimen';
import { Markdown } from '../../../src';
import { fixtureMarkdown, LONG_TEXT } from '../../fixtures';
import { Code, Columns, Example, Outline, Stack } from '../../fixtures/documents/layout';

/** Inline formatting a note body uses: emphasis, links (internal and external), nested and ordered lists. */
const INLINE: SpecimenCopy = {
  en: `## Meeting notes, 15 June

Sam owns the **help centre screenshots**, Alex reviews the *French copy* by Friday. ~~Record a demo video~~ is out of scope.

Run \`notis spaces verify\` before the review. The decision is in [Ship the new onboarding](?note=tasks:task-1); the brief lives on [notis.ai](https://notis.ai).

1. Freeze the copy
2. Take the screenshots
   - Mobile, 390 px
   - Desktop, 1440 px
3. Send the email to the beta group

### Open questions

- Do we keep the old welcome email?
- Who answers replies over the weekend?`,
  fr: `## Notes de réunion, 15 juin

Sam s’occupe des **captures d’écran du centre d’aide**, Alex relit les *textes en français* d’ici vendredi. ~~Enregistrer une vidéo de démonstration~~ ne fait pas partie du périmètre.

Lance \`notis spaces verify\` avant la relecture. La décision se trouve dans [Livrer le nouvel accueil des comptes](?note=tasks:task-1)\u202f; le brief est sur [notis.ai](https://notis.ai).

1. Figer les textes
2. Prendre les captures d’écran
   - Mobile, 390 px
   - Ordinateur, 1440 px
3. Envoyer l’e-mail au groupe de testeurs

### Questions ouvertes

- Garde-t-on l’ancien e-mail de bienvenue\u202f?
- Qui répond aux messages pendant le week-end\u202f?`,
};

/** A short comment as it shows in a list row or a card, at size sm. */
const COMMENT: SpecimenCopy = {
  en: 'Moved the launch to **Monday** so Alex can finish the review. See [the checklist](?note=tasks:task-1).',
  fr: 'Lancement déplacé à **lundi** pour qu’Alex termine la relecture. Voir [la liste de contrôle](?note=tasks:task-1).',
};

const DIGEST: SpecimenCopy = {
  en: '**3 tasks** are due this week. `Ship the new onboarding` is the only one at risk.',
  fr: '**3 tâches** arrivent à échéance cette semaine. `Livrer le nouvel accueil des comptes` est la seule en retard.',
};

/** A wide table in a long paragraph, to show wrapping and horizontal overflow on a phone. */
const LONG: SpecimenCopy = {
  en: `${LONG_TEXT.en}

| Account | Plan | Seats | Renewal | Owner |
| --- | --- | --- | --- | --- |
| Acme Studio | Team | 12 | 1 July 2026 | Sam |
| Northwind Travel | Business | 48 | 15 September 2026 | Alex |`,
  fr: `${LONG_TEXT.fr}

| Compte | Formule | Places | Renouvellement | Responsable |
| --- | --- | --- | --- | --- |
| Acme Studio | Équipe | 12 | 1er juillet 2026 | Sam |
| Northwind Travel | Entreprise | 48 | 15 septembre 2026 | Alex |`,
};

/**
 * A Space's link override: `?note=` links open the record inside the Space instead of navigating. The book marks
 * them with `data-record-key` so the reviewer can see which links the override took.
 */
function RecordLink({ href, children, node: _node, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
  const recordKey = typeof href === 'string' && href.startsWith('?note=') ? href.slice('?note='.length) : null;
  if (!recordKey) return <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>{children}</a>;
  return (
    <a href={href} data-record-key={recordKey} onClick={(event) => event.preventDefault()} {...rest}
      className="font-medium underline decoration-dotted underline-offset-4">
      {children}
    </a>
  );
}

const CODE_DEFAULT = '<Markdown value={note.body} />';

/** What the inline state's links show: https links get target="_blank", relative ones (?note=) stay in place. */
const LINKS_NOTE: SpecimenCopy = {
  en: 'https links open in a new tab (target="_blank"); ?note= links stay in place.',
  fr: 'Les liens https s’ouvrent dans un nouvel onglet (target="_blank")\u202f; les liens ?note= restent sur place.',
};

export const specimen = defineSpecimen({
  id: 'markdown',
  name: 'Markdown',
  group: 'documents',
  from: '@notis/sdk',
  covers: ['Markdown'],
  summary: 'Renders a Markdown value (a note body, a long text field, generated text) with Notis typography.',
  states: [
    {
      id: 'document',
      label: 'A document: headings, task list, table, quote, code',
      render: ({ lang }) => (
        <Example caption={<Code>{CODE_DEFAULT}</Code>} width={760}>
          <Markdown value={fixtureMarkdown(lang)} />
        </Example>
      ),
    },
    {
      id: 'inline',
      label: 'Inline formatting, links and nested lists',
      render: ({ t }) => (
        <Example caption={<Code>{t(LINKS_NOTE)}</Code>} width={760}>
          <Markdown value={t(INLINE)} />
        </Example>
      ),
    },
    {
      id: 'size-sm',
      label: 'size="sm" in dense surfaces (a comment, a digest line) next to the base size',
      render: ({ t }) => (
        <Columns min={300}>
          <Example caption={<Code>{'size="sm"'}</Code>}>
            <Stack gap={12}>
              <Markdown size="sm" value={t(COMMENT)} />
              <Markdown size="sm" value={t(DIGEST)} />
            </Stack>
          </Example>
          <Example caption={<Code>{'size="base" (default)'}</Code>}>
            <Stack gap={12}>
              <Markdown value={t(COMMENT)} />
              <Markdown value={t(DIGEST)} />
            </Stack>
          </Example>
        </Columns>
      ),
    },
    {
      id: 'components',
      label: 'Custom components: a Space opens ?note= links as records',
      render: ({ t }) => (
        <Example caption={<Code>{'<Markdown value={body} components={{ a: RecordLink }} />'}</Code>} width={760}>
          <Markdown value={t(INLINE)} components={{ a: RecordLink }} />
        </Example>
      ),
    },
    {
      id: 'empty',
      label: 'Empty value (draws nothing; the ring marks its box)',
      render: () => (
        <Example caption={<Code>{'<Markdown value="" />'}</Code>} width={480}>
          <Outline><Markdown value="" /></Outline>
        </Example>
      ),
    },
    {
      id: 'narrow',
      label: 'Long text and a wide table at 390 px',
      width: 390,
      render: ({ t }) => (
        <Example caption={<Code>{CODE_DEFAULT}</Code>}>
          <Markdown value={t(LONG)} />
        </Example>
      ),
    },
  ],
});
