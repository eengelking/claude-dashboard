# claude-dashboard

Two dashboards for Claude Code on one machine, served by one local server:

- **Podium** (`#/`, the default): a live fleet console. Every Claude Code session running with the
  Podium reporter mod shows up in one browser tab within about two seconds, with its model and effort,
  its plan, the agents it launched (subagents and forks), what each costs, how full each context window
  is, how often a window blew out, why anything failed, and which git branch or worktree it works in.
  Sessions appear when they start and leave when they end, with no refresh. Podium only observes: it
  never sends prompts or touches a session.
- **Usage** (`#/usage`): the earlier dashboard that charts Claude Code and Admin API usage.

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
with Ctrl-C; it ends every session it started, and they leave the dashboard a few seconds later.

For a production-style run, `npm run build` and then `npm run start -w server` serves the built UI and
the API from http://127.0.0.1:4317.

## Report a real session

The reporter is a Claude Code mod in `mod/podium-reporter/`. Load it for a session with:

```sh
claude --plugin-dir /path/to/claude-dashboard/mod/podium-reporter
```

(Installing it through a plugin marketplace is not set up yet.) The session appears in Podium at once.
In the session, `/podium` prints the dashboard link, the connection state and report counts, and
`/podium name <text>` gives the session a display name. The status line under the prompt reads
`podium ● N live`, or `podium ○ offline` while the server is unreachable (reports queue up and go out
when it is back).

The mod's options are set in Claude Code settings under `pluginConfigs`, keyed `podium-reporter`, or
from the config menu:

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
gets in the session's way. When the server sets `PODIUM_TOKEN`, add `-H 'X-Podium-Token: <token>'`. Don't
use these hooks and the mod in the same session; the mod already reports everything they would.

## Server settings

Environment variables (see `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4317` | Server port (the Vite proxy follows it) |
| `HOST` | `127.0.0.1` | Bind address. Podium is for one machine; leave it on localhost |
| `PODIUM_DB` | `data/podium.sqlite` | SQLite database file |
| `PODIUM_TOKEN` | empty | When set, `POST /api/fleet/report`, `POST /api/fleet/hook` and `DELETE` require `X-Podium-Token` |
| `STALE_AFTER_MS` | `15000` | A session not heard from this long shows as stale |
| `DROP_AFTER_MS` | `60000` | A stale session leaves the fleet after this much more |
| `LINGER_MS` | `8000` | An ended session stays on screen this long |
| `RETAIN_SAMPLES_MS` | 24 hours | Per-second chart samples kept |
| `RETAIN_EVENTS_MS` | 30 days | Activity events kept |
| `RETAIN_SESSIONS_MS` | 30 days | Ended sessions kept |

Sessions, agents and events are stored in SQLite (Node's built-in `node:sqlite`), so a server restart
loses nothing that was reported: sessions come back as stale and recover when their reporters send again.

## Tests and checks

```sh
npm test               # server and UI tests (vitest), plus the simulator's
npm run test:mod       # the mod's tests, run by `claude plugin test` on the engine
npm run typecheck:mod  # the mod against Claude Code's plugin API declarations
npm run build          # UI, server and scripts type-check and build
npm run podium:smoke   # end to end: server, simulator, SSE directly and through Vite
scripts/podium-soak.sh --help   # load and restart check
```

`docs/SPEC.md` is the build spec for Podium. `docs/ARCHITECTURE.md` describes how it was built, where it
departs from the spec and why, what was verified, and the known issues.
