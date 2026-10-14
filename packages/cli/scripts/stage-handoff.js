import { readFileSync, writeFileSync } from 'node:fs';
import { createGithubHandoffStore } from './github-release-handoff.js';
import { createRecordStore } from './github-immutable-record.js';
import { createIntentStore } from './release-intent.js';
import { stageHandoff } from './release-handoff.js';

const credentials = { repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN };
const api = createGithubHandoffStore(credentials);
const manifest = JSON.parse(readFileSync('handoff/handoff-manifest.json'));
if (manifest.readOnly !== (process.env.NOTIS_HANDOFF_READ_ONLY === 'true')) throw new Error('Handoff mode differs from workflow');
const receipt = await stageHandoff({ manifest, tarball: readFileSync('handoff/notis-cli.tgz'),
  planBytes: readFileSync('handoff/release-plan.json'), api, records: createRecordStore(credentials),
  intents: createIntentStore(credentials), repository: credentials.repository });
writeFileSync('handoff-receipt.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt));
