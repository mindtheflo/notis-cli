import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const APP_CHANGELOG_FILE = 'CHANGELOG.md';
export const CHANGELOG_MERGE_DATE = '{PR_MERGE_DATE}';

const ENTRY_HEADING = /^##\s+\[([^\]]+)]\s+-\s+(\{PR_MERGE_DATE\}|\d{4}-\d{2}-\d{2})\s*$/;

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseAppChangelog(markdown, { sourcePath = APP_CHANGELOG_FILE } = {}) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const entries = [];
  const errors = [];
  let current = null;

  function finishCurrent() {
    if (!current) return;
    entries.push({
      title: current.title,
      date: current.date,
      body: current.body.join('\n').trim(),
    });
  }

  for (const [index, line] of lines.entries()) {
    // Only a level-2 heading (`## ...`, not `###`/`####`) can start a release
    // entry; deeper sub-section headings are legitimate release-body content.
    if (!/^##(?!#)/.test(line)) {
      if (current) current.body.push(line);
      continue;
    }

    const match = line.match(ENTRY_HEADING);
    if (!match) {
      errors.push(
        `${sourcePath}:${index + 1} must use \`## [Release title] - YYYY-MM-DD\` or \`## [Release title] - {PR_MERGE_DATE}\`.`,
      );
      continue;
    }

    finishCurrent();
    const title = match[1].trim();
    const date = match[2];
    if (!title) {
      errors.push(`${sourcePath}:${index + 1} must include a release title inside square brackets.`);
    }
    if (date !== CHANGELOG_MERGE_DATE && !validCalendarDate(date)) {
      errors.push(`${sourcePath}:${index + 1} contains an invalid calendar date.`);
    }
    current = { title, date, body: [] };
  }
  finishCurrent();

  if (entries.length === 0 && errors.length === 0) {
    errors.push(
      `${sourcePath} must include at least one \`## [Release title] - YYYY-MM-DD\` entry.`,
    );
  }

  return { source_path: sourcePath, entries, errors, exists: true };
}

export function readAppChangelog(projectDir) {
  const path = join(projectDir, APP_CHANGELOG_FILE);
  if (!existsSync(path)) {
    return {
      source_path: APP_CHANGELOG_FILE,
      entries: [],
      errors: [`${APP_CHANGELOG_FILE} is required for Store publication.`],
      exists: false,
    };
  }
  return parseAppChangelog(readFileSync(path, 'utf-8'));
}
