import { readJson, writeJson } from "./storage";
import type { FleetState } from "./store";

// How often the fleet page redraws from new data and moves its clock (#138). The server's events still arrive as
// they do; the page just shows the newest state once per interval to keep the GPU load down.

/** The intervals offered, in seconds; the first is the default. */
export const UPDATE_CHOICES = [2, 5, 10, 20, 30, 60] as const;
export const UPDATE_KEY = "podium.updateEvery";

/** The viewer's interval from localStorage, 2 s when there is none or it is not one of the six. */
export function readUpdateEvery(): number {
  const v = readJson<unknown>(UPDATE_KEY, UPDATE_CHOICES[0]);
  return (UPDATE_CHOICES as readonly unknown[]).includes(v) ? (v as number) : UPDATE_CHOICES[0];
}

export function writeUpdateEvery(every: number): void {
  writeJson(UPDATE_KEY, every);
}

/**
 * True when `next` holds something the viewer should not wait for: a change of connection phase, a session that
 * starts waiting for them or goes stale, or an agent that has newly failed. Everything else waits for the interval.
 */
export function isUrgentChange(held: FleetState, next: FleetState): boolean {
  if (held === next) return false;
  if (held.phase !== next.phase) return true;
  for (const s of Object.values(next.sessions)) {
    const before = held.sessions[s.id];
    if ((s.status === "waiting" || s.status === "stale") && before?.status !== s.status) return true;
    for (const a of s.agents) {
      if (a.failure && !before?.agents.find((b) => b.id === a.id)?.failure) return true;
    }
  }
  return false;
}
