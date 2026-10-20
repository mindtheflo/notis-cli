import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHAT_PANEL_MIN_CONTENT_WIDTH_PX,
  CHAT_PANEL_MIN_WIDTH_PX,
  CHAT_PANEL_PAGE_PEEK_PX,
  chatPanelMaxWidth,
  chatPanelOverlap,
  chatPanelPageWidth,
  chatPanelPushLimit,
  clampChatPanelWidth,
  CHAT_PANEL_DEFAULT_WIDTH_PX,
  clampReaderWidth,
  overlap,
  parseStoredChatPanelWidth,
  pushLimit,
  readerMaxWidth,
  readerWantWidth,
  splitBreakpoint,
  splitFits,
} from './panelMath';

// The Manager chat rule, moved unchanged from portal/src/components/manager/chat/panelWidth.ts.

test('the panel keeps its own minimum and stops short of covering the page', () => {
  assert.equal(clampChatPanelWidth(200, 1200), CHAT_PANEL_MIN_WIDTH_PX);
  assert.equal(clampChatPanelWidth(600.4, 1200), 600);
  assert.equal(clampChatPanelWidth(2000, 1200), 1200 - CHAT_PANEL_PAGE_PEEK_PX);
  assert.equal(chatPanelMaxWidth(1200), 1200 - CHAT_PANEL_PAGE_PEEK_PX);
});

test('the panel pushes the page to its minimum, then slides over it', () => {
  const limit = 1200 - CHAT_PANEL_MIN_CONTENT_WIDTH_PX;
  assert.equal(chatPanelOverlap(600, 1200), 0);
  assert.equal(chatPanelOverlap(limit, 1200), 0);
  assert.equal(chatPanelOverlap(limit + 50, 1200), 50);
  assert.equal(chatPanelOverlap(chatPanelMaxWidth(1200), 1200), CHAT_PANEL_MIN_CONTENT_WIDTH_PX - CHAT_PANEL_PAGE_PEEK_PX);
  // The push limit is the widest panel that covers none of the page.
  assert.equal(chatPanelPushLimit(1200), limit);
  assert.equal(chatPanelOverlap(chatPanelPushLimit(1200), 1200), 0);
  assert.equal(chatPanelPushLimit(500), CHAT_PANEL_MIN_WIDTH_PX);
  assert.equal(chatPanelPushLimit(null), Number.POSITIVE_INFINITY);
});

test('a row too narrow for both keeps the panel usable', () => {
  assert.equal(chatPanelMaxWidth(400), CHAT_PANEL_MIN_WIDTH_PX);
  assert.equal(clampChatPanelWidth(900, 400), CHAT_PANEL_MIN_WIDTH_PX);
});

test('an unknown row only enforces the minimum and never overlaps', () => {
  assert.equal(chatPanelMaxWidth(null), Number.POSITIVE_INFINITY);
  assert.equal(clampChatPanelWidth(1500, null), 1500);
  assert.equal(chatPanelOverlap(1500, null), 0);
});

test('only a positive stored number is a preference', () => {
  assert.equal(parseStoredChatPanelWidth('560'), 560);
  for (const raw of [null, '', 'wide', '0', '-40', 'Infinity']) {
    assert.equal(parseStoredChatPanelWidth(raw), null, String(raw));
  }
});

test('the page a chosen width leaves: pushed to 320, then 320 under an overlap', () => {
  assert.equal(chatPanelPageWidth(420, 1440), 1020);
  assert.equal(chatPanelPageWidth(1120, 1440), 320);
  // Past the push limit the page keeps its minimum; the chat covers part of it.
  assert.equal(chatPanelPageWidth(1300, 1440), 320);
  assert.equal(chatPanelOverlap(1360, 1440), 240);
});

// The same arithmetic for Space Panels (list 320 + reader 360).

test('Panels split only while list and reader minimums both fit', () => {
  assert.equal(splitBreakpoint(), 680);
  assert.equal(splitFits(680), true);
  assert.equal(splitFits(679), false);
  assert.equal(splitFits(null), true);
  assert.equal(splitFits(900, 400, 400), true);
  assert.equal(splitFits(799, 400, 400), false);
  assert.equal(splitBreakpoint(240, 300), 540);
});

test('a Panels reader never squeezes the list below its minimum and never overlaps it', () => {
  assert.equal(readerMaxWidth(1000), 680);
  assert.equal(pushLimit(1000), 680);
  assert.equal(clampReaderWidth(900, 1000), 680);
  assert.equal(clampReaderWidth(200, 1000), 360);
  assert.equal(clampReaderWidth(420.6, 1000), 421);
  assert.equal(clampReaderWidth(500, null), 500);
  // A row too narrow for both keeps the reader at its minimum (Panels stacks there anyway).
  assert.equal(clampReaderWidth(500, 600), 360);
  // Under list min + peek the reader still leaves the 80px peek.
  assert.equal(clampReaderWidth(500, 400), 320);
  assert.equal(overlap(680, 1000), 0);
});

test('the chat is 420 at every width; a Space reader wants 420 under a 1280 window and 480 from 1280', () => {
  assert.equal(CHAT_PANEL_DEFAULT_WIDTH_PX, 420);
  assert.equal(readerWantWidth(1024), 420);
  assert.equal(readerWantWidth(1279), 420);
  assert.equal(readerWantWidth(1280), 480);
  assert.equal(readerWantWidth(1920), 480);
});

test('the LR2 table: window, chat, Space, list and reader widths', () => {
  // The Space is the window minus the 256px sidebar and, when open, the 420px chat.
  const rows: Array<[window: number, chat: boolean, space: number, list: number, reader: number]> = [
    [1440, true, 764, 320, 444],
    [1440, false, 1184, 704, 480],
    [1920, true, 1244, 764, 480],
    [1920, false, 1664, 1184, 480],
  ];
  for (const [windowWidth, chat, space, list, reader] of rows) {
    assert.equal(windowWidth - 256 - (chat ? CHAT_PANEL_DEFAULT_WIDTH_PX : 0), space, `${windowWidth} chat ${chat}`);
    const width = clampReaderWidth(readerWantWidth(windowWidth), space);
    assert.equal(width, reader, `${windowWidth} chat ${chat} reader`);
    assert.equal(space - width, list, `${windowWidth} chat ${chat} list`);
  }
});
