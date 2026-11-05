/**
 * CloudComputerFrame: a Space service shown in a frame, on the viewer's own Cloud Computer. It keeps the service
 * running while it is on screen (through `CloudComputerWaking` until the service is ready), then signs the frame in to
 * the machine's gate with a one-time code: no pass ever sits in the frame's address, and the session is the frame's own
 * (an HttpOnly cookie on the gate). The service is served from the gate root, so an app built for its own origin
 * (absolute paths, a dev server's reload socket) runs unchanged.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CLOUD_COMPUTER_WORDS } from '../../cloudComputerWords';
import { useCloudComputerService, type UseCloudComputerServiceResult } from '../../hooks/useCloudComputerService';
import type { Words } from '../../words';
import { Button } from '../blocks/blocks';
import { cx, useT } from '../util';
import { CloudComputerWaking } from './CloudComputerWaking';

export interface CloudComputerFrameProps {
  /** A declared service id (the component keeps it running), or the result of `useCloudComputerService`. */
  service: string | UseCloudComputerServiceResult;
  /** Where the frame opens in the service (default `/`). Changing it opens the frame again. */
  path?: string;
  /** The frame's accessible name (default "Cloud Computer service"). */
  title?: Words | string;
  /** The iframe `allow` list (default autoplay, fullscreen and the clipboard). */
  allow?: string;
  /** With a service id: how long a start may take before it shows as failed, in seconds (default 90). */
  waitSeconds?: number;
  className?: string;
}

/** A gate that refuses a code is asked again this many times before the frame shows that it failed. */
const CODE_ATTEMPTS = 3;
const DEFAULT_ALLOW = 'autoplay; fullscreen; clipboard-read; clipboard-write';

function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).origin; } catch { return null; }
}

export function CloudComputerFrame({ service, path = '/', title, allow = DEFAULT_ALLOW, waitSeconds, className }: CloudComputerFrameProps) {
  const t = useT();
  const own = useCloudComputerService(typeof service === 'string' ? service : null, { waitSeconds });
  const result = typeof service === 'string' ? own : service;
  const gate = result.status === 'ready' ? originOf(result.lease?.gate_url) : null;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [state, setState] = useState<'opening' | 'open' | 'failed'>('opening');
  const [attempt, setAttempt] = useState(0);
  const frameCode = result.frameCode;
  const codeRef = useRef(frameCode);
  codeRef.current = frameCode;

  useEffect(() => {
    if (!gate) return undefined;
    setState('opening');
    let alive = true;
    let tries = 0;
    let sending = false;
    const send = async () => {
      if (sending) return;
      sending = true;
      tries += 1;
      try {
        const code = await codeRef.current(path);
        const target = frameRef.current?.contentWindow;
        if (!alive || !target) return;
        target.postMessage({ type: 'notis-gate-code', code: code.code }, gate);
      } catch {
        if (alive) setState('failed');
      } finally {
        sending = false;
      }
    };
    const onMessage = (event: MessageEvent) => {
      if (!alive || event.origin !== gate || event.source !== frameRef.current?.contentWindow) return;
      const type = (event.data as { type?: unknown } | null)?.type;
      if (type === 'notis-gate-ready') {
        void send();
      } else if (type === 'notis-gate-failed') {
        if (tries >= CODE_ATTEMPTS) setState('failed');
        else void send();
      }
    };
    window.addEventListener('message', onMessage);
    return () => { alive = false; window.removeEventListener('message', onMessage); };
  }, [gate, path, attempt]);

  // The first load is the gate's sign-in page; once the code is accepted it leaves for the service: that load is open.
  const loads = useRef(0);
  useEffect(() => { loads.current = 0; }, [gate, path, attempt]);
  const countLoad = useCallback(() => {
    loads.current += 1;
    if (loads.current >= 2) setState((current) => (current === 'failed' ? current : 'open'));
  }, []);

  if (result.status !== 'ready' || !gate) {
    return <CloudComputerWaking service={result} className={className} />;
  }
  const label = t(title ?? CLOUD_COMPUTER_WORDS.frameTitle);
  return (
    <div className={cx('nui-ccf', className)} data-state={state}>
      <iframe key={`${gate}|${path}|${attempt}`} ref={frameRef} className="nui-ccf-frame" data-state={state} title={label}
        src={`${gate}/__notis_gate/frame`} allow={allow} referrerPolicy="no-referrer" onLoad={countLoad} />
      {state === 'opening' && (
        <div className="nui-ccf-cover nui-ccw" role="status" aria-busy="true" data-state="starting">
          <span className="nui-ccw-spinner" aria-hidden="true" />
          <p className="nui-ccw-title">{t(CLOUD_COMPUTER_WORDS.frameOpening)}</p>
        </div>
      )}
      {state === 'failed' && (
        <div className="nui-ccf-cover nui-ccw" role="status" data-state="failed">
          <p className="nui-ccw-title">{t(CLOUD_COMPUTER_WORDS.frameFailed)}</p>
          <div className="nui-ccw-actions">
            <Button size="sm" icon="arrow-clockwise" onClick={() => setAttempt((value) => value + 1)}>
              {t(CLOUD_COMPUTER_WORDS.retry)}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
