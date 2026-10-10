import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { appFilesDigest } from '../src/runtime/app-platform.js';
import { applyPublication, collectSkillFolders, computeSpaceSourceChanges, describeAppliedChanges, lockAfterPull,
  readResourceList, readSpaceLock, resourceEntries, writeResourceList, writeSkillFolder, writeSpaceLock } from '../src/runtime/space-lock.js';

const b64 = (value) => Buffer.from(value).toString('base64');
const GUIDE = { 'SKILL.md': b64('# Guide'), 'scripts/run.py': b64('print(1)') };

function lock(overrides = {}) {
  return { version: 1, space_id: 'space-1', api_base: 'https://fixture.invalid', source_revision: 3, pulled_at: 'now',
    links: [
      { kind: 'skill', id: 'skill-guide', alias: 'guide', binding_id: 'b-guide', binding_revision: 1, available: true },
      { kind: 'database', id: 'db-rows', alias: 'rows', binding_id: 'b-rows', binding_revision: 2, available: true },
      { kind: 'skill', id: 'skill-curated', alias: 'curated', binding_id: 'b-curated', binding_revision: 1, available: true },
    ],
    skills: { guide: { skill_id: 'skill-guide', binding_id: 'b-guide', binding_revision: 1, version: { revision: 3, digest: 'a'.repeat(64) },
      folder_hash: appFilesDigest(GUIDE) } }, ...overrides };
}

function listOf(current) {
  return resourceEntries(current.links.map((link) => ({ ...link, resource_id: link.id })));
}

test('an untouched pull has no changes, whatever the key order of the list', () => {
  const current = lock();
  const folders = { guide: { files: GUIDE, digest: appFilesDigest(GUIDE) } };
  assert.deepEqual(computeSpaceSourceChanges({ lock: current, resources: listOf(current).reverse(), folders, manifest: {} }),
    { changes: null, summary: null, fingerprint: null });
  assert.deepEqual(computeSpaceSourceChanges({ lock: current, resources: null, folders, manifest: {} }).changes, null);
});

test('edited, new and deleted folders and list additions or removals become the exact server change set', () => {
  const current = lock({ skills: { ...lock().skills, old: { skill_id: 'skill-old', binding_id: 'b-old', binding_revision: 4,
    version: { revision: 1, digest: 'e'.repeat(64) }, folder_hash: 'was-there' } } });
  current.links.push({ kind: 'skill', id: 'skill-old', alias: 'old', binding_id: 'b-old', binding_revision: 4, available: true });
  const edited = { ...GUIDE, 'SKILL.md': b64('# Guide edited') };
  const folders = { guide: { files: edited, digest: appFilesDigest(edited) }, 'weekly-digest': { files: { 'SKILL.md': b64('# New') }, digest: 'x' } };
  const resources = [{ kind: 'skill', id: 'skill-guide', alias: 'guide' }, { kind: 'skill', id: 'skill-curated', alias: 'curated' },
    { kind: 'automation', id: 'auto-1', alias: 'weekly' }];
  const { changes, summary, fingerprint } = computeSpaceSourceChanges({ lock: current, resources, folders, manifest: { resources: {} } });
  assert.deepEqual(changes, {
    skills: { edits: { guide: { skill_id: 'skill-guide', binding_id: 'b-guide', binding_revision: 1, version: { revision: 3, digest: 'a'.repeat(64) }, files: edited } },
      creations: { 'weekly-digest': { files: { 'SKILL.md': b64('# New') } } } },
    links: { add: [{ kind: 'automation', resource_id: 'auto-1', alias: 'weekly' }],
      remove: [{ kind: 'skill', resource_id: 'skill-old', binding_id: 'b-old', binding_revision: 4, version: { revision: 1, digest: 'e'.repeat(64) } },
        { kind: 'database', resource_id: 'db-rows', binding_id: 'b-rows', binding_revision: 2 }] } });
  assert.deepEqual(summary.skills, { edited: ['guide'], created: ['weekly-digest'] });
  assert.equal(summary.links.added[0], 'weekly (automation)');
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(computeSpaceSourceChanges({ lock: current, resources: [...resources].reverse(), folders, manifest: {} }).fingerprint, fingerprint);
});

test('ambiguous local states are usage errors, never guessed link changes', () => {
  const current = lock();
  const guide = { guide: { files: GUIDE, digest: appFilesDigest(GUIDE) } };
  const list = listOf(current);
  // R5: a deleted tracked folder removes its link even while the list still names it.
  const unlinked = computeSpaceSourceChanges({ lock: current, resources: list, folders: {}, manifest: {} });
  assert.deepEqual(unlinked.changes.links.remove.map((entry) => entry.kind), ['skill']);
  assert.equal(unlinked.changes.skills, undefined);
  // Listed Skill removed while its folder stays.
  assert.throws(() => computeSpaceSourceChanges({ lock: current, resources: list.filter((entry) => entry.alias !== 'guide'), folders: guide, manifest: {} }), /no longer lists/);
  // Renamed alias.
  assert.throws(() => computeSpaceSourceChanges({ lock: current, resources: list.map((entry) => entry.alias === 'rows' ? { ...entry, alias: 'records' } : entry), folders: guide, manifest: {} }), /cannot be renamed/);
  // A folder named like a listed resource that is not an editable Skill folder of this pull.
  assert.throws(() => computeSpaceSourceChanges({ lock: current, resources: list, folders: { ...guide, curated: { files: GUIDE, digest: 'x' } }, manifest: {} }), /not an editable Skill folder/);
  // Unlisting a resource the definition declares.
  assert.throws(() => computeSpaceSourceChanges({ lock: current, resources: list.filter((entry) => entry.alias !== 'rows'), folders: guide,
    manifest: { resources: { rows: { kind: 'database', key: 'rows' } } } }), /declared by this Space's definition/);
  // A new list entry reusing an alias.
  assert.throws(() => computeSpaceSourceChanges({ lock: current, resources: [...list, { kind: 'automation', id: 'auto-1', alias: 'guide' }], folders: guide, manifest: {} }), /already used/);
});

test('after a publication the lock records applied versions and the server list, including links made elsewhere', () => {
  const current = lock();
  const edited = { 'SKILL.md': b64('# Guide edited') };
  const folders = { guide: { files: edited, digest: appFilesDigest(edited) }, 'weekly-digest': { files: { 'SKILL.md': b64('# New') }, digest: 'new-hash' } };
  const result = { published_revision: 4, applied: {
    skills: { guide: { operation: 'update', skill_id: 'skill-guide', version: { revision: 4, digest: 'b'.repeat(64) }, binding_id: 'b-guide', binding_revision: 1 },
      'weekly-digest': { operation: 'create', skill_id: 'skill-new', version: { revision: 1, digest: 'c'.repeat(64) }, binding_id: 'b-new', binding_revision: 1 } },
    links: [{ kind: 'automation', resource_id: 'auto-1', added: [{ alias: 'weekly', binding_id: 'b-weekly' }], removed: [] }],
    space_links: [
      { binding_id: 'b-guide', alias: 'guide', revision: 1, kind: 'skill', resource_id: 'skill-guide', available: true },
      { binding_id: 'b-new', alias: 'weekly-digest', revision: 1, kind: 'skill', resource_id: 'skill-new', available: true },
      { binding_id: 'b-weekly', alias: 'weekly', revision: 1, kind: 'automation', resource_id: 'auto-1', available: true },
      { binding_id: 'b-else', alias: 'elsewhere', revision: 1, kind: 'database', resource_id: 'db-else', available: false },
      { binding_id: 'b-doc', alias: 'note', revision: 1, kind: 'document', resource_id: 'doc-1', available: true },
    ] }, reviews: [{ alias: 'guide', skill_id: 'skill-guide', review_url: 'https://app.notis.ai/skill-reviews/guide' }] };
  const { lock: next, resources } = applyPublication({ lock: current, folders, result });
  assert.equal(next.source_revision, 4);
  assert.deepEqual(next.skills.guide, { skill_id: 'skill-guide', binding_id: 'b-guide', binding_revision: 1, version: { revision: 4, digest: 'b'.repeat(64) }, folder_hash: appFilesDigest(edited) });
  assert.deepEqual(next.skills['weekly-digest'], { skill_id: 'skill-new', binding_id: 'b-new', binding_revision: 1, version: { revision: 1, digest: 'c'.repeat(64) }, folder_hash: 'new-hash' });
  assert.deepEqual(next.links.map((link) => link.alias), ['elsewhere', 'guide', 'weekly', 'weekly-digest']);
  assert.equal(next.links[0].available, false);
  assert.deepEqual(resources, [{ kind: 'database', id: 'db-else', alias: 'elsewhere' }, { kind: 'skill', id: 'skill-guide', alias: 'guide' },
    { kind: 'automation', id: 'auto-1', alias: 'weekly' }, { kind: 'skill', id: 'skill-new', alias: 'weekly-digest' }]);
  assert.equal(describeAppliedChanges(result), ' Skills updated: guide. Skills created: weekly-digest. Links added: weekly (automation). Review guide: https://app.notis.ai/skill-reviews/guide.');
  const untouched = applyPublication({ lock: current, folders: { guide: folders.guide }, result: { published_revision: 5 } });
  assert.equal(untouched.resources, null); assert.equal(untouched.lock.source_revision, 5);
  assert.deepEqual(untouched.lock.skills, current.skills);
});

test('lock, list and Skill folders are read and written safely inside the pulled project', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'notis-space-lock-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(readSpaceLock(root), null);
  assert.equal(readResourceList(root), null);
  const current = lockAfterPull({ spaceId: 'space-1', apiBase: 'https://fixture.invalid', sourceRevision: 3,
    links: [{ binding_id: 'b-doc', alias: 'note', revision: 1, kind: 'document', resource_id: 'doc-1', available: true },
      { binding_id: 'b-guide', alias: 'guide', revision: 1, kind: 'skill', resource_id: 'skill-guide', available: true }],
    skills: { guide: { skill_id: 'skill-guide', binding_id: 'b-guide', binding_revision: 1, version: { revision: 3, digest: 'a'.repeat(64) }, folder_hash: appFilesDigest(GUIDE) } } });
  writeSpaceLock(root, current);
  assert.deepEqual(readSpaceLock(root), current);
  assert.deepEqual(current.links, [{ kind: 'skill', id: 'skill-guide', alias: 'guide', binding_id: 'b-guide', binding_revision: 1, available: true }], 'Document links are not resource links');
  assert.equal(existsSync(join(root, '.notis/space-lock.json')), true);
  writeResourceList(root, resourceEntries([{ binding_id: 'b-guide', alias: 'guide', revision: 1, kind: 'skill', resource_id: 'skill-guide' }]));
  assert.deepEqual(readResourceList(root), [{ kind: 'skill', id: 'skill-guide', alias: 'guide' }]);
  writeSkillFolder(root, 'guide', GUIDE);
  assert.equal(readFileSync(join(root, 'skills/guide/scripts/run.py'), 'utf8'), 'print(1)');
  assert.throws(() => writeSkillFolder(root, 'guide', GUIDE), /already exists/);
  writeSkillFolder(root, 'guide', GUIDE, { sourceSnapshot: GUIDE });
  const updatedGuide = { 'SKILL.md': b64('# Current native head'), 'references/fields.md': b64('Current fields') };
  writeSkillFolder(root, 'guide', updatedGuide, { sourceSnapshot: GUIDE });
  assert.equal(readFileSync(join(root, 'skills/guide/SKILL.md'), 'utf8'), '# Current native head');
  assert.equal(existsSync(join(root, 'skills/guide/scripts/run.py')), false, 'Files removed in the native head do not reappear from source');
  assert.throws(() => writeSkillFolder(root, 'guide', GUIDE, { sourceSnapshot: GUIDE }), /changed while pulling/);
  assert.equal(readFileSync(join(root, 'skills/guide/SKILL.md'), 'utf8'), '# Current native head', 'Source drift changes nothing');
  writeSkillFolder(root, 'guide', GUIDE, { sourceSnapshot: updatedGuide });
  assert.throws(() => writeSkillFolder(root, 'other', { '../escape.md': b64('x') }), /unsafe file path/);
  assert.throws(() => writeSkillFolder(root, 'Bad Alias', GUIDE), /Unsafe Skill alias/);
  mkdirSync(join(root, 'skills/other/node_modules'), { recursive: true });
  writeFileSync(join(root, 'skills/other/SKILL.md'), '# Other'); writeFileSync(join(root, 'skills/other/node_modules/dep.js'), 'x');
  writeFileSync(join(root, 'skills/other/.env'), 'SECRET=1');
  symlinkSync(join(root, 'skills/guide'), join(root, 'skills/linked'), 'dir');
  writeFileSync(join(root, 'skills/README.md'), 'not a folder');
  const folders = collectSkillFolders(root);
  assert.deepEqual(Object.keys(folders).sort(), ['guide', 'other']);
  assert.deepEqual(Object.keys(folders.other.files), ['SKILL.md'], 'Dependencies, secrets and symlinks never travel');
  assert.equal(folders.guide.digest, appFilesDigest(GUIDE));
  mkdirSync(join(root, 'skills/empty'));
  assert.throws(() => collectSkillFolders(root), /needs a SKILL.md/);
  rmSync(join(root, 'skills/empty'), { recursive: true });
  mkdirSync(join(root, 'skills/Not Valid'));
  assert.throws(() => collectSkillFolders(root), /Skill alias/);
  writeFileSync(join(root, 'resources.json'), JSON.stringify([{ kind: 'document', id: 'doc-1', alias: 'note' }]));
  assert.throws(() => readResourceList(root), /database\|skill\|automation/);
  writeFileSync(join(root, 'resources.json'), JSON.stringify([{ kind: 'skill', id: 'a', alias: 'x' }, { kind: 'skill', id: 'a', alias: 'y' }]));
  assert.throws(() => readResourceList(root), /twice/);
  writeFileSync(join(root, '.notis/space-lock.json'), JSON.stringify({ version: 2 }));
  assert.throws(() => readSpaceLock(root), /unreadable/);
});

test('a staged <kind>:<id> alias is kept in the list but never becomes a folder or a new entry', () => {
  const current = lock();
  const staged = { kind: 'skill', id: 'staged-skill', alias: 'skill:0b6c8f0e-5b1b-4a57-9d8e-3f1c6f1d2a11', binding_id: 'b-staged', binding_revision: 1 };
  current.links = [...current.links, staged];
  const list = [...listOf(current)];
  const guide = { guide: { files: GUIDE, digest: appFilesDigest(GUIDE) } };
  assert.equal(computeSpaceSourceChanges({ lock: current, resources: list, folders: guide, manifest: {} }).changes, null,
    'An untouched staged alias changes nothing');
  const added = [...list, { kind: 'database', id: 'new-db', alias: 'database:new-db' }];
  assert.throws(() => computeSpaceSourceChanges({ lock: current, resources: added, folders: guide, manifest: {} }), /not a valid alias for a new link/);
});
