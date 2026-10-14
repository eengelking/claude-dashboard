// What a log line may carry (#140). The logger takes flat, named fields and never a request or report body, and
// this module is the backstop: a field whose name says it holds a credential or text a person typed is dropped,
// and every string has person tokens and the admin secret replaced, control characters removed and a length cap.
export type FieldValue = string | number | boolean | null | undefined;
export type Fields = Record<string, FieldValue>;

/**
 * Words that make a field name refused: credentials, and prompt, answer, activity and other free text from a
 * session. A name is split into words at `_`, `.`, `-` and camelCase, so `x_podium_token` and `promptText` are
 * refused and `context_pct` is not.
 */
const DENIED = new Set([
  'token', 'secret', 'password', 'passwd', 'authorization', 'authorisation', 'cookie', 'credential', 'credentials', 'apikey', 'key',
  'prompt', 'answer', 'activity', 'excerpt', 'body', 'text', 'header', 'headers',
]);

/** A person token anywhere in a string (tokens.ts checks the exact form; this also catches one inside other text). */
const PERSON_TOKEN = /pdm_[0-9a-f]{12}_[0-9a-f]{16,}/gi;

/** Longest string value kept, in characters. */
export const MAX_VALUE = 500;

/** A secret shorter than this is not scrubbed: it would match ordinary text, and an empty one means auth is off. */
const MIN_SECRET = 8;

export const REDACTED = '[redacted]';

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/** A `Bearer` or `Basic` credential, only after an Authorization-style header or when it looks like a credential. */
const AUTH_SCHEME = /\b(Bearer|Basic)(\s+)([A-Za-z0-9._~+/=-]{8,})/g;

/**
 * A secret-named key and its value: `password=x`, `x-api-key=x`, `"token": "x"`. A bare `key: value` in prose is
 * left alone (a colon counts only when the key is quoted, as in JSON), and so is a name that merely contains one
 * of these words (`token_count`, `tokens`).
 */
const SECRET_ASSIGNMENT =
  /((?:["']?)\b[\w.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)(?:["']?)\s*)(=\s*|(?<=["'])\s*:\s*)("(?:[^"\\]|\\.)*"|'[^']*'|[^\s&,;"'}\])]+)/gi;

/** URL userinfo: the `user:pass@` in `https://user:pass@host/`. */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;

/** Well-known key formats: Anthropic/OpenAI `sk-`, GitHub, AWS access key id, Slack, and JWTs. */
const KEY_FORMATS = new RegExp(
  [
    String.raw`\bsk-[A-Za-z0-9_-]{16,}`,
    String.raw`\bgh[pousr]_[A-Za-z0-9]{20,}`,
    String.raw`\bgithub_pat_[A-Za-z0-9_]{20,}`,
    String.raw`\bAKIA[0-9A-Z]{16}\b`,
    String.raw`\bxox[bap]-[A-Za-z0-9-]{10,}`,
    String.raw`\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+`,
  ].join('|'),
  'g',
);

/** How much of a string the pattern pass reads: well past MAX_VALUE, so redactions still leave a full-length line. */
const PATTERN_WINDOW = 4000;

/** A value that is plainly not a secret: a number, a boolean, null, or an earlier redaction. */
const HARMLESS_VALUE = /^(?:\d+|true|false|null|undefined|\[redacted\])$/i;

/** True when a token after `Bearer` or `Basic` is credential-shaped rather than an English word. */
function credentialShaped(tok: string): boolean {
  return /\d/.test(tok) || /[._~+/=-]/.test(tok) || /[A-Z]/.test(tok.slice(1));
}

/** Replace common secret shapes with `[redacted]`. Conservative: ordinary text, ids, paths and numbers pass. */
function scrubPatterns(value: string): string {
  return value
    .replace(URL_USERINFO, `$1${REDACTED}@`)
    .replace(KEY_FORMATS, REDACTED)
    .replace(AUTH_SCHEME, (m, scheme: string, space: string, tok: string) =>
      credentialShaped(tok) ? `${scheme}${space}${REDACTED}` : m,
    )
    .replace(SECRET_ASSIGNMENT, (m, key: string, sep: string, val: string) => {
      const bare = val.replace(/^["']|["']$/g, '');
      return HARMLESS_VALUE.test(bare) ? m : `${key}${sep}${REDACTED}`;
    });
}

export function scrub(value: string, secrets: readonly string[]): string {
  let out = value.replace(PERSON_TOKEN, REDACTED);
  for (const s of secrets) {
    if (s && s.length >= MIN_SECRET) out = out.split(s).join(REDACTED);
  }
  // The result is cut to MAX_VALUE below and redaction only shortens a string, so look at a bounded window: the
  // assignment pattern backtracks, and an error body of 100k characters would otherwise stall the event loop.
  if (out.length > PATTERN_WINDOW) out = out.slice(0, PATTERN_WINDOW);
  out = scrubPatterns(out);
  out = out.replace(CONTROL, ' ');
  return out.length > MAX_VALUE ? `${out.slice(0, MAX_VALUE - 1)}…` : out;
}

/** True for a field name the logger refuses whatever its value. */
export function deniedField(name: string): boolean {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[_.-]+/);
  return words.some((w) => DENIED.has(w));
}

/** Flat, safe fields: denied names, nested values and non-finite numbers dropped; strings scrubbed. */
export function cleanFields(fields: Fields | undefined, secrets: readonly string[]): Fields {
  const out: Fields = {};
  if (!fields) return out;
  for (const [k, v] of Object.entries(fields)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.]{0,63}$/.test(k) || deniedField(k)) continue;
    if (typeof v === 'string') out[k] = scrub(v, secrets);
    else if (typeof v === 'number') {
      if (Number.isFinite(v)) out[k] = v;
    } else if (typeof v === 'boolean' || v === null) out[k] = v;
  }
  return out;
}
