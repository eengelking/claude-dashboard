// The wire types are defined once, in the server (SPEC 7.4). The UI only imports them as types.
export type {
  ActivityView,
  AgentView,
  BlowoutLogEntry,
  ChangedFile,
  Effort,
  Failure,
  FilesReport,
  GitInfo,
  HistoryRow,
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
export const COPYRIGHT = "© 2026 Ed Engelking";
const REPO = "https://github.com/eengelking/podium/blob/main";
export const LICENSE_URL = `${REPO}/LICENSE`;
export const NOTICES_URL = `${REPO}/THIRD_PARTY_NOTICES.md`;
