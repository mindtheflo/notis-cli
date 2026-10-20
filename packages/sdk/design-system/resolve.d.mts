export declare function sourceAliases(sdkDir?: string): Map<string, string>;
export declare function registerSourceAliases(sdkDir?: string): void;
export declare function sourceAliasPlugin(sdkDir?: string): {
  name: string;
  setup(build: { onResolve(options: { filter: RegExp }, callback: (args: { path: string; resolveDir: string }) => { path: string } | undefined): void }): void;
};
