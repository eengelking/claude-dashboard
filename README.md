# podium

Two dashboards for Claude Code on one machine, served by one local server:

- **Podium** (`#/`, the default): a live fleet console. Every Claude Code session running with the
  Podium reporter mod shows up in one browser tab within about two seconds of its first prompt, with its model and effort,
  its plan, the agents it launched (subagents and forks), what each costs, how full each context window
  is, how often a window blew out, why anything failed, and which git branch or worktree it works in.
  Sessions appear when they start and leave when they end, with no refresh. Podium only observes: it
  never sends prompts or touches a session.

New here? [docs/USER_GUIDE.md](docs/USER_GUIDE.md) walks through setup and reading the dashboard.

Cost in Podium is an estimate from token counts and a price table (see
`mod/podium-reporter/hooks/models.ts`), except the orchestrator's own figure, which is the session's
cost ledger. It is never a bill.

## Run it

Requires Node 24 and npm.

```sh
npm install
npm run dev          # server on http://127.0.0.1:4317, Vite UI on http://localhost:5173
```

Open http://localhost:5173/#/. With nothing reporting yet, the wall says how to start a session.

To see it with simulated sessions instead of real ones, in a second terminal:

```sh
npm run podium:sim -- --sessions 5 --chaos
```

`--chaos` adds sessions that go silent, more failures and more context blowouts. `--help` lists the
other options (`--url`, `--speed`, `--seed`, `--duration`, `--agents`, `--token`, `--print`). Stop it
with Ctrl-C; it ends every session it started, and they leave the dashboard a few seconds later. If the
server has a token (`podiumctl start` sets one), pass it: `--token "$(podiumctl token)"`.

To serve the built UI and the API without a container, `npm run build` and then `npm run start -w server`
(http://127.0.0.1:4317). `podiumctl`, below, does the same thing and manages it for you.

## Run it as a service (podiumctl)

`bin/podiumctl.mjs` starts, stops and watches the server without a dev setup. It runs Podium either in
a **Podman container** (the default when Podman is installed) or as a **standalone** Node process on the
host, and has no dependencies of its own. Install it on your PATH from the repo with `npm link`, or run
`node bin/podiumctl.mjs` / `npm run podiumctl --`.

```sh
git clone https://github.com/eengelking/podium.git && cd podium && npm link
podiumctl start                     # builds the image on first use, then runs it on http://127.0.0.1:4317
podiumctl status                    # mode, state, health, URL, boot setting (exit 3 when stopped)
podiumctl logs -f                   # follow the log
podiumctl restart                   # after changing the config
podiumctl stop
podiumctl enable                    # start on boot / login (launchd on macOS, systemd user unit on Linux)
podiumctl disable
podiumctl start --mode standalone   # no container: needs `podiumctl build --mode standalone` once
podiumctl rm --purge --yes          # remove the container, its data volume and the image
```

`--mode`, `--port` and `--bind` are saved, so later commands reuse them. Container mode keeps the
database in the Podman volume `podium-data`; standalone keeps it in `~/.podium/data/`. Container mode
publishes the port on `127.0.0.1` only.

**Auth token.** The first `start` generates a random token and saves it as `PODIUM_TOKEN` in
`~/.podium/config.env` (mode 0600). Find it any time with `podiumctl token`; `podiumctl token --rotate`
makes a new one. Enter it in the mod's `token` option (see "Report a real session") and in the
`X-Podium-Token` header of the settings hooks below. To run without auth, `podiumctl config set PODIUM_TOKEN=` (empty on purpose).

Other settings (`STALE_AFTER_MS`, `RETAIN_*`, and so on, see the table below) are set with
`podiumctl config set KEY=VALUE` and applied on `restart`. Set `PODIUMCTL_HOME` to keep the files
somewhere other than `~/.podium`. `podiumctl --help` lists everything.

Start on boot: in container mode the boot service runs `podiumctl start`, which also starts the Podman
machine on macOS; in standalone mode it runs the server in the foreground and restarts it if it crashes.
On Linux, `loginctl enable-linger $USER` makes the user unit start before you log in. (The Linux unit is
generated and unit-tested but has not been run on a Linux host.)

## Report a real session

The reporter is a Claude Code mod in `mod/podium-reporter/`. Install it from the eengelking
marketplace, in Claude Code:

```
/plugin marketplace add eengelking/skills
/plugin install podium-reporter@eengelking-marketplace
```

If the server uses a token (`podiumctl start` generates one), get it with `podiumctl token` and enter it
with `/plugin configure podium-reporter@eengelking-marketplace`. The token option is secret, so it has no
row in the `/config` menu. Without it the reporter gets HTTP 401 and `/podium` says so.

To work on the mod itself, load it from a checkout for one session instead:

```sh
claude --plugin-dir /path/to/podium/mod/podium-reporter
```

The session appears in Podium once you send its first prompt. A session that has done nothing yet is kept
off the wall, because Claude Code's background daemon also runs idle twins and spares that report too (see
"Sessions that have not done anything yet" in [docs/USER_GUIDE.md](docs/USER_GUIDE.md)).
In the session, `/podium` prints the dashboard link, the connection state and report counts, and
`/podium name <text>` gives the session a display name. The status line under the prompt reads
`podium ● N live` (N is the cards on the wall, so a session that has not run yet reads 0), or `podium ○ offline` while the server is unreachable (reports queue up and go out
when it is back). Claude Code puts a `⚠` and the mod's name in front of the line; that is how it draws every
mod's status line, not a Podium warning (see [docs/GOTCHAS.md](docs/GOTCHAS.md)). Effort is read from each model request, so a change made with `/effort` shows after
the session's next prompt, not when you pick it.

Set the mod's options with `/plugin configure podium-reporter@eengelking-marketplace`, or in Claude Code
settings under `pluginConfigs`, `podium-reporter`, `options`. Everything except `token` also has a row in
the `/config` menu.

| Option | Default | Meaning |
|---|---|---|
| `serverUrl` | `http://127.0.0.1:4317` | Where reports go |
| `token` | empty | Sent as `X-Podium-Token` when the server sets `PODIUM_TOKEN` |
| `flushIntervalMs` | `1000` | Minimum time between reports while something changes |
| `heartbeatMs` | `5000` | Report at least this often |
| `sessionName` | empty | Display name override |
| `showStatus` | `true` | Show the status line entry |
| `explainFailures` | `false` | Ask a small model (Haiku, low effort) for a two-sentence explanation of each failed agent, from the redacted failure record only. Costs a little; off by default |

### What leaves the session

Only to the server URL above, and only this:

- the session's id, working directory, repository name, git branch and counts (ahead, behind, modified),
  model, effort, context fill, cost, token counts and rate-limit percentages;
- the plan's step titles (from TaskCreate, TaskUpdate or TodoWrite);
- per agent: type, description, model, effort, status, token counts, skills it loaded, last tool name,
  the first 400 characters of its task prompt and of its final answer;
- for a failed call: the tool, a one-line summary of the call (a Bash command, or a tool and a file
  path), its exit code and the last 12 lines of its output;
- short activity lines ("spawned Explore (Haiku low): Map call sites").

Before anything is sent, text is cut to those limits and anything that looks like a secret is replaced
with `[redacted]`: `sk-ant-...` keys, `ghp_...` tokens, `AKIA...` keys, `Bearer ...` values, and the
values after `password=`, `token=`, `secret=`, `apikey=` and `api_key=`. Podium never reads whole
messages, transcripts or files.

### Sessions without the mod

Claude Code's settings hooks can report a reduced view of sessions that were started without the mod:
the session, its working directory and model, agents by type, and waiting or ended states. They carry no
token counts, so context, cost and the plan stay empty, and Podium marks those sessions "settings hooks".
Add this to `~/.claude/settings.json` (or a project's `.claude/settings.json`):

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "curl -s -m 2 -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:4317/api/fleet/hook >/dev/null || true" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "curl -s -m 2 -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:4317/api/fleet/hook >/dev/null || true" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "curl -s -m 2 -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:4317/api/fleet/hook >/dev/null || true" }] }],
    "SubagentStart":    [{ "hooks": [{ "type": "command", "command": "curl -s -m 2 -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:4317/api/fleet/hook >/dev/null || true" }] }],
    "SubagentStop":     [{ "hooks": [{ "type": "command", "command": "curl -s -m 2 -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:4317/api/fleet/hook >/dev/null || true" }] }],
    "Notification":     [{ "hooks": [{ "type": "command", "command": "curl -s -m 2 -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:4317/api/fleet/hook >/dev/null || true" }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "curl -s -m 2 -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:4317/api/fleet/hook >/dev/null || true" }] }]
  }
}
```

Each hook posts the payload Claude Code gives it on stdin and always exits 0, so a stopped server never
gets in the session's way. When the server sets `PODIUM_TOKEN`, add `-H 'X-Podium-Token: <token>'`.

A session that the mod reports is never changed by hooks: the server acknowledges a hook for it and drops
it, so enabling both is harmless. Settings hooks send no heartbeat, so a hook-only session is allowed to
stay silent for `HOOK_STALE_AFTER_MS` (10 minutes) before it shows as stale. A finishing subagent does not
mark the session as waiting on you; the `Stop` hook does.

## Server settings

Environment variables (see `.env.example`). Under `podiumctl` you set them with `podiumctl config set`,
and it chooses `PORT`, `HOST` and `PODIUM_DB` itself.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4317` | Server port (the Vite proxy follows it) |
| `HOST` | `127.0.0.1` | Bind address. Podium is for one machine; leave it on localhost |
| `PODIUM_DB` | `data/podium.sqlite` | SQLite database file (`podiumctl` uses `/data/podium.sqlite` in the container and `~/.podium/data/podium.sqlite` standalone) |
| `PODIUM_HOST_HOME` | the server's own home | Home directory to show as `~` in session paths. `podiumctl` sets it to your home in the container, where the server's own home is `/home/node`. Ignored unless it is an absolute path |
| `PODIUM_TOKEN` | empty | When set, `POST /api/fleet/report`, `POST /api/fleet/hook` and `DELETE` require `X-Podium-Token` |
| `STALE_AFTER_MS` | `15000` | A session not heard from this long shows as stale |
| `HOOK_STALE_AFTER_MS` | `600000` | Same as `STALE_AFTER_MS`, for sessions known only from settings hooks (they send no heartbeat) |
| `DROP_AFTER_MS` | `60000` | A stale session leaves the fleet after this much more |
| `LINGER_MS` | `8000` | An ended session stays on screen this long |
| `RETAIN_SAMPLES_MS` | 24 hours | Per-second chart samples kept |
| `RETAIN_EVENTS_MS` | 30 days | Activity events kept |
| `RETAIN_SESSIONS_MS` | 30 days | Ended sessions kept |

Sessions, agents and events are stored in SQLite (Node's built-in `node:sqlite`), so a server restart
loses nothing that was reported: sessions come back as stale and recover when their reporters send again.

## Tests and checks

```sh
npm test               # server and UI tests (vitest), plus the simulator's and podiumctl's
npm run test:mod       # the mod's tests, run by `claude plugin test` on the engine
npm run typecheck:mod  # the mod against Claude Code's plugin API declarations
npm run build          # UI, server and scripts type-check and build
npm run podium:smoke   # end to end: server, simulator, SSE directly and through Vite
scripts/podium-soak.sh --help   # load and restart check
```

## Docs and project files

| File | What it is |
|---|---|
| [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) | Setting Podium up and reading the dashboard |
| [`docs/SPEC.md`](docs/SPEC.md) | The build spec: intended behavior and requirements |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How it was built, where it departs from the spec and why, what was verified, known issues |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why the significant choices were made |
| [`docs/GOTCHAS.md`](docs/GOTCHAS.md) | Sharp edges that are easy to hit |
| [`docs/DEMO.md`](docs/DEMO.md) | A script and a paste-in prompt for showing Podium to other people |
| [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) | Credits and licenses for the color theme palettes |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed in each release |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to propose and land a change |
| [`.github/SECURITY.md`](.github/SECURITY.md) | How to report a vulnerability (privately) |
| [`.github/CODE_OF_CONDUCT.md`](.github/CODE_OF_CONDUCT.md) | Community expectations |

Podium is released under the [MIT License](LICENSE).
