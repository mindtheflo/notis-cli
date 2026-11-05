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
  attachments: w('Pictures and files', 'Images et fichiers'),
  enlarge: w('Open {name} larger', 'Agrandir {name}'),
  paste: w('Paste text', 'Coller du texte'),
  sent: w('{answer}, sent to the agent', '{answer}, envoyé à l’agent'),
  example: w('Example', 'Exemple'),
  emptyAnchor: w('No comments here yet.', 'Aucun commentaire ici pour le moment.'),
  emptyAll: w('No comments yet.', 'Aucun commentaire pour le moment.'),
  emptyResolved: w('No resolved comments.', 'Aucun commentaire résolu.'),
  saveError: w('Could not save that change. Try again.', 'Impossible d’enregistrer ce changement. Réessaie.'),
  textOnly: w('Only text files can be attached here.', 'Seuls les fichiers texte peuvent être joints ici.'),
  attachFiles: w('Attach pictures or files', 'Joindre des images ou des fichiers'),
  dropFiles: w('Drop to attach', 'Dépose pour joindre'),
  fileUploading: w('Uploading {name}, {percent}%', `Envoi de {name}, {percent}${NNBSP}%`),
  fileReady: w('{name}, ready to send', '{name}, prêt à envoyer'),
  fileRemove: w('Remove {name}', 'Retirer {name}'),
  fileRetry: w('Try {name} again', 'Réessayer {name}'),
  fileTooLarge: w('{name} is over {size} MB. Attach a smaller file.', `{name} dépasse {size}${NNBSP}Mo. Joins un fichier plus léger.`),
  fileType: w('{name} cannot be attached. Attach a picture, a PDF, an office document or a text file.',
    '{name} ne peut pas être joint. Joins une image, un PDF, un document bureautique ou un fichier texte.'),
  fileEmpty: w('{name} is empty.', '{name} est vide.'),
  fileFailed: w('{name} did not upload. Your comment is kept: try again.',
    `{name} n’a pas été envoyé. Ton commentaire est gardé${NNBSP}: réessaie.`),
  fileTooMany: w('Attach up to {n} files to one comment.', 'Joins jusqu’à {n} fichiers à un commentaire.'),
  filesUnavailable: w('These comments take text only.', 'Ces commentaires acceptent seulement du texte.'),
  newActivity: w('New since last turn', 'Nouveau depuis le dernier tour'),
  fromAgent: w('From {name}', 'De {name}'),
  openAgentThread: w('Open the conversation of {name}', 'Ouvrir la conversation de {name}'),
  pin: w('{who}: {body}', `{who}${NNBSP}: {body}`),
  zone: w('{who}, on a zone: {body}', `{who}, sur une zone${NNBSP}: {body}`),
  // Comments on a passage of the text (`usePassageComments`).
  comment: w('Comment', 'Commenter'),
  commentOnSelection: w('Comment on the selected text', 'Commenter le texte sélectionné'),
  openFieldComments: w('Open the comments on this field', 'Ouvrir les commentaires de ce champ'),
  textChanged: w('Text changed', 'Texte modifié'),
  textChangedHint: w('This passage is no longer in the text.', 'Ce passage n’est plus dans le texte.'),
  selectToComment: w('Select a passage to comment on it.', 'Sélectionne un passage pour le commenter.'),
  emptyPassages: w('No comments yet. Select a passage to comment on it.',
    'Aucun commentaire pour le moment. Sélectionne un passage pour le commenter.'),
  inGroup: w('{n} on {group}', '{n} sur {group}'),
  closeComments: w('Close comments', 'Fermer les commentaires'),
  readError: w('Comments could not be read.', 'Impossible de lire les commentaires.'),
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
