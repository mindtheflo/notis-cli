import assert from 'node:assert/strict';
import test from 'node:test';
import { rewriteBundleImports, rewriteSdkImports } from './bundleModule';
import { NOTIS_SDK_BUNDLED_MODULES, NOTIS_SDK_HOST_MODULES } from './runtimeModules';

const sdk = { useNotis: () => 'notis', COLLECTION: 'collection' };
const ui = { Panels: () => null, useList: () => 'list' };
const globals = { __NotisSDK: sdk, __NotisSDKUI: ui };

/** The JavaScript of each data-URL module a rewritten bundle imports. */
function shims(source: string): string[] {
  return [...source.matchAll(/data:text\/javascript,([^"']+)/g)].map((match) => decodeURIComponent(match[1]));
}

/** Evaluates one shim against `globals`, returning what it exports. */
async function evaluateShim(code: string, hostGlobals: Record<string, unknown>) {
  const scope = globalThis as Record<string, unknown>;
  const saved = Object.fromEntries(Object.keys(hostGlobals).map((key) => [key, scope[key]]));
  Object.assign(scope, hostGlobals);
  try {
    return await import(`data:text/javascript,${encodeURIComponent(code)}`) as Record<string, unknown>;
  } finally { Object.assign(scope, saved); }
}

test('every host SDK subpath points at its own global', async () => {
  assert.deepEqual(Object.keys(NOTIS_SDK_HOST_MODULES).sort(), ['@notis/sdk', '@notis/sdk/ui']);
  const source = [
    'import { useNotis } from "@notis/sdk";',
    "import { Panels as P, useList } from '@notis/sdk/ui';",
    'export { useNotis, P, useList };',
  ].join('\n');
  const rewritten = rewriteSdkImports(source, globals);
  assert.doesNotMatch(rewritten, /["']@notis\/sdk/);
  const [sdkShim, uiShim] = shims(rewritten);
  assert.match(sdkShim, /globalThis\["__NotisSDK"\]/);
  assert.match(uiShim, /globalThis\["__NotisSDKUI"\]/);
  const sdkExports = await evaluateShim(sdkShim, globals);
  assert.equal(sdkExports.useNotis, sdk.useNotis);
  assert.equal(sdkExports.COLLECTION, 'collection');
  const uiExports = await evaluateShim(uiShim, globals);
  assert.equal(uiExports.Panels, ui.Panels);
  assert.equal(uiExports.useList, ui.useList);
});

test('namespace, re-export, side-effect and dynamic imports all reach the host', () => {
  const source = [
    'import * as ui from "@notis/sdk/ui";',
    'export * from "@notis/sdk";',
    'export { useList } from "@notis/sdk/ui";',
    'import "@notis/sdk";',
    'const later = () => import("@notis/sdk/ui");',
  ].join('\n');
  const rewritten = rewriteSdkImports(source, globals);
  assert.doesNotMatch(rewritten, /["']@notis\/sdk/);
  assert.equal(shims(rewritten).length, 5);
  // One shim per subpath, reused by every reference.
  assert.equal(new Set(shims(rewritten)).size, 2);
});

test('a bundle that needs a newer SDK is refused before it loads', () => {
  assert.throws(() => rewriteSdkImports('import { useFuture } from "@notis/sdk";', globals),
    (error: Error & { code?: string; missing?: string[] }) => error.code === 'client_update_required'
      && error.missing?.[0] === '@notis/sdk:useFuture');
  assert.throws(() => rewriteSdkImports('import Default from "@notis/sdk/ui";', globals),
    (error: Error & { code?: string; missing?: string[] }) => error.code === 'client_update_required'
      && error.missing?.[0] === '@notis/sdk/ui:default');
});

test('an SDK module the host does not provide is refused, including the bundled-only ones', () => {
  for (const specifier of ['@notis/sdk/interactions', '@notis/sdk/styles.css', ...NOTIS_SDK_BUNDLED_MODULES]) {
    assert.throws(() => rewriteSdkImports(`import { x } from "${specifier}";`, globals),
      (error: Error & { code?: string; missing?: string[] }) => error.code === 'client_update_required'
        && error.missing?.[0] === specifier, specifier);
  }
});

test('a host without the SDK globals says so', () => {
  assert.throws(() => rewriteSdkImports('import { useNotis } from "@notis/sdk";', {}),
    (error: Error & { code?: string }) => error.code === 'notis_sdk_host_unavailable');
  assert.throws(() => rewriteSdkImports('import { Panels } from "@notis/sdk/ui";', { __NotisSDK: sdk }),
    (error: Error & { code?: string }) => error.code === 'notis_sdk_host_unavailable');
});

test('a bundle without SDK imports is left as it is', () => {
  const source = 'export const label = "notis";';
  assert.equal(rewriteSdkImports(source, {}), source);
});

test('React and the SDK are rewritten together', () => {
  const source = [
    'import { jsx } from "react/jsx-runtime";',
    'import { useState } from "react";',
    'import { createPortal } from "react-dom";',
    'import { useNotis } from "@notis/sdk";',
    'export { jsx, useState, createPortal, useNotis };',
  ].join('\n');
  const rewritten = rewriteBundleImports(source, globals);
  assert.doesNotMatch(rewritten, /from\s*["'](?:react|react-dom|react\/jsx-runtime|@notis\/sdk)["']/);
  const code = shims(rewritten).join('\n');
  for (const name of ['window.__ReactJSXRuntime', 'window.React', 'window.ReactDOM', 'globalThis["__NotisSDK"]']) {
    assert.ok(code.includes(name), name);
  }
});
