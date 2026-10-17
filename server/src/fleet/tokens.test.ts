import { describe, it, expect } from 'vitest';
import { newPersonToken, parsePersonToken, hashToken, tokenMatches, safeEqualStr } from './tokens.js';

describe('person tokens', () => {
  it('has the form pdm_<key id>_<secret> with at least 128 bits of secret', () => {
    const t = newPersonToken();
    const m = /^pdm_([0-9a-f]{12})_([0-9a-f]{32,})$/.exec(t.token);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(t.keyId);
    expect(t.hash).toBe(hashToken(t.token));
  });

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newPersonToken().token));
    expect(seen.size).toBe(200);
  });

  it('parses a well-formed token and rejects everything else', () => {
    const t = newPersonToken();
    expect(parsePersonToken(t.token)).toEqual({ keyId: t.keyId });
    for (const bad of ['', 'pdm_', 'pdm_abc_def', 'abc', `${t.token}x `, `PDM_${t.token.slice(4)}`, 'pdm_zzzzzzzzzzzz_' + 'a'.repeat(32)]) {
      expect(parsePersonToken(bad)).toBeNull();
    }
  });

  it('matches only the exact token against its stored hash', () => {
    const t = newPersonToken();
    const other = newPersonToken();
    expect(tokenMatches(t.token, t.hash)).toBe(true);
    expect(tokenMatches(other.token, t.hash)).toBe(false);
    expect(tokenMatches(t.token + 'a', t.hash)).toBe(false);
    expect(tokenMatches(t.token, 'nothex')).toBe(false);
  });

  it('compares strings of different length without throwing', () => {
    expect(safeEqualStr('a', 'ab')).toBe(false);
    expect(safeEqualStr('same', 'same')).toBe(true);
  });
});
