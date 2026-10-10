import { existsSync } from 'node:fs';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { httpRequest } from './transport.js';
import { CliError, EXIT_CODES, usageError } from './errors.js';

async function rendererLibrary() {
  const packaged = new URL('../../dist/view-renderer/src/index.js', import.meta.url);
  if (existsSync(fileURLToPath(packaged))) return import(packaged.href);
  const development = new URL('../../../view-renderer/src/index.js', import.meta.url);
  if (existsSync(fileURLToPath(development))) return import(development.href);
  throw usageError('The shared view renderer is missing. Rebuild or reinstall this CLI package.');
}

/** Root command registration supplies flags/output formatting; this adapter holds no browser JWT. */
export async function renderViewWithCliRuntime({ runtime, url, outputs = ['markdown', 'screenshot'], width = 1440,
  directory, signal, loadLibrary = rendererLibrary, request = httpRequest }) {
  if (typeof url !== 'string' || !url.trim() || ![390, 1440].includes(width)) throw usageError('Choose a view link and width 390 or 1440.');
  const ticket = (await request({ runtime, method: 'POST', path: '/portal_view_render/prepare', spacesProtocol: 1,
    body: { url, outputs, width }, signal })).payload;
  if (typeof ticket?.credential !== 'string') throw usageError('The short-lived render ticket is missing.');
  const library = await loadLibrary();
  const broker = library.createRemoteRenderBroker({ apiBase: runtime.apiBase, credential: ticket.credential });
  let result;
  try {
    result = await library.renderView({ broker, outputs, width, signal });
    await broker.complete(result, { signal });
  }
  catch (error) {
    if (error instanceof library.ViewRenderError) throw new CliError({ code: error.code,
      message: error.message, exitCode: EXIT_CODES.backend, retryable: error.status >= 500 || error.status === 429, cause: error });
    throw error;
  }
  if (!directory) return { result, artifacts: null };
  const root = resolve(directory), created = [], artifacts = {};
  await mkdir(root, { recursive: true });
  try {
    for (const [kind, name, bytes] of [
      ['markdown', 'view.md', result.markdown === undefined ? undefined : Buffer.from(result.markdown, 'utf8')],
      ['screenshot', 'view.png', result.screenshot ? Buffer.from(result.screenshot.data_base64, 'base64') : undefined],
    ]) {
      if (bytes === undefined) continue;
      const path = join(root, name);
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); created.push(path); artifacts[kind] = path;
    }
  } catch (error) { await Promise.allSettled(created.map(path => unlink(path))); throw error; }
  return { result, artifacts };
}
