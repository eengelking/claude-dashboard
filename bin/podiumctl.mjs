#!/usr/bin/env node
// podiumctl: manage the Podium server from the command line, either in a Podman container or as a
// plain Node process on the host. No dependencies; run `podiumctl --help`.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.join(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url))), '..');
export const IMAGE = 'localhost/podium:latest';
export const CONTAINER = 'podium';
export const VOLUME = 'podium-data';
export const SERVICE_LABEL = 'dev.podium.server';
const INNER_PORT = 4317;

/** Server settings podiumctl passes through to the server unchanged when they are set in the config. */
export const PASSTHROUGH = [
  'STALE_AFTER_MS', 'HOOK_STALE_AFTER_MS', 'DROP_AFTER_MS', 'LINGER_MS',
  'RETAIN_SAMPLES_MS', 'RETAIN_EVENTS_MS', 'RETAIN_SESSIONS_MS',
];
/** Keys podiumctl itself owns. Standalone-only: PODIUM_DB. */
export const OWN_KEYS = ['PODIUMCTL_MODE', 'PODIUMCTL_PORT', 'PODIUMCTL_BIND', 'PODIUM_TOKEN', 'PODIUM_DB'];
const ALL_KEYS = [...OWN_KEYS, ...PASSTHROUGH];
/** Keys an older config may still hold. Ignored by the server; `config unset` removes them, `config set` refuses. */
export const RETIRED_KEYS = ['ANTHROPIC_ADMIN_API_KEY'];

const HELP = `podiumctl: manage the Podium server

Usage: podiumctl <command> [options]

Commands:
  build               Build the container image (container mode) or the app (standalone mode)
  start               Start the server; builds first if there is nothing to run yet
  stop                Stop the server (the database is kept)
  restart             Stop, then start (use this after changing the config)
  status              Show mode, state, health, URL and whether it starts on boot (exit 3 if stopped)
  logs                Print the server log (-f to follow, --tail N for the last N lines)
  health              Exit 0 when the server answers, 1 when it does not
  url                 Print the dashboard URL
  token               Print the auth token (--rotate makes a new one; restart to apply)
  config              Show the settings; \`config set KEY=VALUE\` and \`config unset KEY\` change them
  enable              Start on boot / login (launchd on macOS, a systemd user unit on Linux)
  disable             Stop starting on boot
  shell               Open a shell in the container (container mode)
  rm [--purge --yes]  Remove the container; --purge --yes also deletes the data and the image
  run                 Run the server in the foreground (what the boot service calls)

Options:
  --mode container|standalone   How to run it (saved; default: container if Podman is installed)
  --port N                      Port on this machine (saved; default 4317)
  --bind ADDR                   Address to listen on (saved; default 127.0.0.1)
  -f, --follow                  logs: follow
  --tail N                      logs: lines to show (default 100)
  --rotate                      token: generate a new token
  --show-token                  config: print the token instead of masking it
  -h, --help                    This help

Files (set PODIUMCTL_HOME to move them; default ~/.podium):
  config.env     Settings, one KEY=VALUE per line, mode 0600. Holds the generated token.
  data/          SQLite database (standalone mode); container mode uses the Podman volume "${VOLUME}".
  podium.log     Server log (standalone mode); container mode: \`podiumctl logs\`.

Auth: the first \`start\` generates a token and saves it as PODIUM_TOKEN in config.env. Reporters send it
as X-Podium-Token. Find it any time with \`podiumctl token\`. To run without auth:
\`podiumctl config set PODIUM_TOKEN=\` (empty on purpose).

Config keys: ${ALL_KEYS.join(', ')}.
`;

// ---------- pure helpers (exported for tests) ----------

export function parseArgs(argv) {
  const flags = {};
  const rest = [];
  const valued = new Set(['mode', 'port', 'bind', 'tail']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') flags.help = true;
    else if (a === '-f') flags.follow = true;
    else if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split(/=(.*)/s);
      if (valued.has(k)) {
        const v = inline ?? argv[++i];
        if (v === undefined) throw new Error(`--${k} needs a value`);
        flags[k] = v;
      } else flags[k] = inline ?? true;
    } else rest.push(a);
  }
  return { cmd: rest[0], args: rest.slice(1), flags };
}

export function parseEnvFile(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

export function serializeEnv(obj) {
  const lines = ['# Managed by podiumctl. Edit with `podiumctl config set KEY=VALUE`.'];
  for (const k of Object.keys(obj)) lines.push(`${k}=${obj[k]}`);
  return lines.join('\n') + '\n';
}

/** Settings after defaults and flags are applied. `hasPodman` picks the default mode. */
export function resolveConfig(file, flags = {}, hasPodman = true) {
  const mode = flags.mode ?? file.PODIUMCTL_MODE ?? (hasPodman ? 'container' : 'standalone');
  if (mode !== 'container' && mode !== 'standalone') throw new Error(`mode must be container or standalone, not "${mode}"`);
  const port = Number(flags.port ?? file.PODIUMCTL_PORT ?? INNER_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port "${flags.port ?? file.PODIUMCTL_PORT}"`);
  const bind = flags.bind ?? file.PODIUMCTL_BIND ?? '127.0.0.1';
  return { mode, port, bind, token: file.PODIUM_TOKEN, db: file.PODIUM_DB, extra: Object.fromEntries(PASSTHROUGH.filter((k) => file[k] !== undefined).map((k) => [k, file[k]])) };
}

/** Environment the server process gets (the token and other settings live here, never on a command line). */
export function serverEnv(cfg, inContainer) {
  const env = { ...cfg.extra };
  // An empty token is deliberate (auth off): pass it through so a stray PODIUM_TOKEN in the shell or .env cannot win.
  if (cfg.token !== undefined) env.PODIUM_TOKEN = cfg.token;
  if (inContainer) Object.assign(env, { HOST: '0.0.0.0', PORT: String(INNER_PORT), PODIUM_DB: '/data/podium.sqlite' });
  else Object.assign(env, { HOST: cfg.bind, PORT: String(cfg.port), PODIUM_DB: cfg.db ?? '' });
  return env;
}

export function containerRunArgs(cfg, envNames) {
  return [
    'run', '-d', '--name', CONTAINER, '--restart', 'unless-stopped',
    '-p', `${cfg.bind}:${cfg.port}:${INNER_PORT}`,
    '-v', `${VOLUME}:/data`,
    '--health-cmd', `node -e "fetch('http://127.0.0.1:${INNER_PORT}/api/fleet/state').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"`,
    '--health-interval', '30s',
    ...envNames.flatMap((n) => ['-e', n]),
    IMAGE,
  ];
}

export function launchdPlist({ label, args, keepAliveOnFailure, logPath, env }) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const envXml = Object.entries(env).map(([k, v]) => `    <key>${esc(k)}</key><string>${esc(v)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${esc(label)}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${esc(a)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key><true/>
${keepAliveOnFailure ? '  <key>KeepAlive</key>\n  <dict><key>SuccessfulExit</key><false/></dict>\n' : ''}  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>StandardOutPath</key><string>${esc(logPath)}</string>
  <key>StandardErrorPath</key><string>${esc(logPath)}</string>
</dict>
</plist>
`;
}

export function systemdUnit({ args, stopArgs, standalone, env }) {
  const q = (s) => (/[\s"'\\$%]/.test(s) ? `"${s.replace(/(["\\])/g, '\\$1').replace(/%/g, '%%')}"` : s);
  const envLines = Object.entries(env).map(([k, v]) => `Environment=${q(`${k}=${v}`)}`).join('\n');
  const exec = args.map(q).join(' ');
  return `[Unit]
Description=Podium fleet console
After=network-online.target

[Service]
${standalone ? `Type=simple\nExecStart=${exec}\nRestart=on-failure\nRestartSec=3` : `Type=oneshot\nRemainAfterExit=yes\nExecStart=${exec}\nExecStop=${stopArgs.map(q).join(' ')}`}
${envLines}

[Install]
WantedBy=default.target
`;
}

// ---------- environment ----------

const homeDir = () => process.env.PODIUMCTL_HOME || path.join(os.homedir(), '.podium');
const configPath = () => path.join(homeDir(), 'config.env');
const logPath = () => path.join(homeDir(), 'podium.log');
const pidPath = () => path.join(homeDir(), 'podium.pid');

const say = (m) => console.log(m);
class Fail extends Error {}
const fail = (m) => { throw new Fail(m); };

function readConfigFile() {
  try { return parseEnvFile(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; }
}
function writeConfigFile(obj) {
  fs.mkdirSync(homeDir(), { recursive: true });
  fs.writeFileSync(configPath(), serializeEnv(obj), { mode: 0o600 });
  fs.chmodSync(configPath(), 0o600);
}
const hasPodman = () => spawnSync('podman', ['--version'], { stdio: 'ignore' }).status === 0;

function loadCfg(flags, { persist }) {
  const file = readConfigFile();
  const cfg = resolveConfig(file, flags, hasPodman());
  if (persist) {
    const next = { ...file, PODIUMCTL_MODE: cfg.mode, PODIUMCTL_PORT: String(cfg.port), PODIUMCTL_BIND: cfg.bind };
    if (JSON.stringify(next) !== JSON.stringify(file)) writeConfigFile(next);
  }
  return cfg;
}

/** Generate the token on first use (RKE2 style) unless the config deliberately sets it empty. */
function ensureToken(cfg) {
  if (cfg.token !== undefined) return cfg;
  const file = readConfigFile();
  const token = randomBytes(24).toString('hex');
  writeConfigFile({ ...file, PODIUM_TOKEN: token });
  say(`Generated an auth token and saved it to ${configPath()}`);
  say('Show it any time with: podiumctl token');
  return { ...cfg, token };
}

const dashUrl = (cfg) => `http://${cfg.bind === '0.0.0.0' ? '127.0.0.1' : cfg.bind}:${cfg.port}`;

async function healthy(cfg, timeoutMs = 2000) {
  try {
    const r = await fetch(`${dashUrl(cfg)}/api/fleet/state`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch { return false; }
}
/** Waits for the server to answer. `abort` lets a caller stop early, e.g. when the process it spawned has exited. */
async function waitHealthy(cfg, seconds = 30, abort = () => false) {
  for (let i = 0; i < seconds * 2; i++) {
    if (abort()) return false;
    if (await healthy(cfg, 1000)) return !abort();
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** True if something accepts TCP connections on the configured bind address and port. */
function portInUse(cfg, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: cfg.bind === '0.0.0.0' ? '127.0.0.1' : cfg.bind, port: cfg.port });
    const done = (used) => { sock.destroy(); resolve(used); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

/** The last lines of the standalone server log, for a failed start. */
function logTail(from = 0, lines = 15) {
  try { return fs.readFileSync(logPath()).subarray(from).toString('utf8').trimEnd().split('\n').slice(-lines).join('\n'); } catch { return ''; }
}

// ---------- podman ----------

function pm(args, opts = {}) {
  return spawnSync('podman', args, { encoding: 'utf8', ...opts });
}
function ensurePodman() {
  if (!hasPodman()) fail('podman is not installed (or not on PATH). Install it, or use --mode standalone.');
  if (pm(['info'], { stdio: 'ignore' }).status === 0) return;
  if (process.platform === 'darwin' || process.platform === 'win32') {
    say('Podman machine is not running; starting it...');
    if (pm(['machine', 'start'], { stdio: 'inherit' }).status === 0 && pm(['info'], { stdio: 'ignore' }).status === 0) return;
  }
  fail('podman is not usable (`podman info` fails).');
}
const containerState = () => {
  const r = pm(['container', 'inspect', CONTAINER, '--format', '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}']);
  return r.status === 0 ? r.stdout.trim() : null;
};

// ---------- standalone ----------

function readPid() {
  try {
    const pid = Number(fs.readFileSync(pidPath(), 'utf8'));
    process.kill(pid, 0);
    // A stale pid file can name a reused pid; only trust a process that is ours.
    const cmd = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).stdout;
    return /podiumctl|server\/dist\/index\.js/.test(cmd) ? pid : null;
  } catch { return null; }
}
const serverEntry = () => path.join(REPO_ROOT, 'server', 'dist', 'index.js');

function standaloneEnv(cfg) {
  const env = { ...process.env, ...serverEnv(cfg, false) };
  if (!env.PODIUM_DB) env.PODIUM_DB = path.join(homeDir(), 'data', 'podium.sqlite');
  fs.mkdirSync(path.dirname(env.PODIUM_DB), { recursive: true });
  return env;
}
function requireBuilt() {
  if (!fs.existsSync(serverEntry()) || !fs.existsSync(path.join(REPO_ROOT, 'frontend', 'dist', 'index.html'))) {
    fail('the app is not built. Run: podiumctl build --mode standalone');
  }
}

// ---------- commands ----------

async function cmdBuild(cfg) {
  if (cfg.mode === 'container') {
    ensurePodman();
    const r = pm(['build', '-t', IMAGE, '-f', path.join(REPO_ROOT, 'Containerfile'), REPO_ROOT], { stdio: 'inherit' });
    if (r.status !== 0) fail('image build failed');
    say(`Built ${IMAGE}`);
  } else {
    const run = (args) => { if (spawnSync('npm', args, { cwd: REPO_ROOT, stdio: 'inherit' }).status !== 0) fail(`npm ${args.join(' ')} failed`); };
    if (!fs.existsSync(path.join(REPO_ROOT, 'node_modules'))) run(['install']);
    run(['run', 'build', '-w', 'frontend']);
    run(['run', 'build', '-w', 'server']);
    say('Built the app');
  }
}

function otherModeRunning(cfg) {
  if (cfg.mode === 'container') return readPid() ? 'standalone' : null;
  return hasPodman() && pm(['container', 'inspect', CONTAINER], { stdio: 'ignore' }).status === 0 && /^running/.test(containerState() ?? '') ? 'container' : null;
}

async function cmdStart(cfg) {
  const other = otherModeRunning(cfg);
  if (other) fail(`Podium is already running in ${other} mode. Stop it first (podiumctl stop --mode ${other}).`);
  cfg = ensureToken(cfg);
  let exited = false; // set when the standalone server we spawned exits
  let logFrom = 0;    // size of podium.log before this start, so a failure shows only this run's output
  if (cfg.mode === 'container') {
    ensurePodman();
    if ((containerState() ?? '').startsWith('running')) { say(`Already running at ${dashUrl(cfg)} (use restart to apply config changes)`); return; }
    if (pm(['image', 'exists', IMAGE]).status !== 0) { say('No image yet; building it...'); await cmdBuild(cfg); }
    pm(['rm', '-f', CONTAINER], { stdio: 'ignore' });
    const env = serverEnv(cfg, true);
    const r = pm(containerRunArgs(cfg, Object.keys(env)), { env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'inherit'] });
    if (r.status !== 0) fail('podman run failed');
  } else {
    if (readPid()) { say(`Already running at ${dashUrl(cfg)}`); return; }
    if (await portInUse(cfg)) {
      fail(`port ${cfg.port} on ${cfg.bind} is already in use by another process, so a new Podium could not start. Run \`podiumctl status\` to see whether it is Podium, or choose another port with --port.`);
    }
    requireBuilt();
    fs.mkdirSync(homeDir(), { recursive: true });
    const out = fs.openSync(logPath(), 'a');
    logFrom = fs.fstatSync(out).size;
    const child = spawn(process.execPath, [serverEntry()], { cwd: REPO_ROOT, env: standaloneEnv(cfg), detached: true, stdio: ['ignore', out, out] });
    child.unref();
    child.once('exit', () => { exited = true; });
    fs.writeFileSync(pidPath(), String(child.pid));
  }
  // Only report success for the process we spawned: if it exits while we wait, whatever answers is not ours.
  const up = await waitHealthy(cfg, 30, () => exited);
  if (exited) {
    fs.rmSync(pidPath(), { force: true });
    const tail = logTail(logFrom);
    fail(`the server exited right after starting.${tail ? `\nLast lines of ${logPath()}:\n${tail}` : ''}`);
  }
  if (!up) fail(`started, but the server did not answer at ${dashUrl(cfg)}. See: podiumctl logs`);
  say(`Podium is up at ${dashUrl(cfg)}  (${cfg.mode} mode)`);
}

async function cmdStop(cfg) {
  if (cfg.mode === 'container') {
    ensurePodman();
    if (containerState() === null) { say('Not running'); return; }
    if (pm(['stop', '-t', '10', CONTAINER], { stdio: ['ignore', 'ignore', 'inherit'] }).status !== 0) fail('podman stop failed');
    say('Stopped');
    return;
  }
  const pid = readPid();
  if (!pid) { say('Not running'); fs.rmSync(pidPath(), { force: true }); return; }
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (!readPid()) { fs.rmSync(pidPath(), { force: true }); say('Stopped'); return; }
  }
  process.kill(pid, 'SIGKILL');
  fs.rmSync(pidPath(), { force: true });
  say('Did not stop within 5 s; killed');
}

async function cmdStatus(cfg) {
  const lines = [`mode:     ${cfg.mode}`];
  let running = false;
  if (cfg.mode === 'container') {
    if (!hasPodman()) lines.push('state:    podman not installed');
    else if (pm(['info'], { stdio: 'ignore' }).status !== 0) lines.push('state:    podman machine not running');
    else {
      const st = containerState();
      running = !!st?.startsWith('running');
      lines.push(`state:    ${st ? `container ${st.trim()}` : 'no container'}`);
    }
  } else {
    const pid = readPid();
    running = !!pid;
    lines.push(`state:    ${pid ? `running (pid ${pid})` : 'stopped'}`);
  }
  const ok = running && (await healthy(cfg));
  lines.push(`health:   ${running ? (ok ? 'answering' : 'not answering') : '-'}`);
  lines.push(`url:      ${dashUrl(cfg)}`);
  lines.push(`token:    ${cfg.token === undefined ? 'not generated yet (created on first start)' : cfg.token === '' ? 'none (auth off)' : 'set (podiumctl token)'}`);
  lines.push(`on boot:  ${bootEnabled() ? 'enabled' : 'disabled'}`);
  lines.push(`config:   ${configPath()}`);
  say(lines.join('\n'));
  return running ? 0 : 3;
}

function cmdLogs(cfg, flags) {
  const tail = String(flags.tail ?? 100);
  let r;
  if (cfg.mode === 'container') {
    ensurePodman();
    r = pm(['logs', '--tail', tail, ...(flags.follow ? ['--follow'] : []), CONTAINER], { stdio: 'inherit' });
  } else {
    if (!fs.existsSync(logPath())) fail(`no log yet (${logPath()})`);
    r = spawnSync('tail', ['-n', tail, ...(flags.follow ? ['-f'] : []), logPath()], { stdio: 'inherit' });
  }
  return r.status ?? 0;
}

function cmdToken(flags) {
  const file = readConfigFile();
  if (flags.rotate) {
    const token = randomBytes(24).toString('hex');
    writeConfigFile({ ...file, PODIUM_TOKEN: token });
    say(token);
    console.error('New token saved. Restart the server (podiumctl restart) and update the mod\'s `token` option.');
  } else if (file.PODIUM_TOKEN === undefined) fail('no token yet; it is generated on the first `podiumctl start`');
  else if (file.PODIUM_TOKEN === '') fail('auth is off (PODIUM_TOKEN is empty)');
  else say(file.PODIUM_TOKEN);
}

function cmdConfig(cfg, args, flags) {
  const file = readConfigFile();
  if (args[0] === 'set' || args[0] === 'unset') {
    const pair = args.slice(1).join(' ');
    const [k, ...v] = pair.split('=');
    const key = k.trim();
    if (RETIRED_KEYS.includes(key)) {
      if (args[0] === 'set') fail(`${key} is no longer used (the usage dashboard was removed). Use \`podiumctl config unset ${key}\` to clear an old value.`);
    } else if (!ALL_KEYS.includes(key)) fail(`unknown key "${key}". Keys: ${ALL_KEYS.join(', ')}`);
    if (args[0] === 'set') {
      if (!pair.includes('=')) fail('usage: podiumctl config set KEY=VALUE');
      file[key] = v.join('=');
      resolveConfig(file); // validate mode/port
    } else delete file[key];
    writeConfigFile(file);
    say(`${args[0] === 'set' ? 'Set' : 'Unset'} ${key}. Run \`podiumctl restart\` to apply.`);
    return;
  }
  const shown = { ...file };
  if (shown.PODIUM_TOKEN && !flags['show-token']) shown.PODIUM_TOKEN = '(hidden; --show-token or `podiumctl token`)';
  say(`# ${configPath()}\n# resolved: mode=${cfg.mode} port=${cfg.port} bind=${cfg.bind}`);
  say(Object.entries(shown).map(([k, v]) => `${k}=${v}`).join('\n') || '(no settings saved yet)');
}

function servicePaths() {
  return process.platform === 'darwin'
    ? { kind: 'launchd', file: path.join(os.homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`) }
    : { kind: 'systemd', file: path.join(os.homedir(), '.config', 'systemd', 'user', 'podium.service') };
}
const bootEnabled = () => fs.existsSync(servicePaths().file);

function cmdEnable(cfg) {
  const { kind, file } = servicePaths();
  const standalone = cfg.mode === 'standalone';
  const script = fs.realpathSync(fileURLToPath(import.meta.url));
  const args = [process.execPath, script, standalone ? 'run' : 'start', '--mode', cfg.mode];
  const env = { PATH: process.env.PATH ?? '', ...(process.env.PODIUMCTL_HOME ? { PODIUMCTL_HOME: process.env.PODIUMCTL_HOME } : {}) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(homeDir(), { recursive: true });
  if (kind === 'launchd') {
    fs.writeFileSync(file, launchdPlist({ label: SERVICE_LABEL, args, keepAliveOnFailure: standalone, logPath: path.join(homeDir(), 'service.log'), env }));
    const domain = `gui/${os.userInfo().uid}`;
    spawnSync('launchctl', ['bootout', `${domain}/${SERVICE_LABEL}`], { stdio: 'ignore' });
    if (spawnSync('launchctl', ['bootstrap', domain, file], { stdio: 'inherit' }).status !== 0) fail('launchctl bootstrap failed');
    say(`Enabled: ${file}`);
  } else {
    fs.writeFileSync(file, systemdUnit({ args, stopArgs: [process.execPath, script, 'stop', '--mode', cfg.mode], standalone, env }));
    const sc = (a) => spawnSync('systemctl', ['--user', ...a], { stdio: 'inherit' }).status === 0;
    if (!sc(['daemon-reload']) || !sc(['enable', '--now', 'podium.service'])) fail('systemctl failed');
    say(`Enabled: ${file}\nTo start before you log in: loginctl enable-linger $USER`);
  }
  say(`Podium (${cfg.mode} mode) now starts on boot/login.`);
}

function cmdDisable() {
  const { kind, file } = servicePaths();
  if (!fs.existsSync(file)) { say('Not enabled'); return; }
  if (kind === 'launchd') spawnSync('launchctl', ['bootout', `gui/${os.userInfo().uid}/${SERVICE_LABEL}`], { stdio: 'ignore' });
  else {
    spawnSync('systemctl', ['--user', 'disable', '--now', 'podium.service'], { stdio: 'ignore' });
  }
  fs.rmSync(file, { force: true });
  if (kind === 'systemd') spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
  say('Disabled. Check `podiumctl status`: a server the service was running (standalone mode) is stopped with it.');
}

async function cmdRun(cfg) {
  cfg = ensureToken(cfg);
  requireBuilt();
  const child = spawn(process.execPath, [serverEntry()], { cwd: REPO_ROOT, env: standaloneEnv(cfg), stdio: 'inherit' });
  // Record this wrapper's pid, not the server's: `stop` must reach the SIGTERM handler below so the
  // wrapper exits 0 and the boot service (KeepAlive/Restart=on-failure) does not restart the server.
  fs.writeFileSync(pidPath(), String(process.pid));
  let stopping = false;
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { stopping = true; child.kill(sig); });
  child.on('exit', (code, signal) => {
    fs.rmSync(pidPath(), { force: true });
    process.exit(stopping ? 0 : code ?? (signal ? 1 : 0));
  });
}

function cmdRm(cfg, flags) {
  ensurePodman();
  pm(['rm', '-f', CONTAINER], { stdio: 'ignore' });
  say('Container removed (the data volume is kept).');
  if (flags.purge) {
    if (!flags.yes) fail('--purge deletes the database and the image. Re-run with --purge --yes to confirm.');
    pm(['volume', 'rm', '-f', VOLUME], { stdio: 'ignore' });
    pm(['rmi', '-f', IMAGE], { stdio: 'ignore' });
    say('Volume and image removed.');
  }
}

// ---------- main ----------

export async function main(argv) {
  const { cmd, args, flags } = parseArgs(argv);
  if (!cmd || flags.help || cmd === 'help') { say(HELP); return cmd || flags.help ? 0 : 1; }
  const persist = ['build', 'start', 'restart', 'enable'].includes(cmd);
  const cfg = loadCfg(flags, { persist });
  switch (cmd) {
    case 'build': await cmdBuild(cfg); return 0;
    case 'start': await cmdStart(cfg); return 0;
    case 'stop': await cmdStop(cfg); return 0;
    case 'restart': await cmdStop(cfg); await cmdStart(loadCfg({}, { persist: false })); return 0;
    case 'status': return cmdStatus(cfg);
    case 'logs': return cmdLogs(cfg, flags);
    case 'health': { const ok = await healthy(cfg); say(ok ? 'ok' : 'not answering'); return ok ? 0 : 1; }
    case 'url': say(dashUrl(cfg)); return 0;
    case 'token': cmdToken(flags); return 0;
    case 'config': cmdConfig(cfg, args, flags); return 0;
    case 'enable': cmdEnable(cfg); return 0;
    case 'disable': cmdDisable(); return 0;
    case 'run': await cmdRun(cfg); return null;
    case 'shell': ensurePodman(); return pm(['exec', '-it', CONTAINER, '/bin/sh'], { stdio: 'inherit' }).status ?? 1;
    case 'rm': cmdRm(cfg, flags); return 0;
    default: console.error(`unknown command "${cmd}" (see --help)`); return 2;
  }
}

if (fs.realpathSync(process.argv[1] ?? '') === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(
    (code) => { if (code !== null) process.exit(code); },
    (e) => { console.error(e instanceof Fail ? `podiumctl: ${e.message}` : e); process.exit(1); },
  );
}
