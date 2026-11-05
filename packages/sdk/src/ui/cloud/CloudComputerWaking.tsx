/**
 * CloudComputerWaking: what a page that needs a Cloud Computer service shows until the service is ready. Ready, it
 * renders its children; starting, a quiet spinner (restoring its files after a pause says so); failed, what went wrong and Try again, or Allow when only the viewer's
 * approval is missing; on a host without the Cloud Computer, a short notice. An info button tells the hourly price when
 * the host knows it.
 */

import React, { useEffect, useState, type ReactNode } from 'react';
import { CLOUD_COMPUTER_WORDS, cloudComputerPriceWords } from '../../cloudComputerWords';
import { useCloudComputerService, type UseCloudComputerServiceResult } from '../../hooks/useCloudComputerService';
import { fillWords } from '../../words';
import { Button } from '../blocks/blocks';
import { Popover } from '../overlay/Popover';
import { cx, useT } from '../util';

export interface CloudComputerWakingProps {
  /** A declared service id (the component keeps it running), or the result of `useCloudComputerService`. */
  service: string | UseCloudComputerServiceResult;
  /** What shows once the service is ready. */
  children?: ReactNode;
  /** With a service id: how long a start may take before it shows as failed, in seconds (default 90). */
  waitSeconds?: number;
  /** After a failure, Try again is offered after this many seconds (default 5). */
  retryDelaySeconds?: number;
  className?: string;
}

function PriceInfo({ hourlyUsd }: { hourlyUsd: number | null | undefined }) {
  const t = useT();
  const words = cloudComputerPriceWords(hourlyUsd);
  if (!words) return null;
  return (
    <Popover label={CLOUD_COMPUTER_WORDS.priceInfo} align="center" side="top"
      content={<p className="nui-ccw-price">{t(words)}</p>}
      trigger={<Button variant="ghost" size="sm" icon="info" className="nui-ccw-info" aria-label={t(CLOUD_COMPUTER_WORDS.priceInfo)} />} />
  );
}

/** Seconds left before Try again is offered, counting down from `delay` each time `key` changes. */
function useRetryCountdown(key: unknown, active: boolean, delay: number): number {
  const [left, setLeft] = useState(delay);
  useEffect(() => {
    if (!active) return undefined;
    setLeft(delay);
    if (delay <= 0) return undefined;
    const timer = setInterval(() => setLeft((value) => {
      if (value <= 1) { clearInterval(timer); return 0; }
      return value - 1;
    }), 1000);
    return () => clearInterval(timer);
  }, [key, active, delay]);
  return active ? left : delay;
}

export function CloudComputerWaking({ service, children, waitSeconds, retryDelaySeconds = 5, className }: CloudComputerWakingProps) {
  const t = useT();
  // Always called (hook order); a passed result keeps the page's own hook in charge and this one stays inert.
  const own = useCloudComputerService(typeof service === 'string' ? service : null, { waitSeconds });
  const result = typeof service === 'string' ? own : service;
  const failed = result.status === 'failed';
  const left = useRetryCountdown(result.error, failed, Math.max(0, retryDelaySeconds));

  if (result.status === 'ready') return <>{children}</>;
  if (result.status === 'unavailable') {
    return (
      <div className={cx('nui-ccw', className)} role="status" data-state="unavailable">
        <p className="nui-ccw-body">{t(CLOUD_COMPUTER_WORDS.unavailable)}</p>
      </div>
    );
  }
  const hourlyUsd = result.price?.hourly_usd;
  const price = cloudComputerPriceWords(hourlyUsd) ? <PriceInfo hourlyUsd={hourlyUsd} /> : null;
  if (failed && result.approvalRequired) {
    return (
      <div className={cx('nui-ccw', className)} role="status" data-state="approval">
        <p className="nui-ccw-title">{t(CLOUD_COMPUTER_WORDS.approvalTitle)}</p>
        <p className="nui-ccw-body">{t(CLOUD_COMPUTER_WORDS.approvalHint)}</p>
        <div className="nui-ccw-actions">
          <Button size="sm" variant="primary" icon="check" onClick={() => void result.allow().catch(() => undefined)}>
            {t(CLOUD_COMPUTER_WORDS.allow)}
          </Button>
          {price}
        </div>
      </div>
    );
  }
  if (failed) {
    const message = result.error?.message || t(CLOUD_COMPUTER_WORDS.failedGeneric);
    return (
      <div className={cx('nui-ccw', className)} role="status" data-state="failed">
        <p className="nui-ccw-title">{t(CLOUD_COMPUTER_WORDS.failedTitle)}</p>
        <p className="nui-ccw-body">{message}</p>
        <div className="nui-ccw-actions">
          <Button size="sm" icon="arrow-clockwise" disabled={left > 0} onClick={() => result.retry()}>
            {left > 0 ? t(fillWords(CLOUD_COMPUTER_WORDS.retryIn, { seconds: left })) : t(CLOUD_COMPUTER_WORDS.retry)}
          </Button>
          {price}
        </div>
      </div>
    );
  }
  const restoring = result.restoring === true;
  return (
    <div className={cx('nui-ccw', className)} role="status" aria-busy="true" data-state={restoring ? 'restoring' : 'starting'}>
      <span className="nui-ccw-spinner" aria-hidden="true" />
      <p className="nui-ccw-title">{t(restoring ? CLOUD_COMPUTER_WORDS.restoring : CLOUD_COMPUTER_WORDS.starting)}</p>
      <p className="nui-ccw-body">{t(restoring ? CLOUD_COMPUTER_WORDS.restoringHint : CLOUD_COMPUTER_WORDS.startingHint)}</p>
      {price && <div className="nui-ccw-actions">{price}</div>}
    </div>
  );
}
