#!/usr/bin/env node
// Seeds a Podium server with sessions that wait to be answered (#206), for reviewing the Respond UI against
// mockup/podium-respond.html without a Claude Code session. It plays the reporter: it turns the Admin's Respond from
// Podium flag on, makes the people it needs, reports four waiting sessions (a question, a plan, a tool permission and
// a turn that ended) plus one owned by someone else, announces their asks, and keeps them alive with heartbeats.
// Answers sent from the browser are printed as they arrive; nothing reaches a real session.
//
// Never point it at a server you use: it changes the Admin's settings and adds people.

const HELP = `Usage: node scripts/podium-respond-demo.mjs --url <server> --secret <admin secret> [--seconds N]

  --url      the Podium server, for example http://127.0.0.1:4391 (required)
  --secret   the server's admin secret, PODIUM_TOKEN (required)
  --seconds  how long to keep the sessions alive (default 600)
  -h, --help show this help

Prints the people's names and tokens, and the Admin name with the admin secret, so you can sign in to respond.`;

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log(HELP);
  process.exit(0);
}
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const URL_ = arg('--url');
const SECRET = arg('--secret');
const SECONDS = Number(arg('--seconds', '600'));
if (!URL_ || !SECRET) {
  console.error(HELP);
  process.exit(2);
}

let cookie = '';
async function admin(method, path, body) {
  const res = await fetch(`${URL_}/api/admin${path}`, {
    method,
    headers: { 'X-Podium-Admin': '1', 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return res.json();
}

async function mod(token, method, path, body) {
  const res = await fetch(`${URL_}/api/fleet${path}`, { method, headers: { 'X-Podium-Token': token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const ALL = ['question', 'message', 'plan-approve', 'plan-feedback', 'permission', 'command'];
const now = Date.now();
const ASKS = {
  'demo-question': {
    id: 'toolu_demo_q',
    kind: 'question',
    agentId: null,
    openedAt: now - 42_000,
    questions: [
      { question: 'How many History rows per page, and can the user change it?', header: 'Page size', multiSelect: false, options: [{ label: '25/50/100, default 50 (Recommended)', description: 'Same Pager and choices as Admin > Reporters (#167); default 50.', preview: null }, { label: 'Fixed 50, no choice', description: 'No rows-per-page control; just Previous and Next.', preview: null }] },
      { question: 'Should History keep its day selector once it is paged?', header: 'Day selector', multiSelect: false, options: [{ label: 'Keep it, page within the day', description: 'The pager restarts at page 1 when the day changes.', preview: 'History                 [Today ▾]\n claude-dashboard   12:04  $1.55\n ‹ Previous   Page 1 of 3   Next ›' }, { label: 'One paged list, newest first', description: 'Drop the day selector; dates become group rows.', preview: 'History\n Today\n claude-dashboard   12:04  $1.55\n ‹ Previous   Page 1 of 9   Next ›' }] },
      { question: 'When someone opens a session from History and comes back, what should Back restore?', header: 'Back state', multiSelect: true, options: [{ label: 'The page number', description: 'Return to page 3, not page 1.', preview: null }, { label: 'The rows-per-page choice', description: 'Keep 100 if they picked 100.', preview: null }, { label: 'The scroll position', description: 'Land on the row they opened.', preview: null }] },
    ],
  },
  'demo-plan': { id: 'toolu_demo_p', kind: 'plan', agentId: null, openedAt: now - 42_000, plan: { text: '# Paginate the History page (#195)\n\nHistory loads every session for the selected day at once. Page it on the server.\n\n## Steps\n\n1. Add `page` and `pageSize` to `GET /api/fleet/history`.\n2. Reuse the Pager from Admin > Reporters.\n3. Tests and the user guide.', filePath: '~/.claude/plans/wise-beaming-token.md' } },
  'demo-tool': { id: 'toolu_demo_t', kind: 'permission', agentId: null, openedAt: now - 54_000, tool: { name: 'Bash', input: { command: 'git push -u origin issue/195-history-pages', description: 'Push the branch to GitHub' }, cut: false } },
};
const SESSIONS = [
  { id: 'demo-question', name: 'claude-dashboard', who: 'Ed', waitReason: 'input', waitNote: 'AskUserQuestion: 3 questions about History paging' },
  { id: 'demo-plan', name: 'history-paging', who: 'Ed', waitReason: 'permission', waitNote: 'ExitPlanMode' },
  { id: 'demo-tool', name: 'push-branch', who: 'Ed', waitReason: 'permission', waitNote: 'Bash(git push -u origin issue/195-history-pages)' },
  { id: 'demo-idle', name: 'turn-ended', who: 'Ed', waitReason: 'input', waitNote: null },
  { id: 'demo-alex', name: 'alex-session', who: 'Alex', waitReason: 'input', waitNote: null, ask: 'demo-question' },
];

function report(s, closed) {
  const askKey = s.ask ?? s.id;
  const ask = ASKS[askKey] && !closed.has(s.id) ? [{ ...ASKS[askKey], id: `${ASKS[askKey].id}_${s.id}` }] : [];
  return {
    v: 1,
    sentAt: Date.now(),
    reporter: { name: 'podium-reporter', version: '0.14.0', engineVersion: '2.1.301', hostSurface: 'terminal' },
    userName: s.who,
    session: {
      id: s.id, name: s.name, status: 'waiting', waitReason: s.waitReason, waitNote: s.waitNote, endReason: null, resumeId: null,
      startedAt: now - 3_000_000, cwd: `/Users/dev/${s.name}`, projectRoot: `/Users/dev/${s.name}`, repoName: `eengelking/${s.name}`,
      git: { branch: 'issue/195-history-pages', detached: false, isWorktree: false, worktreePath: null, ahead: 0, behind: 0, dirty: 0 },
      model: 'claude-opus-5-5', effort: 'high', context: { tokens: 120_000, window: 1_000_000, percent: 12 }, costUsd: 1.55,
      tokens: { input: 300_000, output: 30_000, cacheRead: 0, cacheWrite: 0 }, rateLimits: [], blowouts: 0, plan: null,
      loop: { skills: [], lastTool: 'Read', toolCalls: 4, toolCounts: { Read: 4 }, steps: { done: 6, total: null } },
      files: null, attached: true, activityFeed: true,
      respond: { level: 'everything', accepts: ALL, limits: [] },
      asks: ask,
    },
    agents: [],
    events: [],
  };
}

const unlocked = await admin('POST', '/unlock', { name: 'Admin', token: SECRET });
if (!unlocked.ok) throw new Error(`could not unlock Admin: ${JSON.stringify(unlocked)}`);
await admin('PUT', '/settings', { features: { respond: true, 'activity-feed': true } });
const tokens = {};
for (const name of ['Ed', 'Alex']) {
  const made = await admin('POST', '/people', { name });
  if (!made.token) throw new Error(`could not make ${name}: ${JSON.stringify(made)}. Use a fresh database.`);
  tokens[name] = made.token;
}
console.log('Sign in to respond with:');
for (const [n, t] of Object.entries(tokens)) console.log(`  ${n}  ${t}`);
console.log(`  Admin  ${SECRET}`);

const closed = new Set();
async function beat() {
  for (const s of SESSIONS) {
    const r = await mod(tokens[s.who], 'POST', '/report', report(s, closed));
    for (const d of r.body?.deliveries ?? []) {
      console.log(`${s.id}: ${d.kind} from ${d.by}`, d.text ?? d.command ?? '');
      await mod(tokens[s.who], 'POST', `/sessions/${s.id}/deliveries/${d.id}/result`, { result: 'took', at: Date.now() });
    }
  }
}
await beat();

// Each ask's held request: an answer that comes is printed and taken, as a reporter would.
async function hold(s) {
  const askId = `${ASKS[s.ask ?? s.id].id}_${s.id}`;
  for (;;) {
    const r = await mod(tokens[s.who], 'GET', `/sessions/${s.id}/asks/${askId}/answer?wait=20`);
    if (r.status === 200) {
      console.log(`${s.id}: answered with ${r.body.delivery.kind} by ${r.body.delivery.by}`, JSON.stringify(r.body.delivery.answers ?? r.body.delivery.text ?? r.body.delivery.mode ?? ''));
      await new Promise((ok) => setTimeout(ok, 1500));
      await mod(tokens[s.who], 'POST', `/sessions/${s.id}/deliveries/${r.body.delivery.id}/result`, { result: 'took', at: Date.now() });
      closed.add(s.id);
      return;
    }
    if (r.status !== 204) return;
  }
}
for (const s of SESSIONS) if (ASKS[s.ask ?? s.id] && s.who === 'Ed') void hold(s);

const end = Date.now() + SECONDS * 1000;
while (Date.now() < end) {
  await new Promise((ok) => setTimeout(ok, 4000));
  await beat();
}
