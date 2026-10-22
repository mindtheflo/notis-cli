/**
 * The toolkit's built-in icons: a small inline SVG set under the Phosphor names the action catalogue uses, so the
 * toolkit has no icon dependency. Every `icon` prop also takes any ReactNode (a Phosphor component, for example).
 */

import React, { type ReactNode } from 'react';

type Shape = ReactNode;

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const F = { fill: 'currentColor', stroke: 'none' } as const;

const SHAPES: Record<string, Shape> = {
  'arrow-left': <path {...S} d="M13 8H3m4-4L3 8l4 4" />,
  x: <path {...S} d="M4 4l8 8M12 4l-8 8" />,
  'caret-up': <path {...S} d="M4 10l4-4 4 4" />,
  'caret-down': <path {...S} d="M4 6l4 4 4-4" />,
  'caret-right': <path {...S} d="M6 4l4 4-4 4" />,
  'caret-left': <path {...S} d="M10 4L6 8l4 4" />,
  'arrows-out': <path {...S} d="M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9" />,
  'dots-three': <g {...F}><circle cx="3.5" cy="8" r="1.25" /><circle cx="8" cy="8" r="1.25" /><circle cx="12.5" cy="8" r="1.25" /></g>,
  'sidebar-simple': <g {...S}><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M9.5 3v10" /></g>,
  'square-center': <g {...S}><rect x="2" y="3" width="12" height="10" rx="1.5" /><rect x="5" y="5.5" width="6" height="5" rx=".75" /></g>,
  'corners-out': <path {...S} d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />,
  check: <path {...S} d="M3 8.5l3 3 7-7" />,
  archive: <g {...S}><rect x="2" y="3" width="12" height="3" rx=".75" /><path d="M3 6v6.5a.5.5 0 00.5.5h9a.5.5 0 00.5-.5V6M6.5 8.5h3" /></g>,
  'tray-arrow-up': <path {...S} d="M2.5 9.5v3a.5.5 0 00.5.5h10a.5.5 0 00.5-.5v-3h-3l-1 1.5h-3l-1-1.5h-3M8 8V2.5M5.5 5L8 2.5 10.5 5" />,
  star: <path {...S} d="M8 2l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z" />,
  'star-fill': <path fill="currentColor" stroke="currentColor" strokeWidth={0.8} strokeLinejoin="round" d="M8 1.6l1.95 3.95 4.36.64-3.16 3.07.75 4.34L8 11.55 4.1 13.6l.75-4.34L1.69 6.19l4.36-.64z" />,
  clock: <g {...S}><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8h3" /></g>,
  'arrow-bend-up-right': <path {...S} d="M10 3l3 3-3 3M13 6H7a4 4 0 00-4 4v3" />,
  'user-plus': <g {...S}><circle cx="6.5" cy="5.5" r="2.75" /><path d="M1.5 13.5c.8-2.2 2.7-3.5 5-3.5s4.2 1.3 5 3.5M12.5 4v4M10.5 6h4" /></g>,
  'envelope-open': <path {...S} d="M2 6.5v6a.5.5 0 00.5.5h11a.5.5 0 00.5-.5v-6L8 2.5zM2 6.5l6 4 6-4" />,
  'envelope-simple': <g {...S}><rect x="2" y="3.5" width="12" height="9" rx="1" /><path d="M2 4.5l6 4.5 6-4.5" /></g>,
  'pencil-simple': <path {...S} d="M10.8 2.7l2.5 2.5L5.6 12.9 2.5 13.5l.6-3.1zM9.3 4.2l2.5 2.5" />,
  'file-text': <path {...S} d="M9.5 2H4a.5.5 0 00-.5.5v11a.5.5 0 00.5.5h8a.5.5 0 00.5-.5V5zM9.5 2v3h3M6 8.5h4M6 11h4" />,
  flask: <path {...S} d="M6 2h4M6.8 2v4.3l-3.6 6.2a1 1 0 00.9 1.5h7.8a1 1 0 00.9-1.5L9.2 6.3V2M4.6 10.2h6.8" />,
  copy: <path {...S} d="M6.5 5.5h5a1 1 0 011 1v5a1 1 0 01-1 1h-5a1 1 0 01-1-1v-5a1 1 0 011-1zM10.5 5.5v-1a1 1 0 00-1-1h-5a1 1 0 00-1 1v5a1 1 0 001 1h1" />,
  'chat-circle-text': <path {...S} d="M4.7 13.1A5.8 5.8 0 102.9 11.3L2.3 13.7zM6 7h4M6 9.3h3" />,
  trash: <path {...S} d="M2.5 4h11M6.5 2.5h3M4 4l.6 9a.5.5 0 00.5.5h5.8a.5.5 0 00.5-.5L12 4M6.5 6.5v4.5M9.5 6.5v4.5" />,
  'circle-half': <g><circle {...S} cx="8" cy="8" r="6" /><path {...F} d="M8 2a6 6 0 010 12z" /></g>,
  'circle-three-quarter': <g><circle {...S} cx="8" cy="8" r="6" /><path {...F} d="M8 8V2a6 6 0 11-6 6z" /></g>,
  pause: <path {...S} d="M5.5 3v10M10.5 3v10" />,
  play: <path {...S} d="M4.5 2.5v11L13 8z" />,
  'toggle-right': <g {...S}><rect x="1.5" y="4" width="13" height="8" rx="4" /><circle cx="10.5" cy="8" r="2" /></g>,
  'toggle-left': <g {...S}><rect x="1.5" y="4" width="13" height="8" rx="4" /><circle cx="5.5" cy="8" r="2" /></g>,
  hourglass: <path {...S} d="M4 2.5h8M4 13.5h8M5 2.5c0 3 6 3.5 6 5.5s-6 2.5-6 5.5M11 2.5c0 3-6 3.5-6 5.5s6 2.5 6 5.5" />,
  'arrow-counter-clockwise': <path {...S} d="M4.5 6H2V3.5M2.3 6A6 6 0 112 9" />,
  'arrow-clockwise': <path {...S} d="M11.5 6H14V3.5M13.7 6A6 6 0 1 0 14 9" />,
  'arrows-clockwise': <path {...S} d="M3 6a5.4 5.4 0 0110 0M13 3v3h-3M13 10a5.4 5.4 0 01-10 0M3 13v-3h3" />,
  plus: <path {...S} d="M8 3v10M3 8h10" />,
  'circle-dashed': <circle {...S} cx="8" cy="8" r="6" strokeDasharray="2.2 2.2" />,
  circle: <circle {...S} cx="8" cy="8" r="6" />,
  'clock-countdown': <g {...S}><path d="M8 2a6 6 0 11-6 6" strokeDasharray="0" /><path d="M8 5v3l2 1.5M2.6 5.3l.1-.1M4.6 3.1l.1-.1" /></g>,
  'check-circle-fill': <g><circle {...F} cx="8" cy="8" r="6.5" /><path d="M5 8.2l2 2 4-4" fill="none" stroke="hsl(var(--background))" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" /></g>,
  'minus-circle': <g {...S}><circle cx="8" cy="8" r="6" /><path d="M5.5 8h5" /></g>,
  'x-circle-fill': <g><circle {...F} cx="8" cy="8" r="6.5" /><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" fill="none" stroke="hsl(var(--background))" strokeWidth={1.5} strokeLinecap="round" /></g>,
  'magnifying-glass-plus': <path {...S} d="M7 12A5 5 0 107 2a5 5 0 000 10zM10.6 10.6L14 14M5 7h4M7 5v4" />,
  'magnifying-glass-minus': <path {...S} d="M7 12A5 5 0 107 2a5 5 0 000 10zM10.6 10.6L14 14M5 7h4" />,
  'download-simple': <path {...S} d="M8 2.5v7.5M4.5 6.5L8 10l3.5-3.5M2.5 10v3a.5.5 0 00.5.5h10a.5.5 0 00.5-.5v-3" />,
  link: <path {...S} d="M6.8 9.2l2.4-2.4M7.6 4.6l1.2-1.2a2.8 2.8 0 014 4l-1.2 1.2M8.4 11.4l-1.2 1.2a2.8 2.8 0 01-4-4l1.2-1.2" />,
  file: <path {...S} d="M9.5 2H4a.5.5 0 00-.5.5v11a.5.5 0 00.5.5h8a.5.5 0 00.5-.5V5zM9.5 2v3h3" />,
  'file-image': <g {...S}><path d="M9.5 2H4a.5.5 0 00-.5.5v11a.5.5 0 00.5.5h8a.5.5 0 00.5-.5V5zM9.5 2v3h3" /><path d="M3.5 12l3-3 2 2 1.5-1.5 2.5 2.5" /><circle cx="6.5" cy="6.75" r=".75" /></g>,
  'file-video': <g {...S}><path d="M9.5 2H4a.5.5 0 00-.5.5v11a.5.5 0 00.5.5h8a.5.5 0 00.5-.5V5zM9.5 2v3h3" /><path d="M6.5 8v3.5L9.5 9.75z" /></g>,
  'file-audio': <g {...S}><path d="M9.5 2H4a.5.5 0 00-.5.5v11a.5.5 0 00.5.5h8a.5.5 0 00.5-.5V5zM9.5 2v3h3" /><path d="M6 9.5v1.5h1.25L9 12.25v-4.5L7.25 9H6M10.5 8.5a1.8 1.8 0 010 2.5" /></g>,
};

export function hasIcon(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(SHAPES, name);
}

/** A built-in icon by name; an unknown name renders nothing. Decorative: the control carries the label. */
export function Icon({ name, className }: { name: string; className?: string }) {
  const shape = SHAPES[name];
  if (!shape) return null;
  return (
    <svg className={className ? `nui-icon ${className}` : 'nui-icon'} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {shape}
    </svg>
  );
}

/** Renders an `icon` prop: a name from the set, or any node the caller passes. */
export function renderIcon(icon: ReactNode | string | undefined, className?: string): ReactNode {
  if (icon === undefined || icon === null || icon === false) return null;
  if (typeof icon === 'string') return <Icon name={icon} className={className} />;
  return icon;
}
