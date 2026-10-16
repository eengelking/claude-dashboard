// A page on another site can point its own name at 127.0.0.1 (DNS rebinding) and then read the open routes as if
// they were its own. The server refuses any request whose Host is not one it expects (#256).
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { hostCheck, parseAllowedHosts, type HostCheckOptions } from './hostCheck.js';

const app = (opts: HostCheckOptions = {}) => {
  const a = express();
  a.use(hostCheck(opts));
  a.get('/api/fleet/state', (_req, res) => void res.json({ ok: true }));
  return a;
};
const get = (a: express.Express, host: string) => request(a).get('/api/fleet/state').set('Host', host);

describe('hostCheck', () => {
  it('refuses a name that is not one the server expects, and serves the loopback names and addresses', async () => {
    const a = app({ bind: '127.0.0.1' });
    const refused = await get(a, 'attacker.example:4317');
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: 'host not allowed' });
    for (const host of ['127.0.0.1:4317', 'localhost:4317', 'LocalHost', '127.0.0.1', '127.1.2.3:80', '[::1]:4317', 'localhost.:4317']) {
      expect((await get(a, host)).status, host).toBe(200);
    }
  });

  it('refuses a request with no Host, and names that only look like an allowed one', async () => {
    const a = app({ bind: '127.0.0.1' });
    // An HTTP client always sends a Host, so call the middleware with a request that has none.
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const next = vi.fn();
    hostCheck({ bind: '127.0.0.1' })({ headers: {} } as express.Request, { status, json } as unknown as express.Response, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    for (const host of ['localhost.attacker.example', '127.0.0.1.attacker.example:4317', 'xlocalhost', 'attacker.example:4317@127.0.0.1', '[::1']) {
      expect((await get(a, host)).status, host).toBe(403);
    }
  });

  it('serves the address the server is bound to, whatever the port', async () => {
    const a = app({ bind: '192.168.1.5' });
    expect((await get(a, '192.168.1.5:4317')).status).toBe(200);
    expect((await get(a, '192.168.1.6:4317')).status).toBe(403);
    expect((await get(a, 'box.lan:4317')).status).toBe(403);
  });

  it('serves a name the owner has allowed, and no other', async () => {
    const a = app({ bind: '192.168.1.5', allowed: ['box.lan', 'Fleet.Example:8443'] });
    expect((await get(a, 'box.lan:4317')).status).toBe(200);
    expect((await get(a, 'BOX.LAN')).status).toBe(200);
    expect((await get(a, 'fleet.example')).status).toBe(200);
    expect((await get(a, 'other.lan')).status).toBe(403);
  });

  it('on a wildcard bind serves any address typed as an IP, but still refuses a name', async () => {
    for (const bind of ['0.0.0.0', '::', '']) {
      const a = app({ bind });
      expect((await get(a, '10.0.0.7:4317')).status, bind).toBe(200);
      expect((await get(a, '[fe80::1]:4317')).status).toBe(200);
      expect((await get(a, 'attacker.example:4317')).status).toBe(403);
    }
  });

  it('refuses before any route runs, and logs the host but nothing else about the request', async () => {
    const warn = vi.fn();
    const logger = { warn } as unknown as NonNullable<HostCheckOptions['logger']>;
    const a = app({ bind: '127.0.0.1', logger });
    const res = await request(a).get('/api/fleet/state?secret=1').set('Host', 'attacker.example').set('X-Podium-Token', 'tok');
    expect(res.status).toBe(403);
    expect(warn).toHaveBeenCalledTimes(1);
    const [event, , fields] = warn.mock.calls[0]!;
    expect(event).toBe('http.host_refused');
    expect(JSON.stringify(fields)).toContain('attacker.example');
    expect(JSON.stringify(warn.mock.calls[0])).not.toMatch(/secret|tok/);
  });

  it('logs a repeated refusal of the same host once a minute, so a page cannot flood the log', async () => {
    const warn = vi.fn();
    const a = app({ bind: '127.0.0.1', logger: { warn } as unknown as NonNullable<HostCheckOptions['logger']> });
    for (let i = 0; i < 5; i++) await get(a, 'attacker.example');
    await get(a, 'other.example');
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('parseAllowedHosts', () => {
  it('reads a comma-separated list, trimming blanks and ignoring empty entries', () => {
    expect(parseAllowedHosts(' box.lan , ,fleet.example:8443,')).toEqual(['box.lan', 'fleet.example:8443']);
    expect(parseAllowedHosts(undefined)).toEqual([]);
    expect(parseAllowedHosts('')).toEqual([]);
  });
});

describe('hostCheck with an IPv6 bind', () => {
  it('serves the bracketed address the server is bound to, and an allowed bare IPv6 setting', async () => {
    const a = app({ bind: 'fe80::5', allowed: ['fd00::7'] });
    expect((await get(a, '[fe80::5]:4317')).status).toBe(200);
    expect((await get(a, '[fd00::7]')).status).toBe(200);
    expect((await get(a, '[fe80::6]:4317')).status).toBe(403);
  });
});
