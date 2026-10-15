import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { wallColumns } from "./wallLayout";

/**
 * The column count for the fleet wall, kept current as the wall's own width changes (a window resize, a pane
 * collapsing or being dragged) and as cards come and go. Attach `ref` to the element that holds every band, so
 * all bands share the same columns. Returns null until a width is known, so the CSS fallback applies.
 */
export function useWallColumns(count: number) {
  const el = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const measure = useCallback(() => {
    if (el.current) setWidth(el.current.clientWidth);
  }, []);
  useLayoutEffect(() => {
    measure();
    const node = el.current;
    if (!node || typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [measure]);
  return { ref: el, cols: width > 0 ? wallColumns(width, count) : null };
}
