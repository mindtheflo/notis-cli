import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAppChangelog } from '../src/runtime/app-changelog.js';

test('Raycast-style changelog parser keeps editable release entries in file order', () => {
  const result = parseAppChangelog(`# Journal Changelog

## [A Better Journal] - {PR_MERGE_DATE}

- Added morning and evening rituals.
- Added **Stats**.

## [Initial Release] - 2026-07-14

- First release.
`);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.entries, [
    {
      title: 'A Better Journal',
      date: '{PR_MERGE_DATE}',
      body: '- Added morning and evening rituals.\n- Added **Stats**.',
    },
    {
      title: 'Initial Release',
      date: '2026-07-14',
      body: '- First release.',
    },
  ]);
});

test('Raycast-style changelog parser reports malformed release headings', () => {
  const result = parseAppChangelog('## Latest release - 2026-07-17\n\n- Missing brackets.');

  assert.equal(result.entries.length, 0);
  assert.match(result.errors.join('\n'), /\[Release title]/);
});
