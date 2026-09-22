import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { appsCommandSpecs, appsInitHandler, appsBuildHandler, appsVerifyHandler } from './apps.js';
import { buildArtifact, prepareAppRelease, resolveProjectDir, loadAppConfig } from '../runtime/app-platform.js';
import { nextIdempotencyKey, runToolCommand } from './helpers.js';
import { usageError, EXIT_CODES } from '../runtime/errors.js';

async function assertReportProject(ctx) {
  const dir = resolveProjectDir(ctx.args.dir || '.');
  if ((await loadAppConfig(dir)).kind !== 'report') throw usageError('Set kind: "report" in notis.config.ts. Reports have no app installation or owned resources.');
  return dir;
}

async function initReport(ctx) {
  const dir = resolveProjectDir(ctx.args.dir || `./${ctx.args.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  const result = await appsInitHandler({ ...ctx, args: { ...ctx.args, dir }, options: {}, output: { emitSuccess: value => value } });
  writeFileSync(join(dir, 'notis.config.ts'), `import { defineNotisApp } from '@notis/sdk/config';
export default defineNotisApp({
  kind: 'report', name: ${JSON.stringify(ctx.args.name)},
  routes: [{ path: '/', slug: 'home', name: 'Report', default: true }],
  tools: [],
});
`);
  writeFileSync(join(dir, 'app/page.tsx'), `'use client';
import { useNotis, NotisCommentBoundary } from '@notis/sdk';
export default function Report() {
  const { app } = useNotis();
  return <NotisCommentBoundary><main className="notis-app-shell space-y-6">
    <h1 className="text-2xl font-semibold">{app?.name || 'Report'}</h1>
    <p className="text-muted-foreground">Your report is ready to build.</p>
  </main></NotisCommentBoundary>;
}
`);
  rmSync(join(dir, 'CHANGELOG.md'), { force: true });
  return ctx.output.emitSuccess({ ...result, command: 'reports init', hints: [
    { command: `cd ${dir} && npm install`, reason: 'Install dependencies' },
    { command: `notis reports build ${dir}`, reason: 'Build the standalone report' },
  ] });
}

const localReportCommand = (command, name = command) => {
  const app = appsCommandSpecs.find(item => item.command_path.join(' ') === `apps ${command}`);
  return { ...app, command_path: ['reports', name],
    summary: `${name[0].toUpperCase() + name.slice(1)} a standalone live SDK report.`,
    when_to_use: 'Author a private standalone document using the shared view runtime; no app or database is required.',
    args_schema: { ...app.args_schema, options: [...(app.args_schema.options || []).filter(option => !['--listing', '--from <slug>'].includes(option.flags)), ...(command === 'verify' ? [{ flags: '--document-id <id>', description: 'Saved report for live verification.' }, { flags: '--expected-revision <revision>', description: 'Saved report revision for live verification.' }] : [])] },
    examples: [`notis reports ${name} ${command === 'init' ? '"Weekly report" ./weekly-report' : './weekly-report'}`],
    handler: async ctx => {
      if (command === 'init') return initReport(ctx);
      await assertReportProject(ctx);
      return (command === 'build' ? appsBuildHandler : appsVerifyHandler)({ ...ctx, options: { ...ctx.options, ...(name === 'preview' ? { keepOpen: true } : {}) } });
    },
  };
};
export const reportsCommandSpecs = [
  localReportCommand('init'), localReportCommand('build'), localReportCommand('verify'), localReportCommand('verify', 'preview'),
  {
    command_path: ['reports', 'save'],
    summary: 'Build, verify and save a standalone live report document.',
    when_to_use: 'Persist an independently owned report, not an app release.',
    args_schema: {
      arguments: [{ token: '[dir]', key: 'dir', description: 'Report source directory.' }],
      options: [
        { flags: '--document-id <id>', description: 'Existing report document to update.' },
        { flags: '--expected-revision <revision>', description: 'Current saved report revision; required for updates.' },
        { flags: '--title <title>', description: 'Required, including updates. Document title.' },
        { flags: '--context-file <file>', description: 'Required. UTF-8 readable report content and structure.' },
      ],
    },
    examples: ['notis reports save ./weekly-report --title \"Weekly review\" --context-file ./context.md'], mutates: true, idempotent: true,
    backend_call: { type: 'tool', name: 'LOCAL_NOTIS_SAVE_REPORT' },
    async handler(ctx) {
      const dir = await assertReportProject(ctx);
      if (!ctx.options.title || !ctx.options.contextFile) throw usageError('--title and --context-file are required.');
      if (ctx.options.documentId && (!/^\d+$/.test(String(ctx.options.expectedRevision ?? '')) || !Number.isSafeInteger(Number(ctx.options.expectedRevision)))) throw usageError('--expected-revision is required for update.');
      const context = readFileSync(resolve(ctx.options.contextFile), 'utf8');
      await buildArtifact(dir, { stdio: ctx.output.isMachineMode() ? 'pipe' : 'inherit' });
      const release = prepareAppRelease(dir);
      try {
        if (release.manifest.routes?.length !== 1) throw usageError('Reports require exactly one SDK route.');
        let verification;
        const exit = await appsVerifyHandler({ ...ctx, args: { dir: release.projectDir }, options: { skipBuild: true, mode: 'stub' }, output: { ...ctx.output, isMachineMode: () => true, emitSuccess: value => { verification = value; } } });
        if (exit !== EXIT_CODES.ok || verification?.data?.status !== 'passed') throw usageError('Report verification failed; nothing saved.');
        const files = { ...release.files, ...Object.fromEntries(Object.entries(release.sourceFiles).map(([path, data]) => [`source/${path}`, data])) };
        const result = await runToolCommand({ runtime: { ...ctx.runtime, timeoutMs: Math.max(ctx.runtime.timeoutMs || 0, 90000) }, toolName: 'LOCAL_NOTIS_SAVE_REPORT', mutating: true,
          idempotencyKey: nextIdempotencyKey(ctx.globalOptions), arguments_: {
            operation: ctx.options.documentId ? 'update' : 'create',
            title: ctx.options.title,
            ...(ctx.options.documentId ? { document_id: ctx.options.documentId, expected_revision: Number(ctx.options.expectedRevision) } : {}),
            report: { schema: 'notis-report/v3', context, artifact: { manifest: release.manifest, files, encoding: 'base64' } },
          } });
        if (!result?.payload?.document?.id || !result.payload.document.view_revision) throw usageError('Save returned no record identity. Read back before retrying; the outcome may be unknown.');
        return ctx.output.emitSuccess({ command: 'reports save', data: result.payload });
      } finally { release.close(); }
    },
  },
];
