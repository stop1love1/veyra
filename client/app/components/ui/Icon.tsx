import type { CSSProperties, ReactNode } from 'react';

export interface IconProps {
  name: string;
  size?: number;
  sw?: number;
  style?: CSSProperties;
}

/** Line icons (simple strokes only). */
export function Icon({ name, size = 22, sw = 1.8, style = {} }: IconProps) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: sw, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<string, ReactNode> = {
    coin:    <g><circle cx="12" cy="12" r="8.5" {...p}/><path d="M12 7.5v9M9.6 9.6h3.4a1.6 1.6 0 010 3.2H9.6m0 0h3.7" {...p}/></g>,
    map:     <g><path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2z" {...p}/><path d="M9 4v14M15 6v14" {...p}/></g>,
    chat:    <path d="M5 5h14a2 2 0 012 2v8a2 2 0 01-2 2H9l-4 3v-3a2 2 0 01-2-2V7a2 2 0 012-2z" {...p}/>,
    cart:    <g><circle cx="9" cy="20" r="1.4" {...p}/><circle cx="18" cy="20" r="1.4" {...p}/><path d="M3 4h2l2.2 11.2a1.5 1.5 0 001.5 1.2h8.6a1.5 1.5 0 001.5-1.2L21 8H6" {...p}/></g>,
    close:   <path d="M6 6l12 12M18 6L6 18" {...p}/>,
    menu:    <path d="M4 7h16M4 12h16M4 17h16" {...p}/>,
    chevL:   <path d="M15 5l-7 7 7 7" {...p}/>,
    chevR:   <path d="M9 5l7 7-7 7" {...p}/>,
    chevD:   <path d="M5 9l7 7 7-7" {...p}/>,
    chevU:   <path d="M5 15l7-7 7 7" {...p}/>,
    plus:    <path d="M12 5v14M5 12h14" {...p}/>,
    minus:   <path d="M5 12h14" {...p}/>,
    heart:   <path d="M12 20s-7-4.6-9.2-9.2C1.3 7.6 3 4.5 6 4.5c2 0 3.2 1.2 4 2.4.8-1.2 2-2.4 4-2.4 3 0 4.7 3.1 3.2 6.3C19 15.4 12 20 12 20z" {...p}/>,
    heartFill:<path d="M12 20s-7-4.6-9.2-9.2C1.3 7.6 3 4.5 6 4.5c2 0 3.2 1.2 4 2.4.8-1.2 2-2.4 4-2.4 3 0 4.7 3.1 3.2 6.3C19 15.4 12 20 12 20z" fill="currentColor" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round"/>,
    star:    <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.6 1-5.8L3.5 9.7l5.9-.9L12 3.5z" {...p}/>,
    check:   <path d="M5 12.5l4.5 4.5L19 7" {...p}/>,
    spark:   <path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3z" {...p}/>,
    quest:   <g><path d="M5 4v16M5 5h10l-1.5 3L15 11H5" {...p}/></g>,
    user:    <g><circle cx="12" cy="8" r="3.6" {...p}/><path d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6" {...p}/></g>,
    power:   <g><path d="M12 3.5v8" {...p}/><path d="M7 6.4a7 7 0 109.9 0" {...p}/></g>,
    edit:    <g><path d="M4 16.4V20h3.6L18 9.6 14.4 6 4 16.4z" {...p}/><path d="M13.1 7.3l3.6 3.6" {...p}/></g>,
    send:    <path d="M5 12l15-7-5 15-3.5-5.5L5 12z" {...p}/>,
    pin:     <g><path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z" {...p}/><circle cx="12" cy="10" r="2.4" {...p}/></g>,
    globe:   <g><circle cx="12" cy="12" r="8.5" {...p}/><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" {...p}/></g>,
    search:  <g><circle cx="11" cy="11" r="6.5" {...p}/><path d="M16 16l4 4" {...p}/></g>,
    hanger:  <g><path d="M12 7a2 2 0 112-2c0 1.5-2 1.8-2 3v1" {...p}/><path d="M12 9l8.5 6c.9.6.5 2-.6 2H4.1c-1.1 0-1.5-1.4-.6-2L12 9z" {...p}/></g>,
    bag:     <g><path d="M6 8h12l-1 12H7L6 8z" {...p}/><path d="M9 8V6a3 3 0 016 0v2" {...p}/></g>,
    bolt:    <path d="M13 3L5 13h6l-1 8 8-10h-6l1-8z" {...p}/>,
    home:    <path d="M4 11l8-7 8 7M6 9.5V20h12V9.5" {...p}/>,
    ticket:  <g><path d="M3 7h18v3a2 2 0 000 4v3H3v-3a2 2 0 000-4V7z" {...p}/><path d="M14 7v10" strokeDasharray="2 2" {...p}/></g>,
    truck:   <g><path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z" {...p}/><circle cx="7" cy="18" r="1.6" {...p}/><circle cx="17" cy="18" r="1.6" {...p}/></g>,
    shield:  <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z" {...p}/>,
    sun:     <g><circle cx="12" cy="12" r="4" {...p}/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" {...p}/></g>,
    cloud:   <path d="M7.5 18a4 4 0 01-.4-7.98 5 5 0 019.7-1.2A3.5 3.5 0 0117 18H7.5z" {...p}/>,
    rain:    <g><path d="M7.5 14a4 4 0 01-.4-7.98 5 5 0 019.7-1.2A3.5 3.5 0 0117 14H7.5z" {...p}/><path d="M8 17l-1 2.5M12 17l-1 2.5M16 17l-1 2.5" {...p}/></g>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block', flexShrink: 0, ...style }}>
      {paths[name] || null}
    </svg>
  );
}
