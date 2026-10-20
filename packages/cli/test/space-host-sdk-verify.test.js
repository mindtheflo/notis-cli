import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifySpaceRelease } from '../src/runtime/space-verification.js';
import { assertSpaceBundleUsesHostSdk } from '../src/runtime/space-platform.js';
import * as renderer from '../../view-renderer/src/index.js';

const b = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64');
const loadRenderer = async () => ({ ...renderer, rendererDigest: createHash('sha256').update('host-sdk-verify-test').digest('hex') });

// What a built Space bundle looks like under protocol 2: React and the SDK stay
// bare imports the host provides; no SDK code is inside. The view fails the
// render unless it got the host's own SDK instance and its shadow root holds
// the host-adopted toolkit stylesheet.
const SAMPLE_SPACE_BUNDLE = `
import { jsx } from "react/jsx-runtime";
import { useLayoutEffect, useRef } from "react";
import { useNotis } from "@notis/sdk";
import * as ui from "@notis/sdk/ui";
function toolkitAdopted(root) {
  const sheets = [...(root.adoptedStyleSheets || [])];
  if (sheets.some(sheet => [...sheet.cssRules].some(rule => rule.cssText.includes("nui-toolkit-sheet-marker")))) return true;
  return [...root.querySelectorAll("style[data-notis-toolkit-styles]")].some(style => style.textContent.includes("nui-toolkit-sheet-marker"));
}
export function SpaceView() {
  const ref = useRef(null);
  if (useNotis !== window.__NotisSDK.useNotis) throw new Error("The Space got its own @notis/sdk instance.");
  if (ui.Panels !== window.__NotisSDKUI.Panels) throw new Error("The Space got its own @notis/sdk/ui instance.");
  useLayoutEffect(() => {
    if (!toolkitAdopted(ref.current.getRootNode())) throw new Error("The toolkit stylesheet is not adopted in the Space shadow root.");
  }, []);
  return jsx("h1", { ref, className: "nui-root", children: "Host SDK sample" });
}
`;

test('the sample Space bundle carries no SDK code', () => {
  assertSpaceBundleUsesHostSdk(SAMPLE_SPACE_BUNDLE);
});

test('a sample Space that imports the host SDK renders in verify with the toolkit sheet adopted', async () => {
  const release = {
    manifest: { local_key: 'host-sdk-sample', name: 'Host SDK sample', kind: 'presentation', actions: {}, resources: {},
      params: {}, shows: {}, bundle: { js: 'bundle/app.js' } },
    files: { 'bundle/app.js': b(SAMPLE_SPACE_BUNDLE) }, sourceFiles: {}, capabilities: { actions: {}, bindings: {} },
  };
  const result = await verifySpaceRelease(release, { capabilities: release.capabilities, loadRenderer });
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.equal(result.render_count, 2);
});

test('a Space that imports an SDK module the host does not provide fails verify', async () => {
  const source = 'import { useFuture } from "@notis/sdk"; export function SpaceView() { return useFuture(); }';
  const release = {
    manifest: { local_key: 'host-sdk-future', name: 'Future', kind: 'presentation', actions: {}, resources: {},
      params: {}, shows: {}, bundle: { js: 'bundle/app.js' } },
    files: { 'bundle/app.js': b(source) }, sourceFiles: {}, capabilities: { actions: {}, bindings: {} },
  };
  const result = await verifySpaceRelease(release, { capabilities: release.capabilities, loadRenderer });
  assert.notEqual(result.status, 'passed', JSON.stringify(result));
});
