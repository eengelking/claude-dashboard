// Per-person report tokens (issue #36). A token is `pdm_<key id>_<secret>`: the key id (6 random bytes) lets the
// server find the person without the name giving anything away, and the secret is 24 random bytes (192 bits).
// Only the SHA-256 of the whole token is stored. The tokens are random and long, so a slow or keyed hash would add
// nothing: there is no password to guess, and the hash only keeps a copied database from handing out working tokens.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_RE = /^pdm_([0-9a-f]{12})_([0-9a-f]{32,128})$/;

export interface NewToken {
  token: string;
  keyId: string;
  hash: string;
  last4: string;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function last4(token: string): string {
  return token.slice(-4);
}

export function newPersonToken(): NewToken {
  const keyId = randomBytes(6).toString('hex');
  const token = `pdm_${keyId}_${randomBytes(24).toString('hex')}`;
  return { token, keyId, hash: hashToken(token), last4: last4(token) };
}

/** The key id in a well-formed person token, or null (so a bad header never reaches the database). */
export function parsePersonToken(token: string): { keyId: string } | null {
  const m = TOKEN_RE.exec(token);
  return m ? { keyId: m[1]! } : null;
}

/** Constant-time check of a presented token against a stored hash. */
export function tokenMatches(presented: string, storedHash: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(storedHash)) return false;
  return timingSafeEqual(Buffer.from(hashToken(presented), 'hex'), Buffer.from(storedHash, 'hex'));
}

/** Constant-time string compare that tolerates different lengths. */
export function safeEqualStr(a: string, b: string): boolean {
  const x = createHash('sha256').update(a, 'utf8').digest();
  const y = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(x, y);
}
