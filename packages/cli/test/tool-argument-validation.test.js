import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { validateArguments } from '../src/command-specs/helpers.js';

const schemas = (name) => JSON.parse(readFileSync(new URL(`../../../server/lib/tools/schemas/${name}.json`, import.meta.url)));
const database = schemas('database').find((tool) => tool.name === 'LOCAL_NOTIS_DATABASE_UPSERT_DATABASE').input_schema;
const threads = schemas('threads').find((tool) => tool.name === 'LOCAL_NOTIS_CONTROL_THREADS').input_schema;

test('database main-view dry run rejects reserved nested parameters before a write', () => {
  for (const param of ['record', 'assistantThread', 'authToken', 'JWT', 'api_Key']) {
    assert.ok(validateArguments(database, { operation: 'create', main_view: { space_id: '00000000-0000-4000-8000-000000000001', param } }).length, param);
  }
  assert.deepEqual(validateArguments(database, { operation: 'create', main_view: { space_id: '00000000-0000-4000-8000-000000000001', param: 'entry' } }), []);
});

test('thread dry run refuses fields belonging to a different operation', () => {
  const send = { action: 'send', row_id: '00000000-0000-4000-8000-000000000001', instructions: 'Continue the same work.', request_id: 'validation-fixture' };
  assert.deepEqual(validateArguments(threads, send), []);
  assert.ok(validateArguments(threads, { ...send, agent_id: 'saved-owner' }).length);
  assert.ok(validateArguments(threads, { action: 'send' }).length);
  assert.deepEqual(validateArguments(threads, { action: 'create', instructions: 'Run a scoped check.' }), []); // Runtime may derive a write request key.
});

test('nested unions, required values and formats are validated without changing arguments', () => {
  const schema = { type: 'object', properties: { target: { anyOf: [{ type: 'null' }, { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, limit: { type: 'integer', minimum: 1 } }, required: ['id'], additionalProperties: false }] } }, required: ['target'] };
  for (const target of [{}, { id: 'not-a-uuid' }, { id: '00000000-0000-4000-8000-000000000001', limit: 0 }, { id: '00000000-0000-4000-8000-000000000001', extra: true }]) {
    const args = { target }; const snapshot = structuredClone(args);
    assert.ok(validateArguments(schema, args).length, JSON.stringify(args));
    assert.deepEqual(args, snapshot);
  }
  assert.deepEqual(validateArguments(schema, { target: null }), []);
  assert.deepEqual(validateArguments(schema, { target: { id: '00000000-0000-4000-8000-000000000001', limit: 2 } }), []);
});

test('an unsupported schema is not labelled valid by a dry run', () => {
  for (const constraint of [{ $ref: '#/$defs/absent' }, { type: 'string', format: 'unregistered-format' }, { type: 'string', inventedKeyword: true }]) {
    assert.ok(validateArguments({ type: 'object', properties: { value: constraint } }, { value: 'fixture' }).length);
  }
});

test('every editable tool schema compiles with supported native annotations', () => {
  const directory = new URL('../../../server/lib/tools/schemas/', import.meta.url);
  let checked = 0;
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.json'))) {
    for (const tool of JSON.parse(readFileSync(new URL(file, directory)))) {
      assert.ok(Object.hasOwn(tool, 'input_schema'), `${file}: ${tool.name} has no input schema`);
      assert.ok(typeof tool.input_schema === 'boolean' || (tool.input_schema !== null
        && typeof tool.input_schema === 'object' && !Array.isArray(tool.input_schema)),
      `${file}: ${tool.name} has an invalid input schema`);
      const errors = validateArguments(tool.input_schema, {});
      assert.ok(!errors.some((error) => error.includes('Tool schema could not be validated')),
        `${file}: ${tool.name} could not compile`);
      checked += 1;
    }
  }
  assert.ok(checked > 0, 'No editable tool schemas were checked');
});
