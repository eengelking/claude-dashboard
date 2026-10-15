// The orchestrator page's three 60-second charts, with a crosshair and value readout on hover.
import { useState, type MouseEvent } from "react";
import { areaPoints, indexAt, seriesPoints, windowMean, xOf } from "../chart";
import { fmtClock, fmtTok } from "../format";
import type { SessionView } from "../types";

const W = 120;
const H = 44;

export interface MiniChartProps {
  label: string;
  values: readonly number[];
  max: number;
  format: (v: number) => string;
  /** Seconds-ago of red markers (peak chart only). */
  marks?: readonly number[];
  /** Draw the dashed 100% line. */
  limit?: boolean;
  /** Epoch ms of the newest point. */
  endTime: number;
  /** Show the mean of the newest N seconds instead of the newest second (bursty series), and say so in the tooltip. */
  avgSeconds?: number;
}

export function MiniChart(p: MiniChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const n = p.values.length;
  const last = p.avgSeconds ? windowMean(p.values, p.avgSeconds) : n ? p.values[n - 1]! : 0;
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || !Number.isFinite(e.clientX)) return;
    setHover(indexAt(e.clientX, r.left, r.width, n));
  };
  const marks = (p.marks ?? []).filter((a) => a >= 0 && a < n);
  const readout = hover === null ? p.format(last) : `${fmtClock(p.endTime - (n - 1 - hover) * 1000).slice(3)}  ${p.format(p.values[hover] ?? 0)}`;
  const peak = n ? Math.max(...p.values) : 0;
  return (
    <div className="hc">
      <div className="ht">
        <span className="hl">{p.label}</span>
        <span className="hv mono" aria-live="off" title={hover === null && p.avgSeconds ? `Average over the last ${p.avgSeconds} seconds` : undefined}>
          {readout}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${p.label}, last 60 seconds: ${p.avgSeconds ? `average of the last ${p.avgSeconds} seconds` : "now"} ${p.format(last)}, peak ${p.format(peak)}${p.marks ? `, ${marks.length} blowouts` : ""}`}
        onPointerMove={onMove}
        onMouseMove={onMove}
        onPointerLeave={() => setHover(null)}
        onMouseLeave={() => setHover(null)}
      >
        <line className="gl" x1="0" x2={W} y1="43.5" y2="43.5" />
        <line className="gl" x1="0" x2={W} y1="22" y2="22" />
        {p.limit && <line className="lim" x1="0" x2={W} y1="2" y2="2" />}
        <polyline className="area" points={areaPoints(p.values, W, H, p.max)} />
        <polyline points={seriesPoints(p.values, W, H, p.max)} />
        {marks.map((age, i) => {
          const x = xOf(n - 1 - age, n, W).toFixed(1);
          return <line key={`${age}-${i}`} className="mk" x1={x} x2={x} y1="1" y2={H} data-testid="blow-mark" />;
        })}
        {hover !== null && <line className="xh" x1={xOf(hover, n, W)} x2={xOf(hover, n, W)} y1="0" y2={H} />}
      </svg>
      <div className="hx">
        <span>60s ago</span>
        {marks.length ? <span className="cr">{`${marks.length} blowout${marks.length > 1 ? "s" : ""} in 60s`}</span> : <span>now</span>}
      </div>
    </div>
  );
}

export function MiniCharts({ s, now }: { s: SessionView; now: number }) {
  const end = (Math.floor(now / 1000) - 1) * 1000;
  return (
    <div className="hcs" aria-label="Orchestrator activity, last 60 seconds">
      <MiniChart label="Tokens per second" values={s.series.tokensPerSec} max={Math.max(1, ...s.series.tokensPerSec)} format={(v) => `${fmtTok(v)}/s`} endTime={end} avgSeconds={10} />
      <MiniChart
        label="Peak context, any loop"
        values={s.series.peakContext}
        max={1}
        format={(v) => `${Math.round(v * 100)}%`}
        marks={s.series.blowoutSecondsAgo}
        limit
        endTime={end}
      />
      <MiniChart label="Subagents running" values={s.series.running} max={Math.max(3, ...s.series.running)} format={(v) => String(v)} endTime={end} />
    </div>
  );
}
