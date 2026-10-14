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

describe('scrub of common secret shapes (#155)', () => {
  const goneCases: Array<[string, string, string]> = [
    ['a Bearer header', 'Authorization: Bearer abc123def456', 'abc123def456'],
    ['a Basic header', 'Authorization: Basic dXNlcjpodW50ZXIy', 'dXNlcjpodW50ZXIy'],
    ['password=', 'login failed password=hunter2 for user', 'hunter2'],
    ['passwd=', 'passwd=hunter2', 'hunter2'],
    ['secret= in a query string', 'GET /x?a=1&client_secret=s3cr3tvalue&b=2', 's3cr3tvalue'],
    ['token=', 'retry with token=zzTop99', 'zzTop99'],
    ['api_key=', 'api_key=KEY12345678', 'KEY12345678'],
    ['api-key=', 'x-api-key=KEY12345678', 'KEY12345678'],
    ['a camelCase key', 'clientSecret=s3cr3tvalue accessToken=abcd1234', 's3cr3tvalue'],
    ['a JSON fragment', 'body {"password": "hunter2", "ok": true}', 'hunter2'],
    ['a single-quoted JSON-ish fragment', "{'token': 'abcd1234'}", 'abcd1234'],
    ['URL userinfo', 'connect https://u:p4ss@db.example.com/x failed', 'p4ss'],
    ['an sk- key', 'key sk-ant-api03-AbCdEfGhIjKlMnOp1234', 'AbCdEfGhIjKlMnOp1234'],
    ['a ghp_ token', 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'],
    ['a github_pat_ token', 'github_pat_11ABCDEFG0abcdefghij_klmnopqrstuvwxyz', 'klmnopqrstuvwxyz'],
    ['an AWS access key id', 'AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
    ['a Slack token', 'xoxb-123456789012-abcdefghijkl', 'abcdefghijkl'],
    ['a JWT', 'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fw', 'SflKxwRJSMeKKF2QT4fw'],
  ];
  it.each(goneCases)('removes %s', (_name, input, secret) => {
    const out = scrub(input, []);
    expect(out).not.toContain(secret);
    expect(out).toContain('[redacted]');
  });

  it('keeps the rest of the message intact', () => {
    const out = scrub('upstream said Authorization: Bearer abc123def456 password=hunter2 https://u:p@host/ key sk-abcdefghijklmnop12345 end', []);
    for (const gone of ['abc123def456', 'hunter2', 'u:p@', 'sk-abcdefghijklmnop12345']) expect(out).not.toContain(gone);
    expect(out).toContain('upstream said Authorization: Bearer');
    expect(out).toContain('password=');
    expect(out).toContain('https://');
    expect(out).toContain('host/');
    expect(out.endsWith(' end')).toBe(true);
  });

  it.each([
    'session 3f2b8c1e-9d4a-4e7b-a1c2-0123456789ab ended after 42 s',
    'model claude-sonnet-5-5 at effort high',
    '/Users/eengelking/dev/claude-dashboard/server/src/logging/redact.ts',
    'tokens=1234 token_count=5 input_tokens: 99',
    'Basic information about the bearer of this token',
    'Bearer of bad news',
    'the password field is required',
    'password=true token=null secret=12345',
    'risk-assessment-framework-2026 and desk-lamp-assembly-instructions',
    'https://example.com/path?x=1&y=2 and http://host:8080/a',
    'user@example.com wrote at 10:30:15',
  ])('leaves ordinary text alone: %s', (s) => {
    expect(scrub(s, [])).toBe(s);
  });

  it('stays fast on a very long message, and still redacts a secret inside the kept part', () => {
    const started = performance.now();
    const out = scrub(`password=hunter2 ${'a-'.repeat(50000)}`, []);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(out).not.toContain('hunter2');
    expect(out.length).toBeLessThanOrEqual(500);
  });

  it('is applied to the logger message and event, not only to fields', () => {
    const local: string[] = [];
    const logger = createLogger({ format: 'json', secrets: [], write: (l) => local.push(l), ship: () => {} });
    logger.warn('auth.failed', 'refused: password=hunter2', { note: 'Bearer abc123def456' });
    const all = local.join('\n');
    expect(all).not.toContain('hunter2');
    expect(all).not.toContain('abc123def456');
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
