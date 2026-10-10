import { uploadNativeRecordFileWithCliRuntime } from '../runtime/native-record-files.js';
import { parseJson } from './helpers.js';
import { usageError } from '../runtime/errors.js';

export const filesCommandSpecs = [{
  command_path: ['files', 'upload'],
  summary: 'Upload a local file for one native record you can edit.',
  when_to_use: 'Save file bytes without a cloud computer; attach the returned file reference through a normal revision-checked row update.',
  args_schema: { arguments: [{ token: '<file>', key: 'file', description: 'Local regular file up to 8 MB.' }], options: [
    { flags: '--target <json>', description: 'Exact native target returned by schema discovery.' },
    { flags: '--record-key <id>', description: 'Stable record key to attach this file to.' },
    { flags: '--schema-revision <number>', description: 'Current native schema revision.' },
    { flags: '--request-id <uuid>', description: 'Stable UUID; reuse with identical bytes after an uncertain response.' },
    { flags: '--name <name>', description: 'Attachment name; defaults to the local basename.' },
    { flags: '--content-type <mime>', description: 'File MIME type; inferred from known extensions.' },
  ] },
  examples: ['notis files upload ./report.html --target \'{"database_id":"<database-id>"}\' --record-key <record-key> --schema-revision 1 --request-id <uuid>'],
  mutates: true, idempotent: true, require_auth: true,
  backend_call: { type: 'http', path: '/portal_native_files/upload' },
  async handler(ctx) {
    if (!ctx.options.target || ctx.options.schemaRevision === undefined) throw usageError('Pass the discovered native --target and --schema-revision.');
    const result = await uploadNativeRecordFileWithCliRuntime({ runtime: ctx.runtime, filePath: ctx.args.file,
      target: parseJson(ctx.options.target, '--target'), recordKey: ctx.options.recordKey,
      schemaRevision: Number(ctx.options.schemaRevision), requestId: ctx.options.requestId,
      ...(ctx.options.name ? { name: ctx.options.name } : {}), ...(ctx.options.contentType ? { contentType: ctx.options.contentType } : {}) });
    return ctx.output.emitSuccess({ command: 'files upload', data: result,
      humanSummary: 'Uploaded and verified the file. Attach the returned file reference with a revision-checked record update.', meta: { mutating: true } });
  },
}];
