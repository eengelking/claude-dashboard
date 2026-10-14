// Failure classification, excerpts and redaction (SPEC 6.4). Pure: no `$` here.
import type { Failure, FailureClass } from './protocol.ts';

export const LIMITS = {
  call: 300,
  line: 240,
  outputLines: 12,
  evidenceLines: 5,
  excerpt: 400,
  /** The whole prompt or answer, when the fullPrompts option is on. */
  fullText: 20_000,
  text: 240,
  /** One activity-feed entry (#118). */
  activity: 300,
  /** A candidate older than this when its loop fails is not the cause. */
  candidateMaxAgeMs: 60_000,
} as const;

const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /Bearer [A-Za-z0-9._-]{20,}/g,
];
// `password=hunter2`, `token: abc`, `"api_key": "abc"`: keep the key, redact the value.
const KEY_VALUE = /((?:password|passwd|token|secret|apikey|api_key)["']?\s*[=:]\s*["']?)([^\s"'&,;]+)/gi;

/** Replaces anything that looks like a secret with `[redacted]`. */
export function redact(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]');
  return out.replace(KEY_VALUE, (_m, key: string) => `${key}[redacted]`);
}

/** Redacts, then cuts to `max` characters. */
export function clip(text: string, max: number): string {
  const r = redact(text);
  return r.length > max ? r.slice(0, max) : r;
}

/** The first 400 characters with whitespace collapsed, redacted. */
export function excerpt(text: string | null | undefined, max: number = LIMITS.excerpt): string {
  if (!text) return '';
  return clip(String(text).replace(/\s+/g, ' ').trim(), max);
}

const CUT_MARKER = '\n\n[cut off at 20,000 characters]';

/** The whole text redacted, line breaks kept, cut to 20,000 characters with a visible marker. */
export function fullText(text: string | null | undefined): string {
  if (!text) return '';
  const r = redact(String(text).replace(/\r\n?/g, '\n')).trim();
  return r.length > LIMITS.fullText ? r.slice(0, LIMITS.fullText) + CUT_MARKER : r;
}

/** The last `n` lines of a text, each redacted and cut to 240 characters. */
export function tailLines(text: string | null | undefined, n: number = LIMITS.outputLines): string[] {
  if (!text) return [];
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
  return lines.slice(-n).map((l) => clip(l, LIMITS.line));
}

/** The exit code a Bash error result reports in its text ("Exit code 1"), best effort. */
export function parseExitCode(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /(?:exit code|exit status|exited with(?: code)?)[\s:]*(-?\d{1,3})\b/i.exec(text);
  return m ? Number(m[1]) : null;
}

/** A one-line summary of a tool call (SPEC 6.4): Bash -> the command; Edit/Read/Write -> tool + path. */
export function summarizeCall(tool: string, input: Record<string, unknown>): string {
  const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));
  let s: string;
  if (tool === 'Bash') s = str(input.command);
  else if (tool === 'Edit' || tool === 'Read' || tool === 'Write' || tool === 'NotebookEdit' || tool === 'MultiEdit') s = `${tool} ${str(input.file_path ?? input.notebook_path)}`.trim();
  else {
    const first = Object.entries(input).find(([k]) => k !== 'tool' && k !== 'tool_use_id' && k !== 'agentId' && k !== 'requestMeta');
    s = first ? `${tool} ${str(first[1])}` : tool;
  }
  return clip(s.replace(/\s+/g, ' ').trim(), LIMITS.call);
}

/** How much raw text an activity entry is built from: more than enough for 300 characters after redaction, and a bound on the work. */
const ACTIVITY_RAW = 4000;
const FILE_TOOLS = new Set(['Edit', 'Read', 'Write', 'NotebookEdit', 'MultiEdit']);
const ENGINE_KEYS = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta']);

/**
 * One activity-feed entry for a tool call (#118): the tool's name, a space, and a short summary of its arguments.
 * Bash: the command; file tools: the path; Grep: the pattern and where; Agent: the description; Skill: the skill;
 * anything else: its first argument. Redacted, whitespace collapsed, cut to 300 characters.
 */
export function activityCall(tool: string, input: Record<string, unknown>): string {
  const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v) ?? '');
  let arg: string;
  if (tool === 'Bash') arg = str(input.command);
  else if (FILE_TOOLS.has(tool)) arg = str(input.file_path ?? input.notebook_path);
  else if (tool === 'Grep' || tool === 'Glob') arg = `${tool === 'Grep' ? `"${str(input.pattern)}"` : str(input.pattern)}${input.path ? ` in ${str(input.path)}` : ''}`;
  else if (tool === 'Agent') arg = str(input.description);
  else if (tool === 'Skill') arg = str(input.skill);
  else {
    const first = Object.entries(input).find(([k]) => !ENGINE_KEYS.has(k));
    arg = first ? str(first[1]) : '';
  }
  return clip(flatten(`${tool} ${arg}`), LIMITS.activity);
}

/**
 * Whitespace collapsed first, then cut to ACTIVITY_RAW, so redaction always sees whole what the entry can show: a
 * secret is never cut into a stub that no longer matches, even after a long run of whitespace before it.
 */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, ACTIVITY_RAW);
}

/** One activity-feed entry for the text a model request wrote: whitespace collapsed, redacted, cut to 300 characters. Empty for text that is only whitespace. */
export function activityText(text: string): string {
  return clip(flatten(text), LIMITS.activity);
}

export interface FailureCandidate {
  at: number;
  tool: string;
  call: string;
  exitCode: number | null;
  outputTail: string[];
  denied: boolean;
  denyText: string | null;
}

/** Builds a candidate from a tool result that errored or was denied. */
export function candidateFrom(
  tool: string,
  input: Record<string, unknown>,
  result: { deny?: string; isError?: boolean; text?: string; result?: unknown },
  at: number,
): FailureCandidate | null {
  const denied = typeof result.deny === 'string';
  if (!denied && result.isError !== true) return null;
  const text = denied ? result.deny! : typeof result.text === 'string' ? result.text : typeof result.result === 'string' ? result.result : '';
  return {
    at,
    tool,
    call: summarizeCall(tool, input),
    exitCode: denied ? null : parseExitCode(text),
    outputTail: tailLines(text),
    denied,
    denyText: denied ? clip(text.replace(/\s+/g, ' ').trim(), LIMITS.line) : null,
  };
}

export type EndReason = 'answer' | 'aborted' | 'refusal' | 'error';

export interface ClassifyInput {
  reason: EndReason;
  candidate: FailureCandidate | null;
  /** The loop's last model stop reason. */
  stopReason: string | null;
  blowouts: number;
  now: number;
}

/**
 * The failure class for a loop that ended with `error`, `refusal` or `aborted` (SPEC 6.4); null for
 * `answer` (a loop that answered is done, and its candidate is discarded).
 *
 * Order: a denial, a refusal, an exhausted context window, an API error with no failing call, an
 * abort, then a tool error or Unknown. The window check comes before the API error because the
 * engine's `error` reason includes running out of context (see ARCHITECTURE.md, Spec questions).
 */
export function classify(i: ClassifyInput): FailureClass | null {
  if (i.reason === 'answer') return null;
  const fresh = i.candidate && i.now - i.candidate.at <= LIMITS.candidateMaxAgeMs ? i.candidate : null;
  if (fresh?.denied) return 'Blocked by permission';
  if (i.reason === 'refusal') return 'Refusal';
  if (i.stopReason === 'model_context_window_exceeded' || i.blowouts >= 3) return 'Context window exhausted';
  if (i.reason === 'error' && !fresh) return 'Model API error';
  if (i.reason === 'aborted') return 'Aborted';
  return fresh ? 'Tool error' : 'Unknown';
}

export interface EvidenceInput {
  blowoutTimes: number[];
  /** How often each failing call summary failed in this loop. */
  failedCalls: Record<string, number>;
  /** How often each file was read in this loop. */
  reads: Record<string, number>;
  denyText: string | null;
}

function hhmmss(t: number): string {
  const d = new Date(t);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((v) => String(v).padStart(2, '0')).join(':');
}

/** Short facts the reporter observed; never invented. At most 5 lines. */
export function evidence(i: EvidenceInput): string[] {
  const out: string[] = [];
  if (i.blowoutTimes.length) {
    const n = i.blowoutTimes.length;
    out.push(`exceeded the context window ${n} time${n > 1 ? 's' : ''} (${i.blowoutTimes.slice(-3).map(hhmmss).join(', ')})`);
  }
  for (const [call, n] of Object.entries(i.failedCalls).sort((a, b) => b[1] - a[1])) {
    if (n >= 2) out.push(clip(`same call failed ${n} times: ${call}`, LIMITS.line));
  }
  for (const [file, n] of Object.entries(i.reads).sort((a, b) => b[1] - a[1])) {
    if (n >= 3) out.push(clip(`${file} read ${n} times`, LIMITS.line));
  }
  if (i.denyText) out.push(clip(`permission denied: ${i.denyText}`, LIMITS.line));
  return out.slice(0, LIMITS.evidenceLines);
}

export function buildFailure(cls: FailureClass, candidate: FailureCandidate | null, ev: string[], at: number, extra: { tool?: string; call?: string } = {}): Failure {
  return {
    class: cls,
    at,
    tool: candidate?.tool ?? extra.tool ?? null,
    call: candidate?.call ?? (extra.call ? clip(extra.call, LIMITS.call) : null),
    exitCode: candidate?.exitCode ?? null,
    outputTail: candidate ? candidate.outputTail.slice(-LIMITS.outputLines) : [],
    evidence: ev.slice(0, LIMITS.evidenceLines),
    explanation: null,
    retriedAs: null,
  };
}

/**
 * The prompt for an optional one-paragraph explanation (SPEC T5.2). Built only from the failure
 * record, which is already redacted and cut to its limits: never from the transcript.
 */
export function explainPrompt(f: Failure): string {
  const lines = [
    'A Claude Code agent failed. From this record alone, say in at most two short sentences what most likely went wrong and what would fix it. Plain text, no preamble, no markdown.',
    `Class: ${f.class}`,
    f.tool ? `Tool: ${f.tool}` : '',
    f.call ? `Call: ${f.call}` : '',
    f.exitCode !== null ? `Exit code: ${f.exitCode}` : '',
    f.outputTail.length ? `Last output lines:\n${f.outputTail.join('\n')}` : '',
    f.evidence.length ? `Observed:\n${f.evidence.map((e) => `- ${e}`).join('\n')}` : '',
  ];
  return redact(lines.filter(Boolean).join('\n'));
}
