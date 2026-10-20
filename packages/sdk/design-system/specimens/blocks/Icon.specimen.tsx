import { defineSpecimen } from '../../specimen';
import { Badge, Button, Icon, hasIcon } from '../../../src/ui/index';
import { w } from '../../../src/words/index';
import { ICON_NAMES } from '../../fixtures/blocks/blocks';

const SIZES = [12, 16, 20, 24, 32] as const;
const COLOURS = [
  { token: 'foreground', className: 'text-foreground' },
  { token: 'muted-foreground', className: 'text-muted-foreground' },
  { token: 'primary', className: 'text-primary' },
  { token: 'destructive', className: 'text-destructive' },
] as const;
const SAMPLE = ['plus', 'check-circle-fill', 'clock-countdown', 'envelope-simple', 'x-circle-fill', 'dots-three'] as const;

export const specimen = defineSpecimen({
  id: 'icon',
  name: 'Icon',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['Icon'],
  summary: 'The built-in icon set: 16px line icons that take the size and colour of the text around them.',
  states: [
    {
      id: 'all',
      label: 'Every icon, by name',
      render: ({ t }) => (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
          {ICON_NAMES.map((name) => (
            <div key={name} className="flex min-w-0 flex-col items-center gap-2 rounded-md bg-muted/50 px-2 py-3">
              <span className="text-xl leading-none"><Icon name={name} /></span>
              <code className="w-full break-all text-center font-mono text-[11px] text-muted-foreground">{name}</code>
              {!hasIcon(name) && <Badge tone="danger">{t({ en: 'Missing', fr: 'Manquante' })}</Badge>}
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'sizes',
      label: 'Sizes: the icon is 1em, so it follows the font size',
      render: () => (
        <div className="flex flex-col gap-4">
          {SIZES.map((size) => (
            <div key={size} className="flex items-center gap-4">
              <code className="w-12 font-mono text-xs text-muted-foreground">{`${size}px`}</code>
              <span className="flex items-center gap-3 leading-none" style={{ fontSize: size }}>
                {SAMPLE.map((name) => <Icon key={name} name={name} />)}
              </span>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'colour',
      label: 'Colour: the icon takes the text colour (filled icons cut their mark in the background colour)',
      render: () => (
        <div className="grid grid-cols-[max-content_1fr] items-center gap-x-6 gap-y-4">
          {COLOURS.map(({ token, className }) => [
            <code key={`${token}-code`} className="font-mono text-xs text-muted-foreground">{token}</code>,
            <span key={token} className={`flex items-center gap-3 text-xl leading-none ${className}`}>
              {SAMPLE.map((name) => <Icon key={name} name={name} />)}
            </span>,
          ])}
        </div>
      ),
    },
    {
      id: 'in-controls',
      label: 'In controls: a name passed as the icon prop',
      render: () => (
        <div className="flex flex-wrap items-center gap-3">
          <Button icon="plus" variant="primary">{w('New automation', 'Nouvelle automatisation')}</Button>
          <Button icon="arrows-clockwise">{w('Sync now', 'Synchroniser')}</Button>
          <Badge tone="success" icon="check-circle-fill">{w('Connected', 'Connecté')}</Badge>
          <Badge tone="danger" icon="x-circle-fill">{w('Needs sign-in', 'Reconnexion nécessaire')}</Badge>
        </div>
      ),
    },
    {
      id: 'unknown',
      label: 'An unknown name renders nothing',
      render: ({ t }) => (
        <div className="flex items-center gap-3 text-sm">
          <code className="font-mono text-xs text-muted-foreground">name=&quot;rocket&quot;</code>
          <span className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-md bg-muted/50 px-2 text-xl">
            <Icon name="rocket" />
          </span>
          <span className="text-muted-foreground">{t({ en: 'Empty: the set has no rocket icon.', fr: 'Vide : le jeu n’a pas d’icône de fusée.' })}</span>
        </div>
      ),
    },
  ],
});
