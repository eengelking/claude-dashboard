// What the logger refuses to carry (#140): tokens, the admin secret, prompt, answer and activity text.
import { describe, it, expect } from 'vitest';
import { createLogger } from './logger.js';
import { cleanFields, scrub } from './redact.js';
import { newPersonToken } from '../fleet/tokens.js';

const SECRET = 'the-admin-secret-0123456789';

describe('scrub', () => {
  it('replaces a person token anywhere in a string, and the admin secret', () => {
    const { token } = newPersonToken();
    const out = scrub(`header was ${token}; also ${SECRET}!`, [SECRET]);
    expect(out).not.toContain(token);
    expect(out).not.toContain(token.split('_')[2]);
    expect(out).not.toContain(SECRET);
    expect(out).toContain('[redacted]');
  });

  it('removes control characters, so one record stays one line, and clips long values', () => {
    expect(scrub('a\nb\r\tc', [])).toBe('a b  c');
    expect(scrub('x'.repeat(5000), []).length).toBeLessThanOrEqual(500);
  });

  it('ignores a secret too short to scrub safely (an empty token means auth is off)', () => {
    expect(scrub('abc', [''])).toBe('abc');
  });
});

describe('cleanFields', () => {
  it('drops fields whose names say they hold a credential or text a person typed', () => {
    const out = cleanFields(
      {
        token: 'a',
        x_podium_token: 'b',
        admin_secret: 'c',
        authorization: 'd',
        cookie: 'e',
        prompt_text: 'f',
        answer: 'g',
        activity: 'h',
        body: 'i',
        session_id: 'keep',
        status: 200,
      },
      [],
    );
    expect(out).toEqual({ session_id: 'keep', status: 200 });
  });
});

describe('a logger given the secret', () => {
  it('never writes or ships the token or the secret, whatever a caller passes', () => {
    const { token } = newPersonToken();
    const local: string[] = [];
    const shipped: string[] = [];
    const logger = createLogger({ format: 'json', secrets: [SECRET], write: (l) => local.push(l), ship: (j) => shipped.push(j) });
    logger.warn('auth.failed', `podium: refused ${token} and ${SECRET}`, { token, secret: SECRET, reason: `wrong ${SECRET}`, note: token });
    const all = local.join('\n') + shipped.join('\n');
    expect(all).not.toContain(token);
    expect(all).not.toContain(SECRET);
    expect(JSON.parse(local[0]!).event).toBe('auth.failed');
  });
});
