/**
 * Fixtures of the "Dates, calendar and timeline" group: the SEO content calendar and the product roadmap the deck
 * reviewed, dated in days from the frame's fixed clock (Monday 15 June 2026) so nothing drifts between runs.
 */
import { FIXED_NOW, type SpecimenCopy, type SpecimenLang } from '../../specimen';

/** Today on the fixed clock, as a local day. */
export const DATES_TODAY: Date = (() => {
  const now = new Date(FIXED_NOW);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
})();

/** The day `offset` days from today. */
export function dayFromToday(offset: number): Date {
  return new Date(DATES_TODAY.getFullYear(), DATES_TODAY.getMonth(), DATES_TODAY.getDate() + offset);
}

/** The ISO day (`2026-06-15`) `offset` days from today. */
export function isoFromToday(offset: number): string {
  const d = dayFromToday(offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const copy = (en: string, fr: string): SpecimenCopy => ({ en, fr });

/** Narrow no-break space, written before `:` and `?` in French. */
const NB = ' ';

// ---------- Status groups (deck core.js: seven fixed groups, a Space maps its statuses onto them) ----------

export type StatusGroup = 'backlog' | 'todo' | 'active' | 'waiting' | 'done';

export const STATUS_GLYPH: Record<StatusGroup, string> = {
  backlog: 'circle-dashed',
  todo: 'circle',
  active: 'circle-half',
  waiting: 'clock-countdown',
  done: 'check-circle-fill',
};

// ---------- The SEO content calendar ----------

export type ContentStatus = 'idea' | 'draft' | 'in_review' | 'live' | 'prospect' | 'contacted';

const CONTENT_GROUP: Record<ContentStatus, StatusGroup> = {
  idea: 'backlog', draft: 'active', in_review: 'waiting', live: 'done', prospect: 'todo', contacted: 'waiting',
};

const CONTENT_STATUS_WORDS: Record<ContentStatus, SpecimenCopy> = {
  idea: copy('Idea', 'Idée'),
  draft: copy('Draft', 'Brouillon'),
  in_review: copy('In review', 'En relecture'),
  live: copy('Live', 'En ligne'),
  prospect: copy('To pitch', 'À démarcher'),
  contacted: copy('Contacted', 'Contacté'),
};

interface ContentSeed {
  id: string;
  kind: 'article' | 'outreach';
  status: ContentStatus;
  owner: string;
  /** Days from today; null waits in the No date tray. */
  due: number | null;
  /** Last day of a multi-day item, in days from today. */
  until?: number;
  title: SpecimenCopy;
}

const CONTENT: readonly ContentSeed[] = [
  { id: 'CC-33', kind: 'article', status: 'live', owner: 'CD', due: -8, title: copy('Notis for real estate agents', 'Notis pour les agents immobiliers') },
  { id: 'CC-21', kind: 'article', status: 'live', owner: 'AL', due: -3, title: copy('Best AI assistants for WhatsApp in 2026', 'Les meilleurs assistants IA pour WhatsApp en 2026') },
  { id: 'CC-37', kind: 'outreach', status: 'contacted', owner: 'FP', due: -1, title: copy(`Follow up: The Verge AI roundup`, `Relance${NB}: sélection IA de The Verge`) },
  { id: 'CC-22', kind: 'article', status: 'in_review', owner: 'MB', due: 0, title: copy('Notis vs Motion: which one plans your week?', `Notis ou Motion${NB}: lequel organise ta semaine${NB}?`) },
  { id: 'CC-25', kind: 'outreach', status: 'contacted', owner: 'FP', due: 0, title: copy('Follow up: guest post on the Zapier blog', `Relance${NB}: article invité sur le blog Zapier`) },
  { id: 'CC-38', kind: 'article', status: 'draft', owner: 'AL', due: 0, title: copy('June product update newsletter', 'Lettre d’information de juin sur les nouveautés') },
  { id: 'CC-39', kind: 'outreach', status: 'prospect', owner: 'FP', due: 0, title: copy('Pitch: Maddyness startup tools list', `Proposition${NB}: liste d’outils pour startups de Maddyness`) },
  { id: 'CC-23', kind: 'article', status: 'draft', owner: 'AL', due: 1, title: copy('How to turn voice notes into tasks', 'Transformer tes notes vocales en tâches') },
  { id: 'CC-26', kind: 'outreach', status: 'contacted', owner: 'FP', due: 2, title: copy('Follow up: Product Hunt newsletter', `Relance${NB}: newsletter Product Hunt`) },
  { id: 'CC-24', kind: 'article', status: 'draft', owner: 'CD', due: 3, title: copy('Gmail filters that save an hour a week', 'Des filtres Gmail qui font gagner une heure par semaine') },
  { id: 'CC-29', kind: 'outreach', status: 'prospect', owner: 'FP', due: 4, title: copy('Pitch: Lifehacker productivity roundup', `Proposition${NB}: sélection productivité de Lifehacker`) },
  { id: 'CC-28', kind: 'article', status: 'draft', owner: 'CD', due: 5, title: copy('AI assistant for lawyers', 'Assistant IA pour avocats') },
  { id: 'CC-30', kind: 'article', status: 'in_review', owner: 'AL', due: 6, title: copy('Calendar sync with Outlook, step by step', 'Synchroniser Outlook, étape par étape') },
  { id: 'CC-40', kind: 'article', status: 'draft', owner: 'MB', due: 7, until: 11, title: copy('Launch week: Notis for teams', `Semaine de lancement${NB}: Notis pour les équipes`) },
  { id: 'CC-27', kind: 'article', status: 'idea', owner: 'MB', due: 8, title: copy('Notion AI alternatives for small teams', 'Alternatives à Notion AI pour les petites équipes') },
  { id: 'CC-35', kind: 'outreach', status: 'contacted', owner: 'FP', due: 9, title: copy('Follow up: Indie Hackers interview', `Relance${NB}: interview Indie Hackers`) },
  { id: 'CC-34', kind: 'article', status: 'draft', owner: 'MB', due: 10, title: copy('Reminders that actually work on WhatsApp', 'Des rappels qui marchent vraiment sur WhatsApp') },
  { id: 'CC-36', kind: 'article', status: 'idea', owner: 'AL', due: 15, title: copy('Weekly review template', 'Modèle de revue hebdomadaire') },
  { id: 'CC-41', kind: 'article', status: 'idea', owner: 'CD', due: 22, title: copy('Back to school: plan the term with Notis', `Rentrée${NB}: planifier le trimestre avec Notis`) },
  { id: 'CC-31', kind: 'article', status: 'idea', owner: 'CD', due: null, title: copy('Case study: a law firm on Notis', `Étude de cas${NB}: un cabinet d’avocats sur Notis`) },
  { id: 'CC-32', kind: 'article', status: 'idea', owner: 'MB', due: null, title: copy('Notis for teachers', 'Notis pour les enseignants') },
];

/** One content calendar entry in one language: what CalendarView reads. */
export interface ContentItem {
  id: string;
  kind: 'article' | 'outreach';
  status: ContentStatus;
  group: StatusGroup;
  statusLabel: string;
  owner: string;
  title: string;
  /** ISO day, or null for the No date tray. */
  date: string | null;
  end: string | null;
}

function contentIn(lang: SpecimenLang): readonly ContentItem[] {
  return CONTENT.map((seed) => ({
    id: seed.id,
    kind: seed.kind,
    status: seed.status,
    group: CONTENT_GROUP[seed.status],
    statusLabel: CONTENT_STATUS_WORDS[seed.status][lang],
    owner: seed.owner,
    title: seed.title[lang],
    date: seed.due == null ? null : isoFromToday(seed.due),
    end: seed.until == null ? null : isoFromToday(seed.until),
  }));
}

const CONTENT_BY_LANG: Record<SpecimenLang, readonly ContentItem[]> = { en: contentIn('en'), fr: contentIn('fr') };

/** The content calendar in one language (the same array on every call, so the view's memo holds). */
export function contentCalendar(lang: SpecimenLang): readonly ContentItem[] {
  return CONTENT_BY_LANG[lang];
}

/** The content calendar with every item dated (the tray has nothing to show). */
const DATED_BY_LANG: Record<SpecimenLang, readonly ContentItem[]> = {
  en: CONTENT_BY_LANG.en.filter((item) => item.date !== null),
  fr: CONTENT_BY_LANG.fr.filter((item) => item.date !== null),
};

export function datedContent(lang: SpecimenLang): readonly ContentItem[] {
  return DATED_BY_LANG[lang];
}

export const contentDate = (item: ContentItem): string | null => item.date;
export const contentEnd = (item: ContentItem): string | null => item.end ?? item.date;

export const CONTENT_LABEL = copy('Content calendar', 'Calendrier éditorial');

// ---------- The product roadmap ----------

export type ProjectStatus = 'todo' | 'in_progress' | 'in_review' | 'done';

const PROJECT_GROUP: Record<ProjectStatus, StatusGroup> = {
  todo: 'todo', in_progress: 'active', in_review: 'waiting', done: 'done',
};

const PROJECT_STATUS_WORDS: Record<ProjectStatus, SpecimenCopy> = {
  todo: copy('To do', 'À faire'),
  in_progress: copy('In progress', 'En cours'),
  in_review: copy('In review', 'En relecture'),
  done: copy('Done', 'Terminé'),
};

export type AreaId = 'spaces' | 'voice' | 'channels' | 'billing' | 'mobile';

export const AREAS: Record<AreaId, SpecimenCopy> = {
  spaces: copy('Spaces', 'Spaces'),
  voice: copy('Voice', 'Voix'),
  channels: copy('Channels', 'Canaux'),
  billing: copy('Billing', 'Facturation'),
  mobile: copy('Mobile app', 'Application mobile'),
};

interface ProjectSeed {
  area: AreaId;
  start: number;
  end: number;
  status: ProjectStatus;
  owner: string;
  title: SpecimenCopy;
}

// The deck's round 5 roadmap (layouts-r5.js), in days from today.
const PROJECTS: readonly ProjectSeed[] = [
  { area: 'spaces', start: -12, end: 9, status: 'in_progress', owner: 'FP', title: copy('Spaces design kit', 'Kit de design des Spaces') },
  { area: 'spaces', start: 6, end: 30, status: 'todo', owner: 'AL', title: copy('Live pieces in Spaces', 'Pièces live dans les Spaces') },
  { area: 'spaces', start: 31, end: 48, status: 'todo', owner: 'FP', title: copy('Rebuild the 10 Spaces', 'Reconstruire les 10 Spaces') },
  { area: 'voice', start: -34, end: -3, status: 'done', owner: 'MB', title: copy('Replies under 1.8 seconds', 'Réponses en moins de 1,8 seconde') },
  { area: 'voice', start: -5, end: 20, status: 'in_progress', owner: 'MB', title: copy('French voice', 'Voix française') },
  { area: 'voice', start: 22, end: 52, status: 'todo', owner: 'CD', title: copy('Call summaries in Notes', 'Résumés d’appel dans Notes') },
  { area: 'channels', start: -22, end: -6, status: 'done', owner: 'CD', title: copy('Instagram reconnect', 'Reconnexion Instagram') },
  { area: 'channels', start: -8, end: 14, status: 'in_review', owner: 'AL', title: copy('Telegram channel', 'Canal Telegram') },
  { area: 'channels', start: 12, end: 40, status: 'todo', owner: 'AL', title: copy('Slack threads', 'Fils Slack') },
  { area: 'billing', start: -3, end: 25, status: 'in_progress', owner: 'FP', title: copy('Cloud Computer upgrades', 'Options du Cloud Computer') },
  { area: 'billing', start: 20, end: 62, status: 'todo', owner: 'CD', title: copy('Team invoices', 'Factures d’équipe') },
  { area: 'billing', start: 58, end: 95, status: 'todo', owner: 'FP', title: copy('Annual plans', 'Offres annuelles') },
];

/** One roadmap project in one language: what TimelineView reads. */
export interface Project {
  id: string;
  area: AreaId;
  areaLabel: string;
  status: ProjectStatus;
  group: StatusGroup;
  statusLabel: string;
  owner: string;
  title: string;
  start: string;
  end: string;
}

function projectsIn(lang: SpecimenLang, seeds: readonly ProjectSeed[], prefix: string): readonly Project[] {
  return seeds.map((seed, i) => ({
    id: `${prefix}-${i + 1}`,
    area: seed.area,
    areaLabel: AREAS[seed.area][lang],
    status: seed.status,
    group: PROJECT_GROUP[seed.status],
    statusLabel: PROJECT_STATUS_WORDS[seed.status][lang],
    owner: seed.owner,
    title: seed.title[lang],
    start: isoFromToday(seed.start),
    end: isoFromToday(seed.end),
  }));
}

const ROADMAP_BY_LANG: Record<SpecimenLang, readonly Project[]> = {
  en: projectsIn('en', PROJECTS, 'PRJ'),
  fr: projectsIn('fr', PROJECTS, 'PRJ'),
};

/** The roadmap in one language (the same array on every call). */
export function roadmap(lang: SpecimenLang): readonly Project[] {
  return ROADMAP_BY_LANG[lang];
}

// Long titles in short bars: the bar truncates, the accessible name keeps the whole title.
const LONG_PROJECTS: readonly ProjectSeed[] = [
  { area: 'spaces', start: -4, end: 3, status: 'in_progress', owner: 'FP', title: copy('Keyboard shortcuts for every list, board and calendar view', 'Raccourcis clavier pour chaque vue liste, tableau et calendrier') },
  { area: 'spaces', start: 5, end: 26, status: 'todo', owner: 'AL', title: copy('Shared views with comments for the whole team', 'Vues partagées avec commentaires pour toute l’équipe') },
  { area: 'voice', start: -2, end: 1, status: 'in_review', owner: 'MB', title: copy('Voice notes transcribed in the language they were spoken in', 'Notes vocales transcrites dans la langue dans laquelle elles ont été dites') },
  { area: 'voice', start: 2, end: 30, status: 'todo', owner: 'CD', title: copy('Call summaries with action items, owners and due dates', 'Résumés d’appel avec actions à mener, responsables et échéances') },
  { area: 'billing', start: -10, end: -1, status: 'done', owner: 'FP', title: copy('Invoices in euros and dollars', 'Factures en euros et en dollars') },
];

const LONG_BY_LANG: Record<SpecimenLang, readonly Project[]> = {
  en: projectsIn('en', LONG_PROJECTS, 'LNG'),
  fr: projectsIn('fr', LONG_PROJECTS, 'LNG'),
};

export function roadmapLongTitles(lang: SpecimenLang): readonly Project[] {
  return LONG_BY_LANG[lang];
}

export const ROADMAP_LABEL = copy('Roadmap', 'Feuille de route');

/** Lanes in the deck's order. */
export const ROADMAP_LANES: readonly AreaId[] = ['spaces', 'voice', 'channels', 'billing'];

export const projectStart = (item: Project): string => item.start;
export const projectEnd = (item: Project): string => item.end;
export const projectGroup = (item: Project): string => item.group;
export const projectStatus = (item: Project): string => item.statusLabel;
