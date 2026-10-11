import { areaPoints, seriesPoints } from "../chart";

/** A small filled sparkline. Decorative: the same number is shown as text beside it. */
export function Sparkline({ values, w = 100, h = 22 }: { values: readonly number[]; w?: number; h?: number }) {
  return (
    <svg className="sp" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <polyline className="area" points={areaPoints(values, w, h)} />
      <polyline points={seriesPoints(values, w, h)} />
    </svg>
  );
}
