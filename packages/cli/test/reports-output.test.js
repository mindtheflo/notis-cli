import test from 'node:test';
import assert from 'node:assert/strict';
import { appsCommandSpecs } from '../src/command-specs/apps.js';
import { reportsCommandSpecs } from '../src/command-specs/reports.js';

test('report wrappers preserve the app output interface and remove only Store-specific guidance', async () => {
  const app = appsCommandSpecs.find(spec => spec.command_path.join(' ') === 'apps build');
  const report = reportsCommandSpecs.find(spec => spec.command_path.join(' ') === 'reports build');
  const original = app.handler;
  class Output {
    #machine = true;
    isMachineMode() { return this.#machine; }
    emitSuccess(result) { return result; }
  }
  try {
    app.handler = async ctx => {
      assert.equal(ctx.output.isMachineMode(), true);
      return ctx.output.emitSuccess({ data: { listing: { ready: false }, artifact: 'saved' }, warnings: ['Store readiness: no images', 'Useful warning'] });
    };
    const result = await report.handler({ options: {}, output: new Output() });
    assert.deepEqual(result, { data: { artifact: 'saved' }, warnings: ['Useful warning'] });
  } finally { app.handler = original; }
});
