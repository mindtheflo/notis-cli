import { createServer } from 'node:http';

export async function getAvailablePortPreferring(preferredPort) {
  if (Number.isInteger(preferredPort) && preferredPort > 0 && preferredPort <= 65535) {
    const preferredIsFree = await new Promise((resolvePromise) => {
      const server = createServer();
      server.once('error', () => resolvePromise(false));
      server.listen(preferredPort, '127.0.0.1', () => {
        server.close(() => resolvePromise(true));
      });
    });
    if (preferredIsFree) {
      return preferredPort;
    }
  }
  return getAvailablePort();
}

export async function getAvailablePort() {
  const server = createServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectPromise);
      resolvePromise();
    });
  });
  const { port } = server.address();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}
