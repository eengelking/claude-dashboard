// The wire types are defined once, in the server (SPEC 7.4). The UI only imports them as types.
export type {
  ActivityView,
  AgentView,
  BlowoutLogEntry,
  Effort,
  Failure,
  GitInfo,
  Kpis,
  LifecycleConfig,
  ModelFamily,
  Plan,
  PlanStep,
  RemovedReason,
  SessionStatusView,
  SessionView,
  StateBody,
} from "../../../server/src/fleet/protocol";

/** The product name, kept in one place so it can change (SPEC 12.10). */
export const APP_NAME = "Podium";
