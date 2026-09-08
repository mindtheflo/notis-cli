/** Serializable context shared with the agent. Apps own annotation storage. */
export interface ContextAttachment {
  /** Durable HTTPS URL supplied by the app. Sent through the host media pipeline. */
  url: string;
  name: string;
  mimeType: string;
}

export interface AgentContextContent {
  title?: string;
  /** Emoji, Phosphor icon name, or HTTPS image URL. Never executable markup. */
  icon?: string;
  /** An app-defined kind, not a closed list of annotation types. */
  kind?: string;
  text?: string;
  comment?: string;
  preview?: { format: 'text' | 'markdown'; content: string };
  /** Any JSON-serializable value: coordinates, chart state, loaded records, etc. */
  data?: unknown;
  attachments?: ContextAttachment[];
}

export interface AgentContextItem extends AgentContextContent {
  /** Stable within this app. The host scopes IDs to the originating app. */
  id: string;
  resource?: import('./runtime').ContextResource | null;
}

/** Host-stamped origin. Apps describe resources; the host identifies the app/view. */
export interface AgentContextSource {
  appId: string;
  appName: string;
  viewSlug: string;
  viewName: string;
  viewUrl?: string | null;
}
