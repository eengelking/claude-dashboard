// Response headers for every route (#249): the console cannot be framed or sniffed, and the page may only run its own
// script, talk to its own server and load the two font hosts index.html names.
import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';

export function securityHeaders(opts: { scriptHashes?: string[] } = {}): RequestHandler {
  const scripts = ["'self'", ...(opts.scriptHashes ?? []).map((h) => `'${h}'`)].join(' ');
  const csp = [
    "default-src 'self'",
    `script-src ${scripts}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return (_req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  };
}

/** The `sha256-…` source of each inline `<script>` in a page, so the policy can allow those and no other inline script. */
export function inlineScriptHashes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(m.groups!.attrs!)) continue;
    out.push(`sha256-${createHash('sha256').update(m.groups!.body!, 'utf8').digest('base64')}`);
  }
  return out;
}
