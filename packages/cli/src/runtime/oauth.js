import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

import { CliError, EXIT_CODES } from './errors.js';
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
    consumed = true;

    const returnedState = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (!stateMatches(state, returnedState)) {
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      endResponse(response, callbackHtml('Authorization failed', 'The callback state did not match.'));
      rejectCode(oauthError('oauth_state_mismatch', 'The OAuth callback state did not match.'));
      return;
    }
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
    fail: () => {
      if (!pendingResponse || pendingResponse.writableEnded) return;
      pendingResponse.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      endResponse(pendingResponse, callbackHtml(
        'Authorization failed',
        'The CLI could not finish signing in. Return to the terminal for details.',
      ));
      pendingResponse = null;
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

function readPendingAuthorization(runtime) {
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
    if (Number(pending.expires_at) <= Math.floor(Date.now() / 1000)) continue;
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

function redeemCommand(profileName, channel) {
  return [
    cliCommandForChannel(channel),
    `--profile ${quoteShellArgument(profileName || 'default')}`,
    'login --code <code>',
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
  const metadata = {
    issuer: pending.issuer,
    resource: pending.resource,
    clientId: pending.client_id,
    tokenEndpoint: pending.token_endpoint,
    channel: pending.channel,
  };
  if (!metadata.issuer || !metadata.resource || !metadata.clientId || !metadata.tokenEndpoint) {
    throw oauthError(
      'oauth_pending_login_invalid',
      'The pending authorization is incomplete. Run notis login again.',
    );
  }
  const tokenResponse = await exchangeCode(
    metadata,
    { code, redirectUri: pending.redirect_uri, verifier: pending.verifier },
    fetchImpl,
  );
  clearPendingAuthorization(runtime, pending.pending_file);
  const profile = persistOAuthTokenResponse(runtime, metadata, tokenResponse);
  updateRuntimeFromOAuthProfile(runtime, profile);
  return { profile, metadata };
}

export async function loginWithOAuth(runtime, options = {}, output, fetchImpl = fetch) {
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
  if (options.code) {
    return redeemAuthorizationCode(runtime, String(options.code).trim(), fetchImpl);
  }

  const metadata = await discoverCliOAuth(runtime.apiBase, fetchImpl);
  const scopes = options.scope?.length
    ? [...new Set(options.scope)]
    : DEFAULT_CLI_OAUTH_SCOPES;
  const timeoutMs = Number(options.timeoutSeconds) > 0
    ? Number(options.timeoutSeconds) * 1000
    : Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : DEFAULT_LOGIN_TIMEOUT_MS;
  const nonBlockingAgent = Boolean(
    runtime.agentMode || runtime.outputMode === 'json',
  );
  const pasteCode = Boolean(options.pasteCode || nonBlockingAgent);
  let receiver;
  let redirectUri;

  if (pasteCode) {
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
      && JSON.stringify(pendingScopes) === JSON.stringify(scopes),
    );
    if (sameAuthorization) {
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
          redeem_command: redeemCommand(
            runtime.profileName,
            authorizationChannel(metadata, runtime, pending),
          ),
        },
      };
    }
  }

  const { verifier, challenge } = createPkce();
  const state = base64url(randomBytes(32));

  if (pasteCode) {
    redirectUri = metadata.copyPasteRedirectUri;
    if (!redirectUri) {
      throw oauthError('oauth_metadata_invalid', 'Notis did not advertise a copy-paste callback.');
    }
  } else {
    let portalOrigin = 'https://app.notis.ai';
    try {
      portalOrigin = new URL(metadata.copyPasteRedirectUri).origin;
    } catch {
      // The OAuth server owns this metadata. Keep the public Portal fallback if
      // a development server omits or returns an invalid copy-paste URL.
    }
    receiver = await createLoopbackReceiver({ state, timeoutMs, portalOrigin });
    redirectUri = receiver.redirectUri;
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
      authorization_endpoint: metadata.authorizationEndpoint,
      channel: authorizationChannel(metadata, runtime),
      scopes,
      expires_at: Math.floor(Date.now() / 1000) + PENDING_LOGIN_TTL_SECONDS,
    });
  }

  if (nonBlockingAgent) {
    await receiver?.close();
    return {
      agentAuthorization: {
        authorize_url: authorizeUrl,
        expires_in: PENDING_LOGIN_TTL_SECONDS,
        redeem_command: redeemCommand(
          runtime.profileName,
          authorizationChannel(metadata, runtime),
        ),
      },
    };
  }

  // Always surface the URL: opening the browser can fail silently, and the
  // wait below is useless without something the user can paste themselves.
  output?.note?.(`Authorize Notis CLI: ${authorizeUrl}`);
  if (options.browser !== false && !pasteCode) {
    openBrowser(authorizeUrl);
  }

  try {
    const code = pasteCode ? await readPastedCode() : await receiver.waitForCode();
    const tokenResponse = await exchangeCode(
      metadata,
      { code, redirectUri, verifier },
      fetchImpl,
    );
    const profile = persistOAuthTokenResponse(runtime, metadata, tokenResponse);
    updateRuntimeFromOAuthProfile(runtime, profile);
    receiver?.complete();
    return { profile, metadata };
  } catch (error) {
    receiver?.fail();
    throw error;
  } finally {
    await receiver?.close();
  }
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
  let ownsLock = false;
  try {
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

    const metadata = storedOAuthMetadata(runtime, profile);
    const response = await fetchJson(
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
    const updated = persistOAuthTokenResponse(runtime, metadata, response);
    updateRuntimeFromOAuthProfile(runtime, updated);
    return true;
  } catch (error) {
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
  const config = loadConfig();
  const profileNames = allProfiles
    ? Object.keys(config.profiles)
    : [runtime.profileName];
  for (const profileName of profileNames) {
    const profile = config.profiles[profileName] || {};
    if (
      profile.oauth_refresh_token
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
              token: profile.oauth_refresh_token,
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
  }
  updateConfig((latest) => {
    for (const profileName of profileNames) {
      const profile = latest.profiles[profileName] || {};
      latest.profiles[profileName] = {
        ...profile,
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
    }
    return latest;
  });
  return { profiles: profileNames };
}
