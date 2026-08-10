import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMMAND_SPECS } from '../src/command-specs/index.js';

const repoRoot = resolve(import.meta.dirname, '../../..');
const cliRoot = resolve(import.meta.dirname, '..');
const NPX_NOTIS = 'npx --package @notis_ai/cli@latest -- notis';

function npxCommand(command) {
  return command.replace(/^notis\b/, NPX_NOTIS);
}

function commandLine(spec) {
  const args = (spec.args_schema?.arguments || []).map((arg) => arg.token).join(' ');
  return `${NPX_NOTIS} ${spec.command_path.join(' ')}${args ? ` ${args}` : ''}`;
}

function renderCommandBlock(spec) {
  const options = spec.args_schema?.options || [];
  const lines = [
    `### \`${commandLine(spec)}\``,
    '',
    spec.summary,
    '',
    `When to use: ${spec.when_to_use}`,
    '',
  ];

  if (options.length) {
    lines.push('Options:');
    for (const option of options) {
      lines.push(`- \`${option.flags}\` — ${option.description}`);
    }
    lines.push('');
  }

  lines.push('Examples:');
  for (const example of spec.examples || []) {
    lines.push(`- \`${npxCommand(example)}\``);
  }
  lines.push('');

  return lines.join('\n');
}

function specsFor(prefix) {
  return COMMAND_SPECS.filter(
    (spec) =>
      spec.command_path[0] === prefix &&
      !spec.deprecated_alias_for
  );
}

function renderReadme() {
  const appSpecs = specsFor('apps');
  const toolSpecs = specsFor('tools');
  const doctorSpec = COMMAND_SPECS.find((spec) => spec.command_path.join(' ') === 'doctor');
  const whoamiSpec = COMMAND_SPECS.find((spec) => spec.command_path.join(' ') === 'whoami');
  const describeSpec = COMMAND_SPECS.find((spec) => spec.command_path.join(' ') === 'describe');
  const loginSpec = COMMAND_SPECS.find((spec) => spec.command_path.join(' ') === 'login');
  const profileSpecs = specsFor('profile');
  const logoutSpec = COMMAND_SPECS.find((spec) => spec.command_path.join(' ') === 'logout');

  return `# @notis_ai/cli

Agent-first Notis CLI for apps and generic tool execution.

## Install

Use the Notis CLI through NPX; do not rely on an installed \`notis\` command. Run \`notis login\` once to authorize a scoped, revocable OAuth credential in the browser — that is how the CLI signs in everywhere, including on a machine that also runs Notis Desktop.

For CI, hosted agents, or internal scripts, pass a non-persisted token with \`NOTIS_JWT=<token>\`.

## Quick Start

\`\`\`bash
npx --package @notis_ai/cli@latest -- notis --help
npx --package @notis_ai/cli@latest -- notis login
npx --package @notis_ai/cli@latest -- notis doctor
npx --package @notis_ai/cli@latest -- notis apps list
npx --package @notis_ai/cli@latest -- notis tools search "list Notis databases"
\`\`\`

Use \`notis login --paste-code\` for the HTTPS copy-paste fallback on a remote machine.

## Profiles

A profile is one account paired with one API endpoint. Every profile keeps its own credential, so switching between them never signs any of them out.

\`\`\`bash
npx --package @notis_ai/cli@latest -- notis login --profile work
npx --package @notis_ai/cli@latest -- notis profile list
npx --package @notis_ai/cli@latest -- notis profile use work
npx --package @notis_ai/cli@latest -- notis --profile default tools search "..."
\`\`\`

\`notis logout\` revokes and removes the OAuth grant for one profile; \`--all-profiles\` clears every one.

Credential precedence within the selected profile is: an active \`./dev.sh\` worktree credential, then \`NOTIS_JWT\`, then the profile's OAuth grant.

\`./dev.sh\` exposes its test account as a lease-backed \`dev-<workspace>-<hash>\` profile bound to its loopback backend. The credential stays in the worktree rather than the shared account config. That synthetic profile is the default only inside its active worktree; naming any stored profile with \`--profile\` runs against that real account instead.

The CLI defaults to \`json\` output in agent or non-TTY contexts and \`table\` output in interactive terminals.

## Global Flags

- \`--json\` — Shortcut for \`--output json\`
- \`--output <table|json|yaml|ndjson>\` — Output mode override
- \`--non-interactive\` — Disable prompts
- \`--profile <name>\` — Run as a stored profile instead of the active one
- \`--api-base <url>\` — Override the API base for one invocation
- \`--timeout-ms <n>\` — HTTP timeout in milliseconds
- \`--idempotency-key <key>\` — Override the generated idempotency key for mutating commands

## Authentication

${renderCommandBlock(loginSpec)}
${renderCommandBlock(logoutSpec)}

## Apps

${appSpecs.map(renderCommandBlock).join('\n')}

## Generic Tools

${toolSpecs.map(renderCommandBlock).join('\n')}

## Profile Commands

${profileSpecs.map(renderCommandBlock).join('\n')}

## Meta Commands

${renderCommandBlock(doctorSpec)}
${renderCommandBlock(whoamiSpec)}
${renderCommandBlock(describeSpec)}

## Local Development

\`\`\`bash
cd packages/cli
npm install
node ./bin/notis.js --help
npm run docs:generate
npm test
\`\`\`
`;
}

function renderAppsSkillDoc() {
  const appSpecs = specsFor('apps');
  const doctorSpec = COMMAND_SPECS.find((spec) => spec.command_path.join(' ') === 'doctor');

  return `# Notis CLI — App Development Workflow

When running outside the Notis container, use the \`notis\` CLI to work with Notis Apps locally.

Notis apps are Vite + React projects using \`@notis/sdk\`. The workflow is init, dev, build, verify, create/link, pull, deploy, and doctor.

Important: \`notis apps deploy\` updates the linked installed app. It is not an app-store publishing flow.

## Setup

Run \`${NPX_NOTIS} login\` to authorize the CLI. Run commands through NPX, for example \`${NPX_NOTIS} apps list\`.

For CI, hosted agents, or internal scripts, pass a non-persisted token with \`NOTIS_JWT=<token>\` and use \`--api-base <server-url>\` when targeting a non-default server.

## Core Workflow

1. Scaffold a new app:

\`\`\`bash
npx --package @notis_ai/cli@latest -- notis apps init
\`\`\`

2. Or pull an installed app's saved source snapshot:

\`\`\`bash
npx --package @notis_ai/cli@latest -- notis apps pull <app-id> ./my-app
cd ./my-app
npm install
\`\`\`

3. Develop locally with live reload:

\`\`\`bash
npx --package @notis_ai/cli@latest -- notis apps dev
\`\`\`

4. Build the production artifact:

\`\`\`bash
npx --package @notis_ai/cli@latest -- notis apps build
\`\`\`

5. Verify the built artifact headlessly:

\`\`\`bash
npx --package @notis_ai/cli@latest -- notis apps verify
\`\`\`

6. Link the project if it was not created or pulled from an app, then deploy:

\`\`\`bash
npx --package @notis_ai/cli@latest -- notis apps link <app-id>
npx --package @notis_ai/cli@latest -- notis apps deploy
\`\`\`

## Commands

${[doctorSpec, ...appSpecs].map(renderCommandBlock).join('\n')}
`;
}

function renderDbSkillDoc() {
  const doctorSpec = COMMAND_SPECS.find((spec) => spec.command_path.join(' ') === 'doctor');

  return `# Notis CLI — Database Tool Workflow

Use the generic \`notis tools\` workflow through NPX for native Notis Database operations from the terminal. The dedicated database command group has been removed.

## Setup

Run \`${NPX_NOTIS} login\` to authorize the CLI. Run commands through NPX, for example \`${NPX_NOTIS} tools search "list Notis databases"\`.

For CI, hosted agents, or internal scripts, pass a non-persisted token with \`NOTIS_JWT=<token>\` and use \`--api-base <server-url>\` when targeting a non-default server.

## Canonical database tools

- \`LOCAL_NOTIS_DATABASE_LIST_DATABASES\` — list native databases.
- \`LOCAL_NOTIS_DATABASE_GET_DATABASE\` — inspect one database schema.
- \`LOCAL_NOTIS_DATABASE_QUERY\` — query native database documents.
- \`LOCAL_NOTIS_DATABASE_UPSERT_DATABASE\` — create or update database schema. Creation requires the owning app's slug or id in the \`app\` argument (every database belongs to a Notis app).

## Workflow

\`\`\`bash
npx --package @notis_ai/cli@latest -- notis tools search "list Notis databases"
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_LIST_DATABASES --arguments '{}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_GET_DATABASE --get-schema
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_GET_DATABASE --arguments '{"database_slug":"tasks"}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_QUERY --dry-run --arguments '{"database_slug":"tasks","query":{"page_size":10}}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_QUERY --arguments '{"database_slug":"tasks","query":{"page_size":10}}'
\`\`\`

## Supporting command

${renderCommandBlock(doctorSpec).trimEnd()}
`;
}

function syncFile(path, content, checkOnly) {
  if (checkOnly) {
    const current = readFileSync(path, 'utf-8');
    if (current !== content) {
      throw new Error(`Generated docs are out of date: ${path}`);
    }
    return;
  }
  writeFileSync(path, content);
}

const checkOnly = process.argv.includes('--check');

syncFile(resolve(cliRoot, 'README.md'), renderReadme(), checkOnly);
syncFile(resolve(repoRoot, 'packages/cli/skills/notis-apps/cli.md'), renderAppsSkillDoc(), checkOnly);
syncFile(resolve(repoRoot, 'packages/cli/skills/notis-query/cli.md'), renderDbSkillDoc(), checkOnly);
