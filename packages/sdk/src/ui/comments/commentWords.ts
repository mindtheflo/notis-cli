/**
 * The words of the comment pane, in English and French. `{n}` is an anchor number or a count, `{who}` an author and
 * `{answer}` an answer. A Space names its own anchors (a slide, a section) by passing `words` to `useComments`.
 */

import { NNBSP, fillWords, w, type Words } from '../../words';

export const COMMENT_WORDS = Object.freeze({
  comments: w('Comments', 'Commentaires'),
  thisAnchor: w('This item', 'Cet élément'),
  all: w('All', 'Tous'),
  // The scope chip beside "This item": not "All", so French never shows "Tous" twice beside the status filter.
  allItems: w('All items', 'Tous les éléments'),
  open: w('Open', 'Ouverts'),
  // Archived threads keep the stored Status `Resolved` and read Done (SPC-124, SPC-126).
  resolved: w('Done', 'Terminé'),
  resolvedFilter: w('Done', 'Terminés'),
  filter: w('Show comments', 'Afficher les commentaires'),
  filterLabel: w('{filter}: {status}, {n}', `{filter}${NNBSP}: {status}, {n}`),
  status: w('Status', 'Statut'),
  scope: w('Show', 'Afficher'),
  copy: w('Copy changes since last turn', 'Copier les changements depuis le dernier tour'),
  copiedOne: w('Copied 1 change', '1 changement copié'),
  copiedMany: w('Copied {n} changes', '{n} changements copiés'),
  copyFailed: w('Could not copy. Try again.', 'Copie impossible. Réessaie.'),
  anchorLabel: w('Item {n}', 'Élément {n}'),
  reply: w('Reply', 'Répondre'),
  replyToReopen: w('Reply', 'Répondre'),
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
  resolve: w('Archive', 'Archiver'),
  reopen: w('Unarchive', 'Désarchiver'),
  // Accessible names of a card's buttons say which comment they act on: "{excerpt}" is the start of its text.
  archiveThread: w('Archive the comment thread: {excerpt}', `Archiver le fil de commentaires${NNBSP}: {excerpt}`),
  unarchiveThread: w('Unarchive the comment thread: {excerpt}', `Désarchiver le fil de commentaires${NNBSP}: {excerpt}`),
  deleteThreadNamed: w('Delete the comment thread: {excerpt}', `Supprimer le fil de commentaires${NNBSP}: {excerpt}`),
  copyLinkNamed: w('Copy the link to the comment thread: {excerpt}', `Copier le lien du fil de commentaires${NNBSP}: {excerpt}`),
  // The viewer's own reply reads "your reply" on both its buttons; someone else's reads "{who}’s reply".
  deleteReplyOf: w('Delete {who}’s reply: {excerpt}', `Supprimer la réponse de {who}${NNBSP}: {excerpt}`),
  deleteYourReply: w('Delete your reply: {excerpt}', `Supprimer ta réponse${NNBSP}: {excerpt}`),
  editRootNamed: w('Edit your comment: {excerpt}', `Modifier ton commentaire${NNBSP}: {excerpt}`),
  editReplyNamed: w('Edit your reply: {excerpt}', `Modifier ta réponse${NNBSP}: {excerpt}`),
  archived: w('Comment thread archived.', 'Fil de commentaires archivé.'),
  unarchived: w('Comment thread back in Open.', 'Fil de commentaires de retour dans Ouverts.'),
  delete: w('Delete', 'Supprimer'),
  copyLink: w('Copy link', 'Copier le lien'),
  linkCopied: w('Link copied', 'Lien copié'),
  linkCopyFailed: w('The link could not be copied.', 'Le lien n’a pas pu être copié.'),
  deleteThread: w('Delete the comment thread', 'Supprimer le fil de commentaires'),
  deleteComment: w('Delete this comment', 'Supprimer ce commentaire'),
  threadDeleted: w('Comment thread deleted.', 'Fil de commentaires supprimé.'),
  commentDeleted: w('Comment deleted', 'Commentaire supprimé'),
  commentDeletedToast: w('Comment deleted.', 'Commentaire supprimé.'),
  edit: w('Edit', 'Modifier'),
  editRoot: w('Edit comment', 'Modifier le commentaire'),
  editReply: w('Edit reply', 'Modifier la réponse'),
  editComment: w('Edit your comment', 'Modifier ton commentaire'),
  save: w('Save', 'Enregistrer'),
  edited: w('edited', 'modifié'),
  // Not shown since delete happens at once with Undo (SPC-133); kept for Spaces that still override them.
  deleteTitle: w('Delete this comment thread?', `Supprimer ce fil de commentaires${NNBSP}?`),
  deleteBody: w('It disappears from the page. The next copy still tells agents you deleted it.',
    'Il disparaît de la page. La prochaine copie indique quand même aux agents que tu l’as supprimé.'),
  // An agent's ask, one sentence each: "{who}" is shown bold. `needs` with `needCheck`, `needChoice` and `needInput`
  // (the group names of the answer buttons) are kept for Spaces that override them.
  askCheck: w('{who} needs your check on the change', '{who} a besoin de ta validation du changement'),
  askChoice: w('{who} needs a choice', '{who} a besoin d’un choix'),
  askInput: w('{who} needs a file or text', '{who} a besoin d’un fichier ou de texte'),
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
  // "{answer}" loses its closing punctuation first, so "waits." never reads "waits., sent".
  sent: w('{answer}, sent to the agent', '{answer}, envoyé à l’agent'),
  // An input ask's answer is the reply under it: the ask says it was answered without repeating the text.
  answeredInput: w('Answered below, sent to the agent', 'Répondu ci-dessous, envoyé à l’agent'),
  example: w('Example', 'Exemple'),
  emptyAnchor: w('No comments here yet.', 'Aucun commentaire ici pour le moment.'),
  emptyAll: w('No comments yet.', 'Aucun commentaire pour le moment.'),
  emptyResolved: w('No done comments.', 'Aucun commentaire terminé.'),
  // Read out while the first read of the comments has not settled (placeholders show, never an empty list).
  loadingComments: w('Loading comments', 'Chargement des commentaires'),
  saveError: w('Could not save that change. Try again.', 'Impossible d’enregistrer ce changement. Réessaie.'),
  deletePartial: w('Some comments could not be deleted. Try again.', 'Certains commentaires n’ont pas pu être supprimés. Réessaie.'),
  // An agent's input ask (Needs input): the answer goes back as a reply.
  answerPlaceholder: w('Your answer', 'Ta réponse'),
  sendAnswer: w('Send the answer', 'Envoyer la réponse'),
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
  openAgentThread: w('Open the thread of {name}', 'Ouvrir la conversation de {name}'),
  // What an agent ran on, in its hover card: the same words as the chat timeline's runtime card (AgentTimeline badge*,
  // ManagerRuntime modeLabels and speedLabels in the Portal catalogues).
  runtimeIntelligence: w('Intelligence: {mode}', `Intelligence${NNBSP}: {mode}`),
  runtimeEffort: w('Reasoning effort: {effort}', `Effort de réflexion${NNBSP}: {effort}`),
  runtimeIntelligenceUnavailable: w('Intelligence unavailable', 'Intelligence indisponible'),
  runtimeSpeed: w('Speed: {speed}', `Vitesse${NNBSP}: {speed}`),
  runtimeSpeedUnavailable: w('Speed unavailable', 'Vitesse indisponible'),
  runtimeModel: w('Model: {model}', `Modèle${NNBSP}: {model}`),
  runtimeModeLow: w('Low', 'Faible'),
  runtimeModeMedium: w('Medium', 'Moyen'),
  runtimeModeHigh: w('High', 'Élevé'),
  runtimeSpeedPriority: w('Fast', 'Rapide'),
  runtimeSpeedNormal: w('Standard', 'Standard'),
  runtimeSpeedFlex: w('Economy', 'Économique'),
  pin: w('{who}: {body}', `{who}${NNBSP}: {body}`),
  zone: w('{who}, on a zone: {body}', `{who}, sur une zone${NNBSP}: {body}`),
  // Comments on a passage of the text (`usePassageComments`).
  comment: w('Comment', 'Commenter'),
  commentOnSelection: w('Comment on the selected text', 'Commenter le texte sélectionné'),
  openFieldComments: w('Open the comments on this field', 'Ouvrir les commentaires de ce champ'),
  // SPC-123: the passage is found again from its surrounding words; when it is gone the old quote stays, open.
  textChanged: w('Passage changed', 'Passage modifié'),
  textChangedHint: w('These words are no longer in the text. The comment stays open.',
    'Ces mots ne sont plus dans le texte. Le commentaire reste ouvert.'),
  selectToComment: w('Select a passage to comment on it.', 'Sélectionne un passage pour le commenter.'),
  emptyPassages: w('No comments yet. Select a passage to comment on it.',
    'Aucun commentaire pour le moment. Sélectionne un passage pour le commenter.'),
  inGroup: w('{n} on {group}', '{n} sur {group}'),
  closeComments: w('Close comments', 'Fermer les commentaires'),
  readError: w('Comments could not be read.', 'Impossible de lire les commentaires.'),
  // Where a reply goes (SPC-117) and where a new comment goes (SPC-114). A manager thread is a "thread" in English (the
  // truths' "New Claude thread") and a "conversation" in French; a comment thread stays a "fil de commentaires".
  goesTo: w('Goes to', 'Va à'),
  ownerThread: w('Thread', 'Conversation'),
  goesToNew: w('a new thread', 'une nouvelle conversation'),
  goesToNewHarness: w('a new {harness} thread', 'une nouvelle conversation {harness}'),
  // Read out while the Goes to line is still loading (no destination shown yet).
  goesToLoading: w('Finding where this goes', 'Recherche de la destination'),
  change: w('Change', 'Changer'),
  changeThread: w('Change the thread this goes to', 'Changer la conversation de destination'),
  openLinkedThread: w('Open {title} in the chat', 'Ouvrir {title} dans le chat'),
  toThread: w('To {title}', 'À {title}'),
  toNew: w('To a new thread', 'À une nouvelle conversation'),
  toNewHarness: w('To a new {harness} thread', 'À une nouvelle conversation {harness}'),
  pickThread: w('Choose the thread this comment goes to', 'Choisir la conversation où va ce commentaire'),
  // While a picked thread is being linked: the Goes to line already names it.
  linking: w('Saving where this goes', 'Enregistrement de la destination'),
  // Grouping on the Space home (SPC-116).
  pageN: w('Page {n}', 'Page {n}'),
  wholeSpace: w('This Space', 'Ce Space'),
  // Comment modes (SPC-118).
  newCommentMenu: w('New comment', 'Nouveau commentaire'),
  modeText: w('On words', 'Sur des mots'),
  modePoint: w('On a point', 'Sur un point'),
  modeBox: w('On a box', 'Sur une zone'),
  modeItems: w('On items', 'Sur des éléments'),
  modeTime: w('At this moment', 'À ce moment'),
  modePage: w('On the whole page', 'Sur toute la page'),
  hintPoint: w('Point at something to comment.', 'Pointe un élément pour commenter.'),
  hintBox: w('Drag a box over what you mean.', 'Trace une zone sur ce que tu veux dire.'),
  hintText: w('Select words to comment on them.', 'Sélectionne des mots pour les commenter.'),
  hintItems: w('Pick the items to comment on.', 'Choisis les éléments à commenter.'),
  hintCancel: w('Esc cancels.', 'Échap annule.'),
  toolBar: w('Comment tools', 'Outils de commentaire'),
  closeToolBar: w('Close comment tool bar', 'Fermer la barre d’outils de commentaire'),
  toggleToolBar: w('Show or hide the comment tools', 'Afficher ou masquer les outils de commentaire'),
  newCommentPage: w('New comment on the whole page', 'Nouveau commentaire sur toute la page'),
  newCommentItems: w('New comment on {n} items', 'Nouveau commentaire sur {n} éléments'),
  newCommentItem: w('New comment on 1 item', 'Nouveau commentaire sur 1 élément'),
  newCommentTime: w('New comment at {time}', 'Nouveau commentaire à {time}'),
  itemsLabel: w('{n} items', '{n} éléments'),
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
