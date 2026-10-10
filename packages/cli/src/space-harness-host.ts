import React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as JSXRuntime from 'react/jsx-runtime';
import { importBundleSource, resolveBundleRouteExport } from '../../sdk/src/bundleModule';
import { SdkPresentation } from '../../sdk/src/presentation';
import { createPrefetchQueue, createQueryClient } from '../../sdk/src/queryCache';
import type { NotisRuntime } from '../../sdk/src/runtime';
import { SPACE_VIEWER_READ_OPERATIONS } from '../../sdk/src/space';
import type { SpaceActionOptions, SpaceDocumentBodyRequest, SpaceViewerReadOperation } from '../../sdk/src/space';

type Call = { op: string; actionId?: string; ok: boolean | null; error?: string };
const state = { mounted: false, renderStarted: false, errors: [] as Array<{ phase: string; message: string }>, runtimeCalls: [] as Call[] };
Object.assign(window, { __harness: state, React, ReactDOM, ReactDOMClient, __ReactJSXRuntime: JSXRuntime });
const diagnostic = (phase: string, reason: unknown) => state.errors.push({ phase,
  message: reason instanceof Error ? reason.message : String(reason || 'Verification failed.') });
window.addEventListener('error', event => diagnostic('window_error', event.error || event.message));
window.addEventListener('unhandledrejection', event => diagnostic('unhandled_rejection', event.reason));
window.addEventListener('securitypolicyviolation', event => diagnostic('security_policy', `Blocked ${event.violatedDirective}`));

async function start() {
  const response = await fetch('/snapshot', { credentials: 'omit' });
  if (!response.ok) throw new Error('The frozen verification snapshot could not be loaded.');
  const snapshot = await response.json();
  const authority = structuredClone(snapshot.descriptor.space);
  const runFixture = async (call: Call, input: unknown) => {
    state.runtimeCalls.push(call);
    try {
      const result = await fetch('/fixture', { method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(5_000) });
      const payload = await result.json();
      if (!result.ok) throw new Error(payload.message || 'No matching synthetic fixture.');
      call.ok = true; return payload.result;
    } catch (error) {
      call.ok = false; call.error = error instanceof Error ? error.message : 'Verification request failed.';
      throw error;
    }
  };
  const protocolFailure = (message: string): Promise<never> => { diagnostic('protocol', message); return Promise.reject(new Error(message)); };
  const deny = () => protocolFailure('Use a declared Space action.');
  const queue = createPrefetchQueue(2);
  const runtime: NotisRuntime = {
    ...snapshot.descriptor, databases: [],
    context: { ...snapshot.descriptor.context,
      resourceId: snapshot.descriptor.context?.resource_id ?? snapshot.descriptor.context?.resourceId ?? null,
      collectionItem: snapshot.descriptor.context?.collection_item ?? snapshot.descriptor.context?.collectionItem ?? null },
    queryClient: createQueryClient({ maxEntries: 100, schedule: queue }),
    listTools: deny, callTool: deny, request: deny,
    callAction<T>(id: string, inputs: Record<string, unknown> = {}, options: SpaceActionOptions = {}): Promise<T> {
      if (!Object.hasOwn(authority.actions, id)) return protocolFailure('Undeclared verification action.');
      if ((options.readOnly || options.dedupe) && authority.actions[id].readOnly !== true) {
        return protocolFailure('A write action cannot run as a cached read.');
      }
      return runFixture({ op: 'callAction', actionId: id, ok: null }, { action_id: id, inputs });
    },
    viewerRead: authority.viewerReads?.length ? <T,>(operation: SpaceViewerReadOperation, input: Record<string, unknown> = {}): Promise<T> => {
      const family = Object.hasOwn(SPACE_VIEWER_READ_OPERATIONS, operation) ? SPACE_VIEWER_READ_OPERATIONS[operation] : null;
      if (!family || !authority.viewerReads.includes(family)) return protocolFailure('Undeclared verification viewer read.');
      return runFixture({ op: 'viewerRead', actionId: operation, ok: null }, { viewer_read: { operation, input } });
    } : undefined,
    shown: Object.values(authority.shows || {}).some(list => 'database' in list) ? <T,>(name: string, params: Record<string, unknown> = {}): Promise<T> => {
      const list = authority.shows && Object.hasOwn(authority.shows, name) ? authority.shows[name] : null;
      if (!list || !('database' in list)) return protocolFailure('Undeclared verification list.');
      return runFixture({ op: 'shown', actionId: name, ok: null }, { shown: { name, params } });
    } : undefined,
    documentBody(request: SpaceDocumentBodyRequest) {
      return runFixture({ op: 'documentBody', actionId: request?.readAction, ok: null }, { document_body: request });
    },
    navigate(payload) {
      if (payload.kind !== 'space-reference' || typeof payload.alias !== 'string' || !authority.navigation?.includes(payload.alias)) {
        return protocolFailure('Offline navigation requires a declared synthetic destination.');
      }
      // This observes a declaration only; no live navigation or access is claimed.
      state.runtimeCalls.push({ op: 'navigate', actionId: payload.alias, ok: true });
    },
    publishActiveResource() {}, captureContextSelection() {},
    addContext: async () => false, updateContext: async () => false, removeContext: async () => false,
    registerTopBarSearch() {}, setTopBarSearchValue() {}, setTopBarSearchLoading() {},
  };
  const module = await importBundleSource(snapshot.source);
  const view = resolveBundleRouteExport(module, ['SpaceView'], true);
  if (!view) throw new Error('The SpaceView export is missing from this presentation.');
  const host = document.createElement('div'); host.style.cssText = 'min-height:100vh;height:100vh';
  const shadow = host.attachShadow({ mode: 'open' });
  const css = document.createElement('style'); css.textContent = snapshot.css; shadow.appendChild(css);
  const mount = document.createElement('div'); mount.setAttribute('data-notis-app-mount', 'true');
  mount.style.cssText = 'min-height:0;height:100%'; shadow.appendChild(mount);
  document.body.appendChild(host);
  const controller = document.createElement('div'); document.body.appendChild(controller);
  const mode = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
  document.documentElement.classList.toggle('dark', mode === 'dark');
  state.renderStarted = true;
  ReactDOMClient.createRoot(controller).render(React.createElement(SdkPresentation, {
    mount, runtime, component: view.component, shell: module.__AppShell, theme: { mode, style: { colorScheme: mode } },
    resetKey: snapshot.cacheKey,
    onCommit: (hasContent: boolean) => { state.mounted = hasContent; },
    onError: (error: Error) => { state.mounted = false; state.errors.push({ phase: 'render', message: error.message }); },
    onProtocolError: (error: Error) => diagnostic('protocol', error),
    fallback: (error: Error) => React.createElement('div', { role: 'alert' }, error.message),
  }));
}

void start().catch(reason => state.errors.push({ phase: 'boot', message: reason instanceof Error ? reason.message : 'Verification did not start.' }));
