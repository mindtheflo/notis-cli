'use client';

import { useNotisRuntime } from '../provider';
import { useQuery, type UseQueryResult } from './useQuery';
import {
  SPACE_VIEWER_READ_OPERATIONS,
  type SpaceViewerDatabase,
  type SpaceViewerReadFamily,
  type SpaceViewerReadInput,
  type SpaceViewerReadOperation,
  type SpaceViewerReadResult,
  type SpaceViewerSkill,
} from '../space';

export interface UseViewerReadOptions {
  enabled?: boolean;
  staleTimeMs?: number;
}

// Bounded crawl of the viewer's Skill inventory: 50 pages of 100.
const MAX_SKILL_PAGES = 50;

/**
 * True when this page may read what the signed-in viewer can open: the Space declares
 * `viewerReads` for this family and the host offers it (never on a Site or anonymous link).
 * Render a fallback when false.
 */
export function useViewerReadAvailable(family: SpaceViewerReadFamily): boolean {
  const runtime = useNotisRuntime();
  return runtime?.resource?.kind === 'space' && typeof runtime.viewerRead === 'function'
    && Boolean(runtime.space?.viewerReads?.includes(family));
}

/** One cached, read-only viewer read. Results are scoped to the current viewer by the host cache scope. */
export function useViewerRead<TOperation extends SpaceViewerReadOperation>(operation: TOperation,
  input: SpaceViewerReadInput[TOperation], options: UseViewerReadOptions = {}): UseQueryResult<SpaceViewerReadResult[TOperation]> {
  const runtime = useNotisRuntime();
  const available = useViewerReadAvailable(SPACE_VIEWER_READ_OPERATIONS[operation]);
  return useQuery(['viewer-read', operation, input], async () => {
    if (!runtime?.viewerRead) throw new Error('Viewer reads are unavailable here.');
    return runtime.viewerRead<SpaceViewerReadResult[TOperation]>(operation, input as Record<string, unknown>);
  }, { readOnly: true, enabled: available && options.enabled !== false, staleTimeMs: options.staleTimeMs });
}

/** Every database the signed-in viewer can open, with its available links and read target. */
export function useViewerDatabases(options: UseViewerReadOptions = {}): UseQueryResult<SpaceViewerDatabase[]> {
  const runtime = useNotisRuntime();
  const available = useViewerReadAvailable('databases');
  return useQuery(['viewer-databases'], async () => {
    if (!runtime?.viewerRead) throw new Error('Viewer reads are unavailable here.');
    const result = await runtime.viewerRead<SpaceViewerReadResult['list_databases']>('list_databases', {});
    if (!Array.isArray(result?.databases)) throw new Error('The database list is incomplete.');
    return result.databases;
  }, { readOnly: true, enabled: available && options.enabled !== false, staleTimeMs: options.staleTimeMs });
}

type ListSkillsRead = (input: SpaceViewerReadInput['list_skills']) => Promise<SpaceViewerReadResult['list_skills']>;

// Content pages read at once. Each one holds an API worker while its snapshots are read, and the API
// has only a few, so a large inventory never takes them all: two pages, plus one quick cursor read.
export const SKILL_CONTENT_PAGES_AT_ONCE = 2;

/**
 * Every Skill page, in order. Pages with instructions are slow (each reads its snapshots), so the next
 * page's cursor comes from a quick read without them and that page starts while the previous one is
 * still read, at most SKILL_CONTENT_PAGES_AT_ONCE content pages at a time. A cursor that no longer
 * matches (the list changed meanwhile) drops the pages started from it, waits for them to end and
 * continues from the real cursor.
 */
export async function readAllViewerSkills(read: ListSkillsRead,
  { includeContent, includeDisabled }: { includeContent: boolean; includeDisabled: boolean }): Promise<SpaceViewerSkill[]> {
  const page = (after: string | null, content: boolean) => read({ limit: 100, include_content: content,
    include_disabled: includeDisabled, ...(after ? { after } : {}) }).then(result => {
    if (!Array.isArray(result?.skills)) throw new Error('The Skill list is incomplete.');
    return result;
  });
  const skills: SpaceViewerSkill[] = [];
  // The pages started and not read yet, in order, each with the cursor it started from.
  const started: { after: string | null; result: Promise<SpaceViewerReadResult['list_skills']> }[] = [];
  // Where the next page to start begins, and whether a quick read (or the last page read) says it exists.
  let cursor: string | null = null;
  let known = true;
  let pages = 0;
  for (;;) {
    if (known && started.length < (includeContent ? SKILL_CONTENT_PAGES_AT_ONCE : 1) && pages + started.length < MAX_SKILL_PAGES) {
      const current = { after: cursor, result: page(cursor, includeContent) };
      void current.result.catch(() => {});
      started.push(current);
      known = false;
      if (includeContent) {
        const probe = await page(cursor, false);
        known = Boolean(probe.has_more && probe.next);
        cursor = probe.next ?? null;
      }
      continue;
    }
    const head = started.shift();
    if (!head) break;
    const result = await head.result;
    skills.push(...result.skills);
    pages += 1;
    if (!result.has_more || !result.next) return skills;
    // A page started ahead is kept only when it continues exactly where this one ended; otherwise (and
    // when none was started) the next page starts from this page's own cursor.
    if (started[0]?.after !== result.next) {
      const dropped = started.splice(0);
      await Promise.allSettled(dropped.map(entry => entry.result));
      cursor = result.next;
      known = true;
    }
  }
  throw new Error('This account has more Skills than a page can read at once.');
}

/**
 * Every Skill the signed-in viewer can see, all pages. With `includeContent`, `skill_md`
 * is present where the viewer holds content access and null elsewhere (curated, legacy).
 */
export function useViewerSkills(options: UseViewerReadOptions & { includeContent?: boolean; includeDisabled?: boolean } = {}):
  UseQueryResult<SpaceViewerSkill[]> {
  const runtime = useNotisRuntime();
  const available = useViewerReadAvailable('skills');
  const includeContent = options.includeContent === true, includeDisabled = options.includeDisabled === true;
  return useQuery(['viewer-skills', includeContent, includeDisabled], async () => {
    if (!runtime?.viewerRead) throw new Error('Viewer reads are unavailable here.');
    return readAllViewerSkills((input: SpaceViewerReadInput['list_skills']) => runtime.viewerRead!('list_skills', input),
      { includeContent, includeDisabled });
  }, { readOnly: true, enabled: available && options.enabled !== false, staleTimeMs: options.staleTimeMs });
}
