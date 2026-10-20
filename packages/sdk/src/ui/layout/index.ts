/** Layout: Panels (list plus open item) and the chat width rule it shares with the Manager. */
export { Panels, usePanels, type PanelsMode, type PanelsProps, type PanelsState } from './Panels';
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
