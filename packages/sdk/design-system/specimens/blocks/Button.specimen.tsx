import { useState, type ReactNode } from 'react';
import { defineSpecimen } from '../../specimen';
import { Button } from '../../../src/ui/index';
import { SHELL_WORDS, STANDARD_ACTIONS, STANDARD_ACTION_IDS, w, type Words } from '../../../src/words/index';

const VARIANTS = ['default', 'primary', 'secondary', 'ghost', 'link', 'danger'] as const;
const SIZES = ['sm', 'md', 'lg'] as const;

/** What each variant is for on a Notis page, in both languages. */
const VARIANT_LABEL: Record<typeof VARIANTS[number], Words> = {
  default: w('Duplicate', 'Dupliquer'),
  primary: w('New automation', 'Nouvelle automatisation'),
  secondary: w('Run now', 'Lancer maintenant'),
  ghost: w('Cancel', 'Annuler'),
  link: w('View run history', 'Voir l’historique'),
  danger: STANDARD_ACTIONS.delete.label,
};

const NEW_SKILL = w('New skill', 'Nouvelle compétence');

function Rows({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[max-content_1fr] items-center gap-x-6 gap-y-3">{children}</div>;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-xs text-muted-foreground">{children}</code>;
}

function Line({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

/** A pressed toggle the reviewer can flip. */
function LiveToggle({ label, icon, start, variant }: {
  label: Words; icon?: string; start: boolean; variant?: typeof VARIANTS[number];
}) {
  const [on, setOn] = useState(start);
  return <Button variant={variant} icon={icon} pressed={on} onClick={() => setOn(!on)}>{label}</Button>;
}

export const specimen = defineSpecimen({
  id: 'button',
  name: 'Button',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['Button'],
  summary: 'A page or row action in six variants and three sizes; with pressed it becomes a toggle.',
  states: [
    {
      id: 'variants',
      label: 'Variants',
      render: () => (
        <Rows>
          {VARIANTS.map((variant) => [
            <Code key={`${variant}-code`}>variant=&quot;{variant}&quot;</Code>,
            <Line key={variant}><Button variant={variant}>{VARIANT_LABEL[variant]}</Button></Line>,
          ])}
        </Rows>
      ),
    },
    {
      id: 'sizes',
      label: 'Sizes (sm, md, lg) for the default, primary and ghost variants',
      render: () => (
        <Rows>
          {(['default', 'primary', 'ghost'] as const).map((variant) => [
            <Code key={`${variant}-code`}>variant=&quot;{variant}&quot;</Code>,
            <Line key={variant}>
              {SIZES.map((size) => (
                <Button key={size} variant={variant} size={size} icon="plus">{VARIANT_LABEL[variant]}</Button>
              ))}
            </Line>,
          ])}
          <Code>size</Code>
          <Line>{SIZES.map((size) => <Code key={size}>{size}</Code>)}</Line>
        </Rows>
      ),
    },
    {
      id: 'icons',
      label: 'With an icon, icon only, and the paused automation Enable action',
      render: ({ t }) => (
        <Rows>
          <Code>icon + text</Code>
          <Line>
            <Button icon={STANDARD_ACTIONS.archive.icon}>{STANDARD_ACTIONS.archive.label}</Button>
            <Button variant="primary" icon="plus">{VARIANT_LABEL.primary}</Button>
            <Button variant="secondary" icon="play">{VARIANT_LABEL.secondary}</Button>
            <Button variant="danger" icon={STANDARD_ACTIONS.delete.icon}>{STANDARD_ACTIONS.delete.label}</Button>
          </Line>
          <Code>ghost + icon</Code>
          <Line>
            <Button variant="ghost" icon={STANDARD_ACTIONS.enable.icon}>{STANDARD_ACTIONS.enable.label}</Button>
            <Button variant="ghost" icon={STANDARD_ACTIONS.disable.icon}>{STANDARD_ACTIONS.disable.label}</Button>
            <Button variant="ghost" icon={STANDARD_ACTIONS.later.icon}>{STANDARD_ACTIONS.later.label}</Button>
          </Line>
          <Code>icon only</Code>
          <Line>
            {SIZES.map((size) => <Button key={size} size={size} icon="plus" aria-label={t(NEW_SKILL)} />)}
            <Button variant="ghost" icon="dots-three" aria-label={t(SHELL_WORDS.more)} />
          </Line>
        </Rows>
      ),
    },
    {
      id: 'pressed',
      label: 'Toggle (pressed): off and on, click to flip',
      render: () => (
        <Rows>
          <Code>pressed=false</Code>
          <Line>
            <LiveToggle label={w('Starred', 'Favoris')} icon="star" start={false} />
            <LiveToggle label={w('Unread only', 'Non lus seulement')} icon="envelope-simple" start={false} />
          </Line>
          <Code>pressed=true</Code>
          <Line>
            <LiveToggle label={w('Starred', 'Favoris')} icon="star" start />
            <LiveToggle label={w('Unread only', 'Non lus seulement')} icon="envelope-simple" start />
          </Line>
          <Code>primary, pressed</Code>
          <Line>
            <LiveToggle variant="primary" label={w('Show paused', 'Afficher en pause')} start={false} />
            <LiveToggle variant="primary" label={w('Show paused', 'Afficher en pause')} start />
          </Line>
        </Rows>
      ),
    },
    {
      id: 'disabled',
      label: 'Disabled, every variant and a pressed toggle',
      render: () => (
        <Rows>
          {VARIANTS.map((variant) => [
            <Code key={`${variant}-code`}>variant=&quot;{variant}&quot;</Code>,
            <Line key={variant}>
              <Button variant={variant} disabled>{VARIANT_LABEL[variant]}</Button>
              <Button variant={variant} icon="plus" disabled>{VARIANT_LABEL[variant]}</Button>
            </Line>,
          ])}
          <Code>pressed</Code>
          <Line><Button pressed disabled icon="star">{w('Starred', 'Favoris')}</Button></Line>
        </Rows>
      ),
    },
    {
      id: 'standard-actions',
      label: 'The standard actions, with their own icons and words',
      render: () => (
        <div className="flex flex-wrap gap-2">
          {STANDARD_ACTION_IDS.map((id) => {
            const action = STANDARD_ACTIONS[id];
            return (
              <Button key={id} size="sm" variant={action.tone === 'danger' ? 'danger' : 'default'} icon={action.icon}>
                {action.label}
              </Button>
            );
          })}
        </div>
      ),
    },
    {
      id: 'long-text',
      label: 'Long French labels in a 280px box: buttons never wrap their text, the row wraps',
      render: () => (
        <div>
          <div className="flex max-w-[280px] flex-wrap gap-2">
            <Button variant="primary">{w('Save changes', 'Enregistrer les modifications')}</Button>
            <Button variant="secondary" icon="play">{VARIANT_LABEL.secondary}</Button>
            <Button icon={STANDARD_ACTIONS.unarchive.icon}>{STANDARD_ACTIONS.unarchive.label}</Button>
            <Button variant="ghost" icon={STANDARD_ACTIONS.unread.icon}>{STANDARD_ACTIONS.unread.label}</Button>
          </div>
        </div>
      ),
    },
  ],
});
