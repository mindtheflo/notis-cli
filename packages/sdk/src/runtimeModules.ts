/**
 * The runtime contract between a Space bundle and its host (Spaces protocol 2).
 *
 * A Space bundle never contains SDK code. Its build externalizes these
 * specifiers and the host (Portal, Site, CLI verify, view renderer) provides
 * them as window globals, set from the module objects the host itself imports,
 * so every Space on a page shares one SDK instance with the host.
 *
 * React is provided the same way (`window.React`, `window.ReactDOM`,
 * `window.ReactDOMClient`, `window.__ReactJSXRuntime`).
 *
 * Pure data: the Vite config and the bundle loader both read it.
 */
export const NOTIS_SDK_HOST_MODULES = Object.freeze({
  '@notis/sdk': '__NotisSDK',
  '@notis/sdk/ui': '__NotisSDKUI',
} as const);

export type NotisSdkHostModule = keyof typeof NOTIS_SDK_HOST_MODULES;
export type NotisSdkHostGlobal = (typeof NOTIS_SDK_HOST_MODULES)[NotisSdkHostModule];

export const REACT_HOST_MODULES = Object.freeze([
  'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime',
] as const);

/**
 * The only other `@notis/sdk` entries a Space may import. They are pure or
 * build-time only, so the Space build inlines them (or runs them in Node); a
 * built bundle never imports them at runtime.
 */
export const NOTIS_SDK_BUNDLED_MODULES = Object.freeze([
  '@notis/sdk/words', '@notis/sdk/config', '@notis/sdk/vite',
] as const);
