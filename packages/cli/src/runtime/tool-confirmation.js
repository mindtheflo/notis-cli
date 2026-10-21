import { createInterface } from 'node:readline';

// A tool that changes something costly (for example LOCAL_NOTIS_MANAGE_CLOUD_COMPUTER)
// first answers with a preview: {requires_confirmation: true, summary,
// confirm_arguments, confirm_input?}. `notis tools exec` shows it, asks
// "Continue? [y/N]" and calls the tool again with confirm_arguments.

function parseJsonObject(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function asObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return parseJsonObject(value);
}

// The single tool result inside a COMPOSIO_MULTI_EXECUTE_TOOL answer, or the
// payload itself when it already is one.
export function extractToolResult(payload) {
  const candidates = [
    payload?.data?.data?.results?.[0]?.response?.data,
    payload?.data?.results?.[0]?.response?.data,
    payload?.results?.[0]?.response?.data,
    payload?.data?.result,
    payload?.result,
    payload,
  ];
  for (const candidate of candidates) {
    const value = asObject(candidate);
    if (value) return value;
  }
  return null;
}

export function findConfirmationPreview(payload) {
  const result = extractToolResult(payload);
  if (!result || result.requires_confirmation !== true) return null;
  const confirmArguments = asObject(result.confirm_arguments);
  if (!confirmArguments) return null;
  return { ...result, confirm_arguments: confirmArguments };
}

export function renderPreview(preview) {
  const summary = Array.isArray(preview.summary)
    ? preview.summary.filter((line) => typeof line === 'string' && line)
    : (typeof preview.summary === 'string' && preview.summary ? [preview.summary] : []);
  const lines = summary.length ? summary : ['This change needs your confirmation.'];
  return lines.join('\n');
}

export function isYes(answer) {
  return /^\s*y(es)?\s*$/i.test(String(answer ?? ''));
}

// Decides what to do with a preview. Returns one of:
//   {decision: 'apply', arguments}       call the tool again with these
//   {decision: 'declined', reason}       the person said no
//   {decision: 'needs_input', field, reason}  a required typed value is missing
//   {decision: 'not_interactive'}        no prompt possible: show the preview only
export async function resolveConfirmation({ preview, args = {}, yes = false, interactive = false, ask }) {
  const confirmArguments = { ...preview.confirm_arguments };
  const confirmInput = asObject(preview.confirm_input);

  if (confirmInput && typeof confirmInput.field === 'string' && confirmInput.field) {
    const { field } = confirmInput;
    let value = args[field] ?? confirmArguments[field];
    if (value === undefined || value === null || value === '') {
      if (yes || !interactive) {
        return {
          decision: 'needs_input',
          field,
          reason: `Add "${field}" to --arguments${confirmInput.expected ? ` (it must be ${JSON.stringify(confirmInput.expected)})` : ''} to apply this change.`,
        };
      }
      value = (await ask(`${confirmInput.prompt || `Type ${field} to continue`}: `)).trim();
      if (!value) return { decision: 'declined', reason: 'Cancelled. Nothing changed.' };
    }
    if (typeof confirmInput.expected === 'string' && value !== confirmInput.expected) {
      return {
        decision: 'declined',
        reason: `That does not match ${JSON.stringify(confirmInput.expected)}. Nothing changed.`,
      };
    }
    confirmArguments[field] = value;
  }

  if (yes) return { decision: 'apply', arguments: confirmArguments };
  if (!interactive) return { decision: 'not_interactive' };
  const answer = await ask('Continue? [y/N] ');
  if (!isYes(answer)) return { decision: 'declined', reason: 'Cancelled. Nothing changed.' };
  return { decision: 'apply', arguments: confirmArguments };
}

export function canPrompt({ runtime, output } = {}) {
  if (runtime?.nonInteractive) return false;
  if (output?.isMachineMode?.()) return false;
  // Lets the CLI tests drive the prompt through a pipe.
  if (process.env.NODE_ENV === 'test' && process.env.NOTIS_TEST_ASSUME_TTY === '1') return true;
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

// Asks on stderr so stdout keeps only the command's result. One reader serves
// every question of a confirmation and queues the lines, so answers piped in
// together ("data\ny\n") reach their questions in order. Call close() after.
export function createStderrPrompter({ input = process.stdin, output = process.stderr } = {}) {
  const rl = createInterface({ input, output, terminal: Boolean(input.isTTY && output.isTTY) });
  const lines = [];
  const waiting = [];
  let ended = false;
  rl.on('line', (line) => {
    const next = waiting.shift();
    if (next) next(line);
    else lines.push(line);
  });
  rl.on('close', () => {
    ended = true;
    while (waiting.length) waiting.shift()('');
  });
  return {
    ask(question) {
      output.write(question);
      if (lines.length) return Promise.resolve(lines.shift());
      if (ended) return Promise.resolve('');
      return new Promise((resolveAnswer) => waiting.push(resolveAnswer));
    },
    close() {
      rl.close();
    },
  };
}
