// Loads /api/fleet/state, keeps an SSE stream open, and applies every message with the pure reducer.
// Six seconds without a message (ticks arrive every 2 s) count as disconnected: the stream is closed
// and reopened, and the snapshot it sends on connect resyncs everything.
import { useEffect, useReducer } from "react";
import { fleetReducer, initialState, LEAVE_MS, type FleetState } from "./store";
import type { ActivityView, Kpis, RemovedReason, SessionView, StateBody, WallSettingsView } from "./types";

export const SILENCE_MS = 6000;
export const RECONNECT_MS = 2000;

export interface FleetSource {
  addEventListener(type: string, listener: (ev: MessageEvent) => void): void;
  close(): void;
  onerror: ((ev: Event) => void) | null;
  readonly readyState: number;
}

export interface UseFleetOptions {
  base?: string;
  /** Opens the stream; tests pass a fake. */
  open?: (url: string) => FleetSource;
  fetchState?: (url: string) => Promise<StateBody>;
}

const CLOSED = 2;

async function defaultFetchState(url: string): Promise<StateBody> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as StateBody;
}

export function useFleet(opts: UseFleetOptions = {}): FleetState {
  const [state, dispatch] = useReducer(fleetReducer, initialState);
  const base = opts.base ?? "/api/fleet";

  useEffect(() => {
    const open = opts.open ?? ((url: string) => new EventSource(url) as unknown as FleetSource);
    const fetchState = opts.fetchState ?? defaultFetchState;
    let source: FleetSource | null = null;
    let stopped = false;
    let last = Date.now();
    let reconnect: ReturnType<typeof setTimeout> | null = null;

    const parse = <T,>(ev: MessageEvent): T | null => {
      try {
        return JSON.parse(String(ev.data)) as T;
      } catch {
        return null;
      }
    };
    const scheduleReconnect = () => {
      if (stopped || reconnect) return;
      reconnect = setTimeout(() => {
        reconnect = null;
        connect();
      }, RECONNECT_MS);
    };
    const connect = () => {
      if (stopped) return;
      source?.close();
      last = Date.now();
      const s = open(`${base}/stream`);
      source = s;
      const on = <T,>(type: string, fn: (data: T, at: number) => void) =>
        s.addEventListener(type, (ev: MessageEvent) => {
          const data = parse<T>(ev);
          last = Date.now();
          if (data !== null) fn(data, last);
        });
      on<StateBody>("snapshot", (body, at) => dispatch({ type: "snapshot", body, at }));
      on<SessionView>("session", (view, at) => dispatch({ type: "session", view, at }));
      on<ActivityView>("activity", (event, at) => dispatch({ type: "activity", event, at }));
      on<{ sessionId: string; reason: RemovedReason }>("removed", (d, at) => dispatch({ type: "removed", sessionId: d.sessionId, reason: d.reason, at }));
      on<WallSettingsView>("wall", (wall, at) => dispatch({ type: "wall", wall, at }));
      on<{ serverTime: number; kpis: Kpis }>("tick", (d, at) => dispatch({ type: "tick", serverTime: d.serverTime, kpis: d.kpis, at }));
      s.onerror = () => {
        if (stopped || source !== s) return;
        dispatch({ type: "disconnected", at: Date.now() });
        // A refused or proxied error closes the stream for good; reopen it ourselves.
        if (s.readyState === CLOSED) scheduleReconnect();
      };
    };

    fetchState(`${base}/state`)
      .then((body) => {
        if (!stopped) dispatch({ type: "snapshot", body, at: Date.now() });
      })
      .catch((err: Error) => {
        if (!stopped) dispatch({ type: "error", message: err.message });
      });
    connect();

    const watchdog = setInterval(() => {
      if (Date.now() - last > SILENCE_MS) {
        dispatch({ type: "disconnected", at: Date.now() });
        source?.close();
        source = null;
        last = Date.now();
        scheduleReconnect();
      }
    }, 1000);

    return () => {
      stopped = true;
      clearInterval(watchdog);
      if (reconnect) clearTimeout(reconnect);
      source?.close();
    };
    // The connection is opened once per mount; options are read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  // Removed sessions play their leave animation, then go.
  useEffect(() => {
    const timers = Object.entries(state.leaving).map(([id, at]) =>
      setTimeout(() => dispatch({ type: "purge", sessionId: id }), Math.max(0, LEAVE_MS - (Date.now() - at))),
    );
    return () => timers.forEach(clearTimeout);
  }, [state.leaving]);

  return state;
}

/** Remove on a heartbeat-lost card: the server drops it from the live set and tells every open tab. */
export async function removeSession(id: string, base = "/api/fleet"): Promise<void> {
  const res = await fetch(`${base}/sessions/${encodeURIComponent(id)}/drop`, { method: "POST" });
  // 404 and 409 mean it already left or is reporting again: the stream shows the truth, nothing to report.
  if (!res.ok && res.status !== 404 && res.status !== 409) throw new Error(`HTTP ${res.status}`);
}

/** Closing a wall notice turns it off for everyone; it takes no token, like Remove. */
export async function closeNotice(id: string, base = "/api/fleet"): Promise<void> {
  const res = await fetch(`${base}/notices/${encodeURIComponent(id)}/close`, { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** The Show them / Hide them link on the background-sessions note changes the same setting as Admin > Settings. */
export async function setShowBackgroundSessions(show: boolean, base = "/api/fleet"): Promise<void> {
  const res = await fetch(`${base}/wall/background-sessions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ show }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
