import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { copyBoundaryRules } from '../scripts/copy-boundary-rules.js';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf-8'));

test('package.json "files" declares every runtime directory the installed CLI needs', () => {
  for (const entry of ['bin/', 'config/', 'dist/', 'src/']) {
    assert.ok(manifest.files.includes(entry), `package.json "files" must include ${entry}`);
  }
});

test('npm pack includes the bin entry and the app boundary rules (0.2.2 boot-crash regression)', () => {
  // The 0.2.2 crash was a runtime file (config/) that was never packed. Assert
  // against the ACTUAL pack file list, not just the "files" array, so an
  // .npmignore or a missing copy step is caught too.
  copyBoundaryRules({ repoRoot: resolve(cliRoot, '../..'), cliRoot });

  const raw = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: cliRoot,
    encoding: 'utf-8',
  });
  const packed = JSON.parse(raw);
  const files = (packed[0]?.files || []).map((file) => file.path);

  for (const required of [
    'bin/notis.js',
    'config/notis_app_boundary_rules.json',
    'skills/notis-cli/AGENT_INSTRUCTIONS.md',
    'dist/skill-sync/index.js',
    'dist/agent-hooks/notis-agent-hook.mjs',
    'dist/base-skills/notis-apps/SKILL.md',
    'dist/base-skills/notis-query/SKILL.md',
    'dist/base-skills/notis-cli/SKILL.md',
  ]) {
    assert.ok(files.includes(required), `npm pack must include ${required}; packed ${files.length} files`);
  }
});
