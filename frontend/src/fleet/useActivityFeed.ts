import { useEffect, useRef, useState } from "react";
import { readJson, writeJson } from "./storage";
import type { ActivityEntryView, ActivityReply } from "./types";
import { usePageVisible } from "./usePageVisible";

// The agent activity feed's fetching (#118). The server keeps a loop's entries only while a viewer holds a lease on
// it, and every fetch renews that lease. So this fetches only while the panel is mounted (the modal belongs to it),
// the feed is on and the tab is visible, on the viewer's own interval. It shows only entries that arrived after its
// first answer: entries another viewer was already watching are not backfilled.
//
// The Admin can turn the feed off for the whole server (Admin > Settings > Feature flags). A reply then says
// `enabled: false`: the hook drops what it showed and reports `adminOff`, but keeps asking at the same interval, so the
// feed comes back by itself when the flag is turned on again.

export type { ActivityReply };
export type FetchActivity = (sessionId: string, loop: string, every: number) => Promise<ActivityReply>;

/** The intervals offered, in seconds; the first is the default. The server takes the same five. */
export const EVERY_CHOICES = [5, 10, 20, 30, 60] as const;
export const EVERY_KEY = "podium.activityEvery";
/** Entries shown, as the server keeps. */
export const FEED_KEPT = 20;

const defaultFetch: FetchActivity = async (sessionId, loop, every) => {
  const res = await fetch(`/api/fleet/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(loop)}/activity?every=${every}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ActivityReply;
};

/** The viewer's interval from localStorage, 5 s when there is none or it is not one of the five. */
export function readEvery(): number {
  const v = readJson<unknown>(EVERY_KEY, EVERY_CHOICES[0]);
  return (EVERY_CHOICES as readonly unknown[]).includes(v) ? (v as number) : EVERY_CHOICES[0];
}

export function writeEvery(every: number): void {
  writeJson(EVERY_KEY, every);
}

export interface FeedState {
  /** The last 20 entries since this viewer started watching, oldest first. */
  entries: ActivityEntryView[];
  /** How many arrived since this viewer started watching. */
  seen: number;
  /** When the last answer came, by this browser's clock; null before the first. */
  fetchedAt: number | null;
  /** The last fetch failed; the next one is still scheduled. */
  failed: boolean;
  /** False when the server says the session is not live: nothing will come. */
  live: boolean;
  /** The last reply said the Admin has turned the feed off for this server. */
  adminOff: boolean;
}

const EMPTY: FeedState = { entries: [], seen: 0, fetchedAt: null, failed: false, live: true, adminOff: false };

export function useActivityFeed(opts: {
  sessionId: string;
  loop: string;
  /** The reporter can send a feed: the option is on (or not known to be off) and the mod is new enough. */
  enabled: boolean;
  /** The loop is still working. A finished one is fetched once more, for its last entries, and then left alone. */
  active: boolean;
  every: number;
  /**
   * The Admin's flag as the console's state last said (true when not known). It only matters when it changes: the hook
   * asks again at once, so the panel follows a flip without waiting out the interval.
   */
  adminOn?: boolean;
  /** Changed by the caller to ask again at once: after sending from Podium, so its entry shows without waiting (#206). */
  nudge?: number;
  fetchActivity?: FetchActivity;
}): FeedState {
  const { sessionId, loop, enabled, active, every } = opts;
  const adminOn = opts.adminOn ?? true;
  const visible = usePageVisible();
  const [state, setState] = useState<FeedState>(EMPTY);
  const fetchRef = useRef(opts.fetchActivity ?? defaultFetch);
  fetchRef.current = opts.fetchActivity ?? defaultFetch;
  // The highest `seq` already taken, and the lease it belongs to. Null until the first answer for this loop.
  const cursor = useRef<{ since: number | null; seq: number } | null>(null);

  useEffect(() => {
    cursor.current = null;
    setState(EMPTY);
  }, [sessionId, loop]);

  useEffect(() => {
    if (!enabled || !visible) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetchRef.current(sessionId, loop, every);
        if (cancelled) return;
        // Turned off by the Admin: the server holds nothing for us now, so neither do we. The next lease starts afresh.
        if (r.enabled === false) {
          cursor.current = null;
          setState({ ...EMPTY, fetchedAt: Date.now(), live: r.live, adminOff: true });
          return;
        }
        const top = r.entries.reduce((n, e) => Math.max(n, e.seq), 0);
        const c = cursor.current;
        // A first answer, or a lease the server started afresh (seq counts from 1 again): what it holds already
        // happened before this viewer was watching, so it is skipped rather than backfilled.
        if (!c || c.since !== r.since) {
          cursor.current = { since: r.since, seq: top };
          setState((st) => ({ ...st, fetchedAt: Date.now(), failed: false, live: r.live, adminOff: false }));
          return;
        }
        const fresh = r.entries.filter((e) => e.seq > c.seq);
        cursor.current = { since: r.since, seq: Math.max(c.seq, top) };
        // An entry sent from Podium can change after it arrives (its note) or go (discarded, or never taken): follow
        // the server for those still in its window.
        const bySeq = new Map(r.entries.map((e) => [e.seq, e]));
        const low = r.entries.length ? r.entries[0]!.seq : Infinity;
        const synced = (list: ActivityEntryView[]) => list.filter((e) => e.kind !== "podium" || e.seq < low || bySeq.has(e.seq)).map((e) => (e.kind === "podium" ? (bySeq.get(e.seq) ?? e) : e));
        setState((st) => ({
          entries: [...synced(st.entries), ...fresh].slice(-FEED_KEPT),
          seen: st.seen + fresh.length,
          fetchedAt: Date.now(),
          failed: false,
          live: r.live,
          adminOff: false,
        }));
      } catch {
        if (!cancelled) setState((st) => ({ ...st, failed: true }));
      }
    };
    void tick();
    const timer = active ? setInterval(() => void tick(), every * 1000) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [sessionId, loop, enabled, visible, active, every, adminOn, opts.nudge]);

  return state;
}
