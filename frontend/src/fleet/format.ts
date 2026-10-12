// Number, time and path formatting, ported from the mockup's helpers.

/** 999 -> "999", 1000 -> "1.0k", 123456 -> "123k", 1.5M -> "1.50M". */
export function fmtTok(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  const v = Math.max(0, n);
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + "k";
  return String(Math.round(v));
}

/** "$0.53", "$12.84", "$140". Null (no ledger) -> "–". */
export function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  const v = Math.max(0, n);
  return "$" + v.toFixed(v >= 100 ? 0 : 2);
}

/** Seconds as "m:ss" under an hour, "1h 05m" under a day, "2d 03h" beyond. */
export function fmtDur(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  if (d) return `${d}d ${String(h).padStart(2, "0")}h`;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(x).padStart(2, "0")}`;
}

/** Seconds left on a countdown: "37 s" under a minute, "1:12" after. */
export function fmtCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0));
  return s < 60 ? `${s} s` : fmtDur(s);
}

/** Epoch milliseconds as local "HH:MM:SS". */
export function fmtClock(t: number): string {
  const d = new Date(t);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((v) => String(v).padStart(2, "0")).join(":");
}

/** A whole percentage, or "–" when unknown. */
export function fmtPct(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "–";
  return `${Math.round(Math.max(0, Math.min(100, p)))}%`;
}

/** Replaces a leading home directory with "~" (the server already does this for `project`). */
export function shortenHome(p: string, home: string): string {
  if (!home) return p;
  const h = home.endsWith("/") ? home.slice(0, -1) : home;
  if (p === h) return "~";
  if (p.startsWith(h + "/")) return "~" + p.slice(h.length);
  return p;
}
