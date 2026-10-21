import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import {
  extractToolResult,
  findConfirmationPreview,
  isYes,
  renderPreview,
  resolveConfirmation,
} from '../src/runtime/tool-confirmation.js';
import { findUpsell, portalOriginFor, renderUpsell } from '../src/runtime/upsell.js';
import { normalizeBackendError } from '../src/runtime/transport.js';

const cliRoot = resolve(import.meta.dirname, '..');
const binPath = join(cliRoot, 'bin', 'notis.js');
const TOOL = 'LOCAL_NOTIS_MANAGE_CLOUD_COMPUTER';

function makeJwt(sub = 'auth-user-123', exp = 4102444800) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub, exp })}.sig`;
}

function envelope(data) {
  return {
    successful: true,
    data: { results: [{ tool_slug: TOOL, index: 0, response: { successful: true, data } }] },
  };
}

function sizePreview() {
  return {
    status: 'preview',
    action: 'change_size',
    requires_confirmation: true,
    revision: '7',
    summary: ['Grow your Cloud Computer from 2 vCPU to 4 vCPU.', 'It costs $0.20 an hour while it runs.'],
    confirm_arguments: {
      action: 'change_size',
      vcpus: 4,
      confirmed: true,
      expected_revision: '7',
      idempotency_key: 'preview-key-1',
    },
    message: 'Nothing has changed yet.',
  };
}

function deletePreview() {
  return {
    status: 'preview',
    action: 'delete_disk',
    requires_confirmation: true,
    revision: '3',
    summary: ['Delete the disk "data" and everything on it, for good.'],
    confirm_arguments: {
      action: 'delete_disk',
      disk_id: 'disk-1',
      confirmed: true,
      expected_revision: '3',
      idempotency_key: 'preview-key-2',
    },
    confirm_input: { field: 'confirm_name', expected: 'data', prompt: 'Type the disk name (data) to delete it' },
  };
}

function cloudUpsell(nextAction) {
  return {
    status: 'error',
    code: 'entitlement_upgrade_required',
    upgrade_required: true,
    entitlement: 'cloud_computer',
    required_plan: 'pro',
    upgrade_url: '/subscribe',
    message: 'Upgrade to Pro to use the Cloud Computer.',
    next_action: nextAction,
  };
}

// A mock /cli_tools: answers the first call with `first` and any later call
// with `applied`, recording every request body.
async function withServer({ first, applied = { status: 'success', applied: true }, status = 200 }, run) {
  const requests = [];
  const server = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}'));
    const body = requests.length === 1 ? first : envelope(applied);
    res.writeHead(requests.length === 1 ? status : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

function runCli(args, { input = '', env = {} } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn('node', [binPath, ...args], {
      cwd: cliRoot,
      env: {
        PATH: process.env.PATH,
        HOME: mkdtempSync(join(tmpdir(), 'notis-cli-home-')),
        NODE_ENV: 'test',
        NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1',
        NOTIS_JWT: makeJwt(),
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('close', (status) => resolvePromise({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}

function execArgs(apiBase, args, extra = []) {
  return ['--api-base', apiBase, 'tools', 'exec', TOOL, '--arguments', JSON.stringify(args), ...extra];
}

// Human output, as a person in a terminal sees it (a pipe defaults to JSON).
function humanArgs(apiBase, args, extra = []) {
  return ['--output', 'table', ...execArgs(apiBase, args, extra)];
}

function sentArguments(request) {
  return request.arguments.tools[0].arguments;
}

// Pure helpers ----------------------------------------------------------------

test('a preview is found inside the multi-execute envelope, also as a JSON string', () => {
  assert.equal(findConfirmationPreview(envelope(sizePreview())).revision, '7');
  const stringified = { data: { results: [{ response: { data: JSON.stringify(sizePreview()) } }] } };
  assert.equal(findConfirmationPreview(stringified).confirm_arguments.vcpus, 4);
  assert.equal(findConfirmationPreview(envelope({ status: 'success' })), null);
  assert.equal(findConfirmationPreview(envelope({ requires_confirmation: true })), null);
  assert.deepEqual(extractToolResult(envelope({ a: 1 })), { a: 1 });
});

test('the preview text is the summary lines', () => {
  assert.equal(renderPreview(sizePreview()), 'Grow your Cloud Computer from 2 vCPU to 4 vCPU.\nIt costs $0.20 an hour while it runs.');
  assert.equal(renderPreview({ summary: [] }), 'This change needs your confirmation.');
});

test('only y or yes confirms', () => {
  for (const answer of ['y', 'Y', 'yes', ' YES ']) assert.equal(isYes(answer), true, answer);
  for (const answer of ['', 'n', 'no', 'yep', 'sure']) assert.equal(isYes(answer), false, answer);
});

test('resolveConfirmation asks Continue? [y/N] and applies the confirm arguments', async () => {
  const questions = [];
  const ask = async (question) => { questions.push(question); return 'y'; };
  const decision = await resolveConfirmation({ preview: sizePreview(), interactive: true, ask });
  assert.deepEqual(questions, ['Continue? [y/N] ']);
  assert.equal(decision.decision, 'apply');
  assert.equal(decision.arguments.confirmed, true);
  assert.equal(decision.arguments.expected_revision, '7');
  assert.equal(decision.arguments.idempotency_key, 'preview-key-1');
});

test('resolveConfirmation: no answer declines, --yes skips the prompt, no TTY never applies', async () => {
  const declined = await resolveConfirmation({ preview: sizePreview(), interactive: true, ask: async () => '' });
  assert.equal(declined.decision, 'declined');

  const askNever = async () => { throw new Error('must not prompt'); };
  const yes = await resolveConfirmation({ preview: sizePreview(), yes: true, interactive: false, ask: askNever });
  assert.equal(yes.decision, 'apply');
  const piped = await resolveConfirmation({ preview: sizePreview(), interactive: false, ask: askNever });
  assert.equal(piped.decision, 'not_interactive');
});

test('resolveConfirmation asks for the typed disk name before deleting', async () => {
  const questions = [];
  const answers = ['data', 'y'];
  const ask = async (question) => { questions.push(question); return answers.shift(); };
  const decision = await resolveConfirmation({ preview: deletePreview(), interactive: true, ask });
  assert.deepEqual(questions, ['Type the disk name (data) to delete it: ', 'Continue? [y/N] ']);
  assert.equal(decision.arguments.confirm_name, 'data');

  const wrong = await resolveConfirmation({ preview: deletePreview(), interactive: true, ask: async () => 'other' });
  assert.equal(wrong.decision, 'declined');

  const missing = await resolveConfirmation({ preview: deletePreview(), yes: true, ask: async () => 'y' });
  assert.equal(missing.decision, 'needs_input');
  assert.equal(missing.field, 'confirm_name');

  const given = await resolveConfirmation({ preview: deletePreview(), args: { confirm_name: 'data' }, yes: true });
  assert.equal(given.decision, 'apply');
  assert.equal(given.arguments.confirm_name, 'data');
});

test('the upsell renderer covers the upgrade page, team owner and trial', () => {
  const open = renderUpsell(cloudUpsell({ action: 'open_subscribe', url: '/subscribe' }), { apiBase: 'https://api.notis.ai' });
  assert.match(open.text, /Upgrade to Pro to use the Cloud Computer\./);
  assert.match(open.text, /Open the upgrade page: https:\/\/app\.notis\.ai\/subscribe/);
  assert.equal(open.upsell.required_plan, 'pro');

  const team = renderUpsell(cloudUpsell({ action: 'contact_billing_owner', message: 'Ask your workspace billing owner to upgrade to Pro.' }));
  assert.match(team.text, /Ask your team owner: Ask your workspace billing owner to upgrade to Pro\./);
  assert.doesNotMatch(team.text, /upgrade page/);

  const trial = renderUpsell(cloudUpsell({ action: 'activate_paid_billing', tool: 'LOCAL_NOTIS_ACTIVATE_PAID_BILLING' }), { apiBase: 'https://api-beta.notis.ai' });
  assert.match(trial.text, /Start my plan now: notis tools exec LOCAL_NOTIS_ACTIVATE_PAID_BILLING/);
  assert.match(trial.text, /https:\/\/beta\.notis\.ai\/subscribe/);
  assert.equal(trial.hints[0].reason, 'Start my plan now');

  const switchPlan = renderUpsell(cloudUpsell({ action: 'switch_trial_plan', tool: 'LOCAL_NOTIS_SWITCH_TRIAL_PLAN', target_plan: 'pro' }));
  assert.match(switchPlan.text, /Start my plan now: .*LOCAL_NOTIS_SWITCH_TRIAL_PLAN .*"target_plan":"pro"/);
});

test('the upsell renderer sends a past due card to billing and a lifetime plan to support', () => {
  const card = renderUpsell(cloudUpsell({ action: 'update_card', label: 'Update card', page: 'billing' }), { apiBase: 'https://api.notis.ai' });
  assert.match(card.text, /Update card: https:\/\/app\.notis\.ai\/settings\/billing/);
  assert.doesNotMatch(card.text, /upgrade page/);
  assert.deepEqual(card.hints, [{ message: 'Update card: https://app.notis.ai/settings/billing' }]);
  assert.equal(card.upsell.next_action, 'update_card');
  assert.equal(card.upsell.action_url, 'https://app.notis.ai/settings/billing');

  const offline = renderUpsell(cloudUpsell({ action: 'update_card', page: 'billing' }), { apiBase: 'http://127.0.0.1:4311' });
  assert.match(offline.text, /Update card: open Settings, then Billing, in the Notis app\./);
  assert.deepEqual(offline.hints, [{
    command: `notis tools exec LOCAL_NOTIS_GET_PORTAL_URL --arguments '${JSON.stringify({ page: '/settings/billing' })}'`,
    reason: 'Get the billing page link',
  }]);

  const lifetime = renderUpsell(cloudUpsell({ action: 'contact_us', label: 'Contact us', url: 'mailto:support@notis.ai' }), { apiBase: 'https://api.notis.ai' });
  assert.match(lifetime.text, /Contact us: mailto:support@notis\.ai/);
  assert.doesNotMatch(lifetime.text, /upgrade page/);
  assert.deepEqual(lifetime.hints, [{ message: 'Contact us: mailto:support@notis.ai' }]);
  assert.equal(lifetime.upsell.action_url, 'mailto:support@notis.ai');

  const bare = renderUpsell(cloudUpsell({ action: 'contact_us' }));
  assert.match(bare.text, /Contact us: mailto:support@notis\.ai/);
});

test('the upsell renderer shows what the plan unlocks and its price when the body has them', () => {
  const rendered = renderUpsell({
    ...cloudUpsell({ action: 'open_subscribe' }),
    unlocks: ['A Cloud Computer that runs for you', 'Extra disks'],
    price: { monthly_usd: '20' },
  });
  assert.match(rendered.text, /Pro unlocks:\n  - A Cloud Computer that runs for you\n  - Extra disks/);
  assert.match(rendered.text, /Price: \$20 a month/);
});

test('findUpsell reads a tool result, a team limit and a backend 403 body', () => {
  assert.equal(findUpsell(envelope(cloudUpsell({ action: 'open_subscribe' })).data.results[0].response.data).entitlement, 'cloud_computer');
  assert.equal(findUpsell({ code: 'cloud_computer_team_limit', message: 'Limit reached.', next_action: { action: 'contact_billing_owner' } }).code, 'cloud_computer_team_limit');
  const backend = {
    error: {
      code: 'entitlement_upgrade_required',
      message: 'Upgrade to Pro to use the Cloud Computer.',
      status: 403,
      details: { upgrade_required: true, required_plan: 'pro', next_action: { action: 'open_subscribe' } },
    },
  };
  assert.equal(findUpsell(backend).next_action.action, 'open_subscribe');
  assert.equal(findUpsell({ status: 'success', data: [{ code: 'x' }] }), null);
  assert.equal(portalOriginFor('http://127.0.0.1:4311'), null);
});

test('a 403 upgrade refusal becomes the rendered upsell, still coded forbidden', () => {
  const error = normalizeBackendError(403, {
    error: {
      code: 'entitlement_upgrade_required',
      message: 'Upgrade to Pro to use the Cloud Computer.',
      details: { upgrade_required: true, required_plan: 'pro', upgrade_url: '/subscribe', next_action: { action: 'contact_billing_owner', message: 'Ask your workspace billing owner to upgrade to Pro.' } },
    },
  }, { apiBase: 'https://api.notis.ai' });
  assert.equal(error.code, 'forbidden');
  assert.match(error.message, /Ask your team owner/);
  assert.equal(error.details.upsell.next_action, 'contact_billing_owner');
  assert.deepEqual(error.hints, [{ message: 'Ask your team owner: Ask your workspace billing owner to upgrade to Pro.' }]);

  const plain = normalizeBackendError(403, { error: { code: 'tool_not_available', message: 'Tool is not available.' } }, {});
  assert.equal(plain.message, 'Tool is not available.');
  assert.equal(plain.hints[0].command, 'notis tools toolkits');
});

// End to end through `notis tools exec` ---------------------------------------

test('without a terminal, tools exec prints the preview and applies nothing', async () => {
  await withServer({ first: envelope(sizePreview()) }, async (apiBase, requests) => {
    const result = await runCli(humanArgs(apiBase, { action: 'change_size', vcpus: 4 }));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(requests.length, 1);
    assert.match(result.stdout, /Grow your Cloud Computer from 2 vCPU to 4 vCPU\./);
    assert.match(result.stdout, /Nothing has changed\. Run the same command with --yes to apply it\./);
  });
});

test('in JSON mode the preview envelope says it was not applied', async () => {
  await withServer({ first: envelope(sizePreview()) }, async (apiBase, requests) => {
    const result = await runCli(['--json', ...execArgs(apiBase, { action: 'change_size', vcpus: 4 })]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(requests.length, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.meta.applied, false);
    assert.equal(payload.meta.confirmation, 'not_interactive');
    assert.match(payload.hints[0].command, /--yes$/);
  });
});

test('--yes re-runs the tool with the confirm arguments', async () => {
  await withServer({ first: envelope(sizePreview()) }, async (apiBase, requests) => {
    const result = await runCli(['--json', ...execArgs(apiBase, { action: 'change_size', vcpus: 4 }, ['--yes'])]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(requests.length, 2);
    assert.deepEqual(sentArguments(requests[0]), { action: 'change_size', vcpus: 4 });
    assert.deepEqual(sentArguments(requests[1]), sizePreview().confirm_arguments);
    assert.notEqual(requests[0].idempotency_key, requests[1].idempotency_key);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.meta.applied, true);
    assert.equal(payload.data.data.results[0].response.data.applied, true);
  });
});

test('a caller idempotency key never replays the preview on the confirming call', async () => {
  await withServer({ first: envelope(sizePreview()) }, async (apiBase, requests) => {
    const result = await runCli(['--json', '--idempotency-key', 'my-key-123', ...execArgs(apiBase, { action: 'change_size', vcpus: 4 }, ['--yes'])]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(requests[0].idempotency_key, 'my-key-123');
    assert.equal(requests[1].idempotency_key, 'my-key-123.confirm');
  });
});

test('at the prompt, y applies and anything else cancels', async () => {
  const env = { NOTIS_TEST_ASSUME_TTY: '1' };
  await withServer({ first: envelope(sizePreview()) }, async (apiBase, requests) => {
    const result = await runCli(humanArgs(apiBase, { action: 'change_size', vcpus: 4 }), { input: 'y\n', env });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Grow your Cloud Computer from 2 vCPU to 4 vCPU\.[\s\S]*Continue\? \[y\/N\]/);
    assert.equal(requests.length, 2);
    assert.equal(sentArguments(requests[1]).confirmed, true);
  });
  await withServer({ first: envelope(sizePreview()) }, async (apiBase, requests) => {
    const result = await runCli(humanArgs(apiBase, { action: 'change_size', vcpus: 4 }), { input: 'n\n', env });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(requests.length, 1);
    assert.match(result.stdout, /Cancelled\. Nothing changed\./);
  });
});

test('deleting a disk at the prompt asks for its name first', async () => {
  await withServer({ first: envelope(deletePreview()) }, async (apiBase, requests) => {
    const result = await runCli(humanArgs(apiBase, { action: 'delete_disk', disk_id: 'disk-1' }), {
      input: 'data\ny\n',
      env: { NOTIS_TEST_ASSUME_TTY: '1' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Type the disk name \(data\) to delete it/);
    assert.equal(requests.length, 2);
    assert.equal(sentArguments(requests[1]).confirm_name, 'data');
  });
});

test('--yes cannot delete a disk without its typed name', async () => {
  await withServer({ first: envelope(deletePreview()) }, async (apiBase, requests) => {
    const result = await runCli(humanArgs(apiBase, { action: 'delete_disk', disk_id: 'disk-1' }, ['--yes']));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(requests.length, 1);
    assert.match(result.stdout, /Add "confirm_name" to --arguments \(it must be "data"\)/);
  });
});

test('a locked tool result renders the shared upsell instead of raw JSON', async () => {
  await withServer({ first: envelope(cloudUpsell({ action: 'activate_paid_billing', tool: 'LOCAL_NOTIS_ACTIVATE_PAID_BILLING' })) }, async (apiBase, requests) => {
    const result = await runCli(humanArgs(apiBase, { action: 'change_size', vcpus: 4 }, ['--yes']));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(requests.length, 1);
    assert.match(result.stdout, /Upgrade to Pro to use the Cloud Computer\./);
    assert.match(result.stdout, /Start my plan now: notis tools exec LOCAL_NOTIS_ACTIVATE_PAID_BILLING/);
  });
});

test('a 403 upgrade refusal prints the shared upsell', async () => {
  const first = {
    error: {
      code: 'entitlement_upgrade_required',
      message: 'Upgrade to Pro to use the Cloud Computer.',
      status: 403,
      details: { upgrade_required: true, entitlement: 'cloud_computer', required_plan: 'pro', upgrade_url: '/subscribe', next_action: { action: 'open_subscribe', url: '/subscribe' } },
    },
    hints: [],
    request_id: 'req_1',
  };
  await withServer({ first, status: 403 }, async (apiBase) => {
    const result = await runCli(humanArgs(apiBase, { action: 'change_size', vcpus: 4 }));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Upgrade to Pro to use the Cloud Computer\./);
    assert.match(result.stderr, /Get the upgrade page link|Open the upgrade page/);
  });
});

test('the prompter hands answers piped in together to their questions in order', async () => {
  const { PassThrough } = await import('node:stream');
  const { createStderrPrompter } = await import('../src/runtime/tool-confirmation.js');
  const input = new PassThrough();
  const output = new PassThrough();
  input.end('data\ny\n');
  const prompter = createStderrPrompter({ input, output });
  try {
    assert.equal(await prompter.ask('Name: '), 'data');
    assert.equal(await prompter.ask('Continue? [y/N] '), 'y');
    assert.equal(await prompter.ask('Again? '), '');
  } finally {
    prompter.close();
  }
});
