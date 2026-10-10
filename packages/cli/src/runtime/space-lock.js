/**
 * Local record of a pulled Space: its resource list and the version of every
 * editable Skill folder (R5).
 *
 * `notis spaces pull` writes the Space's links to `resources.json`, every
 * editable linked Skill to `skills/<alias>/`, and this lock to
 * `.notis/space-lock.json` (local-only state, never part of the portable
 * source). `notis spaces deploy` compares the working tree with the lock and
 * sends only what changed since the pull, each item with the version it was
 * pulled at, so edits and links made elsewhere are kept and a conflict is named
 * before anything is uploaded.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

import { appFilesDigest, readSpaceStateFile, writeSpaceStateFile } from './app-platform.js';
import { usageError } from './errors.js';

export const SPACE_LOCK_FILE = 'space-lock.json';
export const RESOURCES_FILE = 'resources.json';
export const SKILLS_DIR = 'skills';
const ALIAS = /^[a-z][a-z0-9_-]{0,99}$/;
// Links staged from a legacy App without a declared name keep the migration's `<kind>:<id>` alias until renamed
// (`notis spaces resources name`); they can be listed and kept, never used as a Skill folder or a new entry.
const STAGED_ALIAS = /^(database|skill|automation):[A-Za-z0-9-]{1,64}$/;
export function isFolderAlias(alias) { return typeof alias === 'string' && ALIAS.test(alias); }
const LINK_KINDS = new Set(['database', 'skill', 'automation']);
const EXCLUDED_ENTRIES = new Set(['node_modules', '__pycache__', '.ds_store', '.git', '.notis', '.context']);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function excluded(name) {
  const lower = name.toLowerCase();
  return EXCLUDED_ENTRIES.has(lower) || lower.startsWith('.env') || lower.endsWith('.pyc') || lower.endsWith('.pyo');
}

function safeRelativePath(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || value.startsWith('/')
    || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw usageError(`${label} contains an unsafe file path: ${String(value)}`);
  }
  return value;
}

/** Links of the three linkable kinds as the portable list `[{kind, id, alias}]`, sorted by alias. */
export function resourceEntries(links) {
  return (Array.isArray(links) ? links : [])
    .filter((link) => LINK_KINDS.has(link?.kind))
    .map((link) => ({ kind: link.kind, id: link.resource_id, alias: link.alias }))
    .sort((a, b) => (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0));
}

/** The pulled list as the lock records it: identity, alias, binding and availability. */
export function lockLinks(links) {
  return (Array.isArray(links) ? links : [])
    .filter((link) => LINK_KINDS.has(link?.kind))
    .map((link) => ({ kind: link.kind, id: link.resource_id, alias: link.alias, binding_id: link.binding_id,
      binding_revision: link.revision, available: link.available !== false }))
    .sort((a, b) => (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0));
}

export function readSpaceLock(projectDir) {
  const lock = readSpaceStateFile(projectDir, SPACE_LOCK_FILE);
  if (lock === null) return null;
  if (!lock || typeof lock !== 'object' || lock.version !== 1 || typeof lock.space_id !== 'string' || !Array.isArray(lock.links)
    || !lock.skills || typeof lock.skills !== 'object' || Array.isArray(lock.skills)) {
    throw usageError('The Space lock file (.notis/space-lock.json) is unreadable. Pull the Space again.');
  }
  return lock;
}

export function writeSpaceLock(projectDir, lock) {
  return writeSpaceStateFile(projectDir, SPACE_LOCK_FILE, lock);
}

export function readResourceList(projectDir) {
  const path = join(resolve(projectDir), RESOURCES_FILE);
  if (!existsSync(path)) return null;
  if (lstatSync(path).isSymbolicLink()) throw usageError(`${RESOURCES_FILE} must be a regular file.`);
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch { throw usageError(`${RESOURCES_FILE} must be valid JSON.`); }
  if (!Array.isArray(parsed)) throw usageError(`${RESOURCES_FILE} must be a JSON array of {kind, id, alias} entries.`);
  const seen = new Set();
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).sort().join(',') !== 'alias,id,kind'
      || !LINK_KINDS.has(entry.kind) || typeof entry.id !== 'string' || !entry.id || typeof entry.alias !== 'string'
      || !(ALIAS.test(entry.alias) || STAGED_ALIAS.test(entry.alias))) {
      throw usageError(`${RESOURCES_FILE}[${index}] must be {kind: database|skill|automation, id, alias} with a lowercase alias.`);
    }
    const key = `${entry.kind}:${entry.id}`;
    if (seen.has(key)) throw usageError(`${RESOURCES_FILE} lists ${entry.kind} ${entry.id} twice.`);
    seen.add(key);
    return { kind: entry.kind, id: entry.id, alias: entry.alias };
  });
}

export function writeResourceList(projectDir, entries) {
  const root = resolve(projectDir);
  const temporary = join(root, `.${RESOURCES_FILE}-${randomUUID()}`);
  try {
    writeFileSync(temporary, JSON.stringify(entries, null, 2) + '\n', { flag: 'wx' });
    renameSync(temporary, join(root, RESOURCES_FILE));
  } finally { rmSync(temporary, { force: true }); }
}

function walkSkillFolder(directory, prefix, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || excluded(entry.name)) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walkSkillFolder(join(directory, entry.name), path, files);
    else if (entry.isFile()) files[path] = readFileSync(join(directory, entry.name)).toString('base64');
  }
}

/** Every `skills/<alias>/` folder as {alias: {files: {path: base64}, digest}}. */
export function collectSkillFolders(projectDir) {
  const root = join(resolve(projectDir), SKILLS_DIR);
  const folders = {};
  if (!existsSync(root) || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) return folders;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    if (!ALIAS.test(entry.name)) throw usageError(`${SKILLS_DIR}/${entry.name}: name the folder with the Skill alias (lowercase letters, digits, - or _).`);
    const files = {};
    walkSkillFolder(join(root, entry.name), '', files);
    if (!files['SKILL.md']) throw usageError(`${SKILLS_DIR}/${entry.name} needs a SKILL.md.`);
    folders[entry.name] = { files, digest: appFilesDigest(files) };
  }
  return folders;
}

/** The files of a Skill bundle a local folder keeps (the same exclusions as collectSkillFolders). */
export function skillFolderFiles(files) {
  return Object.fromEntries(Object.entries(files || {}).filter(([path]) => !path.split('/').some(excluded)));
}

/** Current linked Skill files own their folder; replacement requires the exact pulled snapshot. */
export function writeSkillFolder(projectDir, alias, files, { sourceSnapshot } = {}) {
  if (!ALIAS.test(alias)) throw usageError(`Unsafe Skill alias: ${alias}`);
  const root = join(resolve(projectDir), SKILLS_DIR, alias);
  const entries = Object.entries(files || {}).map(([path, encoded]) => {
    safeRelativePath(path, `Skill ${alias}`);
    return [path, Buffer.from(encoded, 'base64')];
  });
  if (sourceSnapshot !== undefined) {
    const changed = () => usageError(`${SKILLS_DIR}/${alias} changed while pulling its current Skill. Keep these local files and pull into a new directory.`);
    const readSnapshot = () => {
      const current = {};
      if (!existsSync(root) || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()
        || lstatSync(dirname(root)).isSymbolicLink()) throw changed();
      const walk = (directory, prefix = '') => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (entry.isSymbolicLink() || excluded(entry.name)) throw changed();
          const path = prefix + entry.name;
          if (entry.isDirectory()) walk(join(directory, entry.name), path + '/');
          else if (entry.isFile()) current[path] = readFileSync(join(directory, entry.name)).toString('base64');
          else throw changed();
        }
      };
      walk(root);
      return current;
    };
    const expected = appFilesDigest(sourceSnapshot);
    if (appFilesDigest(readSnapshot()) !== expected) throw changed();
    if (appFilesDigest(files) === expected) return;
    // The archive remains immutable on the server. The editable folder follows
    // the verified linked Skill head, including normalized frontmatter/deletions.
    const staging = join(resolve(projectDir), '.notis', `skill-pull-${randomUUID()}`);
    const backup = `${staging}-previous`;
    mkdirSync(staging, { recursive: true });
    let displaced = false;
    try {
      for (const [path, bytes] of entries) {
        const target = join(staging, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, bytes, { flag: 'wx' });
      }
      if (appFilesDigest(readSnapshot()) !== expected) throw changed();
      renameSync(root, backup); displaced = true;
      try { renameSync(staging, root); }
      catch (error) { renameSync(backup, root); displaced = false; throw error; }
      displaced = false;
      rmSync(backup, { recursive: true });
    } finally {
      rmSync(staging, { recursive: true, force: true });
      // If restoring the prior folder failed, retain its backup for recovery.
      if (!displaced) rmSync(backup, { recursive: true, force: true });
    }
    return;
  }
  for (const [path, bytes] of entries) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    try {
      writeFileSync(target, bytes, { flag: 'wx' });
    } catch (error) {
      if (error?.code === 'EEXIST') throw usageError(`${SKILLS_DIR}/${alias}/${path} already exists in the pulled source; the Skill folder cannot be written over it.`);
      throw error;
    }
  }
}

export function lockAfterPull({ spaceId, apiBase, sourceRevision, links, skills }) {
  return { version: 1, space_id: spaceId, api_base: apiBase, source_revision: sourceRevision, pulled_at: new Date().toISOString(),
    links: lockLinks(links), skills };
}

function byAlias(entries) {
  return new Map(entries.map((entry) => [entry.alias, entry]));
}

/**
 * What changed since the pull, as the server expects it:
 * edited and new Skill folders, deleted tracked folders and list additions or
 * removals. Returns { changes: null } when nothing changed. A deleted tracked
 * folder removes its link even while the list still names it. Ambiguous local
 * states (a kept folder whose list entry was removed, a renamed alias) are
 * usage errors, not conflicts.
 */
export function computeSpaceSourceChanges({ lock, resources, folders, manifest }) {
  const tracked = lock.skills || {};
  const lockLinksByKey = new Map((lock.links || []).map((link) => [`${link.kind}:${link.id}`, link]));
  const lockAliases = byAlias(lock.links || []);
  const declared = new Set(Object.keys(manifest?.resources || {}));
  const list = resources ?? resourceEntries(lock.links.map((link) => ({ ...link, resource_id: link.id })));
  const listByKey = new Map(list.map((entry) => [`${entry.kind}:${entry.id}`, entry]));
  const listAliases = byAlias(list);
  const edits = {}, creations = {}, add = [], remove = [];
  const removedSkills = new Set();

  for (const [alias, folder] of Object.entries(folders)) {
    const entry = tracked[alias];
    if (entry) {
      if (!listByKey.has(`skill:${entry.skill_id}`)) {
        throw usageError(`${RESOURCES_FILE} no longer lists the Skill of ${SKILLS_DIR}/${alias}. Delete the folder too to unlink it, or keep the entry.`);
      }
      if (entry.folder_hash !== folder.digest) {
        edits[alias] = { skill_id: entry.skill_id, binding_id: entry.binding_id, binding_revision: entry.binding_revision,
          version: entry.version, files: folder.files };
      }
    } else if (lockAliases.has(alias) || listAliases.has(alias)) {
      throw usageError(`${SKILLS_DIR}/${alias} matches a listed resource that is not an editable Skill folder of this pull. Choose another folder name or pull again.`);
    } else {
      creations[alias] = { files: folder.files };
    }
  }
  for (const [alias, entry] of Object.entries(tracked)) {
    if (folders[alias]) continue;
    // R5: deleting a tracked folder removes its link; a list entry left behind is rewritten after the deploy.
    if (declared.has(alias)) {
      throw usageError(`'${alias}' is declared by this Space's definition; remove it from the definition before deleting ${SKILLS_DIR}/${alias}.`);
    }
    removedSkills.add(entry.skill_id);
    remove.push({ kind: 'skill', resource_id: entry.skill_id, binding_id: entry.binding_id, binding_revision: entry.binding_revision,
      version: entry.version });
  }
  for (const entry of list) {
    const before = lockLinksByKey.get(`${entry.kind}:${entry.id}`);
    if (!before) {
      if (!ALIAS.test(entry.alias)) {
        throw usageError(`${RESOURCES_FILE}: '${entry.alias}' is not a valid alias for a new link; use lowercase letters, digits, - or _.`);
      }
      if (lockAliases.has(entry.alias) || folders[entry.alias] || creations[entry.alias]) {
        throw usageError(`${RESOURCES_FILE}: alias '${entry.alias}' is already used by another resource or Skill folder.`);
      }
      add.push({ kind: entry.kind, resource_id: entry.id, alias: entry.alias });
    } else if (before.alias !== entry.alias) {
      throw usageError(`${RESOURCES_FILE}: '${before.alias}' cannot be renamed to '${entry.alias}' here; aliases are stable once linked.`);
    }
  }
  for (const link of lock.links || []) {
    if (listByKey.has(`${link.kind}:${link.id}`) || removedSkills.has(link.id)) continue;
    if (declared.has(link.alias)) {
      throw usageError(`'${link.alias}' is declared by this Space's definition; remove it from the definition before removing it from ${RESOURCES_FILE}.`);
    }
    remove.push({ kind: link.kind, resource_id: link.id, binding_id: link.binding_id, binding_revision: link.binding_revision });
  }
  const changes = {};
  if (Object.keys(edits).length || Object.keys(creations).length) {
    changes.skills = { ...(Object.keys(edits).length ? { edits } : {}), ...(Object.keys(creations).length ? { creations } : {}) };
  }
  if (add.length || remove.length) changes.links = { ...(add.length ? { add } : {}), ...(remove.length ? { remove } : {}) };
  if (!Object.keys(changes).length) return { changes: null, summary: null, fingerprint: null };
  const summary = { skills: { edited: Object.keys(edits).sort(), created: Object.keys(creations).sort() },
    links: { added: add.map((entry) => `${entry.alias} (${entry.kind})`), removed: remove.map((entry) => `${entry.kind} ${entry.resource_id}`) } };
  return { changes, summary, fingerprint: createHash('sha256').update(stableJson(changes)).digest('hex') };
}

/**
 * The lock and list after a publication: the applied Skill versions, the new
 * Skills' identities and the Space's current links (including links made
 * elsewhere since the pull, which the deploy kept).
 */
export function applyPublication({ lock, folders, result }) {
  const applied = result?.applied;
  const next = { ...lock, source_revision: result?.published_revision ?? lock.source_revision, updated_at: new Date().toISOString() };
  if (!applied) return { lock: next, resources: null };
  const skills = {};
  for (const [alias, folder] of Object.entries(folders)) {
    const change = applied.skills?.[alias];
    if (change) {
      skills[alias] = { skill_id: change.skill_id, binding_id: change.binding_id, binding_revision: change.binding_revision,
        version: change.version, folder_hash: folder.digest };
    } else if (lock.skills?.[alias]) {
      skills[alias] = lock.skills[alias];
    }
  }
  next.skills = skills;
  next.links = lockLinks(applied.space_links || []);
  return { lock: next, resources: resourceEntries(applied.space_links || []) };
}

/** One line describing what a deploy changed, with the review link of every changed Skill. */
export function describeAppliedChanges(result) {
  const applied = result?.applied;
  if (!applied) return '';
  const parts = [];
  const edited = Object.entries(applied.skills || {}).filter(([, change]) => change.operation === 'update').map(([alias]) => alias);
  const created = Object.entries(applied.skills || {}).filter(([, change]) => change.operation === 'create').map(([alias]) => alias);
  if (edited.length) parts.push(`Skills updated: ${edited.join(', ')}`);
  if (created.length) parts.push(`Skills created: ${created.join(', ')}`);
  const added = (applied.links || []).flatMap((link) => (link.added || []).map((entry) => `${entry.alias} (${link.kind})`));
  const removed = (applied.links || []).flatMap((link) => (link.removed || []).map((entry) => `${entry.alias} (${link.kind})`));
  if (added.length) parts.push(`Links added: ${added.join(', ')}`);
  if (removed.length) parts.push(`Links removed: ${removed.join(', ')}`);
  for (const review of result.reviews || []) {
    if (review.review_url) parts.push(`Review ${review.alias}: ${review.review_url}`);
  }
  return parts.length ? ` ${parts.join('. ')}.` : '';
}
