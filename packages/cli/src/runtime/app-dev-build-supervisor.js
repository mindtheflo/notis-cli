// A separate process retains ownership of the build group if the CLI crashes.
// IPC disconnect is the lifetime signal; unlike polling a PID it cannot mistake
// a reused PID for the original owner.
import { spawn } from 'node:child_process';

if (!process.send) throw new Error('Build supervisor requires an IPC owner');
let build;
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (!build?.pid) process.exit(code);
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(build.pid), '/t', '/f']);
    killer.once('error', () => process.exit(1));
    killer.once('exit', () => process.exit(code));
    return;
  }
  const signalGroup = (signal) => {
    try { process.kill(-build.pid, signal); } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  signalGroup('SIGTERM');
  // npm can exit before Vite/esbuild. Keep the supervisor alive until the
  // entire group has received the fallback signal.
  setTimeout(() => {
    signalGroup('SIGKILL');
    process.exit(code);
  }, 1000);
}
process.on('disconnect', () => stop());
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());
process.once('message', ({ command, args }) => {
  if (stopping || !process.connected) return;
  build = spawn(command, args, {
    detached: process.platform !== 'win32',
    stdio: 'inherit',
    env: process.env,
  });
  build.once('spawn', () => {
    if (process.connected) process.send({ pid: build.pid }, () => {});
  });
  build.once('error', () => stop(1));
  build.once('exit', (code) => stop(code || 0));
});
