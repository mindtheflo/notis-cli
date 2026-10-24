/**
 * The words of the comment pane, in English and French. `{n}` is an anchor number or a count, `{who}` an author and
 * `{answer}` an answer. A Space names its own anchors (a slide, a section) by passing `words` to `useComments`.
 */

import { NNBSP, fillWords, w, type Words } from '../../words';

export const COMMENT_WORDS = Object.freeze({
  comments: w('Comments', 'Commentaires'),
  thisAnchor: w('This item', 'Cet élément'),
  all: w('All', 'Tous'),
  open: w('Open', 'Ouverts'),
  resolved: w('Resolved', 'Résolu'),
  resolvedFilter: w('Resolved', 'Résolus'),
  status: w('Status', 'Statut'),
  scope: w('Show', 'Afficher'),
  copy: w('Copy changes since last turn', 'Copier depuis le dernier tour'),
  copiedOne: w('Copied 1 change', '1 changement copié'),
  copiedMany: w('Copied {n} changes', '{n} changements copiés'),
  copyFailed: w('Could not copy. Try again.', 'Copie impossible. Réessaie.'),
  anchorLabel: w('Item {n}', 'Élément {n}'),
  reply: w('Reply', 'Répondre'),
  replyToReopen: w('Reply to reopen', 'Répondre pour rouvrir'),
  newComment: w('New comment', 'Nouveau commentaire'),
  newCommentOn: w('New comment on item {n}', 'Nouveau commentaire sur l’élément {n}'),
  newCommentWhole: w('New comment on all of item {n}', 'Nouveau commentaire sur tout l’élément {n}'),
  commentOnAnchor: w('Comment on all of item {n}', 'Commenter tout l’élément {n}'),
  pinHint: w('Click where the comment goes.', 'Clique là où va le commentaire.'),
  zoneHint: w('Click to pin a spot, or hold and drag to mark a zone.',
    'Clique pour épingler un point, ou maintiens et fais glisser pour marquer une zone.'),
  commentPlaceholder: w('Add a comment', 'Ajouter un commentaire'),
  send: w('Send', 'Envoyer'),
  cancel: w('Cancel', 'Annuler'),
  resolve: w('Resolve', 'Résoudre'),
  reopen: w('Reopen', 'Rouvrir'),
  delete: w('Delete', 'Supprimer'),
  deleteTitle: w('Delete this comment thread?', `Supprimer ce fil de commentaires${NNBSP}?`),
  deleteBody: w('It disappears from the page. The next copy still tells agents you deleted it.',
    'Il disparaît de la page. La prochaine copie indique quand même aux agents que tu l’as supprimé.'),
  needs: w('{who} needs', '{who} a besoin de'),
  needCheck: w('Your check on the change', 'Ta validation du changement'),
  needChoice: w('A choice', 'Un choix'),
  needInput: w('A file or text', 'Un fichier ou du texte'),
  looksGood: w('Looks good', 'Ça me va'),
  undo: w('Undo', 'Annuler le changement'),
  attach: w('Attach a file', 'Joindre un fichier'),
  paste: w('Paste text', 'Coller du texte'),
  sent: w('{answer}, sent to the agent', '{answer}, envoyé à l’agent'),
  example: w('Example', 'Exemple'),
  emptyAnchor: w('No comments here yet.', 'Aucun commentaire ici pour le moment.'),
  emptyAll: w('No comments yet.', 'Aucun commentaire pour le moment.'),
  emptyResolved: w('No resolved comments.', 'Aucun commentaire résolu.'),
  saveError: w('Could not save that change. Try again.', 'Impossible d’enregistrer ce changement. Réessaie.'),
  textOnly: w('Only text files can be attached here.', 'Seuls les fichiers texte peuvent être joints ici.'),
  newActivity: w('New since last turn', 'Nouveau depuis le dernier tour'),
  pin: w('{who}: {body}', `{who}${NNBSP}: {body}`),
  zone: w('{who}, on a zone: {body}', `{who}, sur une zone${NNBSP}: {body}`),
}) satisfies Readonly<Record<string, Words>>;

export type CommentWordKey = keyof typeof COMMENT_WORDS;
export type CommentWords = Readonly<Record<CommentWordKey, Words>>;

/** The pane's words with a Space's own wording on top (for example "This slide" for `thisAnchor`). */
export function commentWords(overrides?: Partial<Record<CommentWordKey, Words>>): CommentWords {
  return overrides ? Object.freeze({ ...COMMENT_WORDS, ...overrides }) : COMMENT_WORDS;
}

/** "Copied 3 changes". */
export function commentCopiedWords(words: CommentWords, n: number): Words {
  return n === 1 ? words.copiedOne : fillWords(words.copiedMany, { n });
}
