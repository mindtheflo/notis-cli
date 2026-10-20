/**
 * The ownership test of the design system book (design review spec, section 5.4).
 *
 * For every component a specimen covers, the file declaring it (from `api.mjs`, after following re-exports and
 * aliases) must belong to the specimen's group under the rule of `groups.json`: the first group with a prefix
 * the path relative to `packages/sdk/src/` starts with.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readApi } from './api.mjs';
import { checkInventory, groupOfSource, loadGroups } from './inventory';

const SRC = 'packages/sdk/src/';

const groups = await loadGroups();
const api = readApi();
const report = await checkInventory({ words: false });

test('groups.json: ordered keys, unique, and the last group owns every file', () => {
  const keys = groups.map((group) => group.key);
  assert.equal(new Set(keys).size, keys.length, `duplicate group keys in groups.json: ${keys.join(', ')}`);
  assert.ok(groups.length > 0 && groups[groups.length - 1].owns.includes(''), 'the last group of groups.json must own "" so every file has a group');
});

test('every covered component is declared in a file its specimen group owns', () => {
  const problems: string[] = [];
  for (const component of report.components) {
    if (!component.specimen_file) continue;
    const specimen = report.specimens.find((item) => item.file === component.specimen_file);
    if (!specimen) continue;
    const rows = api.filter((row) => row.name === component.name && component.entries.includes(row.entry as never));
    const row = rows.find((item) => item.file?.startsWith(SRC)) ?? rows[0];
    if (!row?.file || !row.file.startsWith(SRC)) {
      problems.push(`${component.name}: api.mjs found no declaration file under ${SRC} (got ${row?.file ?? 'nothing'}); ${component.specimen_file} cannot be checked.`);
      continue;
    }
    const owner = groupOfSource(groups, row.file.slice(SRC.length));
    if (owner !== specimen.group) {
      problems.push(`${component.name} is declared in ${row.file}:${row.line}, owned by group "${owner}", but its specimen ${component.specimen_file} is in group "${specimen.group}": move the specimen to specimens/${owner}/ (or change groups.json, a core change).`);
    }
  }
  assert.equal(problems.length, 0, `\n${problems.join('\n')}`);
});
