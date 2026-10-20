import { useId, useState } from 'react';
import { defineSpecimen, type SpecimenCopy, type SpecimenRenderContext } from '../../specimen';
import { Dialog } from '../../../src';
import { Button, FIELD_WORDS, Notice } from '../../../src/ui/index';
import { STANDARD_ACTIONS, w } from '../../../src/words/index';
import { LONG_TEXT, LONG_TITLE } from '../../fixtures';
import { clickOn, openDialog, typeInto, waitFor } from '../../fixtures/documents/interact';
import { Readout } from '../../fixtures/documents/layout';

type T = SpecimenRenderContext['t'];

const COPY = {
  deleteSpace: { en: 'Delete Space', fr: 'Supprimer le Space' },
  deleteTitle: { en: 'Delete Launch notes?', fr: 'Supprimer «\u202fNotes de lancement\u202f»\u202f?' },
  deleteBody: {
    en: 'Its 3 pages and 24 notes go to the trash for 30 days. People you shared it with lose access now.',
    fr: 'Ses 3 pages et ses 24 notes partent dans la corbeille pendant 30 jours. Les personnes avec qui tu l’as partagé perdent l’accès tout de suite.',
  },
  renameTitle: { en: 'Rename Space', fr: 'Renommer le Space' },
  renameBody: {
    en: 'The new name shows in the sidebar and in links you already shared.',
    fr: 'Le nouveau nom apparaît dans la barre latérale et dans les liens déjà partagés.',
  },
  nameLabel: { en: 'Name', fr: 'Nom' },
  currentName: { en: 'Launch notes', fr: 'Notes de lancement' },
  typedName: { en: ' (June)', fr: ' (juin)' },
  discardTitle: { en: 'Discard your changes to this note?', fr: 'Abandonner tes modifications de cette note\u202f?' },
  keepEditing: { en: 'Keep editing', fr: 'Continuer à modifier' },
  discard: { en: 'Discard', fr: 'Abandonner' },
  lastChoice: { en: 'Last choice:', fr: 'Dernier choix\u202f:' },
  none: { en: 'none yet', fr: 'aucun pour l’instant' },
  closedByEscape: { en: 'closed (Escape or Cancel)', fr: 'fermé (Échap ou Annuler)' },
  deleted: { en: 'deleted', fr: 'supprimé' },
  renamed: { en: 'Name now:', fr: 'Nom actuel\u202f:' },
} satisfies Record<string, SpecimenCopy>;

/** A rename that never answers (saving) or fails (error); the book never reaches a backend. */
type RenameOutcome = 'pending' | 'fails' | 'succeeds';

const actions = 'mt-5 flex flex-wrap justify-end gap-2';

/** The validated deck dialog: Settings > Delete Space asks before anything goes. */
function DeleteSpace({ t }: { t: T }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string>(t(COPY.none));
  return (
    <div className="flex flex-col items-start gap-3">
      <Button variant="danger" icon={STANDARD_ACTIONS.delete.icon} data-ds-open-dialog="" onClick={() => setOpen(true)}>
        {t(COPY.deleteSpace)}
      </Button>
      <Readout label={t(COPY.lastChoice)}>{choice}</Readout>
      <Dialog open={open} role="alertdialog" title={t(COPY.deleteTitle)} description={t(COPY.deleteBody)}
        onClose={() => { setOpen(false); setChoice(t(COPY.closedByEscape)); }}>
        <div className={actions}>
          <Button variant="ghost" onClick={() => { setOpen(false); setChoice(t(COPY.closedByEscape)); }}>{FIELD_WORDS.cancel}</Button>
          <Button variant="danger" data-ds-confirm="" onClick={() => { setOpen(false); setChoice(t(COPY.deleted)); }}>
            {t(COPY.deleteSpace)}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

/** Settings > Rename: a form in a dialog. While it saves, Escape and Cancel do nothing (onClose keeps it open). */
function RenameSpace({ t, outcome }: { t: T; outcome: RenameOutcome }) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(t(COPY.currentName));
  const [saved, setSaved] = useState(t(COPY.currentName));
  const [phase, setPhase] = useState<'idle' | 'saving' | 'failed'>('idle');
  const saving = phase === 'saving';

  function close() {
    if (saving) return;
    setOpen(false);
    setPhase('idle');
  }

  function save() {
    setPhase('saving');
    const done = outcome === 'pending'
      ? new Promise<void>(() => undefined)
      : outcome === 'fails'
        ? Promise.reject(new Error('rename failed'))
        : Promise.resolve();
    done.then(() => { setSaved(name.trim()); setPhase('idle'); setOpen(false); }, () => setPhase('failed'));
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <Button data-ds-open-dialog="" onClick={() => setOpen(true)}>{t(COPY.renameTitle)}</Button>
      <Readout label={t(COPY.renamed)}>{saved}</Readout>
      <Dialog open={open} onClose={close} title={t(COPY.renameTitle)} description={t(COPY.renameBody)}>
        <form className="mt-4 flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); if (!saving) save(); }}>
          <label htmlFor={inputId} className="text-sm font-medium">{t(COPY.nameLabel)}</label>
          <input id={inputId} value={name} data-ds-typed={t(COPY.typedName)} disabled={saving} onChange={(event) => setName(event.target.value)}
            className="w-full rounded-md bg-muted px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" />
          {phase === 'failed' && <Notice tone="danger" onRetry={save}>{FIELD_WORDS.saveFailed}</Notice>}
          <div className={actions}>
            <Button variant="ghost" disabled={saving} onClick={close}>{FIELD_WORDS.cancel}</Button>
            <Button variant="primary" type="submit" data-ds-save="" disabled={saving || name.trim() === ''}>
              {saving ? FIELD_WORDS.saving : FIELD_WORDS.save}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

/** A dialog with only a title: leaving a note with unsaved edits. */
function DiscardChanges({ t }: { t: T }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button data-ds-open-dialog="" onClick={() => setOpen(true)}>{FIELD_WORDS.cancel}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t(COPY.discardTitle)}>
        <div className={actions}>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t(COPY.keepEditing)}</Button>
          <Button variant="danger" onClick={() => setOpen(false)}>{t(COPY.discard)}</Button>
        </div>
      </Dialog>
    </>
  );
}

/** Long copy: the title and description wrap, the actions wrap under each other when they do not fit. */
function LongCopy({ t }: { t: T }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button data-ds-open-dialog="" onClick={() => setOpen(true)}>{t(COPY.renameTitle)}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t(LONG_TITLE)} description={t(LONG_TEXT)}>
        <div className={actions}>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t(COPY.keepEditing)}</Button>
          <Button variant="primary" onClick={() => setOpen(false)}>{w('Save and close the review', 'Enregistrer et fermer la revue trimestrielle')}</Button>
        </div>
      </Dialog>
    </>
  );
}

/** Opens the rename dialog, adds the words in the input's `data-ds-typed` to the name and presses Save. */
async function renameAndSave(root: HTMLElement): Promise<void> {
  const dialog = await openDialog(root);
  const input = await waitFor<HTMLInputElement>(dialog, 'input[data-ds-typed]');
  await typeInto(input, input.dataset.dsTyped ?? '');
  await clickOn(dialog, '[data-ds-save]');
}

export const specimen = defineSpecimen({
  id: 'dialog',
  name: 'Dialog',
  group: 'documents',
  from: '@notis/sdk',
  covers: ['Dialog'],
  summary: 'A native modal dialog in the top layer with a title and an optional description; the Space owns its actions.',
  states: [
    {
      id: 'closed',
      label: 'Closed: only the trigger shows',
      render: ({ t }) => <DeleteSpace t={t} />,
    },
    {
      id: 'confirm-delete',
      label: 'Confirm delete (alertdialog), as validated in the deck',
      height: 420,
      render: ({ t }) => <DeleteSpace t={t} />,
      interact: async (root) => { await openDialog(root); },
    },
    {
      id: 'form',
      label: 'A form in a dialog: rename the Space',
      height: 460,
      render: ({ t }) => <RenameSpace t={t} outcome="succeeds" />,
      interact: async (root) => { await openDialog(root); },
    },
    {
      id: 'saving',
      label: 'Saving: buttons disabled, Escape and Cancel keep it open',
      height: 460,
      render: ({ t }) => <RenameSpace t={t} outcome="pending" />,
      interact: renameAndSave,
    },
    {
      id: 'error',
      label: 'Save failed: an error with Try again inside the dialog',
      height: 520,
      render: ({ t }) => <RenameSpace t={t} outcome="fails" />,
      interact: renameAndSave,
    },
    {
      id: 'title-only',
      label: 'Title only, no description',
      height: 360,
      render: ({ t }) => <DiscardChanges t={t} />,
      interact: async (root) => { await openDialog(root); },
    },
    {
      id: 'long-copy',
      label: 'Long title, description and action label',
      height: 520,
      render: ({ t }) => <LongCopy t={t} />,
      interact: async (root) => { await openDialog(root); },
    },
    {
      id: 'narrow',
      label: 'Confirm delete at 390 px',
      width: 390,
      height: 520,
      render: ({ t }) => <DeleteSpace t={t} />,
      interact: async (root) => { await openDialog(root); },
    },
  ],
});
