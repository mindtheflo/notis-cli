/** Framework-neutral ESM loading shared by Portal and credentialless verification. */
import type React from 'react';
import { NOTIS_SDK_HOST_MODULES } from './runtimeModules';

const SDK_SPECIFIER = String.raw`@notis\/sdk(?:\/[^"'\s]*)?`;
// `from "x"`, `import("x")` and the side-effect `import "x"`.
const SDK_REFERENCE = new RegExp(String.raw`(\bfrom\s*|\bimport\s*\(\s*|\bimport(?![\w$])\s*)(["'])(${SDK_SPECIFIER})\2`, 'g');
// The clause of a static `import ... from "x"` or `export ... from "x"`; quotes never appear in it.
const SDK_CLAUSE = new RegExp(String.raw`\b(?:import|export)(?![\w$])\s*([^;"'\x60()]*?)\s*from\s*(["'])(${SDK_SPECIFIER})\2`, 'g');
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

type HostGlobals = Record<string, unknown>;

function sdkError(code: string, message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

/** The names a static import or re-export clause takes from its module ('default' for a default import). */
function importedNames(clause: string): string[] {
  const names: string[] = [];
  let rest = clause.trim();
  const braces = rest.match(/\{([^}]*)\}/);
  if (braces) {
    for (const part of braces[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0]?.trim();
      if (name) names.push(name);
    }
    rest = rest.replace(braces[0], '');
  }
  for (const part of rest.split(',')) {
    const name = part.trim();
    // `* as N` and `export *` take the whole namespace; nothing to check by name.
    if (name && !name.startsWith('*')) names.push('default');
  }
  return names;
}

function hostNamespace(specifier: string, globals: HostGlobals): Record<string, unknown> {
  if (!Object.hasOwn(NOTIS_SDK_HOST_MODULES, specifier)) {
    throw sdkError('client_update_required', `This Space needs ${specifier}, which this version of Notis does not provide.`,
      { missing: [specifier] });
  }
  const globalName = NOTIS_SDK_HOST_MODULES[specifier as keyof typeof NOTIS_SDK_HOST_MODULES];
  const namespace = globals[globalName];
  if (!namespace || typeof namespace !== 'object') {
    throw sdkError('notis_sdk_host_unavailable', `The host did not provide ${specifier} (window.${globalName}).`);
  }
  return namespace as Record<string, unknown>;
}

/** A module that re-exports every member of one host-provided SDK namespace, read when it evaluates. */
function sdkShim(globalName: string, namespace: Record<string, unknown>): string {
  const names = Object.keys(namespace);
  const body = [`const M = globalThis[${JSON.stringify(globalName)}];`];
  const exported: string[] = [];
  names.forEach((name, index) => {
    body.push(`const e${index} = M[${JSON.stringify(name)}];`);
    exported.push(`e${index} as ${IDENTIFIER.test(name) ? name : JSON.stringify(name)}`);
  });
  if (exported.length) body.push(`export { ${exported.join(', ')} };`);
  return `data:text/javascript,${encodeURIComponent(body.join(' '))}`;
}

/**
 * Points every `@notis/sdk` import of a Space bundle at the host's own SDK
 * (`window.__NotisSDK`, `window.__NotisSDKUI`). A bundle that needs a module or
 * a name this host does not have is refused with `client_update_required`
 * before it loads, instead of failing to link.
 */
export function rewriteSdkImports(source: string, globals: HostGlobals = globalThis as unknown as HostGlobals): string {
  if (!source.includes('@notis/sdk')) return source;
  const missing = new Set<string>();
  for (const [, clause, , specifier] of source.matchAll(SDK_CLAUSE)) {
    const namespace = hostNamespace(specifier, globals);
    for (const name of importedNames(clause)) {
      if (!Object.hasOwn(namespace, name)) missing.add(`${specifier}:${name}`);
    }
  }
  if (missing.size) {
    throw sdkError('client_update_required', `This Space needs a newer version of Notis (missing ${[...missing].join(', ')}).`,
      { missing: [...missing] });
  }
  const shims = new Map<string, string>();
  return source.replace(SDK_REFERENCE, (_match, lead: string, quote: string, specifier: string) => {
    let shim = shims.get(specifier);
    if (!shim) {
      const namespace = hostNamespace(specifier, globals);
      shim = sdkShim(NOTIS_SDK_HOST_MODULES[specifier as keyof typeof NOTIS_SDK_HOST_MODULES], namespace);
      shims.set(specifier, shim);
    }
    return `${lead}${quote}${shim}${quote}`;
  });
}

/** Every host-provided import of a bundle (React and the SDK) pointed at the host's globals. */
export function rewriteBundleImports(source: string, globals?: HostGlobals): string {
  return rewriteSdkImports(rewriteReactImports(source), globals);
}

export function rewriteReactImports(source: string): string {
  // Create inline data URLs that re-export from window globals.
  // This avoids the "Cannot find module" error with blob URL imports.
  const reactShim = `data:text/javascript,${encodeURIComponent(
    'const R = window.React; export default R; export const { createContext, createRef, useState, useEffect, useContext, useCallback, useMemo, useRef, useReducer, useLayoutEffect, useId, memo, forwardRef, createElement, Fragment, Children, cloneElement, isValidElement, lazy, Suspense, startTransition, useTransition, useDeferredValue, useSyncExternalStore, useInsertionEffect, useDebugValue, useImperativeHandle, Component, PureComponent } = R;'
  )}`;
  const jsxShim = `data:text/javascript,${encodeURIComponent(
    'const J = window.__ReactJSXRuntime || {}; const R = window.React; export const jsx = J.jsx || R.createElement; export const jsxs = J.jsxs || R.createElement; export const jsxDEV = J.jsxDEV || R.createElement; export const Fragment = J.Fragment || R.Fragment;'
  )}`;
  const reactDomShim = `data:text/javascript,${encodeURIComponent(
    'const RD = window.ReactDOM; export default RD; export const { createPortal, flushSync, unstable_batchedUpdates } = RD;'
  )}`;
  const reactDomClientShim = `data:text/javascript,${encodeURIComponent(
    'const RDC = window.ReactDOMClient; export default RDC; export const { createRoot, hydrateRoot } = RDC;'
  )}`;

  let result = source;
  // Replace bare side-effect imports
  result = result.replace(/import\s*["']react-dom\/client["'];?/g, `import "${reactDomClientShim}";`);
  result = result.replace(/import\s*["']react-dom["'];?/g, `import "${reactDomShim}";`);
  result = result.replace(/import\s*["']react\/jsx-runtime["'];?/g, `import "${jsxShim}";`);
  result = result.replace(/import\s*["']react\/jsx-dev-runtime["'];?/g, `import "${jsxShim}";`);
  result = result.replace(/import\s*["']react["'];?/g, `import "${reactShim}";`);

  // Replace import statements with data URL shims
  // Handle: import { ... } from "react/jsx-runtime"
  result = result.replace(/from\s*["']react\/jsx-runtime["']/g, `from "${jsxShim}"`);
  result = result.replace(/from\s*["']react\/jsx-dev-runtime["']/g, `from "${jsxShim}"`);
  // Handle react-dom/client before react-dom
  result = result.replace(/from\s*["']react-dom\/client["']/g, `from "${reactDomClientShim}"`);
  // Handle: import ... from "react-dom"
  result = result.replace(/from\s*["']react-dom["']/g, `from "${reactDomShim}"`);
  // Handle: import ... from "react" (must come after react-dom and react/jsx-runtime)
  result = result.replace(/from\s*["']react["']/g, `from "${reactShim}"`);

  return result;
}

export function resolveBundleRouteExport(
  moduleExports: Record<string, React.ComponentType>,
  exportCandidates: string[],
  strict = false,
): { name: string; component: React.ComponentType } | null {
  const namedExport = exportCandidates.find((name) => Boolean(moduleExports[name]));
  if (namedExport) {
    return { name: namedExport, component: moduleExports[namedExport] };
  }
  if (strict) return null;
  if (moduleExports.default) {
    return { name: 'default', component: moduleExports.default };
  }

  // Vite may minify an entry export even though the manifest still carries
  // its source name. A bundle with one non-shell component is unambiguous, so
  // keep Dev usable instead of showing "View not available" for that route.
  const componentExports = Object.entries(moduleExports).filter(
    ([name, value]) => name !== '__AppShell' && Boolean(value),
  );
  if (componentExports.length !== 1) {
    return null;
  }
  const [name, component] = componentExports[0];
  return { name, component };
}

export async function importRewrittenBundleSource(source: string): Promise<Record<string, React.ComponentType>> {
  const blob = new Blob([source], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    return await import(/* webpackIgnore: true */ url) as Record<string, React.ComponentType>;
  } finally { URL.revokeObjectURL(url); }
}

export function importBundleSource(source: string) {
  return importRewrittenBundleSource(rewriteBundleImports(source));
}
