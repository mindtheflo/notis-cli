import assert from 'node:assert/strict';
import childProcess, { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs, { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { verifySpaceRelease } from '../src/runtime/space-verification.js';
import { closeAgentBrowserSessionResult } from '../src/runtime/agent-browser.js';

const worker = resolve(dirname(fileURLToPath(import.meta.url)), '../src/runtime/space-verify-browser-worker.js');
const wait = ms => new Promise(accept => setTimeout(accept, ms));

for (const interruption of ['SIGINT', 'SIGTERM', 'disconnect']) {
  test(`${interruption} waits for pending browser launch before final owned-session cleanup`, async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'notis-browser-worker-test-'));
    writeFileSync(join(scratch, 'agent-browser'), `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const log=value=>fs.appendFileSync(path.join(__dirname,'events'),value+'\\n');
if(process.argv.includes('--version'))process.exit(0);
if(process.argv.includes('open')){
  log('open-start');fs.writeFileSync(path.join(__dirname,'opening'),'1');
  setTimeout(()=>{fs.writeFileSync(path.join(__dirname,'active'),'1');log('open-complete');},300);
}else if(process.argv.includes('close')){
  fs.rmSync(path.join(__dirname,'active'),{force:true});log('close-complete');
  console.log(JSON.stringify({success:true,data:{closed:true}}));
}else console.log(JSON.stringify({data:{result:{mounted:true,errors:[],runtimeCalls:[]}}}));
`, { mode: 0o700 });
    const child = fork(worker, [], { cwd: scratch, execArgv: [], env: { PATH: scratch }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const exited = new Promise(accept => child.once('exit', code => accept(code)));
    try {
      child.send({ url: 'http://127.0.0.1:44444', sessionName: 'notis-space-aabbcc', timeoutMs: 1500 });
      const deadline = Date.now() + 5000;
      while (!existsSync(join(scratch, 'opening')) && Date.now() < deadline) await wait(15);
      assert.ok(existsSync(join(scratch, 'opening')));
      if (interruption === 'disconnect') child.disconnect(); else child.kill(interruption);
      assert.equal(await exited, interruption === 'SIGINT' ? 130 : interruption === 'SIGTERM' ? 143 : 1);
      assert.deepEqual(readFileSync(join(scratch, 'events'), 'utf8').trim().split('\n'), ['open-start', 'open-complete', 'close-complete']);
      assert.equal(existsSync(join(scratch, 'active')), false);
    } finally { child.kill('SIGKILL'); rmSync(scratch, { recursive: true, force: true }); }
  });
}

test('shared renderer setup failure closes its slot and returns a failed diagnostic', async () => {
  const b = value => Buffer.from(value).toString('base64');
  const release = { sourceFiles: {}, files: { 'bundle/app.js': b('export function SpaceView(){return null}') },
    manifest: { kind: 'presentation', local_key: 'fixture', name: 'Fixture', actions: {}, bundle: { js: 'bundle/app.js' } } };
  const result = await verifySpaceRelease(release, { capabilities: { actions: {}, bindings: {} },
    loadRenderer: async () => { throw new Error('fixture renderer failed'); } });
  assert.equal(result.status, 'failed');
  assert.match(result.errors[0].message, /fixture renderer failed/);
});

test('close waits for the owned browser shutdown acknowledgement past its process grace period', async t => {
  const scratch = mkdtempSync(join(tmpdir(), 'notis-close-ack-test-'));
  const originalPath = process.env.PATH;
  process.env.PATH = scratch;
  t.after(() => { process.env.PATH = originalPath; rmSync(scratch, { recursive: true, force: true }); });
  writeFileSync(join(scratch, 'agent-browser'), `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
fs.writeFileSync(path.join(__dirname,'active'),'owned browser');
setTimeout(()=>{fs.rmSync(path.join(__dirname,'active'));console.log(JSON.stringify({success:true,data:{closed:true}}));},5500);
`, { mode: 0o700 });
  const result = await closeAgentBrowserSessionResult('notis-space-fixture');
  assert.equal(result.ok, true);
  assert.equal(result.timed_out, false);
  assert.equal(existsSync(join(scratch, 'active')), false);
});

test('successful command exit without an explicit closed acknowledgement is not cleanup proof', async t => {
  const scratch = mkdtempSync(join(tmpdir(), 'notis-close-missing-ack-'));
  const originalPath = process.env.PATH;
  process.env.PATH = scratch;
  t.after(() => { process.env.PATH = originalPath; rmSync(scratch, { recursive: true, force: true }); });
  writeFileSync(join(scratch, 'agent-browser'), `#!${process.execPath}\nconsole.log(JSON.stringify({success:true,data:{}}));\n`, { mode: 0o700 });
  const result = await closeAgentBrowserSessionResult('notis-space-fixture');
  assert.equal(result.exit_code, 0);
  assert.equal(result.ok, false);
});
