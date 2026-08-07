/**
 * CLI mode detection for `notis apps dev`.
 *
 * The published npm CLI and the repo-local checkout both default to the live
 * Notis API (`api.notis.ai` / `api-beta.notis.ai`). Localhost is not a CLI
 * default — the `/notis-tests` worktree lease (`./dev.sh`) is the only
 * supported loopback override for Notis developers.
 *
 * Mode is baked into `cli-mode.generated.js` at publish time. The
 * `NOTIS_CLI_MODE` env var is honored for internal labeling only (e.g. the
 * `apps` auto-dev loop inside `./dev.sh`).
 */

import { MODE as BAKED_MODE } from './cli-mode.generated.js';

export function getCliMode() {
  const override = process.env.NOTIS_CLI_MODE;
  if (override === 'local' || override === 'published') {
    return override;
  }
  return BAKED_MODE === 'published' ? 'published' : 'local';
}

export function getDefaultApiBase(mode = getCliMode(), { beta = false } = {}) {
  // Mode no longer switches the default API to localhost. Local loopback is
  // reserved for the worktree test lease; `mode` only affects portal origin
  // labeling for the in-repo apps-dev helper.
  void mode;
  return beta ? 'https://api-beta.notis.ai' : 'https://api.notis.ai';
}

export function getDefaultPortalOrigin(mode = getCliMode()) {
  return mode === 'local' ? 'http://localhost:3000' : 'https://app.notis.ai';
}
