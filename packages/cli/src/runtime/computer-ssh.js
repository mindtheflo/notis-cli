// Local files for `notis computer ssh`: this device's key, the SSH config
// block for `ssh notis-computer`, the proxy wrapper and the computer's host key.
// Everything lives in ~/.ssh/notis; ~/.ssh/config only gains one Include line.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const SSH_HOST_ALIAS = 'notis-computer';
export const SSH_USER = 'user';
export const INCLUDE_MARKER = '# notis-computer-ssh';
const HOST_KEY_TYPE = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com|rsa-sha2-(256|512))$/;

export function sshPaths(home = homedir()) {
  const dir = join(home, '.ssh', 'notis');
  return {
    sshDir: join(home, '.ssh'),
    dir,
    userConfig: join(home, '.ssh', 'config'),
    config: join(dir, 'config'),
    key: join(dir, 'id_ed25519'),
    publicKey: join(dir, 'id_ed25519.pub'),
    proxy: join(dir, 'proxy'),
    knownHosts: join(dir, 'known_hosts'),
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// ssh_config tokens are split on whitespace; a quoted path survives spaces.
function configPath(value) {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

export function sshConfigText(paths) {
  return [
    '# Written by notis computer ssh --setup. Run it again to refresh this file.',
    `Host ${SSH_HOST_ALIAS}`,
    `  HostName ${SSH_HOST_ALIAS}`,
    `  User ${SSH_USER}`,
    `  IdentityFile ${configPath(paths.key)}`,
    '  IdentitiesOnly yes',
    // The proxy asks Notis where the computer is (and starts it when stopped),
    // writes its current host key, then relays the connection.
    `  ProxyCommand ${configPath(paths.proxy)}`,
    `  HostKeyAlias ${SSH_HOST_ALIAS}`,
    `  UserKnownHostsFile ${configPath(paths.knownHosts)}`,
    '  StrictHostKeyChecking yes',
    '  ServerAliveInterval 15',
    '  ServerAliveCountMax 4',
    '',
  ].join('\n');
}

// The proxy pins this CLI, profile and config file: ssh runs it from any
// directory and apps such as T3 Desktop start it without the shell's
// environment, where a bare `notis` could pick another profile, an older CLI or
// the default config without that profile.
export function proxyScriptText({ nodePath, cliPath, profileName, configFile }) {
  const profile = profileName ? ` --profile ${shellQuote(profileName)}` : '';
  return [
    '#!/bin/sh',
    '# Written by notis computer ssh --setup.',
    ...(configFile ? [`NOTIS_CLI_CONFIG_FILE=${shellQuote(configFile)}`, 'export NOTIS_CLI_CONFIG_FILE'] : []),
    `NODE=${shellQuote(nodePath)}`,
    `CLI=${shellQuote(cliPath)}`,
    `if [ -x "$NODE" ] && [ -f "$CLI" ]; then exec "$NODE" "$CLI"${profile} computer ssh --proxy; fi`,
    `if command -v notis >/dev/null 2>&1; then exec notis${profile} computer ssh --proxy; fi`,
    `exec npx --yes --package @notis_ai/cli@latest -- notis${profile} computer ssh --proxy`,
    '',
  ].join('\n');
}

// Include only works before the first Host block, so the line goes on top.
export function withInclude(existing, paths) {
  const text = existing || '';
  if (text.includes(INCLUDE_MARKER)) return text;
  return `Include ${configPath(paths.config)} ${INCLUDE_MARKER}\n${text ? `\n${text}` : ''}`;
}

// boat may send a bare key or a known_hosts line; ssh needs `<alias> <type> <key>`.
export function knownHostsText(hostKey) {
  const lines = [];
  for (const raw of String(hostKey || '').split(/\r?\n/)) {
    const fields = raw.trim().split(/\s+/).filter(Boolean);
    const typeIndex = fields.findIndex(field => HOST_KEY_TYPE.test(field));
    if (typeIndex < 0 || !fields[typeIndex + 1]) continue;
    lines.push(`${SSH_HOST_ALIAS} ${fields[typeIndex]} ${fields[typeIndex + 1]}`);
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

function writeAtomic(path, text, mode) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text, { mode });
  chmodSync(temp, mode);
  renameSync(temp, path);
}

export function writeSshFiles({ paths, nodePath, cliPath, profileName, configFile }) {
  mkdirSync(paths.sshDir, { recursive: true, mode: 0o700 });
  writeAtomic(paths.config, sshConfigText(paths), 0o600);
  writeAtomic(paths.proxy, proxyScriptText({ nodePath, cliPath, profileName, configFile }), 0o700);
  const existing = existsSync(paths.userConfig) ? readFileSync(paths.userConfig, 'utf8') : '';
  const next = withInclude(existing, paths);
  if (next !== existing) writeAtomic(paths.userConfig, next, 0o600);
}

export function writeHostKey(paths, hostKey) {
  const text = knownHostsText(hostKey);
  if (!text) return false;
  writeAtomic(paths.knownHosts, text, 0o600);
  return true;
}

// The connect reply names a host and port; ssh's own HostName is only a label.
export function parseConnectReply(payload) {
  const host = typeof payload?.host === 'string' ? payload.host.trim() : '';
  const port = Number(payload?.port);
  if (payload?.status !== 'ready' || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return { host, port, user: payload.user || SSH_USER, hostKey: payload.host_key || '' };
}
