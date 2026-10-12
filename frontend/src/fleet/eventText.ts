import type { ActivityView } from "./types";

const END_REASONS: Record<string, string> = {
  clear: "cleared",
  logout: "logged out",
  prompt_input_exit: "you exited",
  resume: "switched to another session",
};

const START_TEXT: Record<string, string> = {
  resume: "Session resumed.",
  clear: "Session started after clear.",
  compact: "Session continued after compaction.",
};

/**
 * Plain wording for the feed rows whose stored text is a raw call or a log line (#68). The text is read back
 * from what the reporter and the settings hooks wrote, so events already stored read the same way.
 * Returns null for an event that is shown as it was written.
 */
export function readableEvent(e: Pick<ActivityView, "kind" | "text" | "data">): { text: string; tool: string | null } | null {
  if (e.kind === "fail" && e.text.startsWith("orchestrator turn ended with an error after a failing call:")) {
    const tool = e.data?.tool;
    return { text: "Turn ended with an error after a failing call.", tool: typeof tool === "string" && tool ? tool : null };
  }
  const end = e.kind === "end" ? /^session\.end · (.*)$/.exec(e.text) : null;
  if (end) {
    const why = END_REASONS[end[1]];
    return { text: why ? `Session ended (${why}).` : "Session ended.", tool: null };
  }
  const start = e.kind === "start" ? /^session\.start \(settings hooks\) · (.*)$/.exec(e.text) : null;
  if (start) return { text: START_TEXT[start[1]] ?? "Session started.", tool: null };
  const spawn = e.kind === "spawn" ? /^spawned (.+) \(seen by settings hooks\)$/.exec(e.text) : null;
  if (spawn) return { text: `Spawned ${spawn[1]}.`, tool: null };
  return null;
}
