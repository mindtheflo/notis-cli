/**
 * Configuration utilities for notis.config.ts.
 *
 * Usage:
 * ```ts
 * // notis.config.ts
 * import { defineNotisApp } from '@notis/sdk/config';
 *
 * export default defineNotisApp({
 *   name: 'My App',
 *   description: 'Does things',
 *   icon: 'phosphor:squares-four',
 *   databases: ['tasks'],
 *   routes: [
 *     {
 *       path: '/',
 *       slug: 'notes',
 *       name: 'Notes',
 *       default: true,
 *       collection: {
 *         database: 'notes',
 *         titleProperty: 'Name',
 *         parentProperty: 'Parent',
 *         sidebar: {
 *           mode: 'tree',
 *           allowCreate: true,
 *         },
 *       },
 *     },
 *   ],
 *   tools: [...],
 * });
 * ```
 */

export interface NotisRouteConfig {
  path: string;
  slug: string;
  name: string;
  icon?: string;
  parentSlug?: string | null;
  default?: boolean;
  exportName?: string;
  collection?: {
    database: string;
    titleProperty: string;
    parentProperty?: string | null;
    sidebar?: {
      mode: 'flat-list' | 'tree';
      allowCreate: boolean;
    };
  };
}

export const NOTIS_APP_CATEGORIES = [
  'Productivity',
  'Sales & Marketing',
  'Operations',
  'Product & Engineering',
  'Personal',
] as const;

export type NotisAppCategory = typeof NOTIS_APP_CATEGORIES[number];

export interface NotisAppDatabaseConfig {
  /** Database slug, as declared by the app. */
  slug: string;
  /**
   * Ship this database's rows to everyone who installs the app.
   *
   * Off by default: declaring a database publishes its STRUCTURE, never its
   * content. Turn it on only for starter content that every installer should
   * receive - a default folder tree, a set of templates - and never for a
   * database that accumulates the author's own data.
   */
  seedDocuments?: boolean;
}

export interface NotisAppAuthor {
  name: string;
  handle?: string;
  url?: string;
}

export interface NotisAppSkillConfig {
  /** Stable source-owned key used by other app declarations. */
  key: string;
  /**
   * Path to the skill, relative to notis.config.ts. Either a Markdown file
   * (`./skills/onboarding.md`) or a directory holding SKILL.md plus its
   * supporting files (`./skills/onboarding/`), which are packaged on deploy
   * and materialized next to SKILL.md in the sandbox.
   */
  path: string;
  /** User-facing name used for the installed skill. */
  name: string;
  description?: string;
}

export interface NotisAppOnboardingConfig {
  /** Key of a skill declared in `skills`. */
  skill: string;
  /** Editable message placed in Notis when onboarding is opened. */
  prompt: string;
}

export interface NotisAppScreenshotConfig {
  /** Conventional metadata/screenshot-N.png source path. */
  path: string;
  /** Meaningful description used by the Store gallery and assistive technology. */
  alt: string;
  /** Route slug captured by `notis apps screenshot`. */
  route?: string;
  /**
   * Named scenario from metadata/screenshot-fixtures.json. Its `tools` and
   * `requests` override the file-level ones key by key for this capture, and
   * its `actions` run once the route has mounted -- so one route can be shown
   * in several states (populated, empty, a panel opened) without the states
   * leaking into each other.
   */
  scenario?: string;
  /** Optional CSS selector captured as the truthful focal region for this Store image. */
  focus?: string;
  /** Portal color scheme used while rendering this screenshot. Defaults to light. */
  theme?: 'light' | 'dark';
}

/**
 * Named accent tokens for an app's avatar. Keep in sync with the portal
 * `ACCENT_NAMES` and the server `ACCENT_TOKENS`.
 */
export const NOTIS_APP_ACCENTS = [
  'blue',
  'violet',
  'emerald',
  'amber',
  'rose',
  'sky',
  'fuchsia',
  'teal',
] as const;

export type NotisAppAccent = typeof NOTIS_APP_ACCENTS[number];

export interface NotisAppCapabilities {
  /**
   * Read every database in the workspace, not only the ones this app declares
   * in `databases` or created itself.
   *
   * An app runtime is otherwise sandboxed to its own databases, so a catalog or
   * explorer app sees an empty list without this. `'read'` is the only accepted
   * value and it never grants writes: `LOCAL_NOTIS_DATABASE_UPSERT_*` stays
   * bound to the app's own databases.
   */
  workspaceDatabases?: 'read';

  /**
   * Read a few facts about the user's cloud computer: whether a sandbox exists
   * and is running, and whether the GitHub CLI is signed in there.
   *
   * Without this an app has to infer them — the Workspaces app treated a
   * configured repository as proof that `gh auth login` had happened, which
   * cannot show an account name and cannot notice a revoked credential.
   * `'read'` never creates, resumes or commands a sandbox. Read it with
   * `useCloudComputer()`.
   *
   * `'shell'` additionally asks to command the cloud computer: it unlocks
   * `LOCAL_NOTIS_RUN_SANDBOX_SHELL` and the sandbox file tools from this app's
   * views (they are denied to every view otherwise), and implies the read
   * facts. This is the same authority the user's own agent has on the sandbox,
   * so the user is asked for it explicitly at install or in the Store grant
   * step; declare it only when the app's core actions genuinely run there.
   */
  cloudComputer?: 'read' | 'shell';
}

/**
 * Execution hint for a tool whose public name is generated by a provider.
 *
 * MCP public names may be truncated or deduplicated, so the upstream action
 * cannot always be reconstructed from the final `LOCAL_MCP_*` name. Binding
 * the two lets the host skip provider schema discovery on direct calls while
 * the public name remains the user-approved permission boundary.
 */
export interface NotisAppToolBinding {
  /** Exact final name also present in `tools`. */
  name: string;
  /** Exact upstream MCP action name, for example `execute_sql`. */
  providerToolName: string;
}

export interface NotisAppConfig {
  /** URL-safe app slug. Existing apps may still use a display name here. */
  name: string;
  /** Stable local-development slug. Defaults to a slug derived from `name`. */
  devSlug?: string;
  /** Human display title, Raycast-style. Falls back to `name`. */
  title?: string;
  description?: string;
  /**
   * App icon. A `phosphor:<name>` value (e.g. `phosphor:dice-five`) or
   * `metadata/icon.png`. When unset, the app shows its two-letter initials.
   */
  icon?: string;
  /**
   * Optional accent color for the app avatar. One of {@link NOTIS_APP_ACCENTS}.
   * When unset, a stable accent is derived automatically from the app id.
   */
  accent?: NotisAppAccent;
  author?: NotisAppAuthor;
  categories?: NotisAppCategory[];
  tagline?: string;
  /** @deprecated Add release entries to the root CHANGELOG.md instead. */
  versionNotes?: string;
  /** Editorial screenshot order and capture scenarios for the Store listing. */
  screenshots?: NotisAppScreenshotConfig[];
  /**
   * Databases this app owns. A bare string publishes structure only; use the
   * object form to opt a database into shipping its rows to installers.
   */
  databases?: (string | NotisAppDatabaseConfig)[];
  /**
   * Extra permissions the app asks for at install time. Everything here widens
   * what the app can reach beyond its own data, so each one is surfaced to the
   * user before they install.
   */
  capabilities?: NotisAppCapabilities;
  routes?: NotisRouteConfig[];
  /**
   * Final tool names this app can call at runtime, enforced server-side. Use
   * names returned by shared discovery, including native `LOCAL_NOTIS_*`,
   * connected-service names such as `GMAIL_SEND_EMAIL`,
   * `LOCAL_POSTFORME_*`, and `LOCAL_MCP_<SERVER>_<TOOL>`. App code calls
   * each declared name directly with `useTool`; metered calls use the shared
   * credit-cap and usage-billing path.
   */
  tools?: string[];
  /** Optional execution bindings for provider-generated tool names. */
  toolBindings?: NotisAppToolBinding[];
  /** Skills shipped from this app's source tree. */
  skills?: NotisAppSkillConfig[];
  /** Optional onboarding entrypoint exposed from the app sidebar. */
  onboarding?: NotisAppOnboardingConfig;
}

/**
 * Identity function that provides type checking and autocomplete for the
 * Notis app configuration. The returned object is read at build time by
 * `notis apps build` to generate the manifest.
 */
export function defineNotisApp(config: NotisAppConfig): NotisAppConfig {
  return config;
}
