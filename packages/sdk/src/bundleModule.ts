/** Framework-neutral ESM loading shared by Portal and credentialless verification. */
import type React from 'react';

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
  return importRewrittenBundleSource(rewriteReactImports(source));
}
