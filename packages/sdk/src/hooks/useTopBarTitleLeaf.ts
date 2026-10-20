'use client';

import { useEffect, useRef } from 'react';
import { useNotisRuntime } from '../provider';

type Leaf = { label: string; onBack?: () => void };
type LeafSetter = (leaf: Leaf | null) => void;
type Owner = { label: string; back: { current: (() => void) | undefined }; hasBack: boolean };
type LeafOwners = { owners: Owner[]; sent: Owner | null; back: () => void };

// The components that own a leaf, per host setter, in mount order. The newest owner names the leaf; a component
// with no record open owns nothing and never writes, so it cannot clear another one's leaf.
const ownersBySetter = new WeakMap<LeafSetter, LeafOwners>();

function publish(set: LeafSetter, entry: LeafOwners) {
  const top = entry.owners.length ? entry.owners[entry.owners.length - 1] : null;
  const sent = entry.sent;
  if (top === sent || (top && sent && top.label === sent.label && top.hasBack === sent.hasBack)) { entry.sent = top; return; }
  entry.sent = top;
  // The host keeps one stable way back per setter; it always calls the newest owner's latest onBack.
  set(top ? { label: top.label, ...(top.hasBack ? { onBack: entry.back } : {}) } : null);
}

/**
 * Adds the open record's label as the last crumb of the Portal top bar title
 * ("Product / Tickets / PRO-002") while the component is mounted. Pass `null`
 * when no record is open: the component then owns no leaf and leaves another
 * component's leaf alone. With several owners, the most recently opened one
 * names the leaf; closing it gives the leaf back to the one before.
 *
 * `onBack` closes the record: the crumb before the leaf (the view) then calls it,
 * so the top bar is the page's way back and the page draws no breadcrumb of its own.
 *
 * Without a portal runtime, this hook is a safe no-op.
 *
 * ```tsx
 * useTopBarTitleLeaf(openTicket ? openTicket.key : null, () => setParams({ ticket: null }));
 * ```
 */
export function useTopBarTitleLeaf(label: string | null, onBack?: () => void): void {
  const runtime = useNotisRuntime();
  const leaf = label?.trim() || null;
  const back = useRef(onBack);
  back.current = onBack;
  const hasBack = Boolean(onBack);

  useEffect(() => {
    const set = runtime?.setTopBarTitleLeaf;
    if (!set || !leaf) return;
    let entry = ownersBySetter.get(set);
    if (!entry) {
      const created: LeafOwners = { owners: [], sent: null, back: () => created.sent?.back.current?.() };
      entry = created;
      ownersBySetter.set(set, entry);
    }
    const owner: Owner = { label: leaf, back, hasBack };
    entry.owners.push(owner);
    publish(set, entry);
    return () => {
      const current = ownersBySetter.get(set);
      if (!current) return;
      current.owners = current.owners.filter((item) => item !== owner);
      publish(set, current);
    };
  }, [runtime, leaf, hasBack]);
}
