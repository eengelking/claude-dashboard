// What the console shows for responding to a waiting session (#206, mockup/podium-respond.html), worked out from one
// SessionView, the Admin's flags and who is signed in. Pure: the components draw what these say.
import { cardKind } from "./components/Chips";
import { LEVEL_KINDS } from "../../../server/src/fleet/protocol";
import type { AskDetail, AskKind, AskSummary, Delivery, QuestionAnswer, RespondKind, RespondMe, SessionView } from "./types";

/** The ask the band and the modal are about: the newest open one, the main loop's first. */
export function openAsk(s: Pick<SessionView, "asks">): AskSummary | null {
  const open = s.asks.filter((a) => a.state !== "closed");
  const pick = (list: AskSummary[]) => list.slice().sort((a, b) => b.openedAt - a.openedAt)[0] ?? null;
  return pick(open.filter((a) => a.agentId === null)) ?? pick(open);
}

/** The ask the modal shows: the open one, else the one that closed last (its outcome still shows for a while). */
export function shownAsk(s: Pick<SessionView, "asks">): AskSummary | null {
  return openAsk(s) ?? s.asks.slice().sort((a, b) => b.openedAt - a.openedAt)[0] ?? null;
}

/** What answering an ask of this kind needs the session to accept; a turn that ended needs `message`. */
export function neededKinds(kind: AskKind | null): RespondKind[] {
  if (kind === "question") return ["question"];
  if (kind === "plan") return ["plan-approve", "plan-feedback"];
  if (kind === "permission") return ["permission"];
  return ["message"];
}

/**
 * Whether this session can take an answer for an ask of this kind: `ok`; `off` when a switch is off (the Admin's, the
 * session's `respond` level, or its activity feed); `old` when the reporter can't (too old, settings hooks, a `claude -p`
 * run, or PermissionRequest hooks that don't run there).
 */
/**
 * Why a session can't take an answer (canAnswer said `old`): the settings hooks, a reporter older than 0.14.0, a
 * `claude -p` run, or PermissionRequest hooks that don't run there (an organization manages Claude Code).
 */
export type CantReason = "hooks" | "old" | "print" | "managed";
export function cantReason(s: Pick<SessionView, "reporter" | "respond">): CantReason {
  if (s.reporter !== "mod") return "hooks";
  if (!s.respond) return "old";
  if (s.respond.limits.includes("not-interactive")) return "print";
  return "managed";
}

export function canAnswer(s: Pick<SessionView, "reporter" | "respond">, kind: AskKind | null): "ok" | "off" | "old" {
  if (s.reporter !== "mod" || !s.respond) return "old";
  const need = neededKinds(kind);
  if (need.some((k) => s.respond!.accepts.includes(k))) return "ok";
  if (s.respond.limits.includes("not-interactive")) return "old";
  // The level would allow it, so a limit took it away: the reporter can't, rather than a switch being off.
  if (s.respond.accepts.length && need.some((k) => LEVEL_KINDS[s.respond!.level].includes(k))) return "old";
  return "off";
}

/** A plan this session can only send back: approving is not possible here (no PermissionRequest hooks). */
export function planBackOnly(s: Pick<SessionView, "respond">): boolean {
  return !!s.respond && s.respond.accepts.includes("plan-feedback") && !s.respond.accepts.includes("plan-approve");
}

/** A name as the server compares it (`nameKey` in server/src/fleet/people.ts): trimmed, spaces folded, any case. */
export const nameKey = (n: string) => n.trim().replace(/ +/g, " ").toLowerCase();

/** Whether the signed-in person may respond to this session: its owner, or an Admin. A session owned by Admin needs an Admin. */
export function isMine(s: Pick<SessionView, "owner">, me: RespondMe | null): boolean {
  if (!me?.signedIn || !me.name) return false;
  if (me.admin) return true;
  return !!s.owner && s.owner !== "Admin" && nameKey(s.owner) === nameKey(me.name);
}

/** The Respond button on a band: gone, live, or dimmed with whose session it is (mockup section 1, "Rules for the button"). */
export type RespondGate = { show: "none" } | { show: "live"; count: string } | { show: "dimmed"; count: string; owner: string };

export function respondGate(s: SessionView, me: RespondMe | null, flagsOn: boolean): RespondGate {
  if (!flagsOn || !me?.enabled) return { show: "none" };
  // Only while the session waits on its person: not on a blue band (background work), and not while it runs.
  if (cardKind(s) !== "waiting") return { show: "none" };
  const ask = openAsk(s);
  if (canAnswer(s, ask?.kind ?? null) !== "ok") return { show: "none" };
  const count = ask?.kind === "question" && ask.count > 0 ? String(ask.count) : "";
  // Signed out, Podium doesn't know whose sessions are yours, so the button stays live and leads to signing in.
  if (me.signedIn && !isMine(s, me)) return { show: "dimmed", count, owner: s.owner ?? "Unassigned" };
  return { show: "live", count };
}

/** "0:42", for "asked 0:42 ago" and "Last check-in 0:45 ago". */
export function minSec(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

/** "12:23", this browser's local time. */
export function clockOf(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The word for an ask in the mockup's sentences: a question, a plan, a request. */
export const ASK_WORD: Record<AskKind, string> = { question: "question", plan: "plan", permission: "request" };

/** What the panel's header leads with. */
export function askLead(kind: AskKind | null): string {
  return kind === "plan" || kind === "permission" ? "Waiting for your approval." : "Waiting for your input.";
}

export const PLAN_LABELS = { auto: "Yes, and use auto mode", acceptEdits: "Yes, auto-accept edits", default: "Yes, manually approve edits" } as const;

/** A question's answers as the panel quotes them: each answered question's options (", ") or text, joined with "; ". */
export function questionAnswers(detail: Pick<AskDetail, "ask">, answers: readonly QuestionAnswer[]): string {
  return (detail.ask.questions ?? [])
    .map((q, i) => {
      const a = answers[i];
      if (!a) return "";
      if ("text" in a) return a.text.trim();
      return a.options.map((n) => cleanLabel(q.options[n]?.label ?? "").label).join(", ");
    })
    .filter(Boolean)
    .join("; ");
}

/** An answer as the panel quotes it in "Sending to …" and "Their answer was taken first". */
export function deliverySummary(detail: Pick<AskDetail, "ask">, d: Delivery): string {
  switch (d.kind) {
    case "question":
      return questionAnswers(detail, d.answers ?? []);
    case "plan-approve":
      return PLAN_LABELS[d.mode ?? "auto"];
    case "plan-feedback":
      return "No, keep planning";
    case "allow-once":
      return "Allow once";
    case "deny":
      return "Deny";
    default:
      return (d.text ?? "").trim();
  }
}

/** Claude Code marks a recommended option by ending its label with "(Recommended)": shown as a tag instead. */
export function cleanLabel(label: string): { label: string; recommended: boolean } {
  const m = /^(.*?)\s*\(Recommended\)\s*$/i.exec(label);
  return m ? { label: m[1]!, recommended: true } : { label, recommended: false };
}

/** The two commands Podium can send, as the typeahead lists them. */
export const COMMANDS = [
  { name: "/clear", desc: "Start over with an empty conversation" },
  { name: "/compact", desc: "Summarize the conversation to free context" },
] as const;

/** "two", "three": the review footer's count, as the mockup words it. */
export function countWord(n: number): string {
  return ["zero", "one", "two", "three", "four"][n] ?? String(n);
}
