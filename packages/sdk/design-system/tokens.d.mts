export interface ScannedProperty {
  stack: string[];
  name: string;
  value: string;
  line: number;
}

export interface PortalToken {
  chain: string;
  name: string;
  value: string;
  file: string | null;
  line: number;
}

export interface ToolkitToken extends PortalToken {
  file: string;
}

export declare const PORTAL_TOKEN_FILES: readonly string[];

export declare function scanCustomProperties(text: string): ScannedProperty[];
export declare function portalTokens(text: string, file?: string | null): { text: string; tokens: PortalToken[] };
export declare function toolkitTokens(text: string, file: string): ToolkitToken[];
