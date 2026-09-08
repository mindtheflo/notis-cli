import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appsCommandSpecs } from './apps.js';
import { buildArtifact, prepareAppRelease, resolveProjectDir } from '../runtime/app-platform.js';
import { nextIdempotencyKey, runToolCommand } from './helpers.js';
import { usageError, EXIT_CODES } from '../runtime/errors.js';

const reuse = (command, name = command) => {
  const spec = appsCommandSpecs.find(item => item.command_path.join(' ') === `apps ${command}`);
  return {
    ...spec,
    handler: async ctx => {
      const output = new Proxy(ctx.output, {
        get(target, key) {
          if (key === 'emitSuccess') return result => {
            const value = { ...result, warnings: (result.warnings || []).filter(warning => !warning.startsWith('Store readiness:')) };
            if (value.data?.listing) { value.data = { ...value.data }; delete value.data.listing; }
            return target.emitSuccess(value);
          };
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      return spec.handler({ ...ctx, options: { ...ctx.options, listing: false, ...(name === 'preview' ? { keepOpen: true } : {}) }, output });
    },
    command_path: ['reports', name],
    summary: `${name[0].toUpperCase() + name.slice(1)} a record-owned SDK report locally.${name === 'preview' ? ' Keeps the preview server and browser session open.' : ''}`,
    args_schema: {
      ...spec.args_schema,
      options: (spec.args_schema?.options || []).map(option => option.flags === '--listing'
        ? { ...option, description: 'Ignored for reports; saving a report does not publish a Store listing.' }
        : option),
    },
    examples: (spec.examples || []).filter(example => !example.includes('--listing')).map(example => example.replace(`apps ${command}`, `reports ${name}`)),
    when_to_use: 'Author an independent report without deploying its owning app.',
  };
};
export const reportsCommandSpecs = [
  reuse('init'), reuse('build'), reuse('verify'), reuse('verify', 'preview'),
  {
    command_path: ['reports', 'save'],
    summary: 'Build, verify and save a report into an app-owned database record.',
    when_to_use: 'Persist an independently authored report, not an app release.',
    args_schema: {
      arguments: [{ token: '[dir]', key: 'dir', description: 'Report source directory.' }],
      options: [
        { flags: '--database-id <id>', description: 'Required. Owning app database.' },
        { flags: '--document-id <id>', description: 'Existing record to update or attach to.' },
        { flags: '--attach', description: 'Attach to an existing non-view record.' },
        { flags: '--expected-revision <revision>', description: 'Fresh view revision (0 for a record without a view).' },
        { flags: '--title <title>', description: 'Required, including updates. Record title.' },
        { flags: '--context-file <file>', description: 'Required. UTF-8 readable report content and structure.' },
        { flags: '--properties-file <file>', description: 'JSON database property values keyed by name.' },
      ],
    },
    examples: ['notis reports save ./weekly-report --database-id <id> --title \"Weekly review\" --context-file ./context.md'], mutates: true, idempotent: true,
    backend_call: { type: 'tool', name: 'LOCAL_NOTIS_SAVE_REPORT' },
    async handler(ctx) {
      const dir = resolveProjectDir(ctx.args.dir || '.');
      if (!ctx.options.databaseId || !ctx.options.title || !ctx.options.contextFile) throw usageError('--database-id, --title and --context-file are required.');
      if (ctx.options.documentId && (!/^\d+$/.test(String(ctx.options.expectedRevision ?? '')) || !Number.isSafeInteger(Number(ctx.options.expectedRevision)))) throw usageError('--expected-revision is required for update/attach.');
      if (ctx.options.attach && !ctx.options.documentId) throw usageError('--attach requires --document-id.');
      const context = readFileSync(resolve(ctx.options.contextFile), 'utf8');
      const properties = ctx.options.propertiesFile ? JSON.parse(readFileSync(resolve(ctx.options.propertiesFile), 'utf8')) : {};
      await buildArtifact(dir, { stdio: ctx.output.isMachineMode() ? 'pipe' : 'inherit' });
      const release = prepareAppRelease(dir);
      try {
        if (release.manifest.routes?.length !== 1) throw usageError('Reports require exactly one SDK route.');
        let verification;
        const verify = appsCommandSpecs.find(item => item.command_path.join(' ') === 'apps verify');
        const exit = await verify.handler({ ...ctx, args: { dir: release.projectDir }, options: { skipBuild: true, mode: 'stub' }, output: { ...ctx.output, isMachineMode: () => true, emitSuccess: value => { verification = value; } } });
        if (exit !== EXIT_CODES.ok || verification?.data?.status !== 'passed') throw usageError('Report verification failed; nothing saved.');
        const files = { ...release.files, ...Object.fromEntries(Object.entries(release.sourceFiles).map(([path, data]) => [`source/${path}`, data])) };
        const result = await runToolCommand({ runtime: { ...ctx.runtime, timeoutMs: Math.max(ctx.runtime.timeoutMs || 0, 90000) }, toolName: 'LOCAL_NOTIS_SAVE_REPORT', mutating: true,
          idempotencyKey: nextIdempotencyKey(ctx.globalOptions), arguments_: {
            operation: ctx.options.attach ? 'attach' : ctx.options.documentId ? 'update' : 'create',
            database_id: ctx.options.databaseId, title: ctx.options.title, properties,
            ...(ctx.options.documentId ? { document_id: ctx.options.documentId, expected_revision: Number(ctx.options.expectedRevision) } : {}),
            report: { schema: 'notis-report/v2', context, artifact: { manifest: release.manifest, files, encoding: 'base64' } },
          } });
        if (!result?.payload?.document?.id || !result.payload.document.view_revision) throw usageError('Save returned no record identity. Read back before retrying; the outcome may be unknown.');
        return ctx.output.emitSuccess({ command: 'reports save', data: result.payload });
      } finally { release.close(); }
    },
  },
];
