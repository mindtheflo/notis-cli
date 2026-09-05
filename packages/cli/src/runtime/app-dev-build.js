import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

// Expose the actual npm group identity so Desktop recovery and diagnostics
// retain their existing ownership contract. The supervisor owns its lifetime.
export async function startAppDevBuild(cwd, command = 'npm', args = ['run', 'build', '--', '--watch']) {
  const supervisor = spawn(process.execPath, [fileURLToPath(new URL('./app-dev-build-supervisor.js', import.meta.url))], {
    cwd,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NOTIS_DEV: '1' },
  });
  const build = new EventEmitter();
  build.pid = null;
  build.exitCode = null;
  build.signalCode = null;
  build.kill = (signal = 'SIGTERM') => supervisor.kill(signal);
  await new Promise((resolve, reject) => {
    supervisor.once('error', reject);
    supervisor.once('exit', (code, signal) => {
      build.exitCode = code;
      build.signalCode = signal;
      reject(new Error(`Build supervisor exited before startup (${code ?? signal})`));
      build.emit('exit', code, signal);
    });
    supervisor.once('message', ({ pid }) => {
      build.pid = pid;
      resolve();
    });
    supervisor.send({ command, args }, (error) => { if (error) reject(error); });
  });
  return build;
}

export async function stopAppDevBuild(build) {
  if (!build || build.exitCode !== null || build.signalCode !== null) return;
  await new Promise((resolve) => {
    build.once('exit', resolve);
    build.kill('SIGTERM');
  });
}
