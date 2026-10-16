// The fleet state the UI renders, and the pure reducer that applies server messages to it.
import type { ActivityView, Kpis, LifecycleConfig, RemovedReason, SessionView, StateBody, WallSettingsView } from "./types";

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
  /** The wall's notice switches and background-session setting, set in Admin > Settings. */
  wall: WallSettingsView;
  /** The Admin's feature flags by id (Admin > Settings > Feature flags). A flag missing here counts as on. */
  features: Record<string, boolean>;
}

export type FleetAction =
  | { type: "snapshot"; body: StateBody }
  | { type: "session"; view: SessionView }
  | { type: "activity"; event: ActivityView }
  | { type: "removed"; sessionId: string; reason: RemovedReason; at: number }
  | { type: "wall"; wall: WallSettingsView }
  | { type: "tick"; serverTime: number; kpis: Kpis }
  | { type: "disconnected"; at: number }
  | { type: "error"; message: string }
  | { type: "purge"; sessionId: string };

export const initialState: FleetState = {
  phase: "loading",
  error: null,
  serverTime: 0,
  config: { staleAfterMs: 15_000, dropAfterMs: 60_000, lingerMs: 8_000, detachedHideAfterMs: 60_000 },
  sessions: {},
  leaving: {},
  gone: {},
  kpis: null,
  clearedToday: 0,
  events: [],
  server: null,
  wall: { notices: {}, showBackgroundSessions: false },
  features: {},
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

function live(): Pick<FleetState, "phase" | "error"> {
  return { phase: "live", error: null };
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
        ...live(),
        serverTime: action.body.serverTime,
        config: action.body.config ?? state.config,
        sessions,
        leaving: {},
        gone,
        kpis: action.body.kpis,
        clearedToday: action.body.clearedToday,
        events: capEvents(action.body.events),
        server: action.body.server ?? state.server,
        wall: action.body.wall ?? state.wall,
        features: action.body.features ?? state.features,
      };
    }
    case "session": {
      const { [action.view.id]: _leaving, ...leaving } = state.leaving;
      const { [action.view.id]: _gone, ...gone } = state.gone;
      return {
        ...state,
        ...live(),
        sessions: { ...state.sessions, [action.view.id]: action.view },
        leaving,
        gone,
      };
    }
    case "activity": {
      if (state.events.some((e) => e.id === action.event.id)) return { ...state, ...live() };
      return { ...state, ...live(), events: capEvents([action.event, ...state.events]) };
    }
    case "removed": {
      const known = !!state.sessions[action.sessionId];
      return {
        ...state,
        ...live(),
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
    case "wall":
      return { ...state, ...live(), wall: action.wall };
    case "tick":
      return { ...state, ...live(), serverTime: action.serverTime, kpis: action.kpis };
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

/** Reporters currently live: sessions still on screen that have not gone stale. Both top bars show this. */
export function reportersLive(sessions: Record<string, SessionView>, leaving: Record<string, number>): number {
  return Object.values(sessions).filter((s) => !leaving[s.id] && s.status !== "stale").length;
}
