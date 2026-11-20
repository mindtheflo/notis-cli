// `notis repository-secrets`: the repository secrets of your team (or your own), FAC-039 and FAC-070.
//
// A repository secret is a variable (STRIPE_SECRET_KEY) or a whole env file named by its path in the checkout
// (server/.env). Notis keeps it encrypted and never shows it again: list answers names, kinds, who set each one and
// when. set reads the value from a file or stdin here and sends it straight to POST /repository_secrets, never
// through the generic tool pipeline, so it is not part of any tool request record. exec is the only way a value
// leaves Notis: it asks for one repository's environment (the CLI-only `environment` action) and starts a command
// with those variables in its environment, so they never land in a file. It never prints a value.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { constants } from 'node:os';
import { httpRequest } from '../runtime/transport.js';
import { usageError } from '../runtime/errors.js';

const PATH = '/repository_secrets';
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

async function call(ctx, body) {
  return httpRequest({ runtime: ctx.runtime, method: 'POST', path: PATH, body });
}

function label(secret) {
  return secret?.kind === 'variable' ? `${secret.repository} · ${secret.name}` : `${secret.repository}/${secret.name}`;
}

function secretLine(secret) {
  const who = secret?.set_by?.you ? 'you' : (secret?.set_by?.name || 'a teammate');
  return `${label(secret)}  set by ${who}  ${secret.updated_at || ''}`.trimEnd();
}

function readValue(ctx, isVariable) {
  if (ctx.options.file && ctx.options.stdin) throw usageError('Choose --file or --stdin, not both.');
  let value;
  if (ctx.options.file) value = readFileSync(ctx.options.file, 'utf8');
  else if (ctx.options.stdin) value = readFileSync(0, 'utf8');
  else throw usageError('Pass --file <path> or --stdin with the value to store. Values are never typed as arguments.');
  // `echo value | ... --stdin` ends with a newline that is not part of a variable's value.
  return isVariable ? value.replace(/\r?\n$/, '') : value;
}

function names(items) {
  return (Array.isArray(items) ? items : []).map(item => (typeof item === 'string' ? item : label(item))).filter(Boolean);
}

/** Starts argv with env, inheriting stdio; resolves with its exit code (128 + the signal's number when killed). */
export function runWithEnvironment(argv, env) {
  return new Promise((resolve) => {
    let child;
    const forward = (signal) => {
      // From a terminal, Ctrl-C already reached the command (same foreground process group): a second SIGINT
      // would read as "force quit" to servers that stop gracefully on the first.
      if (signal === 'SIGINT' && process.stdin.isTTY) return;
      try { child?.kill(signal); } catch { /* already gone */ }
    };
    const stopForwarding = () => { for (const signal of FORWARDED_SIGNALS) process.removeListener(signal, forward); };
    for (const signal of FORWARDED_SIGNALS) process.on(signal, forward);
    try {
      child = spawn(argv[0], argv.slice(1), { stdio: 'inherit', env });
    } catch (error) {
      stopForwarding();
      process.stderr.write(`notis repository-secrets exec: could not start ${argv[0]} (${error?.code || 'error'})\n`);
      resolve(127);
      return;
    }
    child.once('error', (error) => {
      stopForwarding();
      process.stderr.write(`notis repository-secrets exec: could not start ${argv[0]} (${error?.code || 'error'})\n`);
      resolve(error?.code === 'ENOENT' ? 127 : 126);
    });
    child.once('exit', (code, signal) => {
      stopForwarding();
      resolve(typeof code === 'number' ? code : 128 + (constants.signals[signal] || 0));
    });
  });
}

const repositoryOption = { flags: '--repository <name>', description: 'The repository\'s short name, such as notis.' };

export const repositorySecretsCommandSpecs = [{
  command_path: ['repository-secrets', 'list'],
  summary: 'List the repository secrets of your team (or your own): names, kinds, who set each one and when.',
  when_to_use: 'See which variables and env files Notis keeps for a repository. Values are never shown.',
  args_schema: { options: [{ ...repositoryOption, description: 'Only this repository.' }] },
  examples: ['notis repository-secrets list', 'notis repository-secrets list --repository notis'],
  mutates: false, idempotent: true, require_auth: true,
  backend_call: { type: 'http', path: PATH },
  async handler(ctx) {
    const { payload, requestId } = await call(ctx, { action: 'list', ...(ctx.options.repository ? { repository: ctx.options.repository } : {}) });
    const secrets = Array.isArray(payload?.secrets) ? payload.secrets : [];
    return ctx.output.emitSuccess({ command: 'repository-secrets list', data: payload, meta: { mutating: false, request_id: requestId },
      humanSummary: secrets.length ? secrets.map(secretLine).join('\n') : 'No repository secrets yet.' });
  },
}, {
  command_path: ['repository-secrets', 'set'],
  summary: 'Store or replace a variable or an env file as a repository secret, encrypted. It is never shown again.',
  when_to_use: 'Give the team\'s dev servers a key (--name STRIPE_SECRET_KEY --stdin) or a whole env file (--file server/.env). Any team member can replace one.',
  args_schema: { options: [
    repositoryOption,
    { flags: '--name <name>', description: 'A variable\'s name, such as STRIPE_SECRET_KEY, or the env file\'s path in the repository, such as server/.env (defaults to --file).' },
    { flags: '--file <path>', description: 'Read the value from this file.' },
    { flags: '--stdin', description: 'Read the value from standard input.' },
  ] },
  examples: [
    'notis repository-secrets set --repository notis --file server/.env',
    'printf %s "$KEY" | notis repository-secrets set --repository web --name STRIPE_SECRET_KEY --stdin',
  ],
  mutates: true, idempotent: true, require_auth: true,
  backend_call: { type: 'http', path: PATH },
  async handler(ctx) {
    const repository = ctx.options.repository;
    if (!repository) throw usageError('Pass --repository <name>.');
    const name = ctx.options.name || (ctx.options.file ? String(ctx.options.file).replace(/^\.\//, '') : '');
    if (!name) throw usageError('Pass --name <name> with --stdin.');
    const isVariable = VARIABLE_NAME.test(name);
    const { payload, requestId } = await call(ctx, { action: 'set', repository, name, secret: readValue(ctx, isVariable) });
    const shown = isVariable ? `${repository} · ${name}` : `${repository}/${name}`;
    return ctx.output.emitSuccess({ command: 'repository-secrets set', data: payload, meta: { mutating: true, request_id: requestId },
      humanSummary: `${payload?.replaced ? 'Replaced' : 'Stored'} ${shown}, encrypted. It is never shown again.` });
  },
}, {
  command_path: ['repository-secrets', 'delete'],
  summary: 'Remove a repository secret.',
  when_to_use: 'A variable or env file the repository no longer needs.',
  args_schema: { options: [repositoryOption, { flags: '--name <name>', description: 'The variable\'s name or the env file\'s path, such as server/.env.' }] },
  examples: ['notis repository-secrets delete --repository notis --name portal/.env.local', 'notis repository-secrets delete --repository web --name STRIPE_SECRET_KEY'],
  mutates: true, idempotent: true, require_auth: true,
  backend_call: { type: 'http', path: PATH },
  async handler(ctx) {
    if (!ctx.options.repository || !ctx.options.name) throw usageError('Pass --repository <name> and --name <name>.');
    const { payload, requestId } = await call(ctx, { action: 'delete', repository: ctx.options.repository, name: ctx.options.name });
    return ctx.output.emitSuccess({ command: 'repository-secrets delete', data: payload, meta: { mutating: true, request_id: requestId },
      humanSummary: payload?.deleted ? `Removed ${ctx.options.name} from ${ctx.options.repository}.` : 'There was no such secret.' });
  },
}, {
  command_path: ['repository-secrets', 'exec'],
  summary: 'Run a command with the repository\'s secrets as environment variables. Never prints a value.',
  when_to_use: 'Start a dev server or a script that needs the repository\'s keys, without writing them to a file. Everything after -- is the command; it gets your environment plus the secrets, and NOTIS_REPOSITORY_SECRET_NAMES lists their names. Needs a CLI sign-in that can write.',
  args_schema: {
    arguments: [{ token: '[command...]', key: 'command', description: 'The command and its arguments, after --.' }],
    options: [repositoryOption],
  },
  examples: ['notis repository-secrets exec --repository notis -- ./dev.sh', 'notis repository-secrets exec --repository web -- npm run dev'],
  mutates: false, idempotent: true, require_auth: true,
  backend_call: { type: 'http', path: PATH },
  async handler(ctx) {
    const repository = ctx.options.repository;
    if (!repository) throw usageError('Pass --repository <name>.');
    const argv = Array.isArray(ctx.args.command) ? ctx.args.command.map(String) : [];
    if (!argv.length) throw usageError('Give the command after --, such as: notis repository-secrets exec --repository notis -- ./dev.sh');
    const { payload } = await call(ctx, { action: 'environment', repository });
    const given = payload?.variables && typeof payload.variables === 'object' ? payload.variables : {};
    const variables = Object.fromEntries(Object.entries(given).filter(([key, value]) => key && typeof value === 'string'));
    // Names only, on stderr: stdout belongs to the command.
    const notes = [
      [names(payload?.refused), 'not given (it holds a Notis credential)'],
      [names(payload?.overridden), 'set by more than one secret (the variable, or the deeper env file, won)'],
      [names(payload?.skipped), 'left out (a reserved or invalid name, a value no process can take, or past the size or count limits)'],
    ];
    // A stored name that replaces one already set here: named, so a surprise override is never silent.
    notes.push([Object.keys(variables).filter((key) => Object.prototype.hasOwnProperty.call(process.env, key)).sort(),
      'replaced the value already set in this environment']);
    for (const [list, why] of notes) {
      if (list.length) process.stderr.write(`notis repository-secrets exec: ${list.join(', ')}: ${why}\n`);
    }
    const keys = Object.keys(variables).sort();
    const env = { ...process.env, ...variables, NOTIS_REPOSITORY_SECRET_NAMES: keys.join(',') };
    return runWithEnvironment(argv, env);
  },
}];
