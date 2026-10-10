import { httpRequest } from '../runtime/transport.js';
import { usageError } from '../runtime/errors.js';
import { renderViewWithCliRuntime } from '../runtime/view-render.js';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export function viewRenderCommandSpec({ screenshotOnly = false } = {}) {
  const command_path = screenshotOnly ? ['spaces', 'screenshot'] : ['views', 'render'];
  return {
    command_path, summary: screenshotOnly ? 'Capture a full-height PNG of a live view with your current access.' : 'Render a live view as Markdown and a full-height PNG with your current access.',
    when_to_use: 'Check the actual deployed view; writes are blocked and current access is checked again before any output is saved.',
    args_schema: { arguments: [{ token: '<url>', key: 'url', description: 'Current view-qualified or record link.' }], options: [
      ...(!screenshotOnly ? [{ flags: '--outputs <kinds>', description: 'Comma-separated markdown,screenshot (default both).' }] : []),
      { flags: '--width <pixels>', description: '1440 (default) or 390.' },
      { flags: '--output-dir <path>', description: 'New output directory; defaults to a unique .notis/renders directory. Existing files are never overwritten.' },
    ] }, examples: [screenshotOnly ? 'notis spaces screenshot <view-link> --width 390' : 'notis views render <view-link> --outputs markdown,screenshot'],
    mutates: false, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_view_render/prepare' },
    async handler(ctx) {
      const outputs = screenshotOnly ? ['screenshot'] : (ctx.options.outputs || 'markdown,screenshot').split(',');
      if (!outputs.length || new Set(outputs).size !== outputs.length || outputs.some(value => !['markdown', 'screenshot'].includes(value))) {
        throw usageError('Choose markdown, screenshot, or markdown,screenshot.');
      }
      const width = ctx.options.width === undefined ? 1440 : Number(ctx.options.width);
      const directory = resolve(ctx.options.outputDir || `.notis/renders/${randomUUID()}`);
      const controller = new AbortController(), cancel = () => controller.abort();
      process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
      try {
        const { result, artifacts } = await renderViewWithCliRuntime({ runtime: ctx.runtime,
          url: ctx.args.url, outputs, width, directory, signal: controller.signal });
        const data = { ...result, artifacts };
        if (data.screenshot) {
          const { data_base64: _bytes, ...metadata } = data.screenshot;
          data.screenshot = { ...metadata, path: artifacts.screenshot };
        }
        return ctx.output.emitSuccess({ command: command_path.join(' '), data,
          humanSummary: `Rendered ${result.url}. Saved ${Object.values(artifacts).join(' and ')}.`, meta: { mutating: false } });
      } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
    },
  };
}

export const viewsCommandSpecs = [{
  command_path: ['views', 'find'],
  summary: 'Find the views you can open for a record, database, view link, Space or search.',
  when_to_use: 'Get fresh view-qualified links and declared URL parameters before citing or opening a view.',
  args_schema: { options: [
    { flags: '--record-key <id>', description: 'Find views that show this exact native record.' },
    { flags: '--database-id <id>', description: 'Find views over this database.' },
    { flags: '--url <url>', description: 'Resolve this view link and its current parameters.' },
    { flags: '--space-id <id>', description: 'Describe this Space view.' },
    { flags: '--query <text>', description: 'Search accessible view names, descriptions and readable context.' },
  ] },
  examples: ['notis views find --record-key <record-key>', 'notis views find --url <view-link>', 'notis views find --query inbox'],
  mutates: false, idempotent: true, require_auth: true,
  backend_call: { type: 'http', path: '/portal_spaces/find-views' },
  async handler(ctx) {
    const options = { record_key: ctx.options.recordKey, database_id: ctx.options.databaseId,
      url: ctx.options.url, space_id: ctx.options.spaceId, query: ctx.options.query };
    const selected = Object.entries(options).filter(([, value]) => value !== undefined);
    if (selected.length !== 1 || typeof selected[0][1] !== 'string' || !selected[0][1].trim()) {
      throw usageError('Choose exactly one of --record-key, --database-id, --url, --space-id or --query.');
    }
    const result = await httpRequest({ runtime: ctx.runtime, method: 'POST', path: '/portal_spaces/find-views',
      body: Object.fromEntries(selected), spacesProtocol: 1 });
    return ctx.output.emitSuccess({ command: 'views find', data: result.payload,
      humanSummary: JSON.stringify(result.payload, null, 2), meta: { mutating: false, request_id: result.requestId } });
  },
}, viewRenderCommandSpec()];
