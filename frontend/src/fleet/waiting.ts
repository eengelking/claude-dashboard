import { fmtClock } from "./format";
import type { BackgroundWait, SessionView } from "./types";

type WaitReason = SessionView["waitReason"];

/** The reporter and the settings hooks write a waiting event as this prefix plus the tool call or message. */
const WAIT_PREFIX = "waiting on you: ";

// A question arrives as a permission wait like any tool, but what the person does is answer it.
const QUESTION_TOOLS = new Set(["AskUserQuestion"]);

/** The one pair of sentences the card, the orchestrator callout and the activity feed all use. */
export function waitLead(reason: WaitReason, tool: string | null, past = false): string {
  const input = (tool !== null && QUESTION_TOOLS.has(tool)) || reason === "input";
  if (!input && reason !== "permission") return past ? "Waited on you." : "Waiting on you.";
  const what = input ? "input" : "approval";
  return past ? `Waited for your ${what}.` : `Waiting for your ${what}.`;
}

/** The tool a wait note names: "Tool(input...)" from the mod, or a bare name from a settings hook's PermissionRequest. */
export function toolOfNote(note: string, reason: WaitReason): string | null {
  // A bare word must look like a tool name (Bash, mcp__x__y), so a hook's "permission_prompt" or "idle_prompt" type is not taken for one.
  const m = /^([A-Za-z][\w.:-]*)\(/.exec(note) ?? (reason === "permission" ? /^((?:[A-Z][\w.:-]*)|(?:mcp__[\w.:-]+))$/.exec(note) : null);
  return m ? m[1] : null;
}

/** Reads a waiting event's text, or returns null when the event is not a waiting one. */
export function parseWaitEvent(text: string): { reason: "permission" | "input"; tool: string | null } | null {
  if (!text.startsWith(WAIT_PREFIX)) return null;
  const note = text.slice(WAIT_PREFIX.length).trim();
  const tool = toolOfNote(note, "permission");
  if (tool) return { reason: QUESTION_TOOLS.has(tool) ? "input" : "permission", tool };
  // A notification message or a bare "permission": the words say which kind of wait it was.
  return { reason: note === "" || /permission/i.test(note) ? "permission" : "input", tool: null };
}

// ---- Idle on background work (#119, mockup/podium-background-wait.html) ----------------------------------------------

/** A waiting session whose only wait is on background work or a wake-up, not on the person. */
export function idleOnBackground(s: Pick<SessionView, "status" | "waitReason" | "background">): s is typeof s & { background: BackgroundWait } {
  return s.status === "waiting" && s.waitReason === null && s.background !== null;
}

/** The reporter writes this prefix plus counts ("1 shell, 1 agent") for the activity row of a background wait. */
const WAIT_BG_PREFIX = "waiting on background: ";

const KIND_WORD: Record<string, [string, string]> = {
  shell: ["background shell", "background shells"],
  agent: ["background agent", "background agents"],
  monitor: ["background monitor", "background monitors"],
  workflow: ["background workflow", "background workflows"],
  other: ["background task", "background tasks"],
};

function listOf(parts: string[]): string {
  return parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function sentence(counts: [string, number][], past: boolean, wakeAt: number | null): string {
  const tasks = counts.filter(([k]) => k !== "wakeup");
  if (!tasks.length) {
    const at = wakeAt === null ? "" : ` at ${fmtClock(wakeAt).slice(0, 5)}`;
    return past ? `Waited for a scheduled wake-up${at}.` : `Waiting for a scheduled wake-up${at}.`;
  }
  const what = listOf(tasks.map(([k, n]) => `${n} ${(KIND_WORD[k] ?? KIND_WORD.other!)[n === 1 ? 0 : 1]}`));
  return past ? `Waited for ${what} to finish.` : `Waiting for ${what} to finish.`;
}

function countsOf(b: BackgroundWait): [string, number][] {
  const n = new Map<string, number>();
  for (const t of b.tasks) n.set(t.type, (n.get(t.type) ?? 0) + 1);
  return [...n];
}

/** "Waiting for 1 background shell to finish." or, with only a wake-up, "Waiting for a scheduled wake-up at 14:30." */
export function backgroundLead(b: BackgroundWait): string {
  return sentence(countsOf(b), false, b.wakeAt);
}

/** The short status beside the dot: "waiting on shell", "waiting on 2 tasks", "wakes at 14:30". */
export function backgroundStatus(b: BackgroundWait): string {
  const c = countsOf(b);
  const tasks = c.filter(([k]) => k !== "wakeup");
  if (!tasks.length) return b.wakeAt === null ? "waiting on wake-up" : `wakes at ${fmtClock(b.wakeAt).slice(0, 5)}`;
  if (c.length === 1 && c[0]![1] === 1) return `waiting on ${c[0]![0]}`;
  return `waiting on ${b.tasks.length} tasks`;
}

/** At most this many characters of a task description; the callout cuts there and ends with " ...". */
export const BACKGROUND_DETAIL_LIMIT = 64;

/** The description row of the callout: "Shell: nightly build", several tasks joined by " · ", cut at the limit. */
export function backgroundDetail(b: BackgroundWait): string | null {
  const label = (k: string) => (k === "wakeup" ? "Wake-up" : k === "other" ? "Task" : k[0]!.toUpperCase() + k.slice(1));
  const text = b.tasks.map((t) => `${label(t.type)}: ${t.description}`).join(" · ");
  if (!text.trim()) return null;
  return text.length <= BACKGROUND_DETAIL_LIMIT ? text : `${text.slice(0, BACKGROUND_DETAIL_LIMIT).trimEnd()} ...`;
}

/** What a session lists in its status tooltip: each task and its description, whole. */
export function backgroundTitle(b: BackgroundWait): string {
  return `${backgroundLead(b)} Not waiting on you. ${b.tasks.map((t) => `${t.type}: ${t.description}`).join(" · ")}`.trim();
}

/** Reads a background wait's activity text, or returns null when the event is not one. */
export function parseBackgroundEvent(text: string): { counts: [string, number][]; pill: string } | null {
  if (!text.startsWith(WAIT_BG_PREFIX)) return null;
  const counts: [string, number][] = [];
  for (const part of text.slice(WAIT_BG_PREFIX.length).split(",")) {
    const m = /^\s*(\d+) (\w+)\s*$/.exec(part);
    if (m) counts.push([m[2]!, Number(m[1])]);
  }
  if (!counts.length) return null;
  const pill = counts.map(([k]) => (k === "wakeup" ? "wake-up" : k)).join(" + ");
  return { counts, pill };
}

/** The sentence for a background wait row; `past` once the session has moved on. */
export function backgroundEventLead(counts: [string, number][], past: boolean): string {
  return sentence(counts, past, null);
}
