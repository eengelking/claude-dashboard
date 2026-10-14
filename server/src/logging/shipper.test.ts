// Shipping log lines to a central platform such as VictoriaLogs (#140): batched NDJSON, bounded, never in the way.
import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { gunzipSync } from 'node:zlib';
import { LogShipper, parseShipHeaders, shipUrl } from './shipper.js';

type Call = { url: string; init: RequestInit };

/** A fetch stand-in that records each call and answers with `status` (or never, when `hang`). */
function fakeFetch(opts: { status?: number; hang?: boolean; fail?: boolean } = {}) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (opts.hang) return new Promise<Response>(() => {});
    if (opts.fail) throw new TypeError('fetch failed');
    return new Response(null, { status: opts.status ?? 204 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const bodyOf = (c: Call) => gunzipSync(Buffer.from(c.init.body as Uint8Array)).toString('utf8');

const shippers: LogShipper[] = [];
afterEach(async () => {
  for (const s of shippers.splice(0)) await s.close(50);
});
function make(o: ConstructorParameters<typeof LogShipper>[0]) {
  const s = new LogShipper({ flushMs: 60_000, ...o });
  shippers.push(s);
  return s;
}

describe('shipUrl', () => {
  it('points a bare VictoriaLogs address at its JSON line ingest, with the field mapping', () => {
    const u = new URL(shipUrl('http://logs.local:9428'));
    expect(u.origin + u.pathname).toBe('http://logs.local:9428/insert/jsonline');
    expect(u.searchParams.get('_time_field')).toBe('timestamp');
    expect(u.searchParams.get('_msg_field')).toBe('message');
    expect(u.searchParams.get('_stream_fields')).toBe('service,host');
  });

  it('keeps a full ingest path, a proxy prefix, and query args the user set', () => {
    expect(new URL(shipUrl('http://h:9428/insert/jsonline')).pathname).toBe('/insert/jsonline');
    expect(new URL(shipUrl('https://h/vl/')).pathname).toBe('/vl/insert/jsonline');
    expect(new URL(shipUrl('http://h:9428?_stream_fields=service')).searchParams.get('_stream_fields')).toBe('service');
  });

  it('refuses something that is not an http(s) URL', () => {
    expect(() => shipUrl('not a url')).toThrow();
    expect(() => shipUrl('ftp://h/')).toThrow();
  });
});

describe('parseShipHeaders', () => {
  it('reads Name=Value pairs separated by semicolons, keeping = inside a value', () => {
    expect(parseShipHeaders('Authorization=Basic dXNlcjpwYXNz==; AccountID=12 ;ProjectID=3;')).toEqual({
      headers: { Authorization: 'Basic dXNlcjpwYXNz==', AccountID: '12', ProjectID: '3' },
      invalid: [],
    });
    expect(parseShipHeaders(undefined)).toEqual({ headers: {}, invalid: [] });
  });

  it('names (never shows the value of) a pair it cannot use', () => {
    const out = parseShipHeaders('Bad Name=x;NoValue;Good=1');
    expect(out.headers).toEqual({ Good: '1' });
    expect(out.invalid).toEqual(['Bad Name', 'NoValue']);
  });
});

describe('LogShipper', () => {
  it('posts a batch as gzipped NDJSON with the ingest query args and the configured headers', async () => {
    const f = fakeFetch();
    const s = make({ url: 'http://logs.local:9428', headers: { AccountID: '7', Authorization: 'Bearer abc' }, fetch: f.fn });
    s.push('{"a":1}');
    s.push('{"b":2}');
    await s.flush();
    expect(f.calls).toHaveLength(1);
    const c = f.calls[0]!;
    expect(c.url).toBe('http://logs.local:9428/insert/jsonline?_time_field=timestamp&_msg_field=message&_stream_fields=service%2Chost');
    expect(c.init.method).toBe('POST');
    const h = new Headers(c.init.headers);
    expect(h.get('content-type')).toBe('application/stream+json');
    expect(h.get('content-encoding')).toBe('gzip');
    expect(h.get('accountid')).toBe('7');
    expect(h.get('authorization')).toBe('Bearer abc');
    expect(bodyOf(c)).toBe('{"a":1}\n{"b":2}\n');
    expect(s.size).toBe(0);
  });

  it('sends a full batch on its own, without waiting for the timer', async () => {
    const f = fakeFetch();
    const s = make({ url: 'http://h:9428', batchSize: 3, fetch: f.fn });
    for (let i = 0; i < 3; i++) s.push(`{"i":${i}}`);
    await new Promise((r) => setTimeout(r, 20));
    expect(f.calls).toHaveLength(1);
  });

  it('keeps at most maxBuffer lines while the endpoint is down, dropping the oldest, and says so once', async () => {
    const f = fakeFetch({ fail: true });
    const notes: string[] = [];
    const s = make({ url: 'http://h:9428', maxBuffer: 5, batchSize: 100, fetch: f.fn, notify: (_e, m) => notes.push(m) });
    for (let i = 0; i < 12; i++) s.push(`{"i":${i}}`);
    expect(s.size).toBe(5);
    expect(s.dropped).toBe(7);
    const drops = notes.filter((n) => /dropping the oldest/.test(n));
    expect(drops).toHaveLength(1);
    await s.flush(); // fails: the lines go back, still bounded
    for (let i = 12; i < 20; i++) s.push(`{"i":${i}}`);
    expect(s.size).toBe(5);
    expect(notes.filter((n) => /dropping the oldest/.test(n))).toHaveLength(1);
    expect(notes.some((n) => /failed/.test(n))).toBe(true);
  });

  it('sends what it kept once the endpoint is back, newest lines intact, and says it recovered', async () => {
    let up = false;
    const calls: Call[] = [];
    const fn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (!up) throw new TypeError('fetch failed');
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const notes: string[] = [];
    const s = make({ url: 'http://h:9428', maxBuffer: 3, fetch: fn, notify: (_e, m) => notes.push(m), backoffMs: 0 });
    for (let i = 0; i < 5; i++) s.push(`{"i":${i}}`);
    await s.flush();
    up = true;
    await s.flush();
    expect(bodyOf(calls.at(-1)!)).toBe('{"i":2}\n{"i":3}\n{"i":4}\n');
    expect(notes.some((n) => /recovered/.test(n))).toBe(true);
  });

  it('never shows a header value or the credentials in a URL in what it says', async () => {
    const f = fakeFetch({ status: 503 });
    const notes: string[] = [];
    const s = make({ url: 'http://user:pa55word@h:9428', headers: { Authorization: 'Bearer sekrit-header' }, fetch: f.fn, notify: (_e, m, fields) => notes.push(m + JSON.stringify(fields ?? {})) });
    s.push('{}');
    await s.flush();
    expect(notes.join('\n')).not.toMatch(/pa55word|sekrit-header/);
    expect(notes.join('\n')).toContain('503');
  });

  it('drops a batch the endpoint refuses as malformed (4xx) instead of retrying it forever', async () => {
    const f = fakeFetch({ status: 400 });
    const s = make({ url: 'http://h:9428', fetch: f.fn, notify: () => {} });
    s.push('{}');
    await s.flush();
    expect(s.size).toBe(0);
    expect(s.dropped).toBe(1);
  });

  it('gives up on a hung endpoint after its timeout and keeps the lines for later', async () => {
    const hung = net.createServer(() => {}); // accepts, never answers
    await new Promise<void>((r) => hung.listen(0, '127.0.0.1', r));
    const port = (hung.address() as net.AddressInfo).port;
    try {
      const s = make({ url: `http://127.0.0.1:${port}`, timeoutMs: 150, notify: () => {} });
      s.push('{"x":1}');
      const t0 = Date.now();
      await s.flush();
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(s.size).toBe(1);
    } finally {
      hung.close();
    }
  });

  it('close flushes what is left, within its time cap even when the endpoint hangs', async () => {
    const ok = fakeFetch();
    const a = make({ url: 'http://h:9428', fetch: ok.fn });
    a.push('{"last":true}');
    await a.close(500);
    expect(ok.calls).toHaveLength(1);

    const hang = fakeFetch({ hang: true });
    const b = make({ url: 'http://h:9428', fetch: hang.fn });
    b.push('{"last":true}');
    const t0 = Date.now();
    await b.close(100);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
