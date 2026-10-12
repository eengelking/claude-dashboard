import type { SessionView } from "./types";

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
