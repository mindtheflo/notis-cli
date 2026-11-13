/**
 * The live Notis APIs, one row per release channel: the API's current name,
 * the names it answered on before (retired), and the channel's Portal.
 *
 * Every CLI list of live API hosts derives from this table. When a channel's
 * API moves to a new name, the new name becomes `current` and the old one
 * joins `retired`. A retired name stays listed after its domain is removed:
 * profiles that stored it keep being recognised and renamed to `current`
 * (CLI-037), and sign-ins recorded on it are known to be spent (CLI-038).
 * Mirrors server/lib/release_channels.py (CHANNEL_ORIGINS, _LEGACY_HOSTNAMES).
 */
const CHANNEL_APIS = {
  stable: { current: 'api.notis.ai', retired: [], portal: 'https://app.notis.ai' },
  nightly: { current: 'api-nightly.notis.ai', retired: ['api-beta.notis.ai'], portal: 'https://app-nightly.notis.ai' },
};

const HOST_ROWS = Object.entries(CHANNEL_APIS).flatMap(([channel, row]) => [
  { host: row.current, channel, current: true },
  ...row.retired.map(host => ({ host, channel, current: false })),
]);

/** Every live API hostname, current names first. */
export const LIVE_API_HOSTS = [
  ...HOST_ROWS.filter(row => row.current),
  ...HOST_ROWS.filter(row => !row.current),
].map(row => row.host);

/** Every live API origin (`https://<host>`), current names first. */
export const LIVE_API_ORIGINS = LIVE_API_HOSTS.map(host => `https://${host}`);

/** The channel a live API hostname serves, else null. */
export function channelForApiHost(hostname) {
  return HOST_ROWS.find(row => row.host === hostname)?.channel || null;
}

/** The Portal of the channel a live API hostname serves, else null. */
export function portalOriginForApiHost(hostname) {
  const channel = channelForApiHost(hostname);
  return channel ? CHANNEL_APIS[channel].portal : null;
}

/** The current API origin of a channel (`https://api-nightly.notis.ai`). */
export function currentApiOrigin(channel) {
  return `https://${CHANNEL_APIS[channel].current}`;
}

/** Whether a hostname is a retired name of a live API. */
export function isRetiredApiHost(hostname) {
  return HOST_ROWS.some(row => row.host === hostname && !row.current);
}

function parsedHttps(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Whether a value is exactly a live API origin: `https://<live host>` with at
 * most a trailing slash, no port, path, query or fragment.
 */
export function isLiveApiOrigin(value) {
  const parsed = parsedHttps(value);
  return Boolean(parsed)
    && LIVE_API_HOSTS.includes(parsed.hostname)
    && !parsed.port
    && /^\/*$/.test(parsed.pathname)
    && !parsed.search
    && !parsed.hash;
}

/**
 * The current origin for a value that is exactly a retired API origin
 * (`https://api-beta.notis.ai` -> `https://api-nightly.notis.ai`), else null.
 * An address with a port, path or query is not the retired API and is left
 * to the caller as stored.
 */
export function renamedRetiredApiOrigin(value) {
  if (!isLiveApiOrigin(value)) return null;
  const { hostname } = new URL(value);
  return isRetiredApiHost(hostname) ? currentApiOrigin(channelForApiHost(hostname)) : null;
}

/** Whether a URL of any shape points at a retired API name over HTTPS. */
export function isOnRetiredApiHost(value) {
  const parsed = parsedHttps(value);
  return Boolean(parsed) && isRetiredApiHost(parsed.hostname);
}
