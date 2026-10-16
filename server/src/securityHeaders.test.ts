// Response headers that keep the console from being framed, sniffed or fed outside script (#249).
import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { inlineScriptHashes, securityHeaders } from './securityHeaders.js';

const app = (hashes: string[] = []) => {
  const a = express();
  a.use(securityHeaders({ scriptHashes: hashes }));
  a.get('/x', (_req, res) => void res.json({ ok: true }));
  return a;
};

describe('securityHeaders', () => {
  it('stops the page being framed or sniffed and trims the referrer', async () => {
    const res = await request(app()).get('/x');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('sends a content security policy that only lets the page talk to itself', async () => {
    const csp = (await request(app()).get('/x')).headers['content-security-policy'] ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("form-action 'self'");
    // The fonts the page loads are the only third-party origins.
    expect(csp).toContain('https://fonts.googleapis.com');
    expect(csp).toContain('https://fonts.gstatic.com');
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it('allows the page\'s own inline script by hash and nothing else', async () => {
    const csp = (await request(app(["sha256-abc="])).get('/x')).headers['content-security-policy'] ?? '';
    expect(csp).toMatch(/script-src 'self' 'sha256-abc='/);
  });
});

describe('inlineScriptHashes', () => {
  it('hashes inline scripts and skips ones with a src', () => {
    const html = '<script>var a=1;</script><script type="module" src="/a.js"></script>';
    const hashes = inlineScriptHashes(html);
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/);
  });
});
