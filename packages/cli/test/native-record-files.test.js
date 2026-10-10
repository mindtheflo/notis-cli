import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { uploadNativeRecordFileWithCliRuntime } from '../src/runtime/native-record-files.js';
const key = '11111111-1111-4111-8111-111111111111', requestId = '22222222-2222-4222-8222-222222222222';
async function fixture(t, bytes = Buffer.from('<h1>Fixture</h1>')) {
  const dir = await mkdtemp(join(tmpdir(), 'native-file-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const filePath = join(dir, 'fixture.html'); await writeFile(filePath, bytes);
  return { runtime: {}, target: { database_id: 'fixture-db' }, recordKey: key, schemaRevision: 2, requestId, filePath };
}
test('local file adapter sends bounded bytes and validates exact upload proof', async t => {
  const options = await fixture(t), calls = [];
  const result = await uploadNativeRecordFileWithCliRuntime({ ...options, request: async value => {
    calls.push(value); const data = Buffer.from(value.body.base64, 'base64');
    return { payload: { protocol: 1, record_key: key, request_id: requestId, sha256: createHash('sha256').update(data).digest('hex'),
      size_bytes: data.length, file: { name: 'fixture.html', url: 'https://example.com/fixture.html' }, url: 'https://example.com/fixture.html' } };
  } });
  assert.equal(result.file.name, 'fixture.html'); assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/portal_native_files/upload'); assert.equal(calls[0].body.content_type, 'text/html');
  assert.equal(calls[0].body.request_id, requestId); assert.equal(calls[0].body.actor, undefined);
});
test('no confirmed readback means failure with no automatic mutation retry', async t => {
  const options = await fixture(t); let calls = 0;
  await assert.rejects(uploadNativeRecordFileWithCliRuntime({ ...options, request: async () => { calls++; return { payload: {} }; } }), /not confirmed/);
  assert.equal(calls, 1);
});
test('oversized local file is rejected before transport', async t => {
  const options = await fixture(t, Buffer.alloc(8 * 1024 * 1024 + 1)); let calls = 0;
  await assert.rejects(uploadNativeRecordFileWithCliRuntime({ ...options, request: async () => { calls++; } }), /up to 8 MB/);
  assert.equal(calls, 0);
});
