export interface ComputerIdentity {
  /** Stable UUID v4 for this computer, shared by every account on it. */
  computerId: string;
  /** The name the user chose, or null to use the computer's own name. */
  name: string | null;
  /** The computer's own name (macOS Computer Name, else the host name). */
  defaultName: string;
  /** `name ?? defaultName`, what the server and the user see. */
  displayName: string;
}

export interface ComputerIdentityOptions {
  /** The CLI config file computer.json sits next to. Defaults to NOTIS_CLI_CONFIG_FILE or ~/.notis/config.json. */
  configFile?: string;
  platform?: NodeJS.Platform;
  hostname?: () => string;
  readMacComputerName?: () => string | null;
}

export const COMPUTER_IDENTITY_VERSION: number;
export const COMPUTER_NAME_MAX_LENGTH: number;

export function computerIdentityFile(configFile?: string): string;
export function normalizeComputerName(value: unknown): string | null;
export function defaultComputerName(options?: ComputerIdentityOptions): string;
export function readComputerIdentity(options?: ComputerIdentityOptions): ComputerIdentity;
export function setComputerName(
  name: string | null,
  options?: ComputerIdentityOptions,
): ComputerIdentity;
