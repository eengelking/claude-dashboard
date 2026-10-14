// The default text output is what the server printed before #140 (the maintainer's decision on #140): the new
// lifecycle, Admin and refusal events show in text only at debug. This runs the real entry point, sends a normal
// report, a rejected one, one with a wrong token and one that ends, lets a session go stale and be dropped, and
// stops the server, then compares every line it printed.
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fixtureReport } from '../fleet/testing.js';

const SERVER_DIR = path.resolve(__dirname, '..', '..');
const TOKEN = 'text-output-secret-0123456789';

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('the default text output', () => {
  it('is the same lines as before the logger, for startup, reports, refusals, sweeps and shutdown', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'podium-text-'));
    const db = path.join(dir, 'podium.sqlite');
    const port = await freePort();
    const env = {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      PODIUM_DB: db,
      PODIUM_TOKEN: TOKEN,
      // A session goes stale and is dropped within the test; an ended one leaves at once.
      STALE_AFTER_MS: '300',
      DROP_AFTER_MS: '300',
      LINGER_MS: '0',
      PODIUM_LOG_LEVEL: '',
      PODIUM_LOG_FORMAT: '',
      PODIUM_LOG_SHIP_URL: '',
      PODIUM_LOG_SHIP_HEADERS: '',
      PODIUM_LOG_SHIP_BUFFER: '',
    };
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd: SERVER_DIR, env });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)));
    try {
      for (let i = 0; i < 100 && !out.includes('Podium fleet console'); i++) await sleep(100);
      const base = `http://127.0.0.1:${port}/api/fleet`;
      const post = (body: unknown, token = TOKEN) =>
        fetch(`${base}/report`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Podium-Token': token }, body: JSON.stringify(body) });
      const r = fixtureReport();
      expect((await post(r)).status).toBe(200);
      expect((await post({ ...r, v: 2 })).status).toBe(400);
      expect((await post(r, 'wrong-token')).status).toBe(401);
      const done = { ...r, session: { ...r.session, id: 'text-output-done', status: 'done' as const, endReason: 'prompt_input_exit' } };
      expect((await post(done)).status).toBe(200);
      await sleep(2500); // the first session goes stale and is dropped; the ended one is swept
      child.kill('SIGTERM');
      expect(await exited).toBe(0);
    } finally {
      child.kill('SIGKILL');
      fs.rmSync(dir, { recursive: true, force: true });
    }
    // Node's own warning about node:sqlite is not the server's output.
    const lines = out.split('\n').filter((l) => l && !l.startsWith('(node:') && !l.startsWith('(Use `node'));
    expect(lines).toEqual([
      `Podium server listening on http://127.0.0.1:${port}`,
      `Podium fleet console: http://127.0.0.1:${port}/#/  (database ${db})`,
      'podium: rejected report at $.v: unsupported protocol version',
      'Received SIGTERM, shutting down',
    ]);
  }, 30_000);
});
