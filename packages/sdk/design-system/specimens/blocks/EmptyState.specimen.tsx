import { defineSpecimen } from '../../specimen';
import { BLOCK_WORDS, Button, EmptyState } from '../../../src/ui/index';
import { SHELL_WORDS, fillWords, w } from '../../../src/words/index';

const NO_AUTOMATIONS = {
  title: w('No automations yet', 'Aucune automatisation pour l’instant'),
  body: w(
    'Ask Notis in the chat to do something on a schedule, or create one here.',
    'Demande à Notis dans le chat de faire quelque chose à heure fixe, ou crée-en une ici.',
  ),
  action: w('New automation', 'Nouvelle automatisation'),
};

const NO_MATCH = {
  title: w('No skills match “{query}”', 'Aucune compétence ne correspond à « {query} »'),
  body: w('Check the spelling or clear the search.', 'Vérifie l’orthographe ou efface la recherche.'),
};

export const specimen = defineSpecimen({
  id: 'empty-state',
  name: 'EmptyState',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['EmptyState'],
  summary: 'What a list or panel shows when it has nothing: a title, an optional line and one action.',
  states: [
    {
      id: 'default',
      label: 'No props: the default title from BLOCK_WORDS',
      render: () => <EmptyState />,
    },
    {
      id: 'title-body',
      label: 'Default title and body',
      render: () => <EmptyState title={BLOCK_WORDS.emptyTitle} body={BLOCK_WORDS.emptyBody} />,
    },
    {
      id: 'icon-action',
      label: 'An empty Automations page: icon, words and the primary action',
      render: () => (
        <EmptyState icon="clock-countdown" title={NO_AUTOMATIONS.title} body={NO_AUTOMATIONS.body}
          action={<Button variant="primary" icon="plus">{NO_AUTOMATIONS.action}</Button>} />
      ),
    },
    {
      id: 'no-match',
      label: 'A search with no result, with Clear',
      render: () => (
        <EmptyState title={fillWords(NO_MATCH.title, { query: 'invoice' })} body={NO_MATCH.body}
          action={<Button variant="ghost" icon="x">{SHELL_WORDS.clear}</Button>} />
      ),
    },
    {
      id: 'narrow',
      label: 'Narrow (390px) with the long French body',
      width: 390,
      render: () => (
        <EmptyState icon="clock-countdown" title={NO_AUTOMATIONS.title} body={NO_AUTOMATIONS.body}
          action={<Button variant="primary" icon="plus">{NO_AUTOMATIONS.action}</Button>} />
      ),
    },
  ],
});
