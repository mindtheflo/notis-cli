import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

import { CliError, EXIT_CODES, usageError } from './errors.js';
import { getAuthRecovery, quoteShellArgument } from './auth-recovery.js';
import {
  channelFromProfile,
  cliCommandForChannel,
  isReleaseChannel,
} from './channel.js';
import {
  credentialIsExpired,
  ensureProfile,
  getOAuthApiBase,
  getOAuthResource,
  getProfile,
  loadConfig,
  resolveConfigFile,
  updateConfig,
} from './profiles.js';

export const DEFAULT_CLI_OAUTH_SCOPES = [
  'notis:read',
  'notis:write',
  'notis:connections',
  'notis:apps',
];
const OAUTH_LOCK_DIR = join(homedir(), '.notis', 'oauth.lock');
const DEFAULT_LOGIN_TIMEOUT_MS = 300_000;
const DEFAULT_REFRESH_EXPIRES_IN = 30 * 24 * 60 * 60;
// A parked authorization outlives the terminal that started it: the user may
// still have to sign up, verify an email, and consent before pasting the code.
const PENDING_LOGIN_TTL_SECONDS = 30 * 60;
const OAUTH_HTTP_TIMEOUT_MS = 10_000;
const RESPONSE_FLUSH_GRACE_MS = 2_000;
const MAX_NODE_TIMER_MS = 2_147_483_647;

function oauthError(code, message, hints = null, details = {}) {
  return new CliError({
    code,
    message,
    exitCode: EXIT_CODES.auth,
    details,
    hints: hints || [
      { command: 'notis login', reason: 'Start a new browser authorization' },
      { command: 'notis doctor', reason: 'Inspect the active credential state' },
    ],
  });
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return {};
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
  } catch {
    return {};
  }
}

async function fetchJson(url, init = {}, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OAUTH_HTTP_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  init.signal?.addEventListener?.('abort', abortFromCaller, { once: true });
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw oauthError(
        payload.error || 'oauth_request_failed',
        payload.error_description || payload.message || `OAuth request failed with status ${response.status}`,
        null,
        payload,
      );
    }
    return payload;
  } catch (error) {
    if (controller.signal.aborted && !init.signal?.aborted) {
      throw oauthError(
        'oauth_request_timeout',
        'The OAuth server did not respond in time. Retry the command.',
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener?.('abort', abortFromCaller);
  }
}

export async function discoverCliOAuth(apiBase, fetchImpl = fetch) {
  const normalizedApiBase = apiBase.replace(/\/+$/, '');
  const protectedResource = await fetchJson(
    `${normalizedApiBase}/.well-known/oauth-protected-resource/cli`,
    {},
    fetchImpl,
  );
  const issuer = protectedResource.authorization_servers?.[0];
  if (
    typeof protectedResource.resource !== 'string'
    || !protectedResource.resource
    || typeof issuer !== 'string'
    || !issuer
  ) {
    throw oauthError('oauth_metadata_invalid', 'Notis returned incomplete CLI OAuth metadata.');
  }
  const authorizationServer = await fetchJson(
    `${issuer.replace(/\/+$/, '')}/.well-known/oauth-authorization-server`,
    {},
    fetchImpl,
  );
  if (
    typeof authorizationServer.authorization_endpoint !== 'string'
    || typeof authorizationServer.token_endpoint !== 'string'
    || typeof authorizationServer.revocation_endpoint !== 'string'
  ) {
    throw oauthError('oauth_metadata_invalid', 'Notis returned incomplete authorization server metadata.');
  }
  return {
    apiBase: normalizedApiBase,
    issuer,
    resource: protectedResource.resource,
    clientId: protectedResource.notis_cli_client_id || 'notis_cli',
    copyPasteRedirectUri: protectedResource.notis_cli_copy_paste_redirect_uri,
    // A deployment that predates channel advertising, or a local one with no
    // published build, leaves this null and the profile keeps resolving its
    // channel from the endpoint it authorized against.
    channel: isReleaseChannel(protectedResource.notis_cli_channel)
      ? protectedResource.notis_cli_channel
      : null,
    authorizationEndpoint: authorizationServer.authorization_endpoint,
    tokenEndpoint: authorizationServer.token_endpoint,
    revocationEndpoint: authorizationServer.revocation_endpoint,
  };
}

export function createPkce() {
  const verifier = base64url(randomBytes(64));
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return { verifier, challenge };
}

function stateMatches(expected, actual) {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual || '');
  return (
    expectedBuffer.length === actualBuffer.length
    && timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

const DESKTOP_DOWNLOAD_FALLBACK_URL = 'https://notis.ai/channels/desktop-app/#download';
const DESKTOP_DOWNLOAD_BASE_URL = (
  'https://jhgrvlwivajaifrunqpe.supabase.co/storage/v1/object/public/'
  + 'desktop-releases/production'
);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizePortalOrigin(value) {
  try {
    const parsed = new URL(value || 'https://app.notis.ai');
    if (!['http:', 'https:'].includes(parsed.protocol)) return 'https://app.notis.ai';
    return parsed.origin;
  } catch {
    return 'https://app.notis.ai';
  }
}

function callbackHtml(title, detail) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #09090b; color: #fafafa; }
      main { width: min(100%, 520px); padding: clamp(24px, 6vw, 40px); border: 1px solid #27272a; border-radius: 22px; background: #111113; box-shadow: 0 24px 80px rgb(0 0 0 / 35%); }
      h1 { margin: 0; font-size: clamp(1.75rem, 6vw, 2.4rem); line-height: 1.08; letter-spacing: -0.035em; }
      p { margin: 14px 0 0; color: #a1a1aa; line-height: 1.6; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(detail)}</p>
    </main>
  </body>
</html>`;
}

function connectedCallbackHtml({ portalOrigin }) {
  const safePortalOrigin = normalizePortalOrigin(portalOrigin);
  const webAppUrl = new URL('/manage', `${safePortalOrigin}/`).toString();
  const quickLoginUrl = new URL('/desktop-quick-login', `${safePortalOrigin}/`);
  quickLoginUrl.searchParams.set('redirect', '/manage');
  const serializedDownloads = JSON.stringify({
    fallback: DESKTOP_DOWNLOAD_FALLBACK_URL,
    base: DESKTOP_DOWNLOAD_BASE_URL,
  }).replaceAll('<', '\\u003c');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>Notis CLI is connected</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --background: #08090b;
        --surface: #111317;
        --surface-raised: #171a20;
        --border: #292d35;
        --muted: #a6acb8;
        --primary: #f5f7fa;
        --primary-ink: #111317;
        --success: #72f2ad;
        --focus: #8cb8ff;
      }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: clamp(16px, 4vw, 40px);
        background:
          radial-gradient(circle at 50% -10%, rgb(63 80 120 / 20%), transparent 38%),
          var(--background);
        color: #f8fafc;
      }
      main {
        width: min(100%, 680px);
        padding: clamp(24px, 6vw, 44px);
        border: 1px solid var(--border);
        border-radius: 24px;
        background: rgb(17 19 23 / 96%);
        box-shadow: 0 28px 100px rgb(0 0 0 / 42%);
      }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 9px;
        margin-block-end: 30px;
        color: #d9dde5;
        font-size: 0.82rem;
        font-weight: 750;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .brand-mark {
        display: grid;
        width: 30px;
        aspect-ratio: 1;
        place-items: center;
        border-radius: 9px;
        background: #f4f4f5;
        color: #09090b;
        font-size: 1rem;
        font-weight: 900;
      }
      .status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-block-end: 14px;
        color: var(--success);
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .status-dot {
        width: 8px;
        aspect-ratio: 1;
        border-radius: 999px;
        background: currentColor;
        box-shadow: 0 0 0 5px rgb(114 242 173 / 10%);
      }
      h1 {
        margin: 0;
        max-width: 16ch;
        font-size: clamp(2rem, 7vw, 3.25rem);
        line-height: 1.02;
        letter-spacing: -0.055em;
      }
      .lede {
        margin: 16px 0 0;
        max-width: 58ch;
        color: var(--muted);
        font-size: clamp(0.96rem, 2vw, 1.08rem);
        line-height: 1.6;
      }
      .capabilities {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin: 26px 0 0;
        padding: 0;
        list-style: none;
      }
      .capabilities li {
        min-height: 84px;
        padding: 15px;
        border: 1px solid var(--border);
        border-radius: 15px;
        background: var(--surface-raised);
      }
      .capabilities strong { display: block; margin-block-end: 4px; font-size: 0.94rem; }
      .capabilities span { display: block; color: var(--muted); font-size: 0.81rem; line-height: 1.45; }
      .actions { display: grid; grid-template-columns: 1.45fr 1fr; gap: 10px; margin-block-start: 26px; }
      .button {
        display: inline-flex;
        min-height: 48px;
        align-items: center;
        justify-content: center;
        padding: 12px 18px;
        border: 1px solid var(--border);
        border-radius: 13px;
        background: transparent;
        color: #f4f4f5;
        font: inherit;
        font-weight: 750;
        text-align: center;
        text-decoration: none;
        cursor: pointer;
        transition: transform 140ms ease, background 140ms ease, border-color 140ms ease;
      }
      .button:hover { transform: translateY(-1px); border-color: #454b57; background: #1b1e24; }
      .button:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
      .button-primary { border-color: var(--primary); background: var(--primary); color: var(--primary-ink); }
      .button-primary:hover { border-color: #fff; background: #fff; }
      .helper { margin: 12px 0 0; color: #777f8d; font-size: 0.78rem; line-height: 1.45; }
      .next-step {
        margin-block-start: 24px;
        padding: 18px;
        border: 1px solid rgb(114 242 173 / 28%);
        border-radius: 16px;
        background: rgb(114 242 173 / 7%);
      }
      .next-step h2 { margin: 0; font-size: clamp(1.3rem, 4vw, 1.65rem); letter-spacing: -0.03em; }
      .next-step p { margin: 8px 0 0; color: var(--muted); line-height: 1.55; }
      .next-step .actions { margin-block-start: 18px; }
      @media (max-width: 560px) {
        body { place-items: start center; }
        main { border-radius: 20px; }
        .capabilities, .actions { grid-template-columns: 1fr; }
        .capabilities li { min-height: auto; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="brand"><span class="brand-mark">N</span> Notis</div>
      <section id="connected-view" aria-labelledby="connected-title">
        <div class="status"><span class="status-dot"></span> CLI ready</div>
        <h1 id="connected-title">Notis CLI is connected.</h1>
        <p class="lede">
          Your terminal is ready. Add the Desktop app to unlock everything that runs safely on this computer.
        </p>
        <ul class="capabilities" aria-label="Desktop capabilities">
          <li><strong>Sync agent skills</strong><span>Keep your Notis skills available in Codex, Claude Code, Cursor, and other local agents.</span></li>
          <li><strong>Control your computer</strong><span>Let approved agents use local apps, files, and computer controls when you ask.</span></li>
          <li><strong>Connect local MCP</strong><span>Use local MCP servers and tools without exposing them to the public internet.</span></li>
          <li><strong>Approve local actions</strong><span>Review sensitive computer actions from the Desktop app before they run.</span></li>
        </ul>
        <div class="actions">
          <button class="button button-primary" id="download-desktop" type="button">Download Notis Desktop</button>
          <a class="button" href="${escapeHtml(webAppUrl)}">Open Web App</a>
        </div>
        <p class="helper">The CLI stays connected even if you continue in the web app.</p>
      </section>
      <section class="next-step" id="desktop-ready-view" aria-labelledby="desktop-ready-title" hidden>
        <div class="status"><span class="status-dot"></span> Download started</div>
        <h2 id="desktop-ready-title" tabindex="-1">Quick login to Notis Desktop</h2>
        <p>
          Install the app, then use quick login. Your signed-in browser securely hands the current session to Desktop.
        </p>
        <div class="actions">
          <a class="button button-primary" href="${escapeHtml(quickLoginUrl.toString())}">Open &amp; sign in to Desktop</a>
          <a class="button" href="${escapeHtml(webAppUrl)}">Open Web App</a>
        </div>
        <button class="button" id="download-again" type="button" style="width:100%;margin-top:10px">Download again</button>
      </section>
    </main>
    <script>
      (() => {
        const downloads = ${serializedDownloads};
        const downloadButton = document.getElementById('download-desktop');
        const downloadAgainButton = document.getElementById('download-again');
        const connectedView = document.getElementById('connected-view');
        const readyView = document.getElementById('desktop-ready-view');

        const resolveDownload = async () => {
          const ua = navigator.userAgent || '';
          if (/Windows/i.test(ua)) return downloads.base + '/win32/x64/notis-x64.exe';
          if (/Linux/i.test(ua) && !/Android/i.test(ua)) return downloads.base + '/linux/x64/notis-linux-x64.zip';
          if (/Macintosh|Mac OS X/i.test(ua)) {
            let architecture = '';
            try {
              architecture = (await navigator.userAgentData?.getHighEntropyValues?.(['architecture']))?.architecture || '';
            } catch {}
            const path = /arm/i.test(architecture)
              ? '/darwin/arm64/notis-arm64.dmg'
              : '/darwin/x64/notis-x64.dmg';
            return downloads.base + path;
          }
          return downloads.fallback;
        };

        const startDownload = async () => {
          const downloadUrl = await resolveDownload();
          window.open(downloadUrl, '_blank', 'noopener,noreferrer');
          connectedView.hidden = true;
          readyView.hidden = false;
          document.title = 'Quick login to Notis Desktop';
          document.getElementById('desktop-ready-title')?.focus?.();
        };

        downloadButton?.addEventListener('click', startDownload);
        downloadAgainButton?.addEventListener('click', async () => {
          const downloadUrl = await resolveDownload();
          window.open(downloadUrl, '_blank', 'noopener,noreferrer');
        });
      })();
    </script>
  </body>
</html>`;
}

export async function createLoopbackReceiver({
  state,
  timeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
  portalOrigin,
} = {}) {
  let consumed = false;
  let resolveCode;
  let rejectCode;
  let timeout;
  let pendingResponse = null;
  // Browsers routinely park speculative connections that never send a request.
  // `server.close()` waits for every socket it accepted, so the sockets have to
  // be tracked and dropped by hand or a finished login would keep waiting.
  const sockets = new Set();
  let responseFlushed = Promise.resolve();
  const result = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const endResponse = (response, body) => {
    responseFlushed = new Promise((resolve) => {
      response.end(body, resolve);
    });
  };

  const server = createServer((request, response) => {
    const address = server.address();
    const expectedHost = address && typeof address === 'object'
      ? `127.0.0.1:${address.port}`
      : '';
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');

    if (request.headers.host !== expectedHost) {
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      endResponse(response, callbackHtml('Invalid callback', 'The callback host was not accepted.'));
      return;
    }
    const url = new URL(request.url || '/', `http://${expectedHost}`);
    if (request.method !== 'GET' || url.pathname !== '/callback') {
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      endResponse(response, callbackHtml('Not found', 'This callback path does not exist.'));
      return;
    }
    if (consumed) {
      response.writeHead(410, { 'Content-Type': 'text/html; charset=utf-8' });
      endResponse(response, callbackHtml('Already used', 'This authorization callback was already handled.'));
      return;
    }
    const returnedState = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (!stateMatches(state, returnedState)) {
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      endResponse(response, callbackHtml('Authorization failed', 'The callback state did not match.'));
      return;
    }
    // A stray or malicious request must not burn the one legitimate callback.
    // Only a request carrying this authorization's state consumes the receiver.
    consumed = true;
    if (error || !code) {
      const description = url.searchParams.get('error_description') || 'Authorization was not completed.';
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      endResponse(response, callbackHtml('Authorization not completed', description));
      rejectCode(oauthError(error || 'oauth_code_missing', description));
      return;
    }
    // Keep the browser request pending until the CLI has exchanged and
    // persisted the code. Receiving a valid callback is not enough to claim
    // that the command line is connected.
    pendingResponse = response;
    resolveCode(code);
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : null;
  if (!port) {
    server.close();
    throw oauthError('oauth_loopback_failed', 'Could not start the local OAuth callback listener.');
  }

  timeout = setTimeout(() => {
    rejectCode(oauthError('oauth_timeout', `Authorization timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  const close = async () => {
    clearTimeout(timeout);
    if (pendingResponse && !pendingResponse.writableEnded) {
      pendingResponse.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      endResponse(pendingResponse, callbackHtml(
        'Authorization did not finish',
        'Return to the terminal for details, then retry sign in.',
      ));
      pendingResponse = null;
    }
    // The browser answer is already written; wait only for the kernel to take
    // it so tearing the socket down cannot truncate the connected page.
    await Promise.race([
      responseFlushed,
      new Promise((resolve) => { setTimeout(resolve, RESPONSE_FLUSH_GRACE_MS).unref?.(); }),
    ]);
    // Chrome parks a speculative connection next to the one that carried the
    // callback. It never sends a request, so Node counts it as active and
    // `server.close()` waits for a socket only the browser will ever release:
    // a login that already succeeded would sit in the terminal for minutes.
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    if (!server.listening) return;
    await new Promise((resolve) => server.close(resolve));
  };

  return {
    port,
    redirectUri: `http://127.0.0.1:${port}/callback`,
    waitForCode: () => result,
    complete: () => {
      if (!pendingResponse || pendingResponse.writableEnded) return;
      const connectedUrl = new URL(
        '/cli-connected',
        `${normalizePortalOrigin(portalOrigin)}/`,
      );
      pendingResponse.writeHead(302, {
        'Content-Type': 'text/html; charset=utf-8',
        Location: connectedUrl.toString(),
      });
      endResponse(pendingResponse, connectedCallbackHtml({ portalOrigin }));
      pendingResponse = null;
    },
    fail: ({ detached = false } = {}) => {
      if (!pendingResponse || pendingResponse.writableEnded) return;
      pendingResponse.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      endResponse(pendingResponse, callbackHtml(
        'Authorization failed',
        detached
          ? 'The CLI could not finish signing in. Start sign in again from your agent or terminal.'
          : 'The CLI could not finish signing in. Return to the terminal for details.',
      ));
      pendingResponse = null;
    },
    cancel: () => {
      rejectCode(oauthError('oauth_listener_cancelled', 'This browser authorization is no longer active.'));
    },
    close,
  };
}

export function browserOpenCommand(url, platform = process.platform) {
  const command = platform === 'darwin'
    ? 'open'
    : platform === 'win32'
      ? 'rundll32.exe'
      : 'xdg-open';
  const args = platform === 'win32'
    ? ['url.dll,FileProtocolHandler', url]
    : [url];
  return { command, args };
}

function openBrowser(url) {
  const { command, args } = browserOpenCommand(url);
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    // A missing opener emits an async 'error' event that no try/catch can reach,
    // and an unhandled one would take the whole login down.
    child.on('error', () => {});
    child.unref();
  } catch {
    // Non-fatal. The authorize URL is printed alongside this call.
  }
}

function storedOAuthMetadata(runtime, profile) {
  const issuer = String(profile.oauth_issuer || '').replace(/\/+$/, '');
  const apiBase = getOAuthApiBase(profile)
    || String(profile.api_base || runtime.apiBase || '').replace(/\/+$/, '');
  const resource = getOAuthResource(profile) || (apiBase ? `${apiBase}/cli` : '');
  if (!issuer || !apiBase || !resource || !profile.oauth_client_id) {
    throw oauthError(
      'oauth_metadata_missing',
      'The stored OAuth profile is incomplete. Run notis login again.',
    );
  }
  return {
    apiBase,
    issuer,
    resource,
    clientId: profile.oauth_client_id,
    tokenEndpoint: `${issuer}/oauth/token`,
    revocationEndpoint: `${issuer}/oauth/revoke`,
  };
}

function buildAuthorizeUrl(metadata, {
  redirectUri,
  challenge,
  state,
  scopes,
}) {
  const url = new URL(metadata.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', metadata.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('resource', metadata.resource);
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  return url.toString();
}

async function exchangeCode(metadata, {
  code,
  redirectUri,
  verifier,
}, fetchImpl = fetch) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: metadata.clientId,
    redirect_uri: redirectUri,
    resource: metadata.resource,
    code_verifier: verifier,
  });
  return fetchJson(
    metadata.tokenEndpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
    fetchImpl,
  );
}

function persistOAuthTokenResponse(runtime, metadata, tokenResponse) {
  const now = Math.floor(Date.now() / 1000);
  const payload = decodeJwtPayload(tokenResponse.access_token);
  const oauthApiBase = (metadata.apiBase || runtime.apiBase || '').replace(/\/+$/, '');
  let beta;
  try {
    const hostname = new URL(oauthApiBase).hostname;
    if (hostname === 'api-beta.notis.ai') beta = true;
    else if (hostname === 'api.notis.ai') beta = false;
  } catch {
    beta = undefined;
  }
  const config = updateConfig((latest) => {
    const next = ensureProfile(latest, runtime.profileName);
    const profile = next.profiles[runtime.profileName];
    next.profiles[runtime.profileName] = {
      ...profile,
      // The grant defines this profile's endpoint. A profile is one account on
      // one API, and the environment the user just authorized against is the
      // only endpoint the resulting token is accepted by.
      api_base: oauthApiBase || profile.api_base,
      beta: beta ?? profile.beta,
      // The deployment that just authorized this profile also names the
      // published build that belongs to it. Pinning it here is what lets the
      // next run correct itself without the user knowing a channel exists.
      channel: isReleaseChannel(metadata.channel)
        ? metadata.channel
        : channelFromProfile({ ...profile, beta: beta ?? profile.beta, api_base: oauthApiBase })
          ?? profile.channel,
      oauth_api_base: oauthApiBase || profile.oauth_api_base,
      oauth_resource: metadata.resource,
      oauth_access_token: tokenResponse.access_token,
      oauth_refresh_token: tokenResponse.refresh_token || profile.oauth_refresh_token,
      oauth_access_expires_at: now + Number(tokenResponse.expires_in || 0),
      oauth_refresh_expires_at:
        now + Number(tokenResponse.refresh_expires_in || DEFAULT_REFRESH_EXPIRES_IN),
      oauth_client_id: metadata.clientId,
      oauth_issuer: metadata.issuer,
      oauth_scopes: String(tokenResponse.scope || '').split(/\s+/).filter(Boolean),
      oauth_user_id: payload.sub || payload.notis_user_id,
    };
    return next;
  });
  return config.profiles[runtime.profileName];
}

function pendingAuthorizationFile(runtime) {
  const profileKey = createHash('sha256')
    .update(String(runtime.profileName || 'default'))
    .digest('hex')
    .slice(0, 16);
  return `${resolveConfigFile()}.pending-login.${profileKey}`;
}

function legacyPendingAuthorizationFile(runtime) {
  return `${resolveConfigFile()}.pending-login`;
}

// The PKCE verifier outlives the process that created it whenever the browser
// hand-off cannot block on a terminal, so it is parked next to the config
// rather than in it: normalizeConfig drops unknown profile keys, and a
// half-finished login must never survive as profile state.
function savePendingAuthorization(runtime, pending) {
  const file = pendingAuthorizationFile(runtime);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(pending, null, 2), { mode: 0o600 });
}

function readPendingAuthorization(runtime, { includeExpired = false } = {}) {
  for (const file of [
    pendingAuthorizationFile(runtime),
    legacyPendingAuthorizationFile(runtime),
  ]) {
    let pending;
    try {
      pending = JSON.parse(readFileSync(file, 'utf-8'));
    } catch {
      continue;
    }
    if (!pending?.verifier || !pending?.redirect_uri) continue;
    if (!includeExpired && Number(pending.expires_at) <= Math.floor(Date.now() / 1000)) continue;
    if (pending.profile !== runtime.profileName) continue;
    return { ...pending, pending_file: file };
  }
  return null;
}

function clearPendingAuthorization(runtime, file = pendingAuthorizationFile(runtime)) {
  try {
    rmSync(file);
  } catch {
    // Nothing to clear.
  }
}

function clearPendingAuthorizations(runtime) {
  clearPendingAuthorization(runtime);
  const legacyFile = legacyPendingAuthorizationFile(runtime);
  try {
    const pending = JSON.parse(readFileSync(legacyFile, 'utf-8'));
    if (pending?.profile === runtime.profileName) rmSync(legacyFile);
  } catch {
    // Missing, malformed, or owned by another profile.
  }
}

function pendingAuthorizationOwnedBy(pending, owner) {
  return Boolean(
    pending
    && pending.hand_off === owner.hand_off
    && pending.state === owner.state
    && pending.verifier === owner.verifier
    && pending.redirect_uri === owner.redirect_uri
    && pending.api_base === owner.api_base
  );
}

function clearPendingAuthorizationIfOwner(runtime, owner) {
  // Cleanup must still remove an owner that expired at the same instant as a
  // receiver timeout; ordinary reads continue to ignore expired grants.
  const pending = readPendingAuthorization(runtime, { includeExpired: true });
  if (!pendingAuthorizationOwnedBy(pending, owner)) return false;
  clearPendingAuthorization(runtime, pending.pending_file);
  return true;
}

async function publishForegroundAuthorization(runtime, authorization) {
  const globalLock = await acquireListenerGlobalLock();
  let lockDir = null;
  try {
    lockDir = await acquireListenerStartLock(runtime);
    stopPendingListener(runtime);
    clearPendingAuthorizations(runtime);
    savePendingAuthorization(runtime, authorization);
  } finally {
    releaseListenerStartLock(lockDir);
    releaseListenerGlobalLock(globalLock);
  }
}

const LISTENER_SCRIPT = fileURLToPath(new URL('./login-listener.js', import.meta.url));
const LISTENER_SCRIPT_NAME = 'login-listener.js';
// How long the parent waits for the detached child to bind and report its port.
// Only a bind, so this is generous; exceeding it means the child is not coming.
const LISTENER_HANDSHAKE_TIMEOUT_MS = 10_000;
const LISTENER_START_LOCK_STALE_MS = LISTENER_HANDSHAKE_TIMEOUT_MS * 2;
const LISTENER_GLOBAL_LOCK_HEARTBEAT_MS = 5_000;
const LISTENER_CANCELLATION_POLL_MS = 100;
const LISTENER_IDENTITY_PROBE_TIMEOUT_MS = 2_000;

const LISTENER_CHILD_ENV_KEYS = [
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'PATH',
  'Path',
  'PATHEXT',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
];

/**
 * A detached listener outlives the command that launched it. Give it only the
 * OS/runtime values needed to start Node and find its private config, never the
 * caller's unrelated API keys, service credentials, or inherited NOTIS_JWT.
 */
export function listenerChildEnvironment(env = process.env) {
  const childEnv = {};
  for (const key of LISTENER_CHILD_ENV_KEYS) {
    if (typeof env[key] === 'string' && env[key]) childEnv[key] = env[key];
  }
  childEnv.NOTIS_CLI_CONFIG_FILE = resolveConfigFile();
  return childEnv;
}

function listenerStateFile(runtime) {
  const profileKey = createHash('sha256')
    .update(String(runtime.profileName || 'default'))
    .digest('hex')
    .slice(0, 16);
  return `${resolveConfigFile()}.login-listener.${profileKey}`;
}

function listenerStartLockDir(runtime) {
  return `${listenerStateFile(runtime)}.lock`;
}

function listenerGlobalLockDir() {
  return `${resolveConfigFile()}.oauth-listener-global.lock`;
}

function listenerGlobalLockOwnerFile(lockDir) {
  return join(lockDir, 'owner.json');
}

function readListenerGlobalLockOwner(lockDir) {
  try {
    return JSON.parse(readFileSync(listenerGlobalLockOwnerFile(lockDir), 'utf-8'));
  } catch {
    return null;
  }
}

function writeListenerGlobalLockOwner(lock) {
  const current = readListenerGlobalLockOwner(lock.lockDir);
  if (current && current.owner_token !== lock.ownerToken) return false;
  writeFileSync(listenerGlobalLockOwnerFile(lock.lockDir), JSON.stringify({
    owner_token: lock.ownerToken,
    owner_pid: process.pid,
    updated_at: Date.now(),
  }), { mode: 0o600 });
  return true;
}

function listenerGlobalLockIsStale(lockDir, staleMs) {
  try {
    return Date.now() - statSync(listenerGlobalLockOwnerFile(lockDir)).mtimeMs > staleMs;
  } catch {
    try {
      return Date.now() - statSync(lockDir).mtimeMs > staleMs;
    } catch {
      return false;
    }
  }
}

function retireStaleListenerGlobalLock(lockDir) {
  const retiredDir = `${lockDir}.stale-${process.pid}-${base64url(randomBytes(8))}`;
  try {
    renameSync(lockDir, retiredDir);
  } catch {
    return false;
  }
  rmSync(retiredDir, { recursive: true, force: true });
  return true;
}

async function acquireListenerStartLock(runtime) {
  const lockDir = listenerStartLockDir(runtime);
  mkdirSync(dirname(lockDir), { recursive: true });
  const deadline = Date.now() + LISTENER_START_LOCK_STALE_MS * 2;
  for (;;) {
    try {
      mkdirSync(lockDir);
      return lockDir;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > LISTENER_START_LOCK_STALE_MS) {
          rmdirSync(lockDir);
          continue;
        }
      } catch {
        // The owner may have released the lock between stat and removal.
      }
      if (Date.now() >= deadline) {
        throw oauthError(
          'oauth_listener_lock_timeout',
          'Timed out waiting for another CLI process to start browser authorization.',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

function releaseListenerStartLock(lockDir) {
  if (!lockDir) return;
  try {
    rmdirSync(lockDir);
  } catch {
    // A crashed owner or stale-lock cleanup may already have removed it.
  }
}

export async function acquireListenerGlobalLock({
  staleMs = LISTENER_START_LOCK_STALE_MS,
  waitMs = LISTENER_START_LOCK_STALE_MS * 2,
  heartbeatMs = LISTENER_GLOBAL_LOCK_HEARTBEAT_MS,
} = {}) {
  const lockDir = listenerGlobalLockDir();
  mkdirSync(dirname(lockDir), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(lockDir);
      const lock = {
        lockDir,
        ownerToken: base64url(randomBytes(24)),
        heartbeat: null,
      };
      writeListenerGlobalLockOwner(lock);
      lock.heartbeat = setInterval(() => {
        try {
          writeListenerGlobalLockOwner(lock);
        } catch {
          // A stale-lock recovery may have retired this directory. Ownership-
          // qualified release below must not disturb the successor.
        }
      }, heartbeatMs);
      lock.heartbeat.unref?.();
      return lock;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (
        listenerGlobalLockIsStale(lockDir, staleMs)
        && retireStaleListenerGlobalLock(lockDir)
      ) {
        continue;
      }
      if (Date.now() >= deadline) {
        throw oauthError(
          'oauth_listener_global_lock_timeout',
          'Timed out waiting for another CLI process to finish OAuth account changes.',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

export function releaseListenerGlobalLock(lock) {
  if (!lock) return;
  clearInterval(lock.heartbeat);
  const owner = readListenerGlobalLockOwner(lock.lockDir);
  if (owner?.owner_token !== lock.ownerToken) return;
  const releasedDir = `${lock.lockDir}.released-${process.pid}-${lock.ownerToken}`;
  try {
    renameSync(lock.lockDir, releasedDir);
  } catch {
    return;
  }
  const movedOwner = readListenerGlobalLockOwner(releasedDir);
  if (movedOwner?.owner_token !== lock.ownerToken) {
    try { renameSync(releasedDir, lock.lockDir); } catch { /* successor already owns the path */ }
    return;
  }
  rmSync(releasedDir, { recursive: true, force: true });
}

function saveListenerState(runtime, state) {
  const file = listenerStateFile(runtime);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function readListenerState(runtime) {
  try {
    const state = JSON.parse(readFileSync(listenerStateFile(runtime), 'utf-8'));
    return state?.profile === runtime.profileName ? state : null;
  } catch {
    return null;
  }
}

function listenerStateAllowsPersistence(runtime, ownerPid) {
  const state = readListenerState(runtime);
  return Boolean(
    state
    && Number(state.pid) === Number(ownerPid)
    && state.cancelled !== true
    && Number(state.expires_at) > Math.floor(Date.now() / 1000),
  );
}

/**
 * Drop the listener record, optionally only when it still describes `ownerPid`.
 *
 * A child that times out must not delete a record a newer child already wrote:
 * losing it orphans the live listener, because every later stop and reuse finds
 * the profile through this file.
 */
export function clearListenerState(runtime, { ownerPid = null } = {}) {
  if (ownerPid !== null) {
    try {
      const state = JSON.parse(readFileSync(listenerStateFile(runtime), 'utf-8'));
      if (Number(state?.pid) !== Number(ownerPid)) return;
    } catch {
      return;
    }
  }
  try {
    rmSync(listenerStateFile(runtime));
  } catch {
    // Nothing to clear.
  }
}

/**
 * A listener from an earlier run that is still waiting for the same browser.
 *
 * Re-running `notis start` is routine — an agent does it to check whether the
 * user has finished — and each run would otherwise strand another detached
 * process holding another port. Handing back the authorization URL the user was
 * already given is also the only answer that stays true: the earlier URL is the
 * one whose PKCE verifier the live listener holds.
 */
function readLiveListener(runtime, { sameApiBase = true } = {}) {
  const state = readListenerState(runtime);
  if (!state?.pid || !state?.authorize_url) return null;
  if (state.cancelled === true) return null;
  // Reuse needs the endpoint to match, because a grant belongs to the API that
  // issued it. Stopping one does not: a listener for any endpoint is still
  // about to write this profile.
  if (sameApiBase && state.api_base !== runtime.apiBase) return null;
  if (Number(state.expires_at) <= Math.floor(Date.now() / 1000)) return null;
  if (!listenerProcessIsAlive(state.pid, {
    expectedIdentity: state.identity_token,
    expectedScriptPath: state.listener_script,
  })) return null;
  return state;
}

/**
 * Is this pid still *our* listener?
 *
 * A bare `kill(pid, 0)` only proves some process holds the number. State files
 * outlive reboots and SIGKILLs, and pids are recycled, so that test eventually
 * reports a stranger as the listener — which would hand out an authorize URL
 * whose loopback port is dead, and let `logout` signal an unrelated process.
 * Matching the command line costs one `ps` on a rare path and rules both out.
 */
export function listenerProcessIsAlive(
  pid,
  {
    platform = process.platform,
    run = execFileSync,
    signal = process.kill.bind(process),
    expectedIdentity = null,
    expectedScriptPath = null,
  } = {},
) {
  const numericPid = Number(pid);
  if (!Number.isSafeInteger(numericPid) || numericPid <= 0) return false;
  try {
    // Signal 0 tests for a live process without touching it.
    signal(numericPid, 0);
  } catch {
    return false;
  }
  // tasklist's verbose view does not contain a process command line, so it can
  // never identify the script behind node.exe. CIM exposes the actual command
  // line and is available through Windows PowerShell and modern PowerShell.
  const windowsCommand = `(Get-CimInstance Win32_Process -Filter "ProcessId = ${numericPid}").CommandLine`;
  const probes = platform === 'win32'
    ? [
      ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsCommand]],
      ['pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsCommand]],
    ]
    : [['ps', ['-o', 'command=', '-p', String(numericPid)]]];
  for (const [command, args] of probes) {
    try {
      const output = run(command, args, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: LISTENER_IDENTITY_PROBE_TIMEOUT_MS,
      });
      return Boolean(
        expectedIdentity
        && expectedScriptPath
        && output.includes(expectedScriptPath)
        && output.includes(LISTENER_SCRIPT_NAME)
        && output.includes(expectedIdentity),
      );
    } catch {
      // Try the next probe.
    }
  }
  // Nothing here can tell this pid apart from a stranger that inherited the
  // number. Fail closed: the cost is a listener we stop reusing, against
  // signalling an unrelated process, which is the failure that cannot be undone.
  return false;
}

/**
 * End an authorization that is still in flight for this profile.
 *
 * Best effort by design: the listener may already have exited, and failing to
 * reach it is never a reason to fail the command that asked for this.
 */
export function stopPendingListener(
  runtime,
  {
    platform = process.platform,
    signal = process.kill.bind(process),
  } = {},
) {
  const state = readListenerState(runtime);
  const live = readLiveListener(runtime, { sameApiBase: false });
  if (live) {
    // Persist cancellation before notifying the child. POSIX can deliver a
    // catchable SIGTERM, but Windows terminates Node immediately for that
    // signal. On Windows the child observes this tombstone through its polling
    // channel and stays alive long enough to revoke an in-flight exchange.
    saveListenerState(runtime, { ...live, cancelled: true });
    if (platform === 'win32') return;
    try {
      signal(live.pid, 'SIGTERM');
      clearListenerState(runtime, { ownerPid: live.pid });
    } catch {
      // Already gone, or owned by another user. Keep the tombstone so a child
      // that is still alive cannot persist this authorization.
    }
    return;
  }
  if (
    state?.pid
    && Number(state.expires_at) > Math.floor(Date.now() / 1000)
  ) {
    // Signal 0 may prove the PID exists while ps/CIM cannot prove it is ours.
    // Never signal that process, but keep a cancellation tombstone the child
    // must observe under the start lock before it can persist credentials.
    saveListenerState(runtime, { ...state, cancelled: true });
    return;
  }
  clearListenerState(runtime);
}

async function stopPendingListenerAfterStart(runtime) {
  const lockDir = await acquireListenerStartLock(runtime);
  try {
    stopPendingListener(runtime);
  } finally {
    releaseListenerStartLock(lockDir);
  }
}

async function clearListenerStateAfterStart(runtime, { ownerPid }) {
  const lockDir = await acquireListenerStartLock(runtime);
  try {
    clearListenerState(runtime, { ownerPid });
  } finally {
    releaseListenerStartLock(lockDir);
  }
}

/**
 * Hand the loopback callback to a process that outlives this command.
 *
 * An agent reads a command's output only once the command exits, so a login
 * that waited in-process would hold the authorization URL hostage inside a
 * command that cannot finish until the user opens the URL they were never
 * shown. Detaching breaks that deadlock: this process prints the URL and exits
 * while the child keeps the listener, so an agent-driven signup gets the same
 * no-copy browser hand-off a human at a terminal gets.
 *
 * Returns null rather than throwing when the child cannot be started or cannot
 * bind — a sandbox that forbids either is a reason to fall back to the code
 * flow, not to fail the login.
 */
async function startDetachedLoopbackListener(runtime, {
  metadata,
  verifier,
  state,
  scopes,
  timeoutMs,
  portalOrigin,
}) {
  // A retry can start in another process before this child consumes its input.
  // Keep each verifier/state payload private to exactly one child.
  const identityToken = randomBytes(24).toString('base64url');
  const payloadFile = `${listenerStateFile(runtime)}.payload.${process.pid}.${randomBytes(8).toString('hex')}`;
  try {
    mkdirSync(dirname(payloadFile), { recursive: true });
    writeFileSync(payloadFile, JSON.stringify({
      profile: runtime.profileName,
      api_base: runtime.apiBase,
      verifier,
      state,
      scopes,
      timeout_ms: timeoutMs,
      portal_origin: portalOrigin,
      metadata,
    }), { mode: 0o600, flag: 'wx' });
  } catch {
    return null;
  }

  let child;
  try {
    child = spawn(process.execPath, [LISTENER_SCRIPT, payloadFile, identityToken], {
      detached: true,
      windowsHide: true,
      // An IPC channel only so the child can report the port it bound. Every
      // other stream is dropped: the child must not write to a terminal the
      // parent no longer owns.
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: listenerChildEnvironment(),
    });
  } catch {
    try { rmSync(payloadFile); } catch { /* best effort */ }
    return null;
  }

  const port = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('error', onFailure);
      child.off('exit', onFailure);
      resolve(value);
    };
    const onMessage = (message) => finish(Number(message?.port) || null);
    const onFailure = () => finish(null);
    const timer = setTimeout(() => finish(null), LISTENER_HANDSHAKE_TIMEOUT_MS);
    child.once('message', onMessage);
    child.once('error', onFailure);
    child.once('exit', onFailure);
  });

  if (!port) {
    try { child.kill(); } catch { /* already gone */ }
    try { rmSync(payloadFile); } catch { /* the child may have consumed it */ }
    return null;
  }

  // The child owns its lifetime from here. Disconnecting drops the only handle
  // keeping this process's event loop alive on its behalf.
  try { child.disconnect(); } catch { /* already disconnected */ }
  child.unref();
  return {
    pid: child.pid,
    port,
    redirectUri: `http://127.0.0.1:${port}/callback`,
    identityToken,
    scriptPath: LISTENER_SCRIPT,
  };
}

async function revokeCancelledToken(metadata, tokenResponse, fetchImpl) {
  const token = tokenResponse?.refresh_token || tokenResponse?.access_token;
  if (!token || !metadata?.revocationEndpoint || !metadata?.clientId) return;
  try {
    await fetchJson(
      metadata.revocationEndpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, client_id: metadata.clientId }),
      },
      fetchImpl,
    );
  } catch {
    // The child still refuses local persistence. Revocation is compensating
    // cleanup and must not turn a cancelled browser page into a credential.
  }
}

/**
 * The detached child's whole life: bind, report the port, wait, persist.
 *
 * Runs in its own process with no terminal, so nothing here may write to stdout
 * or throw past the top level — a crash would leave the user staring at a
 * browser page that never resolves.
 */
export async function runDetachedLoginListener(
  payloadFile,
  fetchImpl = fetch,
  identityToken = process.argv[3] || null,
) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(payloadFile, 'utf-8'));
  } catch {
    return 1;
  }
  // The verifier is a bearer secret for this authorization. It has been read;
  // it should not outlive the read.
  try { rmSync(payloadFile); } catch { /* best effort */ }

  const runtime = { profileName: payload.profile, apiBase: payload.api_base };
  let receiver;
  try {
    receiver = await createLoopbackReceiver({
      state: payload.state,
      timeoutMs: Number(payload.timeout_ms) || DEFAULT_LOGIN_TIMEOUT_MS,
      portalOrigin: payload.portal_origin,
    });
  } catch {
    return 1;
  }

  process.send?.({ port: receiver.port });

  // Logout signals the child instead of killing it blindly. Before exchange,
  // cancellation closes the wait immediately. During exchange, the child stays
  // alive long enough to revoke any grant the server may already have issued.
  let terminationRequested = false;
  const requestTermination = () => {
    if (terminationRequested) return;
    terminationRequested = true;
    receiver.cancel();
  };
  process.once('SIGTERM', requestTermination);
  // Windows cannot deliver a catchable SIGTERM to another Node process. The
  // state file is therefore also a cross-platform cancellation channel. A
  // replacement listener changes the owner pid; logout marks this owner as
  // cancelled. Either transition must stop this child before it can persist.
  let ownPublicationObserved = false;
  const cancellationPoll = setInterval(() => {
    const state = readListenerState(runtime);
    if (!state) return;
    const stateBelongsToThisChild = Boolean(
      Number(state.pid) === Number(process.pid)
      && (!identityToken || state.identity_token === identityToken),
    );
    // The parent publishes this child's ownership only after the child has
    // bound and reported its port. Until that publication is visible, an old
    // Windows/unverifiable cancellation tombstone still belongs to the
    // predecessor and must not make the replacement cancel itself.
    if (!ownPublicationObserved) {
      if (!stateBelongsToThisChild) return;
      ownPublicationObserved = true;
    }
    if (
      !stateBelongsToThisChild
      || state.cancelled === true
      || Number(state.expires_at) <= Math.floor(Date.now() / 1000)
    ) {
      requestTermination();
    }
  }, LISTENER_CANCELLATION_POLL_MS);
  cancellationPoll.unref?.();

  let tokenResponse = null;
  let tokenPersisted = false;
  try {
    const code = await receiver.waitForCode();
    // Keep replacement publication and logout serialized across the whole
    // exchange. Revoking an old refresh token revokes the CLI grant, not just
    // one token family, so compensation must complete before a successor can
    // exchange and persist under that same grant.
    const globalLock = await acquireListenerGlobalLock();
    let lockDir = null;
    try {
      lockDir = await acquireListenerStartLock(runtime);
      if (terminationRequested || !listenerStateAllowsPersistence(runtime, process.pid)) {
        throw oauthError(
          'oauth_listener_cancelled',
          'This browser authorization is no longer active.',
        );
      }
      tokenResponse = await exchangeCode(
        payload.metadata,
        { code, redirectUri: receiver.redirectUri, verifier: payload.verifier },
        fetchImpl,
      );
      if (terminationRequested || !listenerStateAllowsPersistence(runtime, process.pid)) {
        throw oauthError(
          'oauth_listener_cancelled',
          'This browser authorization is no longer active.',
        );
      }
      persistOAuthTokenResponse(runtime, payload.metadata, tokenResponse);
      tokenPersisted = true;
      clearListenerState(runtime, { ownerPid: process.pid });
      receiver.complete();
    } catch (error) {
      if (tokenResponse && !tokenPersisted) {
        await revokeCancelledToken(payload.metadata, tokenResponse, fetchImpl);
      }
      throw error;
    } finally {
      releaseListenerStartLock(lockDir);
      releaseListenerGlobalLock(globalLock);
    }
    return 0;
  } catch {
    receiver.fail({ detached: true });
    return 1;
  } finally {
    clearInterval(cancellationPoll);
    process.off('SIGTERM', requestTermination);
    await receiver.close();
    try {
      await clearListenerStateAfterStart(runtime, { ownerPid: process.pid });
    } catch {
      // The child is exiting and can no longer authorize anything. A stale
      // owner-qualified record is safe for the next login to replace.
    }
  }
}

/**
 * Would a `127.0.0.1` callback on this host reach the browser the user is in?
 *
 * Over SSH or inside a container it usually would not: the listener binds fine,
 * so nothing fails, and the user's own machine answers the callback URL with a
 * connection refused. The Portal code hand-off works from any browser, so an
 * uncertain answer has to resolve to `false` — the cost of choosing it wrongly
 * is one copied code, against a login that cannot be completed at all.
 *
 * `--mode browser` still forces the loopback for anyone who has forwarded the
 * port and knows better.
 */
export function loopbackReachesTheUsersBrowser(
  env = process.env,
  pathExists = (path) => {
    try {
      statSync(path);
      return true;
    } catch {
      return false;
    }
  },
  platform = process.platform,
) {
  // Connection markers carry identity/address data, so their presence is the
  // signal. CI/provider flags are booleans encoded as strings; conventional
  // disabled values must not turn a local machine into a remote host merely
  // because non-empty strings are truthy in JavaScript.
  const remoteConnectionMarkers = [
    'SSH_CONNECTION',
    'SSH_CLIENT',
    'SSH_TTY',
    'JENKINS_URL',
    'CODEBUILD_BUILD_ID',
  ];
  const remoteBooleanMarkers = [
    'CODESPACES',
    'REMOTE_CONTAINERS',
    'DEVCONTAINER',
    'CI',
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'BUILDKITE',
    'CIRCLECI',
    'TF_BUILD',
    'RENDER',
    'VERCEL',
  ];
  const disabledFlagValues = new Set(['', '0', 'false', 'no', 'off']);
  const remoteFlagEnabled = (name) => {
    if (env[name] === undefined || env[name] === null) return false;
    return !disabledFlagValues.has(String(env[name]).trim().toLowerCase());
  };
  if (
    remoteConnectionMarkers.some((name) => Boolean(env[name]))
    || remoteBooleanMarkers.some(remoteFlagEnabled)
  ) return false;
  // Notis cloud agents run under this canonical root. Their browser belongs to
  // the user, not the Vercel VM, so a listener on the VM's loopback is unreachable.
  if (pathExists('/vercel/sandbox') || pathExists('/.dockerenv')) return false;
  // macOS and Windows browser launches are local unless one of the remote
  // markers above says otherwise. On Linux, require a graphical session:
  // marker-free cloud workers are commonly plain VMs where 127.0.0.1 belongs
  // to the worker rather than to the user's browser.
  if (platform === 'darwin' || platform === 'win32') return true;
  if (platform === 'linux') {
    return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY || env.MIR_SOCKET);
  }
  return false;
}

const LOGIN_MODES = new Set(['auto', 'browser', 'code']);

function requestedLoginMode(options) {
  const requested = options.mode ? String(options.mode).toLowerCase() : null;
  if (requested && !LOGIN_MODES.has(requested)) {
    throw usageError(
      `Unknown login mode "${requested}". Use auto, browser, or code.`,
      { code: 'oauth_login_mode_invalid', mode: requested },
    );
  }
  return requested;
}

function requestedAuthorizationTimeoutMs(options) {
  const hasSeconds = options.timeoutSeconds !== undefined && options.timeoutSeconds !== null;
  const hasMilliseconds = options.timeoutMs !== undefined && options.timeoutMs !== null;
  if (!hasSeconds && !hasMilliseconds) return null;
  const raw = hasSeconds ? options.timeoutSeconds : options.timeoutMs;
  const numeric = Number(raw);
  const milliseconds = hasSeconds ? numeric * 1000 : numeric;
  if (
    !Number.isFinite(numeric)
    || numeric <= 0
    || !Number.isInteger(numeric)
    || !Number.isSafeInteger(milliseconds)
    || milliseconds > MAX_NODE_TIMER_MS
  ) {
    throw usageError(
      '--timeout-seconds must be a positive whole number within the supported timer range.',
      { timeout_seconds: raw },
    );
  }
  return milliseconds;
}

/**
 * Which hand-off the browser uses to return the authorization code.
 *
 * `auto`, the default, always tries the loopback hand-off first so nobody has
 * to copy a code. Whether this process can wait for the browser decides only
 * *who* holds the listener: a terminal login keeps it in-process, and a login
 * that has to return immediately hands it to a detached child. The Portal code
 * flow is the fallback when no listener can start or the user's browser cannot
 * safely reach this machine's loopback callback.
 *
 * `browser` additionally insists on waiting in-process, which is what a piped
 * but human-driven run (CI, `| tee`) wants. `code` forces the Portal flow for
 * an SSH session where no browser on this machine can reach 127.0.0.1.
 */
function resolveLoginMode(runtime, options) {
  const requested = requestedLoginMode(options);
  // --paste-code predates --mode and stays an alias so published commands and
  // documented recipes keep working unchanged.
  const mode = requested || (options.pasteCode ? 'code' : 'auto');
  const wantsNonBlocking = Boolean(
    runtime.agentMode
    || ['json', 'yaml', 'ndjson'].includes(runtime.outputMode)
    || runtime.nonInteractive,
  );

  if (mode === 'browser' && runtime.agentMode) {
    throw oauthError(
      'oauth_login_mode_unavailable',
      'Agent mode cannot block on a browser callback: the authorization URL only reaches the user once this command exits.',
      [
        {
          command: 'notis login',
          reason: 'The default already hands the browser callback to a background listener, so no code is copied',
        },
        { command: 'notis login --mode code', reason: 'Show a code the agent can hand to the user instead' },
      ],
    );
  }

  const loopbackReachable = loopbackReachesTheUsersBrowser(
    runtime.hostEnvironment ?? process.env,
    undefined,
    runtime.hostPlatform ?? process.platform,
  );
  return {
    automaticMode: mode === 'auto',
    wantsNonBlocking,
    // An explicit --mode browser is a promise to wait, so it overrides the
    // non-blocking default that a piped stdout would otherwise imply.
    nonBlocking: wantsNonBlocking && mode !== 'browser',
    // Only an explicit request starts on the code flow. Every other mode earns
    // its way there by failing to bind a loopback port -- except on a host whose
    // loopback the user's browser cannot reach, where binding succeeds and the
    // callback is unreachable anyway.
    usePasteCode: mode === 'code' || (mode === 'auto' && !loopbackReachable),
  };
}

function redeemCommand(profileName, channel) {
  return [
    cliCommandForChannel(channel),
    `--profile ${quoteShellArgument(profileName || 'default')}`,
    'login --code <code>',
  ].join(' ');
}

/**
 * What to run once the browser has finished, when there is no code to redeem.
 *
 * The detached listener writes the credential itself, so the only thing left is
 * to observe that it landed. `start` is idempotent and reports the account, so
 * it doubles as the confirmation step.
 */
function confirmCommand(profileName, channel, apiBase) {
  return [
    cliCommandForChannel(channel),
    `--profile ${quoteShellArgument(profileName || 'default')}`,
    `--api-base ${quoteShellArgument(apiBase)}`,
    'start',
  ].join(' ');
}

function authorizationChannel(metadata, runtime, pending = null) {
  return metadata.channel
    || pending?.channel
    || channelFromProfile({ api_base: pending?.api_base || runtime.apiBase });
}

function updateRuntimeFromOAuthProfile(runtime, profile) {
  const oauthApiBase = getOAuthApiBase(profile);
  runtime.jwt = profile.oauth_access_token;
  runtime.credentialKind = 'oauth';
  runtime.credentialSource = 'oauth';
  runtime.oauthAccessToken = profile.oauth_access_token;
  runtime.oauthRefreshToken = profile.oauth_refresh_token;
  runtime.oauthAccessExpiresAt = profile.oauth_access_expires_at;
  runtime.oauthRefreshExpiresAt = profile.oauth_refresh_expires_at;
  runtime.oauthClientId = profile.oauth_client_id;
  runtime.oauthIssuer = profile.oauth_issuer;
  runtime.oauthApiBase = oauthApiBase;
  runtime.oauthResource = getOAuthResource(profile);
  runtime.oauthScopes = profile.oauth_scopes || [];
  runtime.oauthUserId = profile.oauth_user_id;
  if (oauthApiBase && !runtime.requestedApiBase) {
    runtime.apiBase = oauthApiBase;
  }
}

function assertOAuthApiTarget(runtime, profile) {
  const requestedApiBase = String(runtime.requestedApiBase || '').replace(/\/+$/, '');
  const oauthApiBase = getOAuthApiBase(profile);
  if (requestedApiBase && oauthApiBase && requestedApiBase !== oauthApiBase) {
    throw oauthError(
      'oauth_api_target_mismatch',
      `This OAuth grant belongs to ${oauthApiBase}, not ${requestedApiBase}. Run login for the requested environment.`,
    );
  }
}

export async function ensureFreshOAuthCredential(runtime, fetchImpl = fetch) {
  if (runtime.credentialKind !== 'oauth') {
    return Boolean(runtime.jwt);
  }

  const profile = getProfile(loadConfig(), runtime.profileName);
  assertOAuthApiTarget(runtime, profile);
  if (!credentialIsExpired({ credentialKind: 'oauth' }, profile)) {
    updateRuntimeFromOAuthProfile(runtime, profile);
    return true;
  }

  return refreshOAuthCredential(runtime, fetchImpl);
}

async function readPastedCode() {
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const value = (await prompt.question('Paste the authorization code: ')).trim();
    if (!value) throw oauthError('oauth_code_missing', 'No authorization code was provided.');
    try {
      const parsed = new URL(value);
      return parsed.searchParams.get('code') || value;
    } catch {
      return value;
    }
  } finally {
    prompt.close();
  }
}

async function redeemAuthorizationCode(runtime, code, fetchImpl) {
  if (!code) {
    throw oauthError('oauth_code_missing', 'No authorization code was provided.');
  }
  const globalLock = await acquireListenerGlobalLock();
  let lockDir = null;
  let metadata = null;
  let tokenResponse = null;
  let tokenPersisted = false;
  try {
    lockDir = await acquireListenerStartLock(runtime);
    const pending = readPendingAuthorization(runtime);
    if (!pending) {
      throw oauthError(
        'oauth_pending_login_missing',
        'No pending authorization for this profile. Run notis login again to start one.',
      );
    }
    // The grant belongs to the environment that issued it. Redeeming without
    // repeating --api-base must not persist a token under a different backend.
    if (pending.api_base) {
      runtime.apiBase = pending.api_base;
    }
    metadata = {
      apiBase: pending.api_base,
      issuer: pending.issuer,
      resource: pending.resource,
      clientId: pending.client_id,
      tokenEndpoint: pending.token_endpoint,
      revocationEndpoint: pending.revocation_endpoint
        || `${String(pending.issuer || '').replace(/\/+$/, '')}/oauth/revoke`,
      channel: pending.channel,
    };
    if (!metadata.issuer || !metadata.resource || !metadata.clientId || !metadata.tokenEndpoint) {
      throw oauthError(
        'oauth_pending_login_invalid',
        'The pending authorization is incomplete. Run notis login again.',
      );
    }
    // Hold publication ownership through exchange and persistence. Otherwise a
    // new browser start can retire this verifier while its request is in flight
    // and the stale result can overwrite the newer authorization afterward.
    tokenResponse = await exchangeCode(
      metadata,
      { code, redirectUri: pending.redirect_uri, verifier: pending.verifier },
      fetchImpl,
    );
    stopPendingListener(runtime);
    const profile = persistOAuthTokenResponse(runtime, metadata, tokenResponse);
    tokenPersisted = true;
    clearPendingAuthorization(runtime, pending.pending_file);
    updateRuntimeFromOAuthProfile(runtime, profile);
    return { profile, metadata };
  } catch (error) {
    if (tokenResponse && !tokenPersisted) {
      await revokeCancelledToken(metadata, tokenResponse, fetchImpl);
    }
    throw error;
  } finally {
    releaseListenerStartLock(lockDir);
    releaseListenerGlobalLock(globalLock);
  }
}

async function exchangeAndPersistForegroundAuthorization(
  runtime,
  metadata,
  authorization,
  fetchImpl,
) {
  const globalLock = await acquireListenerGlobalLock();
  let lockDir = null;
  let tokenResponse = null;
  let tokenPersisted = false;
  try {
    lockDir = await acquireListenerStartLock(runtime);
    const pending = readPendingAuthorization(runtime);
    if (!pendingAuthorizationOwnedBy(pending, authorization)) {
      throw oauthError(
        'oauth_listener_cancelled',
        'This browser authorization is no longer active.',
      );
    }
    // Linearize exchange and persistence with both detached publication and
    // logout. If logout won first, it removed the owner-qualified pending
    // record above and no grant is minted. If it starts later, it waits and
    // clears the credential after this operation completes.
    stopPendingListener(runtime);
    tokenResponse = await exchangeCode(
      metadata,
      {
        code: authorization.code,
        redirectUri: authorization.redirect_uri,
        verifier: authorization.verifier,
      },
      fetchImpl,
    );
    const profile = persistOAuthTokenResponse(runtime, metadata, tokenResponse);
    tokenPersisted = true;
    clearPendingAuthorizationIfOwner(runtime, authorization);
    return profile;
  } catch (error) {
    if (tokenResponse && !tokenPersisted) {
      await revokeCancelledToken(metadata, tokenResponse, fetchImpl);
    }
    throw error;
  } finally {
    releaseListenerStartLock(lockDir);
    releaseListenerGlobalLock(globalLock);
  }
}

/**
 * The parked authorization this profile is already waiting on, if this run is
 * asking for the same thing.
 *
 * Minting a fresh verifier instead would silently invalidate the URL the user
 * was already handed: the code it returns can only be redeemed against the
 * verifier that was parked with it. Re-running a login is routine -- an agent
 * does it to check progress -- so the answer has to stay the same URL.
 */
function reusablePendingAuthorization(runtime, metadata, scopes, requestedTimeoutMs = null) {
  const pending = readPendingAuthorization(runtime);
  const pendingScopes = Array.isArray(pending?.scopes) && pending.scopes.length > 0
    ? pending.scopes
    : DEFAULT_CLI_OAUTH_SCOPES;
  const sameAuthorization = Boolean(
    pending
    && pending.state
    && pending.api_base === runtime.apiBase
    && pending.issuer === metadata.issuer
    && pending.resource === metadata.resource
    && pending.client_id === metadata.clientId
    && pending.token_endpoint === metadata.tokenEndpoint
    && pending.redirect_uri === metadata.copyPasteRedirectUri
    && (
      requestedTimeoutMs === null
      || Number(pending.authorization_timeout_ms) === requestedTimeoutMs
    )
    && JSON.stringify(pendingScopes) === JSON.stringify(scopes),
  );
  if (!sameAuthorization) return null;
  const challenge = createHash('sha256')
    .update(pending.verifier, 'ascii')
    .digest('base64url');
  return {
    agentAuthorization: {
      authorize_url: buildAuthorizeUrl(metadata, {
        redirectUri: pending.redirect_uri,
        challenge,
        state: pending.state,
        scopes: pendingScopes,
      }),
      expires_in: Math.max(0, Number(pending.expires_at) - Math.floor(Date.now() / 1000)),
      hand_off: 'code',
      redeem_command: redeemCommand(
        runtime.profileName,
        authorizationChannel(metadata, runtime, pending),
      ),
    },
  };
}

export async function loginWithOAuth(
  runtime,
  options = {},
  output,
  fetchImpl = fetch,
  createReceiver = createLoopbackReceiver,
  spawnListener = startDetachedLoopbackListener,
  readCode = readPastedCode,
) {
  // A worktree profile is authenticated by the running `./dev.sh`, not by a
  // browser grant. Authorizing over it would replace a scoped test identity
  // with a real account and quietly point local testing at the wrong user.
  // Check before both starting and redeeming authorization: a copy-paste flow
  // may have started before the worktree lease claimed this profile.
  if (runtime.credentialKind === 'worktree') {
    throw oauthError(
      'oauth_profile_is_dev_managed',
      `Profile "${runtime.profileName}" is managed by ./dev.sh and cannot be authorized in a browser.`,
      [
        {
          command: `notis login --profile ${quoteShellArgument(runtime.profileName === 'default' ? 'personal' : 'default')}`,
          reason: 'Authorize a real account under a different profile name',
        },
        { command: 'notis profile list', reason: 'See the profiles this machine already has' },
      ],
    );
  }
  // Even redemption is a mutating invocation, so malformed local options must
  // fail before reading pending state or contacting the token endpoint.
  requestedLoginMode(options);
  const requestedTimeoutMs = requestedAuthorizationTimeoutMs(options);
  if (options.code) {
    return redeemAuthorizationCode(runtime, String(options.code).trim(), fetchImpl);
  }

  // Reject a malformed local invocation before making discovery requests.
  const loginMode = resolveLoginMode(runtime, options);
  const metadata = await discoverCliOAuth(runtime.apiBase, fetchImpl);
  const scopes = options.scope?.length
    ? [...new Set(options.scope)]
    : DEFAULT_CLI_OAUTH_SCOPES;
  const timeoutMs = requestedTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
  // A detached listener is not a terminal waiting on a prompt: nobody is held
  // up by it, and the user still has to sign up and verify an email, so its
  // default is the parked-authorization window rather than the blocking one.
  // An explicit --timeout-seconds still wins; the flag documents how long the
  // authorization stays open, and silently ignoring it here made it a lie.
  const parkedAuthorizationTimeoutMs = requestedTimeoutMs ?? PENDING_LOGIN_TTL_SECONDS * 1000;
  const {
    automaticMode,
    wantsNonBlocking,
    nonBlocking,
    usePasteCode,
  } = loginMode;
  let nonBlockingAgent = nonBlocking;
  let listenerGlobalLock = null;
  let listenerStartLock = null;
  let receiver;
  let detachedListener = null;
  let detachedListenerPublished = false;
  let redirectUri;
  let foregroundAuthorization = null;

  if (automaticMode || nonBlockingAgent || usePasteCode || options.reusePersistedCredential) {
    listenerGlobalLock = await acquireListenerGlobalLock();
    try {
      listenerStartLock = await acquireListenerStartLock(runtime);
    } catch (error) {
      releaseListenerGlobalLock(listenerGlobalLock);
      listenerGlobalLock = null;
      throw error;
    }
  }

  try {
  if (options.reusePersistedCredential) {
    // `start` doubles as the confirmation command for a detached login. The
    // child can persist its token while this invocation is doing discovery;
    // re-read under the publication lock so an idempotent confirmation cannot
    // mint a second grant from a stale runtime snapshot.
    const storedProfile = getProfile(loadConfig(), runtime.profileName);
    if (
      storedProfile.oauth_access_token
      && !credentialIsExpired({ credentialKind: 'oauth' }, storedProfile)
    ) {
      assertOAuthApiTarget(runtime, storedProfile);
      updateRuntimeFromOAuthProfile(runtime, storedProfile);
      return { profile: storedProfile, metadata, reusedPersistedCredential: true };
    }
  }
  // A listener spawned by an earlier run is still holding the browser hand-off,
  // and its URL is the only one whose verifier that process knows.
  if (automaticMode && !usePasteCode) {
    // Auto mode may have degraded to the copy-code hand-off on an earlier run.
    // That parked verifier owns the URL the user already received, so keep the
    // hand-off sticky instead of publishing a competing loopback authorization.
    const parked = reusablePendingAuthorization(runtime, metadata, scopes, requestedTimeoutMs);
    if (parked) return parked;
    // A non-reusable sidecar belongs to a different/expired authorization. It
    // must not survive beside the listener this run is about to publish.
    clearPendingAuthorizations(runtime);
    const live = readLiveListener(runtime, { sameApiBase: false });
    // Reuse is only safe when the live listener is authorizing the *same*
    // thing. The copy-paste path below already compares the full authorization;
    // matching only the profile here would hand back a URL carrying the scopes
    // of the earlier run, silently ignoring this one's --scope.
    const sameListenerAuthorization = Boolean(
      live
      && live.api_base === runtime.apiBase
      && live.issuer === metadata.issuer
      && live.resource === metadata.resource
      && live.client_id === metadata.clientId
      && live.token_endpoint === metadata.tokenEndpoint
      && (
        requestedTimeoutMs === null
        || Number(live.authorization_timeout_ms) === requestedTimeoutMs
      )
      && JSON.stringify(live.scopes || []) === JSON.stringify(scopes),
    );
    if (live && !sameListenerAuthorization) {
      // A different authorization is being requested, so the old listener is
      // now unreachable work holding a port. Stop it before spawning another.
      stopPendingListener(runtime);
    }
    if (live && sameListenerAuthorization) {
      return {
        agentAuthorization: {
          authorize_url: live.authorize_url,
          expires_in: Math.max(0, Number(live.expires_at) - Math.floor(Date.now() / 1000)),
          hand_off: 'browser_callback',
          confirm_command: confirmCommand(
            runtime.profileName,
            authorizationChannel(metadata, runtime),
            live.api_base,
          ),
        },
      };
    }
  }

  if (!nonBlockingAgent && !usePasteCode) {
    // A foreground browser flow never holds publication locks while a person
    // completes authorization. This also covers explicit browser mode and a
    // start command checking for an already-persisted credential.
    releaseListenerStartLock(listenerStartLock);
    listenerStartLock = null;
    releaseListenerGlobalLock(listenerGlobalLock);
    listenerGlobalLock = null;
  }

  if (usePasteCode) {
    const reused = reusablePendingAuthorization(runtime, metadata, scopes, requestedTimeoutMs);
    if (reused) return reused;
    // Code and loopback hand-offs are mutually exclusive for one profile. This
    // runs under the same publication lock as detached starts so a code request
    // cannot leave a second valid authorization beside a listener that is
    // still being published.
    stopPendingListener(runtime);
  }

  const { verifier, challenge } = createPkce();
  const state = base64url(randomBytes(32));

  // May flip to true below: the browser hand-off is a preference, not a
  // guarantee, and the redirect URI is signed into the authorize URL before the
  // user ever sees it. Deciding here is the last moment a fallback is free.
  let pasteCode = usePasteCode;

  const degradeToCode = (error) => {
    // A locked-down machine that cannot bind 127.0.0.1 used to dead-end here
    // with no way forward, even though the Portal hand-off would have worked.
    // Only a missing copy-paste callback is genuinely unrecoverable.
    if (!metadata.copyPasteRedirectUri) throw error;
    receiver = undefined;
    pasteCode = true;
    // --mode browser promised to wait for a browser callback, not for someone
    // to type into a pipe. Once no listener exists, returning the URL beats
    // prompting on a stdout nobody is reading. A caller that declared itself
    // non-interactive is in the same position: `readPastedCode` would block on
    // a stdin prompt it has already said it cannot answer.
    nonBlockingAgent = wantsNonBlocking || Boolean(runtime.nonInteractive);
    output?.note?.(
      'The local callback listener could not start, so this login switched to the copy-paste code flow.',
    );
  };

  if (!pasteCode) {
    let portalOrigin = 'https://app.notis.ai';
    try {
      portalOrigin = new URL(metadata.copyPasteRedirectUri).origin;
    } catch {
      // The OAuth server owns this metadata. Keep the public Portal fallback if
      // a development server omits or returns an invalid copy-paste URL.
    }
    if (nonBlockingAgent) {
      // This command has to return before the user has even opened the URL, so
      // the listener has to belong to something else.
      detachedListener = await spawnListener(runtime, {
        metadata,
        verifier,
        state,
        scopes,
        timeoutMs: parkedAuthorizationTimeoutMs,
        portalOrigin,
      });
      if (detachedListener) {
        redirectUri = detachedListener.redirectUri;
      } else {
        degradeToCode(oauthError(
          'oauth_loopback_failed',
          'Could not start a background OAuth callback listener.',
        ));
      }
    } else {
      try {
        receiver = await createReceiver({ state, timeoutMs, portalOrigin });
        redirectUri = receiver.redirectUri;
      } catch (error) {
        degradeToCode(error);
      }
    }
  }

  if (pasteCode) {
    // A loopback bind may have degraded after the initial mode decision. Code
    // publication still has to join the same serialization protocol as every
    // detached start before it writes a verifier sidecar.
    if (!listenerStartLock) {
      listenerGlobalLock = await acquireListenerGlobalLock();
      try {
        listenerStartLock = await acquireListenerStartLock(runtime);
      } catch (error) {
        releaseListenerGlobalLock(listenerGlobalLock);
        listenerGlobalLock = null;
        throw error;
      }
      const live = readLiveListener(runtime, { sameApiBase: false });
      if (live) stopPendingListener(runtime);
    }
    if (!usePasteCode) {
      // This run degraded into the code flow rather than starting there, so it
      // has not yet checked for a parked authorization. Overwriting one would
      // make the URL an earlier run already handed the user unredeemable.
      const reused = reusablePendingAuthorization(runtime, metadata, scopes, requestedTimeoutMs);
      if (reused) return reused;
    }
    redirectUri = metadata.copyPasteRedirectUri;
    if (!redirectUri) {
      throw oauthError('oauth_metadata_invalid', 'Notis did not advertise a copy-paste callback.');
    }
  }

  const authorizeUrl = buildAuthorizeUrl(metadata, {
    redirectUri,
    challenge,
    state,
    scopes,
  });

  // Every copy-paste hand-off leaves the browser holding a code this process
  // may no longer be around to receive, so park the verifier for `--code`.
  // The window is the user's, not the terminal's: signing up and consenting
  // routinely outlasts the in-process wait.
  if (pasteCode) {
    savePendingAuthorization(runtime, {
      profile: runtime.profileName,
      api_base: runtime.apiBase,
      verifier,
      state,
      redirect_uri: redirectUri,
      issuer: metadata.issuer,
      resource: metadata.resource,
      client_id: metadata.clientId,
      token_endpoint: metadata.tokenEndpoint,
      revocation_endpoint: metadata.revocationEndpoint,
      authorization_endpoint: metadata.authorizationEndpoint,
      channel: authorizationChannel(metadata, runtime),
      scopes,
      authorization_timeout_ms: parkedAuthorizationTimeoutMs,
      expires_at: Math.floor(Date.now() / 1000) + Math.ceil(parkedAuthorizationTimeoutMs / 1000),
    });
  } else if (!nonBlockingAgent) {
    foregroundAuthorization = {
      profile: runtime.profileName,
      api_base: runtime.apiBase,
      verifier,
      state,
      redirect_uri: redirectUri,
      hand_off: 'browser_callback',
      issuer: metadata.issuer,
      resource: metadata.resource,
      client_id: metadata.clientId,
      token_endpoint: metadata.tokenEndpoint,
      revocation_endpoint: metadata.revocationEndpoint,
      authorization_endpoint: metadata.authorizationEndpoint,
      channel: authorizationChannel(metadata, runtime),
      scopes,
      authorization_timeout_ms: timeoutMs,
      expires_at: Math.floor(Date.now() / 1000) + Math.ceil(timeoutMs / 1000),
    };
    // Logout and competing logins use this owner-qualified sidecar to cancel
    // a foreground authorization before it can exchange or persist a grant.
    await publishForegroundAuthorization(runtime, foregroundAuthorization);
  }

  if (nonBlockingAgent) {
    await receiver?.close();
    if (detachedListener) {
      const listenerTtlSeconds = Math.round(parkedAuthorizationTimeoutMs / 1000);
      saveListenerState(runtime, {
        profile: runtime.profileName,
        api_base: runtime.apiBase,
        pid: detachedListener.pid,
        port: detachedListener.port,
        authorize_url: authorizeUrl,
        issuer: metadata.issuer,
        resource: metadata.resource,
        client_id: metadata.clientId,
        token_endpoint: metadata.tokenEndpoint,
        scopes,
        authorization_timeout_ms: parkedAuthorizationTimeoutMs,
        identity_token: detachedListener.identityToken,
        listener_script: detachedListener.scriptPath,
        // The record must not outlive the child it points at, or reuse hands
        // back a URL whose listener has already given up.
        expires_at: Math.floor(Date.now() / 1000) + listenerTtlSeconds,
      });
      detachedListenerPublished = true;
      return {
        agentAuthorization: {
          authorize_url: authorizeUrl,
          expires_in: listenerTtlSeconds,
          // Nothing to copy: the browser returns the code to the listener the
          // child is holding, and the credential is written before the user is
          // told they are connected.
          hand_off: 'browser_callback',
          confirm_command: confirmCommand(
            runtime.profileName,
            authorizationChannel(metadata, runtime),
            runtime.apiBase,
          ),
        },
      };
    }
    return {
      agentAuthorization: {
        authorize_url: authorizeUrl,
        expires_in: Math.round(parkedAuthorizationTimeoutMs / 1000),
        hand_off: 'code',
        redeem_command: redeemCommand(
          runtime.profileName,
          authorizationChannel(metadata, runtime),
        ),
      },
    };
  }

  if (pasteCode) {
    // Do not hold publication locks while a human finds and pastes a code. The
    // parked verifier is now authoritative; redemption reacquires both locks
    // and validates that it still owns the profile before exchanging.
    releaseListenerStartLock(listenerStartLock);
    listenerStartLock = null;
    releaseListenerGlobalLock(listenerGlobalLock);
    listenerGlobalLock = null;
  }

  // Always surface the URL: opening the browser can fail silently, and the
  // wait below is useless without something the user can paste themselves.
  const announceAuthorization = output?.notice || output?.note;
  announceAuthorization?.call(output, `Authorize Notis CLI: ${authorizeUrl}`);
  if (options.browser !== false && !pasteCode) {
    openBrowser(authorizeUrl);
  }

  try {
    if (pasteCode) {
      return await redeemAuthorizationCode(runtime, await readCode(), fetchImpl);
    }
    const code = await receiver.waitForCode();
    const profile = await exchangeAndPersistForegroundAuthorization(
      runtime,
      metadata,
      { ...foregroundAuthorization, code },
      fetchImpl,
    );
    updateRuntimeFromOAuthProfile(runtime, profile);
    receiver?.complete();
    return { profile, metadata };
  } catch (error) {
    receiver?.fail();
    throw error;
  } finally {
    await receiver?.close();
    if (foregroundAuthorization) {
      const globalLock = await acquireListenerGlobalLock();
      let lockDir = null;
      try {
        lockDir = await acquireListenerStartLock(runtime);
        clearPendingAuthorizationIfOwner(runtime, foregroundAuthorization);
      } finally {
        releaseListenerStartLock(lockDir);
        releaseListenerGlobalLock(globalLock);
      }
    }
  }
  } finally {
    if (detachedListener && !detachedListenerPublished) {
      try { process.kill(detachedListener.pid); } catch { /* already gone */ }
      clearListenerState(runtime, { ownerPid: detachedListener.pid });
    }
    releaseListenerStartLock(listenerStartLock);
    releaseListenerGlobalLock(listenerGlobalLock);
  }
}

function pendingListenerProfiles() {
  const configFile = resolveConfigFile();
  const prefix = `${basename(configFile)}.login-listener.`;
  let entries;
  try {
    entries = readdirSync(dirname(configFile));
  } catch {
    return [];
  }
  const profiles = new Set();
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || entry.includes('.payload') || entry.endsWith('.lock')) continue;
    try {
      const state = JSON.parse(readFileSync(join(dirname(configFile), entry), 'utf-8'));
      if (typeof state?.profile === 'string' && state.profile) profiles.add(state.profile);
    } catch {
      // Ignore malformed or concurrently removed sidecars.
    }
  }
  return [...profiles];
}

function pendingAuthorizationProfiles() {
  const configFile = resolveConfigFile();
  const configName = basename(configFile);
  const prefix = `${configName}.pending-login.`;
  const legacyName = `${configName}.pending-login`;
  let entries;
  try {
    entries = readdirSync(dirname(configFile));
  } catch {
    return [];
  }
  const profiles = new Set();
  for (const entry of entries) {
    if (entry !== legacyName && !entry.startsWith(prefix)) continue;
    try {
      const pending = JSON.parse(readFileSync(join(dirname(configFile), entry), 'utf-8'));
      if (typeof pending?.profile === 'string' && pending.profile) profiles.add(pending.profile);
    } catch {
      // Ignore malformed or concurrently removed sidecars.
    }
  }
  return [...profiles];
}

function lockIsStale() {
  try {
    return Date.now() - statSync(OAUTH_LOCK_DIR).mtimeMs > 45_000;
  } catch {
    return false;
  }
}

async function acquireRefreshLock(runtime, waitMs = 60_000) {
  mkdirSync(join(homedir(), '.notis'), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(OAUTH_LOCK_DIR);
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const profile = getProfile(loadConfig(), runtime.profileName);
      if (
        profile.oauth_access_token
        && profile.oauth_access_token !== runtime.oauthAccessToken
        && !credentialIsExpired({ credentialKind: 'oauth' }, profile)
      ) {
        updateRuntimeFromOAuthProfile(runtime, profile);
        return false;
      }
      if (lockIsStale()) {
        try {
          rmdirSync(OAUTH_LOCK_DIR);
          continue;
        } catch {
          // The owner may have completed between stat and removal.
        }
      }
      if (Date.now() >= deadline) {
        throw oauthError('oauth_refresh_lock_timeout', 'Timed out waiting for another CLI process to refresh OAuth.');
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

export async function refreshOAuthCredential(runtime, fetchImpl = fetch) {
  // Refresh rotates the same stored grant that login publishes and logout
  // removes. Join their global -> profile lock order so a token rotation can
  // never be mistaken for a successor authorization by a concurrent logout.
  const globalLock = await acquireListenerGlobalLock();
  let profileLock = null;
  let ownsLock = false;
  let metadata = null;
  let rotatedResponse = null;
  let rotatedPersisted = false;
  try {
    profileLock = await acquireListenerStartLock(runtime);
    ownsLock = await acquireRefreshLock(runtime);
    if (!ownsLock) return true;
    const config = loadConfig();
    const profile = getProfile(config, runtime.profileName);
    assertOAuthApiTarget(runtime, profile);
    if (
      profile.oauth_access_token
      && profile.oauth_access_token !== runtime.oauthAccessToken
      && !credentialIsExpired({ credentialKind: 'oauth' }, profile)
    ) {
      updateRuntimeFromOAuthProfile(runtime, profile);
      return true;
    }
    if (!profile.oauth_refresh_token || !profile.oauth_client_id || !profile.oauth_issuer) {
      return false;
    }

    metadata = storedOAuthMetadata(runtime, profile);
    rotatedResponse = await fetchJson(
      metadata.tokenEndpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: profile.oauth_refresh_token,
          client_id: profile.oauth_client_id,
          resource: metadata.resource,
        }),
      },
      fetchImpl,
    );
    const updated = persistOAuthTokenResponse(runtime, metadata, rotatedResponse);
    rotatedPersisted = true;
    updateRuntimeFromOAuthProfile(runtime, updated);
    return true;
  } catch (error) {
    if (rotatedResponse && !rotatedPersisted) {
      await revokeCancelledToken(metadata, rotatedResponse, fetchImpl);
    }
    if (error instanceof CliError) {
      throw new CliError({
        code: error.code,
        message: error.message,
        exitCode: error.exitCode,
        retryable: error.retryable,
        details: error.details,
        hints: getAuthRecovery(runtime).hints,
        warnings: error.warnings,
        cause: error,
      });
    }
    throw error;
  } finally {
    if (ownsLock) {
      try {
        rmdirSync(OAUTH_LOCK_DIR);
      } catch {
        // A process exit or external cleanup may already have removed the lock.
      }
    }
    releaseListenerStartLock(profileLock);
    releaseListenerGlobalLock(globalLock);
  }
}

export async function logoutOAuth(runtime, { allProfiles = false } = {}, fetchImpl = fetch) {
  if (runtime.credentialKind === 'worktree' && !allProfiles) {
    throw oauthError(
      'oauth_profile_is_dev_managed',
      `Profile "${runtime.profileName}" is managed by ./dev.sh and has no OAuth grant to remove.`,
      [
        {
          command: 'notis logout --profile <name>',
          reason: 'Name a stored OAuth profile to disconnect it',
        },
        { command: 'notis profile list', reason: 'See the stored account profiles on this machine' },
      ],
    );
  }
  // A single-profile logout mutates the same state as login publication and
  // refresh, so it needs the global lock just as much as --all-profiles does.
  const globalLock = await acquireListenerGlobalLock();
  try {
    const config = loadConfig();
    const profileNames = allProfiles
      ? [...new Set([
        ...Object.keys(config.profiles),
        ...pendingListenerProfiles(),
        ...pendingAuthorizationProfiles(),
      ])]
      : [runtime.profileName];
    const clearedProfiles = [];
    for (const profileName of profileNames) {
      // An unfinished login is still holding a listener that would write this
      // profile back in the moment the old URL is opened. Signing out has to end
      // the authorization in flight, not just the one already stored.
      const profileRuntime = { ...runtime, profileName };
      const profileLock = await acquireListenerStartLock(profileRuntime);
      try {
        const latestBeforeClear = loadConfig();
        const storedProfile = latestBeforeClear.profiles[profileName] || {};
        const hadStoredGrant = Boolean(
          storedProfile.oauth_access_token
          || storedProfile.oauth_refresh_token
          || storedProfile.oauth_client_id
          || storedProfile.oauth_issuer
          || storedProfile.oauth_resource
          || storedProfile.oauth_user_id
        );
        const hadPendingAuthorization = Boolean(readPendingAuthorization(profileRuntime));
        const hadListener = Boolean(readListenerState(profileRuntime));
        if (hadStoredGrant || hadPendingAuthorization || hadListener) {
          clearedProfiles.push(profileName);
        }
        clearPendingAuthorizations(profileRuntime);
        stopPendingListener(profileRuntime);
        // Read only after both locks are held. A publication or refresh that
        // won first is part of this logout; one that starts later observes the
        // cleared profile instead of resurrecting it afterward.
        const profile = loadConfig().profiles[profileName] || {};
        const revocationToken = profile.oauth_refresh_token || profile.oauth_access_token;
        if (
          revocationToken
          && profile.oauth_client_id
          && profile.oauth_issuer
        ) {
          try {
            const metadata = storedOAuthMetadata(runtime, profile);
            await fetchJson(
              metadata.revocationEndpoint,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  token: revocationToken,
                  client_id: profile.oauth_client_id,
                }),
              },
              fetchImpl,
            );
          } catch {
            // Local credential removal still succeeds when the remote grant is
            // already gone or the network is unavailable.
          }
        }
        updateConfig((latest) => {
          const current = latest.profiles[profileName];
          // A named pending login has no stored profile yet. Cancelling it must
          // not create an empty profile as a side effect of logout.
          if (!current) return latest;
          latest.profiles[profileName] = {
            ...current,
            oauth_access_token: undefined,
            oauth_refresh_token: undefined,
            oauth_access_expires_at: undefined,
            oauth_refresh_expires_at: undefined,
            oauth_client_id: undefined,
            oauth_issuer: undefined,
            oauth_api_base: undefined,
            oauth_resource: undefined,
            oauth_scopes: undefined,
            oauth_user_id: undefined,
          };
          return latest;
        });
      } finally {
        releaseListenerStartLock(profileLock);
      }
    }
    return { profiles: clearedProfiles };
  } finally {
    releaseListenerGlobalLock(globalLock);
  }
}
