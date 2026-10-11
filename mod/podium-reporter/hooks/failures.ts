// Failure classification, excerpts and redaction (SPEC 6.4). Pure: no `$` here.
import type { Failure, FailureClass } from './protocol.ts';

export const LIMITS = {
  call: 300,
  line: 240,
  outputLines: 12,
  evidenceLines: 5,
  excerpt: 400,
  text: 240,
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
