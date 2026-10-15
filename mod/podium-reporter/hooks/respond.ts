// Responding to a waiting session from Podium (#206, SPEC 5.3): the pure parts. No `$` here. What the session accepts,
// the asks it announces (redacted and cut), what an answer from Podium turns into for Claude Code, and the lines the
// reporter writes in the transcript.
import { redact } from './failures.ts';
import {
  acceptsFor,
  RESPOND_LEVELS,
  RESPOND_LIMITS,
  type Ask,
  type AskQuestion,
  type Delivery,
  type PlanMode,
  type QuestionAnswer,
  type RespondInfo,
  type RespondLevel,
  type RespondLimit,
} from './protocol.ts';

/** The `respond` option; anything else reads as `off`. */
export function respondLevel(v: unknown): RespondLevel {
  return typeof v === 'string' && (RESPOND_LEVELS as readonly string[]).includes(v) ? (v as RespondLevel) : 'off';
}

/** Report.session.respond: the level as set, what the session takes now, and why a kind is missing. */
export function respondInfo(level: RespondLevel, activityFeed: boolean, interactive: boolean, permissionHooks: boolean | null): RespondInfo {
  const limits: RespondLimit[] = [];
  if (permissionHooks === false) limits.push('no-permission-hooks');
  if (!interactive) limits.push('not-interactive');
  return { level, accepts: acceptsFor(level, limits, activityFeed), limits };
}

/** 40000 -> "40,000". */
function thousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Redacts and cuts a text to `max`, ending a cut one with a visible marker. Line breaks are kept. */
export function cut(text: unknown, max: number): string {
  const r = redact(String(text ?? '').replace(/\r\n?/g, '\n'));
  return r.length > max ? `${r.slice(0, max)}\n\n[cut off at ${thousands(max)} characters]` : r;
}

/** A one-line field (a header, a label): redacted, line breaks folded, cut without a marker. */
function line(text: unknown, max: number): string {
  const r = redact(String(text ?? '').replace(/\s+/g, ' ').trim());
  return r.length > max ? r.slice(0, max) : r;
}

const L = RESPOND_LIMITS;

/** The questions of an AskUserQuestion call, as the ask carries them. Undefined when the input is not one Claude Code makes. */
export function askQuestions(input: Record<string, unknown>): AskQuestion[] | undefined {
  const qs = input.questions;
  if (!Array.isArray(qs) || !qs.length || qs.length > L.questions) return undefined;
  const out: AskQuestion[] = [];
  for (const q of qs) {
    if (!q || typeof q !== 'object') return undefined;
    const o = q as Record<string, unknown>;
    if (typeof o.question !== 'string' || !Array.isArray(o.options) || !o.options.length || o.options.length > L.options) return undefined;
    out.push({
      question: cut(o.question, L.question),
      header: line(o.header, L.header),
      multiSelect: o.multiSelect === true,
      options: (o.options as unknown[]).map((op) => {
        const p = (op && typeof op === 'object' ? op : {}) as Record<string, unknown>;
        return { label: line(p.label, L.label), description: cut(p.description ?? '', L.description), preview: typeof p.preview === 'string' && p.preview ? cut(p.preview, L.preview) : null };
      }),
    });
  }
  return out;
}

export function questionAsk(id: string, agentId: string | null, input: Record<string, unknown>, now: number): Ask | null {
  const questions = askQuestions(input);
  return questions ? { id, kind: 'question', agentId, openedAt: now, questions } : null;
}

/** A plan ask from ExitPlanMode's input, which carries `plan` and `planFilePath` (verified on 2.1.301). */
export function planAsk(id: string, agentId: string | null, input: Record<string, unknown>, now: number): Ask {
  const filePath = typeof input.planFilePath === 'string' && input.planFilePath ? line(input.planFilePath, 1024) : null;
  return { id, kind: 'plan', agentId, openedAt: now, plan: { text: cut(input.plan ?? '', L.plan), filePath } };
}

const cutMark = (n: number) => ` [cut off at ${thousands(n)} characters]`;
const CUT_MARK = / \[cut off at [\d,]+ characters\]$/;

/** Every string in a parsed tool input, as the container and key that hold it. */
function stringLeaves(v: unknown, out: { at: Record<string | number, unknown>; key: string | number }[] = []) {
  if (!v || typeof v !== 'object') return out;
  for (const [k, x] of Object.entries(v)) {
    const key = Array.isArray(v) ? Number(k) : k;
    if (typeof x === 'string') out.push({ at: v as Record<string | number, unknown>, key });
    else stringLeaves(x, out);
  }
  return out;
}

/**
 * A tool's arguments, redacted string by string and held to RESPOND_LIMITS.toolInput (20,000) as JSON; `cut` when
 * anything was. Past the limit the longest text is cut, with its marker, until the whole fits, and the rest is kept.
 */
export function toolInput(input: unknown): { input: Record<string, unknown>; cut: boolean } {
  let wasCut = false;
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') {
      const r = redact(v);
      if (r.length > L.toolInput) {
        wasCut = true;
        return `${r.slice(0, L.toolInput)}${cutMark(L.toolInput)}`;
      }
      return r;
    }
    if (v && typeof v === 'object') {
      if (depth > 6) {
        wasCut = true;
        return '[cut off]';
      }
      if (Array.isArray(v)) {
        if (v.length > 50) wasCut = true;
        return v.slice(0, 50).map((x) => walk(x, depth + 1));
      }
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x, depth + 1)]));
    }
    return v;
  };
  const obj = input && typeof input === 'object' && !Array.isArray(input) ? (walk(input, 0) as Record<string, unknown>) : {};
  // Each pass takes the overflow (plus room for a marker) off the longest text. JSON escaping only makes a text count
  // for more, so this shrinks the whole by at least the overflow and settles in a few passes.
  for (let pass = 0; pass < 20; pass++) {
    const over = JSON.stringify(obj).length - L.toolInput;
    if (over <= 0) break;
    const leaves = stringLeaves(obj);
    if (!leaves.length) break;
    const text = (l: (typeof leaves)[number]) => String(l.at[l.key]);
    const longest = leaves.reduce((a, b) => (text(b).length > text(a).length ? b : a));
    const raw = text(longest).replace(CUT_MARK, '');
    const keep = Math.max(0, raw.length - over - 40);
    longest.at[longest.key] = `${raw.slice(0, keep)}${cutMark(keep)}`;
    wasCut = true;
  }
  if (JSON.stringify(obj).length > L.toolInput) return { input: { note: 'The input is too long to show here.' }, cut: true };
  return { input: obj, cut: wasCut };
}

export function toolAsk(id: string, agentId: string | null, tool: string, input: unknown, now: number): Ask {
  return { id, kind: 'permission', agentId, openedAt: now, tool: { name: line(tool, 120), ...toolInput(input) } };
}

/**
 * Claude Code's `answers` map from a delivery's answers by position, against the questions as Claude asked them (not
 * the redacted copy Podium saw): an option's label, a multi-select's labels joined with ", ", or the typed text.
 * A skipped question is left out.
 */
export function answersMap(questions: readonly { question: string; options: readonly { label: string }[] }[], answers: readonly QuestionAnswer[]): Record<string, string> {
  const out: Record<string, string> = {};
  questions.forEach((q, i) => {
    const a = answers[i];
    if (!a) return;
    if ('text' in a) out[q.question] = a.text;
    else {
      const labels = a.options.map((n) => q.options[n]?.label).filter((l): l is string => typeof l === 'string');
      if (labels.length) out[q.question] = labels.join(', ');
    }
  });
  return out;
}

/**
 * The PermissionRequest decision that approves a plan from Podium. `updatedInput` is the event's own `tool_input`,
 * unchanged: without it Claude Code ignores the allow for ExitPlanMode (anthropics/claude-code#97656). A test fails if
 * it ever goes missing. The only `setMode` the reporter ever sends.
 */
export function planApproval(toolInput: unknown, mode: PlanMode) {
  return {
    decision: {
      behavior: 'allow' as const,
      updatedInput: toolInput as Record<string, unknown>,
      updatedPermissions: [{ type: 'setMode' as const, mode, destination: 'session' as const }],
    },
  };
}

/** What the reporter says when Podium denies a tool without a reason. */
export const DENIED_FROM_PODIUM = 'Denied from Podium.';

/** A tool's decision from Podium: allow once, or deny with the reason. Never `updatedPermissions`, never `interrupt`. */
export function toolDecision(d: Delivery): { decision: { behavior: 'allow' } | { behavior: 'deny'; message: string } } {
  if (d.kind === 'allow-once') return { decision: { behavior: 'allow' } };
  const message = (d.text ?? '').trim() || DENIED_FROM_PODIUM;
  return { decision: { behavior: 'deny', message } };
}

/** "No, keep planning" (or a message in place of an answer) for ExitPlanMode's tool.call. */
export function planFeedback(d: Delivery): { deny: string } {
  return { deny: (d.text ?? '').trim() || 'No, keep planning.' };
}

/** How a rejected ExitPlanMode ended in the terminal: feedback from "Tell Claude what to change", or Esc (verified on 2.1.301). */
export function planRejection(text: string | undefined): 'feedback' | 'closed' {
  return /the user said:/i.test(text ?? '') ? 'feedback' : 'closed';
}

/** Whether a tool call ended refused by a permission decision (the terminal's No, or a hook's deny), not run. */
export function toolDenied(res: { deny?: string; isError?: boolean; text?: string; result?: unknown } | null | undefined): boolean {
  if (!res) return false;
  if (res.deny !== undefined) return true;
  return res.isError === true && /doesn't want to proceed with this tool use|Denied by PermissionRequest hook|Permission to use .* (?:has been|was) denied/i.test(res.text ?? '');
}

/** A short summary of a question answered in the terminal, for Podium's "Answered in the terminal" (≤ 2,000 characters). */
export function terminalAnswers(result: unknown): string | null {
  const answers = (result as { result?: { answers?: unknown } } | null)?.result?.answers;
  if (!answers || typeof answers !== 'object') return null;
  const s = Object.values(answers as Record<string, unknown>)
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .join('; ');
  return s ? line(s, RESPOND_LIMITS.answer) : null;
}

/** `HH:MM` in the session machine's local time. */
export function clockTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const LINE_OPEN = 'also open in Podium. Answer here or there.';
export const LINE_MESSAGES_ON = 'messages from Podium are on.';

/** The transcript line after an answer from Podium, naming who sent it and when (the mockup's section 4). */
export function answeredLine(d: Delivery, at: number): string {
  const verb = {
    question: 'Answered',
    reply: 'Replied',
    'plan-approve': 'Approved',
    'plan-feedback': 'Sent back',
    'allow-once': 'Allowed once',
    deny: 'Denied',
    message: 'Sent',
    command: 'Sent',
  }[d.kind];
  return `${verb} from Podium by ${d.by} at ${clockTime(at)}`;
}
