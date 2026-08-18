import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MAX_APP_SKILL_BUNDLE_BYTES,
  normalizeAppSkillManifestPath,
  resolveConfiguredAppSkills,
} from '../src/runtime/app-platform.js';

function createProject() {
  return mkdtempSync(join(tmpdir(), 'notis-app-source-skills-'));
}

function writeSkillDirectory(projectDir) {
  const skillDir = join(projectDir, 'skills', 'new-workspace');
  mkdirSync(join(skillDir, 'scripts'), { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), '# New workspace\n\nRun the scripts.\n');
  writeFileSync(join(skillDir, 'scripts', 'run_job.sh'), '#!/bin/bash\necho job\n');
  writeFileSync(join(skillDir, 'reference.md'), 'Supporting notes.\n');
  return skillDir;
}

function decode(entry) {
  return Buffer.from(entry.content_b64, 'base64').toString('utf8');
}

test('a markdown-file skill declaration resolves exactly as before', () => {
  const projectDir = createProject();
  mkdirSync(join(projectDir, 'skills'), { recursive: true });
  writeFileSync(join(projectDir, 'skills', 'onboarding.md'), '# Onboarding\n');

  const [skill] = resolveConfiguredAppSkills(
    {
      skills: [
        { key: 'onboarding', path: './skills/onboarding.md', name: 'onboarding', description: ' Set up. ' },
      ],
    },
    projectDir,
  );

  assert.deepEqual(skill, {
    key: 'onboarding',
    path: 'skills/onboarding.md',
    name: 'onboarding',
    description: 'Set up.',
    skill_md: '# Onboarding\n',
  });
  assert.equal('bundle_files' in skill, false);
});

test('a directory skill declaration resolves SKILL.md plus its supporting files', () => {
  const projectDir = createProject();
  writeSkillDirectory(projectDir);

  const [skill] = resolveConfiguredAppSkills(
    { skills: [{ key: 'new-workspace', path: './skills/new-workspace/', name: 'New workspace' }] },
    projectDir,
  );

  assert.equal(skill.path, 'skills/new-workspace');
  assert.equal(skill.skill_md, '# New workspace\n\nRun the scripts.\n');
  assert.deepEqual(
    skill.bundle_files.map((entry) => entry.path),
    ['SKILL.md', 'reference.md', 'scripts/run_job.sh'],
  );
  assert.equal(
    decode(skill.bundle_files.find((entry) => entry.path === 'scripts/run_job.sh')),
    '#!/bin/bash\necho job\n',
  );
});

test('a directory skill declaration requires SKILL.md at its root', () => {
  const projectDir = createProject();
  const skillDir = join(projectDir, 'skills', 'new-workspace', 'scripts');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'run_job.sh'), 'echo job\n');

  assert.throws(
    () => resolveConfiguredAppSkills(
      { skills: [{ key: 'new-workspace', path: './skills/new-workspace/', name: 'New workspace' }] },
      projectDir,
    ),
    /must contain SKILL\.md/,
  );
});

test('a directory skill declaration skips excluded entries and symlinks', () => {
  const projectDir = createProject();
  const skillDir = writeSkillDirectory(projectDir);
  mkdirSync(join(skillDir, 'node_modules'), { recursive: true });
  writeFileSync(join(skillDir, 'node_modules', 'leftover.js'), 'module.exports = {};\n');
  writeFileSync(join(skillDir, '.env.local'), 'SECRET=1\n');
  symlinkSync(join(projectDir, 'skills', 'new-workspace', 'SKILL.md'), join(skillDir, 'linked.md'));

  const [skill] = resolveConfiguredAppSkills(
    { skills: [{ key: 'new-workspace', path: './skills/new-workspace', name: 'New workspace' }] },
    projectDir,
  );

  assert.deepEqual(
    skill.bundle_files.map((entry) => entry.path),
    ['SKILL.md', 'reference.md', 'scripts/run_job.sh'],
  );
});

test('a directory skill declaration rejects a path that escapes the project', () => {
  const projectDir = createProject();
  writeSkillDirectory(projectDir);

  assert.throws(
    () => resolveConfiguredAppSkills(
      { skills: [{ key: 'new-workspace', path: '../new-workspace/', name: 'New workspace' }] },
      projectDir,
    ),
    /must stay inside the project/,
  );
});

test('a configured directory skill root cannot be a symlink', () => {
  const projectDir = createProject();
  const outside = createProject();
  const outsideSkill = writeSkillDirectory(outside);
  mkdirSync(join(projectDir, 'skills'), { recursive: true });
  symlinkSync(outsideSkill, join(projectDir, 'skills', 'linked-skill'));

  assert.throws(
    () => resolveConfiguredAppSkills(
      { skills: [{ key: 'linked', path: './skills/linked-skill', name: 'Linked' }] },
      projectDir,
    ),
    /cannot be a symbolic link|must stay inside the project after resolving links/,
  );
});

test('a configured markdown skill root cannot be a symlink', () => {
  const projectDir = createProject();
  const outside = createProject();
  const outsideFile = join(outside, 'secret.md');
  writeFileSync(outsideFile, 'host-only content\n');
  mkdirSync(join(projectDir, 'skills'), { recursive: true });
  symlinkSync(outsideFile, join(projectDir, 'skills', 'linked.md'));

  assert.throws(
    () => resolveConfiguredAppSkills(
      { skills: [{ key: 'linked', path: './skills/linked.md', name: 'Linked' }] },
      projectDir,
    ),
    /cannot be a symbolic link|must stay inside the project after resolving links/,
  );
});

test('a directory skill declaration rejects files above the bundle size cap', () => {
  const projectDir = createProject();
  const skillDir = writeSkillDirectory(projectDir);
  writeFileSync(join(skillDir, 'huge.bin'), Buffer.alloc(MAX_APP_SKILL_BUNDLE_BYTES + 1));

  assert.throws(
    () => resolveConfiguredAppSkills(
      { skills: [{ key: 'new-workspace', path: './skills/new-workspace/', name: 'New workspace' }] },
      projectDir,
    ),
    /above the \d+ byte limit/,
  );
});

test('manifest skill paths drop the leading dot-slash and any trailing slash', () => {
  assert.equal(normalizeAppSkillManifestPath('./skills/new-workspace/'), 'skills/new-workspace');
  assert.equal(normalizeAppSkillManifestPath('skills/onboarding.md'), 'skills/onboarding.md');
  assert.equal(normalizeAppSkillManifestPath(undefined), '');
});
