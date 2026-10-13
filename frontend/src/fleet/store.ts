// The fleet state the UI renders, and the pure reducer that applies server messages to it.
import type { ActivityView, CacheAlertsView, Kpis, LifecycleConfig, RemovedReason, SessionView, StateBody } from "./types";

/** At most this many activity events are kept in memory (SPEC 8.1). */
export const EVENT_CAP = 150;

/** How long a removed session stays on screen for its leave animation. */
export const LEAVE_MS = 600;

export type Phase = "loading" | "live" | "disconnected";

export interface FleetState {
  phase: Phase;
  /** Why the first load failed, until a message arrives. */
  error: string | null;
  serverTime: number;
  /** Local time of the last message from the server. */
  lastMessageAt: number;
  config: LifecycleConfig;
  sessions: Record<string, SessionView>;
  /** Sessions that left the live set and are playing their leave animation, with when it started. */
  leaving: Record<string, number>;
  /** Sessions that left the live set: their activity rows are greyed and inert. */
  gone: Record<string, RemovedReason>;
  kpis: Kpis | null;
  clearedToday: number;
  /** Newest first, at most EVENT_CAP. */
  events: ActivityView[];
  /** The server's version and the reporter range it supports; null until the first snapshot. */
  server: StateBody["server"] | null;
  /** The cooling-alert counter (#27); null until the first snapshot or from a server that predates it. */
  cacheAlerts: CacheAlertsView | null;
}

export type FleetAction =
  | { type: "snapshot"; body: StateBody; at: number }
  | { type: "session"; view: SessionView; at: number }
  | { type: "activity"; event: ActivityView; at: number }
  | { type: "removed"; sessionId: string; reason: RemovedReason; at: number }
  | { type: "tick"; serverTime: number; kpis: Kpis; cacheAlerts?: CacheAlertsView; at: number }
  | { type: "disconnected"; at: number }
  | { type: "error"; message: string }
  | { type: "purge"; sessionId: string };

export const initialState: FleetState = {
  phase: "loading",
  error: null,
  serverTime: 0,
  lastMessageAt: 0,
  config: { staleAfterMs: 15_000, dropAfterMs: 60_000, lingerMs: 8_000, detachedHideAfterMs: 60_000 },
  sessions: {},
  leaving: {},
  gone: {},
  kpis: null,
  clearedToday: 0,
  events: [],
  server: null,
  cacheAlerts: null,
};

function capEvents(list: ActivityView[]): ActivityView[] {
  const seen = new Set<string>();
  const out: ActivityView[] = [];
  for (const e of list.slice().sort((a, b) => b.t - a.t)) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
    if (out.length >= EVENT_CAP) break;
  }
  return out;
}

function live(state: FleetState, at: number): Pick<FleetState, "phase" | "error" | "lastMessageAt"> {
  return { phase: "live", error: null, lastMessageAt: Math.max(state.lastMessageAt, at) };
}

export function fleetReducer(state: FleetState, action: FleetAction): FleetState {
  switch (action.type) {
    case "snapshot": {
      const sessions: Record<string, SessionView> = {};
      for (const s of action.body.sessions) sessions[s.id] = s;
      // Sessions the client knew that the snapshot lacks have left while it was away.
      const gone: Record<string, RemovedReason> = {};
      for (const id of Object.keys(state.sessions)) if (!sessions[id]) gone[id] = "done";
      for (const [id, why] of Object.entries(state.gone)) if (!sessions[id]) gone[id] = why;
      for (const e of action.body.events) if (!sessions[e.sessionId] && !gone[e.sessionId]) gone[e.sessionId] = "done";
      return {
        ...state,
        ...live(state, action.at),
        serverTime: action.body.serverTime,
        config: action.body.config ?? state.config,
        sessions,
        leaving: {},
        gone,
        kpis: action.body.kpis,
        clearedToday: action.body.clearedToday,
        events: capEvents(action.body.events),
        server: action.body.server ?? state.server,
        cacheAlerts: action.body.cacheAlerts ?? state.cacheAlerts,
      };
    }
    case "session": {
      const { [action.view.id]: _leaving, ...leaving } = state.leaving;
      const { [action.view.id]: _gone, ...gone } = state.gone;
      return {
        ...state,
        ...live(state, action.at),
        sessions: { ...state.sessions, [action.view.id]: action.view },
        leaving,
        gone,
      };
    }
    case "activity": {
      if (state.events.some((e) => e.id === action.event.id)) return { ...state, ...live(state, action.at) };
      return { ...state, ...live(state, action.at), events: capEvents([action.event, ...state.events]) };
    }
    case "removed": {
      const known = !!state.sessions[action.sessionId];
      return {
        ...state,
        ...live(state, action.at),
        leaving: known ? { ...state.leaving, [action.sessionId]: action.at } : state.leaving,
        gone: { ...state.gone, [action.sessionId]: action.reason },
        clearedToday: state.clearedToday + (action.reason === "deleted" ? 0 : 1),
      };
    }
    case "purge": {
      if (!state.leaving[action.sessionId]) return state;
      const { [action.sessionId]: _s, ...sessions } = state.sessions;
      const { [action.sessionId]: _l, ...leaving } = state.leaving;
      return { ...state, sessions, leaving };
    }
    case "tick":
      return { ...state, ...live(state, action.at), serverTime: action.serverTime, kpis: action.kpis, cacheAlerts: action.cacheAlerts ?? state.cacheAlerts };
    case "disconnected":
      return state.phase === "disconnected" ? state : { ...state, phase: "disconnected" };
    case "error":
      return { ...state, error: action.message };
    default:
      return state;
  }
}

/** Sessions on screen: live ones plus those playing their leave animation. */
export function visibleSessions(state: FleetState): SessionView[] {
  return Object.values(state.sessions);
}
