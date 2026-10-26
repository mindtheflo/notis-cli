/** Layout: Panels (list plus open item), SidePane (a page with a resizable pane) and the chat width rule. */
export { Panels, usePanels, type PanelsMode, type PanelsProps, type PanelsState } from './Panels';
export {
  SIDE_PANE_DEFAULT_PX,
  SIDE_PANE_MAIN_MIN_PX,
  SIDE_PANE_MAX_PX,
  SIDE_PANE_MIN_PX,
  SidePane,
  clampSidePaneWidth,
  type SidePaneProps,
} from './SidePane';
export * as panelMath from './panelMath';
export * from './panelMath';
export {
  PAGE_VIEWPORT_ATTRIBUTE,
  createChatPanelEdge,
  pageViewport,
  type ChatPanelEdge,
  type ChatPanelEdgeAdapters,
  type ChatPanelEdgeAnalytics,
  type ChatPanelEdgeAria,
  type ChatPanelEdgeMethod,
  type ChatPanelEdgeOutcome,
  type ChatPanelEdgeTrigger,
  type EdgeKeyboardEvent,
  type EdgePointerEvent,
} from './chatPanelEdge';
