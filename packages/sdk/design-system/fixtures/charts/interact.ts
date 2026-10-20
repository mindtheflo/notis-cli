/**
 * Interaction steps for the chart specimens: wait for a plot to have its size, point at a bar or a point the way a
 * mouse does (recharts reads React mouse events on its wrapper), reveal the data table a chart keeps hidden for view
 * Markdown, and focus an about button so its tooltip opens.
 */
import { nextFrame } from '../../specimen';

/** Lets effects, layout and recharts' own frame-throttled pointer settle. */
export async function settle(frames = 4): Promise<void> {
  for (let i = 0; i < frames; i += 1) await nextFrame();
}

/** The `index`th recharts wrapper under `root` once it is drawn with a size (ResponsiveContainer measures first). */
export async function waitForPlot(root: HTMLElement, index = 0, frames = 120): Promise<HTMLElement> {
  for (let i = 0; i < frames; i += 1) {
    const wrapper = root.querySelectorAll<HTMLElement>('.recharts-wrapper')[index];
    if (wrapper && wrapper.querySelector('.recharts-surface') && wrapper.getBoundingClientRect().width > 0) return wrapper;
    await nextFrame();
  }
  throw new Error(`No drawn chart #${index} after ${frames} frames`);
}

/**
 * Points at a plot: `at` is the horizontal position as a share of the plot width (0 the left edge, 1 the right),
 * `y` the vertical one. Sends what a mouse entering then moving sends; recharts opens its tooltip on the nearest
 * point and Chart lights the hovered bar.
 */
export async function hoverPlot(root: HTMLElement, { at, y = 0.5, index = 0 }: { at: number; y?: number; index?: number }):
  Promise<void> {
  const wrapper = await waitForPlot(root, index);
  const rect = wrapper.getBoundingClientRect();
  const init: MouseEventInit = {
    bubbles: true,
    composed: true,
    cancelable: true,
    clientX: rect.left + rect.width * at,
    clientY: rect.top + rect.height * y,
    view: wrapper.ownerDocument.defaultView,
  };
  const target = wrapper.querySelector('.recharts-surface') ?? wrapper;
  target.dispatchEvent(new MouseEvent('mouseover', init));
  target.dispatchEvent(new MouseEvent('mouseenter', { ...init, bubbles: false }));
  target.dispatchEvent(new MouseEvent('mousemove', init));
  await settle();
  // A second move once the first frame has run, as a real pointer keeps moving.
  target.dispatchEvent(new MouseEvent('mousemove', init));
  await settle(6);
}

/**
 * Draws the data table a chart keeps hidden (`table[data-notis-render="chart-data"]`, the numbers view Markdown
 * reads) into the state's `[data-chart-table-out]` slot, so the review sees what an assistant reads.
 */
export async function revealTable(root: HTMLElement, index = 0): Promise<void> {
  let table: HTMLTableElement | undefined;
  for (let i = 0; i < 60 && !table; i += 1) {
    table = root.querySelectorAll<HTMLTableElement>('table[data-notis-render="chart-data"]')[index];
    if (!table) await nextFrame();
  }
  const out = root.querySelector<HTMLElement>('[data-chart-table-out]');
  if (!table || !out) throw new Error('No chart data table or no slot to draw it in');
  const copy = table.cloneNode(true) as HTMLTableElement;
  copy.hidden = false;
  copy.removeAttribute('hidden');
  copy.removeAttribute('data-notis-render');
  copy.style.cssText = 'border-collapse:collapse;font-size:12px;width:100%;';
  copy.querySelectorAll<HTMLElement>('th, td').forEach((cell) => {
    cell.style.cssText = 'padding:4px 8px;text-align:left;font-variant-numeric:tabular-nums;white-space:nowrap;';
    if (cell.tagName === 'TH') cell.style.fontWeight = '500';
  });
  copy.querySelectorAll<HTMLElement>('thead th').forEach((cell) => { cell.style.color = 'hsl(var(--muted-foreground))'; });
  out.replaceChildren(copy);
  await settle(2);
}

/** Focuses the `index`th element matching `selector` under `root` as the keyboard does (focus-visible). */
export async function focusFrom(root: HTMLElement, selector: string, index = 0, frames = 8): Promise<HTMLElement> {
  let target: HTMLElement | undefined;
  for (let i = 0; i < 60 && !target; i += 1) {
    target = root.querySelectorAll<HTMLElement>(selector)[index];
    if (!target) await nextFrame();
  }
  if (!target) throw new Error(`Nothing matches ${selector} #${index}`);
  // Script focus before any pointer press counts as keyboard focus (focus-visible); for an about button that opens
  // its tooltip at once.
  target.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
  await settle(frames);
  return target;
}

/** Focuses the `index`th about button under `root` from the keyboard, so its tooltip opens. */
export async function focusAbout(root: HTMLElement, index = 0): Promise<void> {
  await focusFrom(root, '[data-about]', index);
}
