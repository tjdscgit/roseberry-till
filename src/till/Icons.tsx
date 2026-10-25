import type { ReactNode } from "react";

// Stroke icons, sized by the caller. All decorative: buttons carry their own labels.
type P = { size?: number; color?: string };

function Svg({ size = 22, color = "currentColor", width = 2.4, children }: P & { width?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const Search = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Svg>;
export const Close = (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
export const Minus = (p: P) => <Svg {...p}><path d="M5 12h14" /></Svg>;
export const Plus = (p: P) => <Svg {...p}><path d="M5 12h14M12 5v14" /></Svg>;
export const Back = (p: P) => <Svg {...p}><path d="M15 5l-7 7 7 7" /></Svg>;
export const Check = (p: P) => <Svg {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>;
export const Backspace = (p: P) => (
  <Svg {...p} width={2}><path d="M21 5H9l-6 7 6 7h12z" /><path d="M17 9l-6 6M11 9l6 6" /></Svg>
);
export const Terminal = (p: P) => (
  <Svg {...p} width={1.8}><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M9 6h6M9 17h6" /></Svg>
);
export const WifiOff = (p: P) => (
  <Svg {...p} width={2}><path d="M2 2l20 20" /><path d="M8.5 16a5 5 0 0 1 7 0" /><path d="M5 12.5a10 10 0 0 1 4.2-2.6" /><path d="M14.8 9.9A10 10 0 0 1 19 12.5" /><circle cx="12" cy="19.5" r="1" /></Svg>
);
