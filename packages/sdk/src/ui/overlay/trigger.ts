/** Wiring a caller's trigger element (cloneElement) without dropping its own ref or handlers. */

import { cloneElement, type ReactElement, type Ref, type SyntheticEvent } from 'react';

export function setRef<V>(ref: Ref<V> | undefined | null, value: V | null): void {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else (ref as { current: V | null }).current = value;
}

/** The trigger's own ref (React 19 keeps it in props, React 18 on the element). */
function ownRef(element: ReactElement): Ref<unknown> | undefined {
  const props = element.props as { ref?: Ref<unknown> } | null;
  return props?.ref ?? (element as unknown as { ref?: Ref<unknown> }).ref ?? undefined;
}

type Handlers = Record<string, ((event: SyntheticEvent) => void) | undefined>;

/**
 * Clones `element` with `extra` props. Event handlers in `extra` run after the element's own and are skipped when
 * the own handler called preventDefault. `ref` is merged.
 */
export function cloneTrigger(element: ReactElement, extra: Record<string, unknown> & { ref?: Ref<HTMLElement> }): ReactElement {
  const own = (element.props ?? {}) as Handlers & Record<string, unknown>;
  const merged: Record<string, unknown> = { ...extra };
  for (const [name, handler] of Object.entries(extra)) {
    if (!/^on[A-Z]/.test(name) || typeof handler !== 'function') continue;
    const original = own[name];
    if (typeof original !== 'function') continue;
    merged[name] = (event: SyntheticEvent) => {
      original(event);
      if (!event.defaultPrevented) (handler as (event: SyntheticEvent) => void)(event);
    };
  }
  const elementRef = ownRef(element);
  const extraRef = extra.ref;
  merged.ref = (node: HTMLElement | null) => {
    setRef(elementRef as Ref<HTMLElement> | undefined, node);
    setRef(extraRef, node);
  };
  return cloneElement(element, merged);
}
