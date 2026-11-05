/**
 * `notis cc`: the user's Cloud Computer from a terminal. run and job go
 * through LOCAL_NOTIS_RUN_SANDBOX_SHELL, so the server keeps its entitlement,
 * Space-edit and job checks. push and pull open a direct transfer session
 * (POST /portal_spaces/cloud-transfer, runtime/cloud-transfer.js): the server
 * checks the same things, then the bytes go straight to the machine's gate.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { formatBytes, pull, push } from '../runtime/cloud-transfer.js';
import { CliError, EXIT_CODES, usageError } from '../runtime/errors.js';
import { extractToolResult } from '../runtime/tool-confirmation.js';
import { findUpsell, renderUpsell } from '../runtime/upsell.js';
import { nextIdempotencyKey, runToolCommand } from './helpers.js';
import { toolCallTimeoutMs } from './tools.js';

export const SANDBOX_SHELL_TOOL = 'LOCAL_NOTIS_RUN_SANDBOX_SHELL';
const ATTACHED_MAX_TIMEOUT_MS = 720000;
const JOB_MAX_TIMEOUT_MS = 21600000;
const FOLLOW_INTERVAL_MS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_ID = /^[A-Za-z0-9._:-]{1,200}$/;

function commandName(ctx) {
  return ctx.spec.command_path.join(' ');
}

function jobId(ctx) {
  const value = ctx.args.jobId;
  if (typeof value !== 'string' || !JOB_ID.test(value)) throw usageError('Pass the job id that notis cc run --detach printed.');
  return value;
}

function nonNegativeInteger(value, flag) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(parsed)) throw usageError(`${flag} is a whole number of bytes, 0 or more.`);
  return parsed;
}

/** `--timeout-ms` is the global flag: for cc run it bounds the command (or the detached job). */
function commandTimeoutMs(ctx, detach) {
  const raw = ctx.options.timeoutMs ?? ctx.globalOptions.timeoutMs;
  if (raw === undefined) return undefined;
  const value = Number(raw);
  const max = detach ? JOB_MAX_TIMEOUT_MS : ATTACHED_MAX_TIMEOUT_MS;
  if (!/^\d+$/.test(String(raw)) || !Number.isSafeInteger(value) || value < 1000 || value > max) {
    throw usageError(detach
      ? '--timeout-ms bounds the detached job: 1000 to 21600000 (6 hours).'
      : '--timeout-ms bounds the command: 1000 to 720000 (12 minutes). Use --detach for longer work.');
  }
  return value;
}

/** One shell tool call; reads use a fresh key so a poll never replays an earlier answer. */
async function callShell(ctx, args, { mutating }) {
  // A detached job's --timeout-ms is the job's bound, never this call's wait;
  // every call still gets the long-running floor (waking the machine takes time).
  const base = args.detach && ctx.globalOptions.timeoutMs !== undefined ? 0 : ctx.runtime.timeoutMs;
  const timeoutMs = toolCallTimeoutMs(SANDBOX_SHELL_TOOL, args, base);
  const result = await runToolCommand({
    runtime: { ...ctx.runtime, timeoutMs },
    toolName: SANDBOX_SHELL_TOOL,
    arguments_: args,
    mutating,
    idempotencyKey: mutating ? nextIdempotencyKey(ctx.globalOptions) : randomUUID(),
    sendIdempotencyKeyWhenReading: true,
  });
  return { result, payload: extractToolResult(result.payload) || {} };
}

/** Plan limits come back as an upsell prompt, never a bare refusal. */
function upsellResponse(ctx, result, payload) {
  const body = findUpsell(payload);
  if (!body) return null;
  const rendered = renderUpsell(body, { apiBase: ctx.runtime.apiBase });
  return ctx.output.emitSuccess({ command: commandName(ctx), data: payload, humanSummary: rendered.message,
    requestId: result.requestId, hints: rendered.hints, meta: { mutating: false, upsell: rendered.upsell },
    renderHuman: () => rendered.text });
}

/** A refusal (no command ran, unknown job, no access) is an error; a command that exited non-zero is not. */
function refusal(payload) {
  if (payload.status !== 'error' || Number.isInteger(payload.exit_code)) return null;
  const notFound = payload.error === 'cloud_computer_job_unknown' || payload.code === 'cloud_computer_job_unknown';
  return new CliError({
    code: payload.error || payload.code || payload.error_code || 'cloud_computer_error',
    message: payload.message || payload.stderr || 'The Cloud Computer could not do this.',
    exitCode: notFound ? EXIT_CODES.usage : EXIT_CODES.backend,
    details: payload,
  });
}

function jobHints(id) {
  return [
    { command: `notis cc job logs ${id} --follow`, reason: 'Stream its output until it ends' },
    { command: `notis cc job status ${id}`, reason: 'Check whether it is still running' },
    { command: `notis cc job cancel ${id}`, reason: 'Stop it' },
  ];
}

function describeJob(job) {
  if (!job) return '';
  const exit = job.exit_code === null || job.exit_code === undefined ? '' : `, exit code ${job.exit_code}`;
  return `Job ${job.job_id}: ${job.status}${exit}, ${job.log_bytes ?? 0} bytes of output.`;
}

async function runHandler(ctx) {
  const command = ctx.args.command;
  if (typeof command !== 'string' || !command.trim()) throw usageError('Pass the command to run, in quotes.');
  if (command.includes('\0')) throw usageError('The command cannot contain a NUL character.');
  const detach = Boolean(ctx.options.detach);
  const space = ctx.options.space;
  if (space !== undefined && (typeof space !== 'string' || !UUID.test(space))) throw usageError('--space takes the Space id (a UUID).');
  const cwd = ctx.options.cwd;
  if (cwd !== undefined && (typeof cwd !== 'string' || !cwd || cwd.includes('\0'))) throw usageError('--cwd takes a folder on the Cloud Computer.');
  const timeoutMs = commandTimeoutMs(ctx, detach);
  const args = { command, ...(detach ? { detach: true } : {}), ...(space ? { space_id: space } : {}),
    ...(cwd ? { cwd } : {}), ...(timeoutMs ? { timeout_ms: timeoutMs } : {}) };
  ctx.output.emitProgress({ phase: 'execute', message: detach ? 'Starting a job on your Cloud Computer' : 'Running on your Cloud Computer' });
  const { result, payload } = await callShell(ctx, args, { mutating: true });
  const upsell = upsellResponse(ctx, result, payload);
  if (upsell !== null) return upsell;
  const refused = refusal(payload);
  if (refused) throw refused;
  if (detach) {
    const id = payload.job_id || payload.job?.job_id;
    if (!id) throw new CliError({ code: 'cloud_computer_job_missing', message: 'The Cloud Computer did not return a job id.', exitCode: EXIT_CODES.backend, details: payload });
    return ctx.output.emitSuccess({ command: commandName(ctx), data: payload, requestId: result.requestId,
      humanSummary: `Started job ${id}.`, hints: jobHints(id), meta: { mutating: true },
      renderHuman: () => `Started job ${id}.\n${describeJob(payload.job)}`.trim() });
  }
  const exitCode = Number.isInteger(payload.exit_code) ? payload.exit_code : null;
  const code = ctx.output.emitSuccess({ command: commandName(ctx), data: payload, requestId: result.requestId,
    humanSummary: `Exited with code ${exitCode ?? 'unknown'}.`, meta: { mutating: true },
    renderHuman: () => {
      if (payload.stderr) process.stderr.write(payload.stderr.endsWith('\n') ? payload.stderr : `${payload.stderr}\n`);
      return (payload.stdout || '').replace(/\n$/, '');
    } });
  // In a terminal the command's own exit code comes through, like a local shell.
  return !ctx.output.isMachineMode?.() && exitCode ? Math.min(exitCode, 255) : code;
}

async function jobStatusHandler(ctx) {
  const id = jobId(ctx);
  const { result, payload } = await callShell(ctx, { job_id: id, job_action: 'status' }, { mutating: false });
  const upsell = upsellResponse(ctx, result, payload);
  if (upsell !== null) return upsell;
  const refused = refusal(payload);
  if (refused) throw refused;
  const job = payload.job || payload;
  const hints = job.status === 'running'
    ? jobHints(id).filter(hint => !hint.command.startsWith('notis cc job status'))
    : [{ command: `notis cc job logs ${id}`, reason: 'Read what it printed' }];
  return ctx.output.emitSuccess({ command: commandName(ctx), data: payload, requestId: result.requestId,
    humanSummary: describeJob(job), hints, meta: { mutating: false } });
}

async function jobCancelHandler(ctx) {
  const id = jobId(ctx);
  const { result, payload } = await callShell(ctx, { job_id: id, job_action: 'cancel' }, { mutating: true });
  const upsell = upsellResponse(ctx, result, payload);
  if (upsell !== null) return upsell;
  const refused = refusal(payload);
  if (refused) throw refused;
  return ctx.output.emitSuccess({ command: commandName(ctx), data: payload, requestId: result.requestId,
    humanSummary: describeJob(payload.job || payload), meta: { mutating: true } });
}

async function jobLogsHandler(ctx) {
  const id = jobId(ctx);
  const follow = Boolean(ctx.options.follow);
  let offset = nonNegativeInteger(ctx.options.offset, '--offset') ?? 0;
  const sleep = typeof ctx.sleep === 'function' ? ctx.sleep : ms => new Promise(resolve => setTimeout(resolve, ms));
  const streaming = follow && !ctx.output.isMachineMode?.();
  const startOffset = offset;
  let text = '', last = null, requestId = null, idleAfterEnd = 0;
  for (;;) {
    const { result, payload } = await callShell(ctx, { job_id: id, job_action: 'logs', log_offset: offset }, { mutating: false });
    const upsell = upsellResponse(ctx, result, payload);
    if (upsell !== null) return upsell;
    const refused = refusal(payload);
    if (refused) throw refused;
    requestId = result.requestId;
    last = payload;
    // Only bytes past what was already printed: a repeated offset prints nothing twice.
    const advanced = Number.isInteger(payload.next_offset) && payload.next_offset > offset;
    if (advanced) {
      const chunk = typeof payload.text === 'string' ? payload.text : '';
      text += chunk;
      if (streaming && chunk) process.stdout.write(chunk);
      offset = payload.next_offset;
    }
    if (!follow || payload.eof === true) break;
    if (payload.status !== 'running') {
      // An ended job with bytes left is read again at once; one that stops
      // advancing without eof is not polled forever.
      if (advanced) continue;
      if (++idleAfterEnd >= 3) break;
    }
    await sleep(FOLLOW_INTERVAL_MS);
  }
  const data = { job_id: id, status: last?.status ?? null, text, offset: startOffset, next_offset: offset, eof: last?.eof === true };
  const summary = data.eof ? `Job ${id} ${data.status}; all output read.` : `Job ${id} ${data.status}; read up to byte ${offset}.`;
  return ctx.output.emitSuccess({ command: commandName(ctx), data, requestId, humanSummary: summary,
    hints: data.eof ? [] : [{ command: `notis cc job logs ${id} --offset ${offset}${follow ? '' : ' --follow'}`, reason: 'Read the next output' }],
    meta: { mutating: false },
    renderHuman: () => {
      if (streaming) { ctx.output.note(summary); return ''; }
      return text.replace(/\n$/, '');
    } });
}

const MACHINE_ROOT = '/vercel/sandbox';

/** --space <id> [--dest files/...] (inside the Space folder) or --dest /vercel/sandbox/... (a folder on the machine). */
function transferTarget(ctx, { required }) {
  const space = ctx.options.space;
  const dest = ctx.options.dest;
  if (space !== undefined && (typeof space !== 'string' || !UUID.test(space))) throw usageError('--space takes the Space id (a UUID).');
  if (dest !== undefined && (typeof dest !== 'string' || !dest || dest.includes('\0'))) throw usageError('--dest takes a folder.');
  if (space) {
    if (dest && dest.startsWith('/')) throw usageError('With --space, --dest is a folder inside the Space folder, such as files/launch.');
    return { spaceId: space, dest: dest || (required ? 'files' : undefined) };
  }
  if (!dest || !dest.startsWith(`${MACHINE_ROOT}/`)) {
    throw usageError(`Pass --space <space-id> (and optionally --dest files/...), or --dest with a full folder inside ${MACHINE_ROOT}.`);
  }
  return { path: dest };
}

function streamsOption(ctx) {
  const raw = ctx.options.streams;
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!/^\d+$/.test(String(raw)) || value < 1 || value > 32) throw usageError('--streams is a whole number from 1 to 32.');
  return value;
}

function rate(value) {
  return value ? `${formatBytes(value)}/s` : 'n/a';
}

async function pushHandler(ctx) {
  const local = ctx.args.local;
  if (typeof local !== 'string' || !local || !fs.existsSync(local)) throw usageError('Pass a file or folder on this computer.');
  const target = transferTarget(ctx, { required: true });
  ctx.output.emitProgress({ phase: 'prepare', message: 'Preparing a direct transfer to your Cloud Computer' });
  const result = await push(ctx, local, target, { streams: streamsOption(ctx), followLinks: !ctx.options.skipLinks });
  const summary = result.already_committed
    ? `Already on your Cloud Computer in ${result.root} (${result.files} files).`
    : `Sent ${result.files} files (${formatBytes(result.total_bytes)}) to ${result.root} in ${Math.round(result.seconds)} s.`;
  return ctx.output.emitSuccess({ command: commandName(ctx), data: result, humanSummary: summary, meta: { mutating: true },
    renderHuman: () => {
      const lines = [summary];
      if (!result.already_committed) {
        lines.push(`Large files: ${formatBytes(result.large.bytes)} at ${rate(result.large.bytes_per_second)}. Small files: ${formatBytes(result.small.bytes)} at ${rate(result.small.bytes_per_second)}.`);
        if (result.resumed_from_bytes) lines.push(`Resumed: ${formatBytes(result.resumed_from_bytes)} were already there.`);
      }
      if (result.skipped.length) lines.push(`Skipped ${result.skipped.length}: ${result.skipped.slice(0, 5).map(item => `${item.path} (${item.reason})`).join(', ')}`);
      return lines.join('\n');
    } });
}

async function pullHandler(ctx) {
  const remote = ctx.args.remote;
  const local = ctx.args.local;
  if (typeof remote !== 'string' || !remote) throw usageError('Pass the file or folder to copy from the Cloud Computer.');
  if (typeof local !== 'string' || !local) throw usageError('Pass where to put it on this computer.');
  const space = ctx.options.space;
  if (space !== undefined && (typeof space !== 'string' || !UUID.test(space))) throw usageError('--space takes the Space id (a UUID).');
  let target;
  if (space) {
    if (remote.startsWith('/')) throw usageError('With --space, the remote path is inside the Space folder, such as files/render.mp4.');
    target = { spaceId: space, dest: remote };
  } else {
    if (!remote.startsWith(`${MACHINE_ROOT}/`)) throw usageError(`Pass a full path inside ${MACHINE_ROOT}, or --space with a path inside the Space folder.`);
    target = { path: remote };
  }
  const result = await pull(ctx, target, local, { streams: streamsOption(ctx) });
  const summary = `Received ${result.files} files (${formatBytes(result.total_bytes)}) into ${result.local} in ${Math.round(result.seconds)} s`
    + (result.unchanged_files ? `; ${result.unchanged_files} were already identical.` : '.');
  return ctx.output.emitSuccess({ command: commandName(ctx), data: result, humanSummary: summary, meta: { mutating: false } });
}

const jobArgument = { token: '<job-id>', key: 'jobId', description: 'Job id printed by notis cc run --detach.' };

export const ccCommandSpecs = [
  {
    command_path: ['cc', 'run'],
    summary: 'Run a shell command on your Cloud Computer, or start it as a background job.',
    when_to_use: 'Use this for builds, installs, scripts and servers on the Cloud Computer. Add --detach for work longer than 12 minutes, then follow it with notis cc job logs. Add --space to run in a Space folder (you must be able to edit that Space).',
    args_schema: {
      arguments: [{ token: '<command>', description: 'Shell command, run with bash -lc. Quote it.' }],
      options: [
        { flags: '--detach', description: 'Start it as a background job and print its job id at once.' },
        { flags: '--space <space-id>', description: 'Run in this Space folder: NOTIS_SPACE_DIR is set, and without --cwd the command starts there.' },
        { flags: '--cwd <dir>', description: 'Folder to start in, inside /vercel/sandbox.' },
        { flags: '--timeout-ms <n>', description: 'Time limit of the command (1000 to 720000), or of the detached job (up to 21600000, 6 hours).' },
      ],
    },
    examples: [
      'notis cc run "npm test" --cwd /vercel/sandbox/app',
      'notis cc run "npm run build" --space <space-id> --detach --timeout-ms 3600000',
    ],
    output_schema: 'Attached: { status, stdout, stderr, exit_code, timeout_ms }. Detached: { status, job_id, job: { job_id, status, exit_code, started_at, ended_at, log_bytes } }.',
    mutates: true,
    idempotent: true,
    require_auth: true,
    related_commands: ['notis cc job logs <job-id>', 'notis cc job status <job-id>', 'notis cc job cancel <job-id>', 'notis spaces folder <space-id>'],
    backend_call: { type: 'tool', name: SANDBOX_SHELL_TOOL },
    handler: runHandler,
  },
  {
    command_path: ['cc', 'push'],
    summary: 'Copy a file or folder from this computer to your Cloud Computer, straight to the machine.',
    when_to_use: 'Use this for big files and whole project folders (videos, datasets, builds). Small files travel in batches, big ones in 32 MB parts over parallel streams; the bytes never pass through Notis servers. If the link drops or you stop it, run the same command again: it sends only what is missing. Links are followed like scp unless --skip-links is set.',
    args_schema: {
      arguments: [{ token: '<local>', key: 'local', description: 'File or folder on this computer.' }],
      options: [
        { flags: '--space <space-id>', description: 'Put it in this Space folder (you must be able to edit the Space).' },
        { flags: '--dest <folder>', description: 'With --space: a folder inside the Space folder (default files). Without: a full folder inside /vercel/sandbox.' },
        { flags: '--streams <n>', description: 'Parallel streams (default 8).' },
        { flags: '--skip-links', description: 'Do not follow symbolic links.' },
      ],
    },
    examples: [
      'notis cc push ./launch-video --space <space-id> --dest files/launch',
      'notis cc push dataset.parquet --dest /vercel/sandbox/data',
    ],
    output_schema: 'Returns { status, session_id, root, files, total_bytes, committed_bytes, sent_bytes, seconds, resumed_from_bytes, large: { bytes, bytes_per_second }, small: { bytes, bytes_per_second }, skipped }.',
    mutates: true,
    idempotent: true,
    require_auth: true,
    related_commands: ['notis cc pull <remote> <local>', 'notis spaces folder <space-id>'],
    backend_call: { type: 'http', path: '/portal_spaces/cloud-transfer' },
    handler: pushHandler,
  },
  {
    command_path: ['cc', 'pull'],
    summary: 'Copy a file or folder from your Cloud Computer to this computer, straight from the machine.',
    when_to_use: 'Use this to bring renders, exports or results back. Downloads resume where they stopped when you run the same command again, and every file is checked against its sha256.',
    args_schema: {
      arguments: [
        { token: '<remote>', key: 'remote', description: 'With --space: a path inside the Space folder. Without: a full path inside /vercel/sandbox.' },
        { token: '<local>', key: 'local', description: 'Where to put it on this computer.' },
      ],
      options: [
        { flags: '--space <space-id>', description: 'Read from this Space folder.' },
        { flags: '--streams <n>', description: 'Parallel streams (default 8).' },
      ],
    },
    examples: ['notis cc pull files/render.mp4 ./ --space <space-id>', 'notis cc pull /vercel/sandbox/app/dist ./dist'],
    output_schema: 'Returns { status, session_id, root, local, files, total_bytes, unchanged_files, seconds, skipped }.',
    mutates: false,
    idempotent: true,
    require_auth: true,
    related_commands: ['notis cc push <local>'],
    backend_call: { type: 'http', path: '/portal_spaces/cloud-transfer' },
    handler: pullHandler,
  },
  {
    command_path: ['cc', 'job', 'status'],
    summary: 'Show whether a Cloud Computer job is running, and how it ended.',
    when_to_use: 'Use this after notis cc run --detach to check a background job.',
    args_schema: { arguments: [jobArgument], options: [] },
    examples: ['notis cc job status <job-id>'],
    output_schema: 'Returns { job_id, status (running, succeeded, failed, cancelled, timed_out or lost), exit_code, started_at, ended_at, log_bytes }.',
    mutates: false,
    idempotent: true,
    require_auth: true,
    related_commands: ['notis cc job logs <job-id>', 'notis cc job cancel <job-id>'],
    backend_call: { type: 'tool', name: SANDBOX_SHELL_TOOL },
    handler: jobStatusHandler,
  },
  {
    command_path: ['cc', 'job', 'logs'],
    summary: 'Read the output of a Cloud Computer job, or follow it until the job ends.',
    when_to_use: 'Use this to see what a background job printed. --follow checks every 2 seconds and prints only new output; pass --offset to continue from an earlier next_offset.',
    args_schema: {
      arguments: [jobArgument],
      options: [
        { flags: '--offset <n>', description: 'Byte to start reading from (default 0).' },
        { flags: '--follow', description: 'Keep reading every 2 seconds until the job ends and all output is read.' },
      ],
    },
    examples: ['notis cc job logs <job-id>', 'notis cc job logs <job-id> --follow', 'notis cc job logs <job-id> --offset 65536'],
    output_schema: 'Returns { job_id, status, text, offset, next_offset, eof }; eof is true once the job ended and every byte was read.',
    mutates: false,
    idempotent: true,
    require_auth: true,
    related_commands: ['notis cc job status <job-id>', 'notis cc job cancel <job-id>'],
    backend_call: { type: 'tool', name: SANDBOX_SHELL_TOOL },
    handler: jobLogsHandler,
  },
  {
    command_path: ['cc', 'job', 'cancel'],
    summary: 'Stop a running Cloud Computer job.',
    when_to_use: 'Use this to stop a background job started with notis cc run --detach.',
    args_schema: { arguments: [jobArgument], options: [] },
    examples: ['notis cc job cancel <job-id>'],
    output_schema: 'Returns the job status after the cancel.',
    mutates: true,
    idempotent: true,
    require_auth: true,
    related_commands: ['notis cc job status <job-id>'],
    backend_call: { type: 'tool', name: SANDBOX_SHELL_TOOL },
    handler: jobCancelHandler,
  },
];
