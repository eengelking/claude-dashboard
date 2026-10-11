// Line icons from the mockup, as components. Decorative: hidden from assistive tech.
import type { ReactElement } from "react";

type P = { className?: string };
const svg = (paths: ReactElement, extra = "") => ({ className }: P) => (
  <svg className={`i${extra ? ` ${extra}` : ""}${className ? ` ${className}` : ""}`} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    {paths}
  </svg>
);

export const IconFork = svg(
  <>
    <circle cx="4" cy="3" r="1.6" />
    <circle cx="12" cy="3" r="1.6" />
    <circle cx="8" cy="13" r="1.6" />
    <path d="M4 4.6v1.2c0 1.2 1 2 2.2 2h3.6c1.2 0 2.2-.8 2.2-2V4.6M8 7.8v3.6" />
  </>,
  "kfork",
);
export const IconSub = svg(<rect x="3" y="3" width="10" height="10" rx="2" />);
export const IconOrch = svg(<><circle cx="8" cy="4" r="2" /><path d="M8 6v3M3 13v-2.5a1.5 1.5 0 0 1 1.5-1.5h7a1.5 1.5 0 0 1 1.5 1.5V13M8 9v4" /></>);
export const IconCheck = svg(<path d="M3.5 8.5l3 3 6-7" />);
export const IconX = svg(<path d="M4 4l8 8M12 4l-8 8" />);
export const IconClock = svg(<><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.2l2 1.3" /></>);
export const IconWarn = svg(<><path d="M8 2.5l6 10.5H2z" /><path d="M8 7v2.8M8 11.6v.1" /></>);
export const IconBack = svg(<path d="M10 3L5 8l5 5" />);
export const IconBranch = svg(<><circle cx="4.5" cy="3.5" r="1.6" /><circle cx="4.5" cy="12.5" r="1.6" /><circle cx="11.5" cy="5.5" r="1.6" /><path d="M4.5 5.1v5.8M11.5 7.1c0 2.4-3 2.4-6 3.6" /></>);
export const IconTree = svg(<><rect x="2" y="2.5" width="7" height="5" rx="1" /><rect x="7" y="8.5" width="7" height="5" rx="1" /><path d="M4 7.5v3h3" /></>);
export const IconUp = svg(<path d="M8 13V3M4 7l4-4 4 4" />);
export const IconDown = svg(<path d="M8 3v10M4 9l4 4 4-4" />);
export const IconMod = svg(<circle cx="8" cy="8" r="2.6" />);
export const IconJump = svg(<path d="M6 3h7v7M13 3L5 11" />);

export function Logo() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="10" cy="4" r="2" />
      <circle cx="4" cy="15" r="2" />
      <circle cx="10" cy="15" r="2" />
      <circle cx="16" cy="15" r="2" />
      <path d="M10 6v3M10 9H4v4M10 9h6v4M10 9v4" />
    </svg>
  );
}
