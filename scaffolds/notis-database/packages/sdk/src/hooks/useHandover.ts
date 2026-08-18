'use client';

import { useCallback, useState } from 'react';
import { useNotisRuntime } from '../provider';
import type { HandoverPayload, HandoverResult } from '../runtime';

export interface UseHandoverResult {
  /** Hand the work over. Rejects when the host has no manager chat. */
  handover: (payload: HandoverPayload) => Promise<HandoverResult>;
  /** True while the manager chat is being prepared. */
  pending: boolean;
  error: Error | null;
  /**
   * False when the host cannot hand work over (dev harness, vite preview).
   * Render the app's own fallback — a copyable prompt, say — when it is false.
   */
  available: boolean;
}

/**
 * Hand a piece of work from app code to the Notis manager chat.
 *
 * An app displays work; the manager runs it. `handover` puts the message in
 * the chat surface that already owns streaming progress, billing, cancellation
 * and the transcript, and the app watches its own databases for the result.
 *
 * ```tsx
 * const { handover, pending, available } = useHandover();
 *
 * return available ? (
 *   <Button
 *     disabled={pending}
 *     onClick={() => { void handover({ prompt: 'Create a workspace on notis to ...' }); }}
 *   >
 *     Send to Notis
 *   </Button>
 * ) : (
 *   <CopyablePrompt prompt="Create a workspace on notis to ..." />
 * );
 * ```
 *
 * Pass `skill` to bind the work to a skill declared in `notis.config.ts`; the
 * host rejects a key the app does not declare. `autoSend` is accepted for
 * forward compatibility; today's hosts always return `drafted` and let the
 * user press send.
 */
export function useHandover(): UseHandoverResult {
  const runtime = useNotisRuntime();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const handover = useCallback(
    async (payload: HandoverPayload): Promise<HandoverResult> => {
      if (!runtime?.handover) {
        throw new Error('This Notis host cannot hand work to the manager chat.');
      }

      setPending(true);
      setError(null);

      try {
        return await runtime.handover(payload);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setPending(false);
      }
    },
    [runtime],
  );

  return { handover, pending, error, available: Boolean(runtime?.handover) };
}
