// Series to SVG polyline points (pure).

/**
 * Points for a sparkline `w` wide and `h` tall, scaled so the largest value reaches near the top
 * (`max` fixes the scale instead). Values are clamped to the scale. One point draws a flat line
 * across; no points draw a flat line at the bottom.
 */
export function seriesPoints(values: readonly number[], w: number, h: number, max?: number, pad = 2): string {
  const n = values.length;
  const bottom = h - pad;
  const span = h - pad * 2;
  if (n === 0) return `0,${bottom.toFixed(1)} ${w},${bottom.toFixed(1)}`;
  const top = max ?? Math.max(1, ...values.map((v) => (Number.isFinite(v) ? v : 0)));
  const y = (v: number) => (bottom - (Math.max(0, Math.min(Number.isFinite(v) ? v : 0, top)) / top) * span).toFixed(1);
  if (n === 1) return `0,${y(values[0]!)} ${w},${y(values[0]!)}`;
  return values.map((v, i) => `${((i / (n - 1)) * w).toFixed(1)},${y(v)}`).join(" ");
}

/** The same points closed along the bottom edge, for the filled area under the line. */
export function areaPoints(values: readonly number[], w: number, h: number, max?: number, pad = 2): string {
  return `${seriesPoints(values, w, h, max, pad)} ${w},${h} 0,${h}`;
}

/** The x position of point `index` of `n` across width `w`. */
export function xOf(index: number, n: number, w: number): number {
  if (n <= 1) return 0;
  return (index / (n - 1)) * w;
}

/** The mean of the newest `window` points (all of them when there are fewer); 0 for none. */
export function windowMean(values: readonly number[], window: number): number {
  const tail = window > 0 ? values.slice(-window) : [];
  return tail.length ? tail.reduce((a, b) => a + b, 0) / tail.length : 0;
}

/** The point index under a pointer at `clientX` over a box starting at `left`, `width` wide. */
export function indexAt(clientX: number, left: number, width: number, n: number): number {
  if (n <= 1 || width <= 0) return 0;
  return Math.max(0, Math.min(n - 1, Math.round(((clientX - left) / width) * (n - 1))));
}
