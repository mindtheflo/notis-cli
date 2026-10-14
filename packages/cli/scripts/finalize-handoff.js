import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGithubHandoffStore } from './github-release-handoff.js';
import { createRecordStore } from './github-immutable-record.js';
import { createIntentStore } from './release-intent.js';
import { verifyFinalizerHandoff, deliverVerifiedBundle } from './release-handoff.js';
import { publishAndReconcile, readReleaseHistory } from './release-registry.js';
import { verifyNpmOidcAccess } from './npm-oidc-preflight.js';

// Expression == ignores case, so a flag such as "True" would enable a channel.
for (const flag of [process.env.NOTIS_BETA_RELEASE_FLAG, process.env.NOTIS_PRODUCTION_RELEASE_FLAG]) {
  if (flag && flag !== 'true' && flag !== 'false') throw new Error('Release flags must be exactly true, false or unset');
}
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH));
const inputs = event.inputs;
const credentials = { repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN };
const api = createGithubHandoffStore(credentials);
const intents = createIntentStore(credentials);
const bundle = await verifyFinalizerHandoff({ ...credentials, inputs, api, intents,
  records: createRecordStore(credentials), context: { event: process.env.GITHUB_EVENT_NAME,
    sha: process.env.GITHUB_SHA, ref: process.env.GITHUB_REF, workflowRef: process.env.GITHUB_WORKFLOW_REF,
    runId: process.env.GITHUB_RUN_ID } });
if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== bundle.manifest.sourceSha) throw new Error('Finalizer checkout identity mismatch');
const out = resolve(process.env.RUNNER_TEMP, 'notis-cli-finalizer');
mkdirSync(out, { recursive: true });
const tarball = resolve(out, 'notis-cli.tgz');
writeFileSync(tarball, bundle.tarball);
const { GITHUB_TOKEN: _github, NODE_AUTH_TOKEN: _npm, NPM_TOKEN: _legacy, ...npmEnv } = process.env;
// A clean npm config and directory prevent source .npmrc/scripts from changing
// the target registry. Preserve only the platform-provided OIDC request env.
writeFileSync(resolve(out, 'npmrc'), 'registry=https://registry.npmjs.org/\nignore-scripts=true\n');
npmEnv.NPM_CONFIG_USERCONFIG = resolve(out, 'npmrc');
npmEnv.NPM_CONFIG_REGISTRY = 'https://registry.npmjs.org/';
npmEnv.NPM_CONFIG_IGNORE_SCRIPTS = 'true';
const npmVersion = execFileSync('npm', ['--version'], { cwd: out, env: npmEnv, encoding: 'utf8' }).trim();
const [major, minor, patch] = npmVersion.split('.').map(Number);
if (!(major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1))))) throw new Error('Trusted publishing requires npm >=11.5.1');
const authentication = bundle.manifest.readOnly
  ? await verifyNpmOidcAccess({ packageName: bundle.manifest.packageName }) : undefined;
const delivery = await deliverVerifiedBundle({ bundle, enabled: process.env.NOTIS_FINALIZER_ENABLED === 'true',
  intents, readHistory: readReleaseHistory, publish: publishAndReconcile, tarball, cwd: out, env: npmEnv });
const receipt = { schema: 1, phase: bundle.manifest.readOnly ? 'handoff_preview_verified' : 'npm_delivery_verified',
  published: !bundle.manifest.readOnly, readOnly: bundle.manifest.readOnly, sourceSha: bundle.manifest.sourceSha,
  channel: bundle.manifest.channel, version: bundle.manifest.version, integrity: bundle.manifest.tarball.integrity,
  builder: bundle.manifest.builder, handoffRefSha: bundle.handoffRefSha, handoffDigest: bundle.digest,
  finalizer: { provider: 'github', runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    runUrl: `https://github.com/${credentials.repository}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    workflowRef: process.env.GITHUB_WORKFLOW_REF, npmVersion }, ...(authentication ? { authentication } : {}),
  ...(delivery ? { delivery } : {}) };
const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
writeFileSync(resolve(out, 'release-receipt.json'), receiptBytes);
// A durable authenticated receipt survives Actions artifact retention. A rerun
// has its own append-only name; no existing receipt is replaced or deleted.
await api.ensureAsset({ releaseId: bundle.binding.releaseId,
  name: `receipt-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}.json`, bytes: receiptBytes, contentType: 'application/json' });
console.log(JSON.stringify(receipt));
