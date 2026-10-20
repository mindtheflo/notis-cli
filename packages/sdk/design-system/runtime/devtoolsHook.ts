/**
 * A minimal React DevTools hook for the render smoke test of the design system book (`completeness.test.tsx`).
 *
 * React reads `globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__` once, when `react-dom` loads, and then reports every
 * commit to it. This hook walks each committed tree below the `[data-ds-state-root]` element of a book state and
 * records the `type` and `elementType` of every fiber there (a `forwardRef`, `memo` or `lazy` object is the
 * `elementType`), so the test can assert that each component a specimen covers really rendered, and counts the
 * host nodes there (portalled content included) so an empty state is caught.
 *
 * Import it before anything imports `react-dom`. Test only: the book frame never loads it.
 */

interface Fiber {
  tag?: number;
  type?: unknown;
  elementType?: unknown;
  memoizedProps?: unknown;
  child?: Fiber | null;
  sibling?: Fiber | null;
}

/** HostComponent, HostText, HostHoistable and HostSingleton (React 19 fiber tags). */
const HOST_TAGS = new Set([5, 6, 26, 27]);
const STATE_ROOT = 'data-ds-state-root';

let recording: { types: Set<unknown>; hostNodes: number; stateRoots: number } | null = null;

function isStateRoot(fiber: Fiber): boolean {
  const props = fiber.memoizedProps;
  return typeof fiber.type === 'string' && Boolean(props) && typeof props === 'object' && Object.hasOwn(props as object, STATE_ROOT);
}

/** The fibers below `fiber` (not `fiber` itself), depth first. */
function* descendants(fiber: Fiber): Generator<Fiber> {
  const stack: Fiber[] = [];
  if (fiber.child) stack.push(fiber.child);
  while (stack.length > 0) {
    const next = stack.pop()!;
    yield next;
    if (next.sibling) stack.push(next.sibling);
    if (next.child) stack.push(next.child);
  }
}

function recordCommit(current: Fiber | undefined): void {
  if (!recording || !current) return;
  let hostNodes = 0;
  let stateRoots = 0;
  for (const fiber of descendants(current)) {
    if (!isStateRoot(fiber)) continue;
    stateRoots += 1;
    for (const inner of descendants(fiber)) {
      if (inner.type !== null && inner.type !== undefined && typeof inner.type !== 'string') recording.types.add(inner.type);
      if (inner.elementType !== null && inner.elementType !== undefined && typeof inner.elementType !== 'string') recording.types.add(inner.elementType);
      if (inner.tag !== undefined && HOST_TAGS.has(inner.tag)) hostNodes += 1;
    }
  }
  // The latest commit that holds a state root decides whether the state shows anything.
  if (stateRoots > 0) {
    recording.hostNodes = hostNodes;
    recording.stateRoots = stateRoots;
  }
}

const hook = {
  supportsFiber: true,
  isDisabled: false,
  renderers: new Map<number, unknown>(),
  inject(renderer: unknown): number {
    const id = hook.renderers.size + 1;
    hook.renderers.set(id, renderer);
    return id;
  },
  checkDCE() {},
  setStrictMode() {},
  onScheduleFiberRoot() {},
  onCommitFiberRoot(_renderer: number, root: { current?: Fiber }) {
    recordCommit(root?.current);
  },
  onCommitFiberUnmount() {},
  onPostCommitFiberRoot() {},
};

const KEY = '__REACT_DEVTOOLS_GLOBAL_HOOK__';
if (!(KEY in globalThis)) Object.defineProperty(globalThis, KEY, { configurable: true, writable: true, value: hook });

/** Whether this hook is the one React reports to (false when a real DevTools hook was there first). */
export function devtoolsHookInstalled(): boolean {
  return (globalThis as Record<string, unknown>)[KEY] === hook && hook.renderers.size > 0;
}

export interface RenderRecord {
  /** Every component type and element type committed below a state root. */
  types: Set<unknown>;
  /** Host nodes below the state root in the latest commit that had one (portals included). */
  hostNodes: number;
  /** State roots seen in that commit. */
  stateRoots: number;
}

/** Starts recording the commits of one state. */
export function startRecording(): void {
  recording = { types: new Set(), hostNodes: 0, stateRoots: 0 };
}

/** Stops recording and returns what was committed since `startRecording`. */
export function stopRecording(): RenderRecord {
  const done = recording ?? { types: new Set(), hostNodes: 0, stateRoots: 0 };
  recording = null;
  return done;
}
