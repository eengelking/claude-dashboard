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

export function scrub(value: string, secrets: readonly string[]): string {
  let out = value.replace(PERSON_TOKEN, REDACTED);
  for (const s of secrets) {
    if (s && s.length >= MIN_SECRET) out = out.split(s).join(REDACTED);
  }
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
