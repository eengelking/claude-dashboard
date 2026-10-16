# podium

![Podium showing nine simulated Claude Code sessions: running, stale and failing orchestrators, context blowouts, and the activity feed](docs/images/podium-chaos.png)

Two dashboards for Claude Code on one machine, served by one local server:

- **Podium** (`#/`, the default): a live fleet console. Every Claude Code session running with the
  Podium reporter mod shows up in one browser tab within about two seconds of its first prompt, with its model and effort,
  its plan, the agents it launched (subagents and forks), what each costs, how full each context window
  is, how often a window blew out, why anything failed, and which git branch or worktree it works in.
  Sessions appear when they start and leave when they end, with no refresh. Podium watches; the one thing it
  can send is an answer to a session that waits on you (a question, a plan, a tool's permission prompt, a message,
  `/clear` or `/compact`), and only once the server's Admin and the session's owner have both turned that on.

New here? [docs/USER_GUIDE.md](docs/USER_GUIDE.md) walks through setup and reading the dashboard.

Cost in Podium is an estimate from token counts and a price table. The table starts as Anthropic's list
prices and you can change any price in Admin > Model prices. It is never a bill.

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
other options (`--url`, `--speed`, `--seed`, `--duration`, `--agents`, `--token`, `--person`, `--unnamed`, `--print`). Stop it
with Ctrl-C; it ends every session it started, and they leave the dashboard a few seconds later. If the
server has a token (`podiumctl start` sets one), pass it: `--token "$(podiumctl token)"`.

To see the people view, give the simulator people with a token each from Admin:
`--person "Ed E.=<Ed's token>" --person "Priya N.=<Priya's token>" --unnamed`. Sessions go to the people in
turn, each on a laptop and every third one on a build box; `--unnamed` keeps a share of sessions with no name,
which show under Admin when they send the admin secret with `--token`.

To serve the built UI and the API without a container, `npm run build` and then `npm run start -w server`
(http://127.0.0.1:4317). `podiumctl`, below, does the same thing and manages it for you.

### What it costs to run

The more sessions and agents report, the more Podium needs. Every agent adds data that the server stores and
sends to the browser, and the browser draws it, so the work grows with the amount of data consumed.

- **Server CPU and memory** grow with ingest, the SQLite writes and the state sent to every open client. This
  load is there whether or not a browser is open.
- **Browser CPU, memory and GPU** grow with the rows, charts, animations and updates to draw. This load is
  per open tab.

As one example, Chrome on an M5 MacBook Pro used about 24% GPU with ten simulated sessions and a hundred
agents on screen, against about 15% for a plain page (#81). That is one machine and one browser, not a
promise. To measure your own, open a tab and run `scripts/gpu-sample.sh` (macOS; `--help` lists its options).

To lower it, keep fewer sessions on screen, leave the tab hidden (animations pause while it is), use wall mode
(`w`), which hides the side panes and top bar so the browser stops drawing them, and close the dashboard when
nobody is looking.

## Run it as a service (podiumctl)

`bin/podiumctl` starts, stops and watches the server without a dev setup. It runs Podium either in
a **Podman container** (the default when Podman is installed) or as a **standalone** Node process on the
host, and has no dependencies of its own. Install it on your PATH from the repo with `npm link`, or run
`bin/podiumctl <command>` (no `node` in front) or `npm run podiumctl --`.

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
makes a new one. This is the **admin secret**: it opens the Admin section (below) and, on a one-person
setup, you can also enter it in the mod's `token` option (see "Report a real session") and in the
`X-Podium-Token` header of the settings hooks below. To run without auth, `podiumctl config set PODIUM_TOKEN=`
(empty on purpose). Admin is switched off then, because nothing would protect it.

**Admin and per-person tokens.** When several people report to one Podium, open **Admin** (the button in the
top bar's upper right, or `#/admin`) and enter the admin secret. Create a user and Podium makes a token for
them, shown once with the settings to paste: their name and the token. A token only works with the name it
was made for, so a leaked token alone cannot claim someone else's name. From Admin you can also rotate or
revoke a token, put people in groups (a label for arranging the console, nothing more), turn off reporting
with the admin secret, and read the admin log. Tokens are stored hashed, so Podium cannot show one again.
Reporting with the admin secret keeps working, and those sessions show under the owner **Admin**. Admin
locks after 10 idle minutes, and five wrong secrets lock it for 15 minutes. Tokens travel in a header as
they do today, so a server reachable over a network needs a trusted network or a TLS proxy.

**Several people on one Podium.** The server listens on `127.0.0.1` by default, so only your own machine
can reach it. To let other people report to it:

1. Restart it on an address the others can reach: `podiumctl restart --bind 0.0.0.0` (all interfaces), or
   the one interface they use. The container then publishes the port on that address too. Allow the port
   (4317 by default) in the firewall for the people who need it and no one else.
2. Make each person a token in Admin. They set `serverUrl` to `http://<your host>:4317`, `token` to their
   token and `userName` to the name you gave them (see "Report a real session").
3. Once a session reports with a person's token, the console groups the wall by person (see "People" in
   [docs/USER_GUIDE.md](docs/USER_GUIDE.md)).

Know what that costs. Reading the console needs no token, so anyone who can reach the port sees every
session: names, machines, paths, branches, plan steps, commands from failed calls and the excerpts listed
under "What leaves the session". Tokens and reports cross the network in plain HTTP, so use a network you
trust or put a TLS proxy in front. Anyone with a valid token can delete any session. The name shown on a
session comes from the token that sent it: with the shared admin secret every session shows as Admin,
and with the server's auth turned off every session is Unassigned, because then anyone could claim any
name. Per-person read permissions are not part of Podium.

Other settings (`STALE_AFTER_MS`, `RETAIN_*`, the `PODIUM_LOG_*` logging settings, and so on, see the table
below) are set with `podiumctl config set KEY=VALUE` and applied on `restart`. "Logs" in the
[user guide](docs/USER_GUIDE.md#logs) covers what the server logs, sending it to VictoriaLogs, and pointing an
agent at it. Set `PODIUMCTL_HOME` to keep the files
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

If the server uses a token (`podiumctl start` generates one), enter it with
`/plugin configure podium-reporter@eengelking-marketplace`. On your own machine that is the admin secret
(`podiumctl token`). If someone runs the server for a group, they make you a token in Admin: enter it as
`token`, and your name as `userName`. The token option is secret, so it has no row in the `/config` menu.
Without a token the server accepts, or with a token that does not belong to your name, the reporter gets
HTTP 401, logs it once, and tries again about once a minute. `/podium` and the status line say so.

To work on the mod itself, load it from a checkout for one session instead:

```sh
claude --plugin-dir /path/to/podium/mod/podium-reporter
```

The session appears in Podium once you send its first prompt. A session that has done nothing yet is kept
off the wall, because Claude Code's background daemon also runs idle twins and spares that report too (see
"Sessions that have not done anything yet" in [docs/USER_GUIDE.md](docs/USER_GUIDE.md)).
In the session, `/podium` prints the dashboard link, the connection state and report counts, and
`/podium name <text>` gives the session a display name. The status line under the prompt reads
`podium v0.11.1 ● N live` (N is the cards on the wall, so a session that has not run yet reads 0), or `podium v0.11.1 ○ offline` while the server is unreachable (reports queue up and go out
when it is back). When the mod and the server are on versions that do not match, it ends in `· update mod` or `· upgrade server`, and in `· update available` when the server supports a newer mod than yours. To update the mod, run `claude plugin update podium-reporter@eengelking-marketplace` and then `/reload-plugins` in the session (see "Updating the mod" in [docs/USER_GUIDE.md](docs/USER_GUIDE.md)). Claude Code puts a `⚠` and the mod's name in front of the line; that is how it draws every
mod's status line, not a Podium warning (see [docs/GOTCHAS.md](docs/GOTCHAS.md)). Effort is read from each model request, so a change made with `/effort` shows after
the session's next prompt, not when you pick it.

Set the mod's options with `/plugin configure podium-reporter@eengelking-marketplace`, or in
`~/.claude/settings.json` under `pluginConfigs`, `podium-reporter@eengelking-marketplace`, `options`
(`podium-reporter` for a copy loaded with `--plugin-dir`). Claude Code keeps `token` in its secure storage
instead. Everything except `token` also has a row in the `/config` menu.

| Option | Default | Meaning |
|---|---|---|
| `serverUrl` | `http://127.0.0.1:4317` | Where reports go |
| `token` | empty | Sent as `X-Podium-Token`: a per-person token from Admin, or the admin secret (`PODIUM_TOKEN`) on a one-person setup |
| `userName` | empty | The name your token was made for. The server accepts a report only when the token and this name match. Leave empty when you report with the admin secret. Nothing that names you or your machine is sent until you set it; with it set, reports also carry this machine's name (see below) |
| `flushIntervalMs` | `1000` | Minimum time between reports while something changes |
| `heartbeatMs` | `5000` | Report at least this often |
| `sessionName` | empty | Display name override |
| `showStatus` | `true` | Show the status line entry |
| `fullPrompts` | `false` | Send each agent's whole task prompt and final answer (up to 20,000 characters each, secrets redacted) so the console can open them in a modal. Off by default: only the first 400 characters leave the session. Everyone who can open the console can read them |
| `activityFeed` | `false` | Send an agent's recent activity: while someone has that agent's panel open in the console, its last 20 tool calls (the tool's name and a short summary of its arguments) and the text it writes between them, each cut to 300 characters with secrets redacted. Nothing is sent for an agent nobody is watching, and the server keeps it in memory only. The orchestrator's own loop works the same way. Everyone who can open the console can watch. The server's Admin can also switch the feed off for everyone under Admin > Settings > Feature flags (on by default); while it is off the server asks no mod for it |
| `respond` | `off` | Respond from Podium: what this session accepts from Podium, sent by its owner or an Admin. `off` (nothing), `questions` (answers to questions, and new messages while idle), `questions-and-plans` (the above, plus approving or rejecting a plan), `everything` (the above, plus allowing or denying a tool, allow once only, and `/clear`, `/compact`). It needs `activityFeed` on too, and the server's Respond from Podium switch in Admin > Settings > Feature flags (off by default) |
| `explainFailures` | `false` | Ask a small model (Haiku, low effort) for a two-sentence explanation of each failed agent, from the redacted failure record only. Costs a little; off by default |

### What leaves the session

Only to the server URL above, and only this:

- the session's id, working directory, repository name, git branch and counts (ahead, behind, modified),
  model, effort, context fill, cost, token counts (also totalled per model, and per model for each agent, so
  the server can price them) and rate-limit percentages;
- the paths of the files the session changed in its repository, each with its status and its added and
  removed line counts (at most 200 files; never file contents or diff text);
- the plan's step titles (from TaskCreate, TaskUpdate or TodoWrite; a session that does not use these tools
  shows "No plan reported. Agents were launched ad hoc.", and plan mode does not make a plan appear, see
  [Gotchas](docs/GOTCHAS.md#a-session-shows-no-plan));
- for the orchestrator's own loop: how many model requests it made, the name of every tool it used with how
  many times, and the skills it loaded;
- per agent: type, description, model, effort, status, token counts, skills it loaded, the name of every
  tool it used with how many times, the first 400 characters of its task prompt and of its final answer, or the whole of each (up to 20,000
  characters) only when you have turned on `fullPrompts`;
- for a failed call: the tool, a one-line summary of the call (a Bash command, or a tool and a file
  path), its exit code and the last 12 lines of its output;
- when a session is idle on background work or a scheduled wake-up: each task's type (shell, agent, monitor, workflow, wake-up), a short description of at most 120 characters, its status and when the wake-up fires. A shell's command is never sent;
- short activity lines ("spawned Explore (Haiku low): Map call sites");
- whether `activityFeed` is on, and only when you have turned it on, the server's Admin has not turned the
  feed off, and someone is watching an agent's (or the orchestrator's) panel right now: that loop's last 20 tool calls, each the tool's name and a short
  summary of its arguments (a Bash command, a file path, a search pattern), and the text the model wrote
  between them, each cut to 300 characters. The model's thinking is never sent. When nobody is watching,
  nothing of it is read or sent, and the server forgets it soon after the panel closes;
- only when you have set `respond` (and `activityFeed`), and the server takes answers: what the session accepts, and
  while it waits on you, the open question (its questions, options and previews), plan (its text and file path) or
  tool call (the tool and its arguments), each cut to fixed limits and redacted, so its owner can answer from the
  console. It is shown only to the session's owner or an Admin, and the server keeps it in memory only. After a
  `/clear`, the new session also names the one it continues, so History can link them;
- only when you have set `userName`: that name, and which machine the session runs on: its short host name
  (what `hostname` prints, up to the first dot) and a random 12-character id the mod makes the first time
  and keeps in its own store (`~/.claude/plugins/store/podium-reporter_…json`, key `machineId`), so two
  machines with the same host name stay apart. The id is random, not read from the hardware, and the
  operating system user name and `git config` are never read.

Before anything is sent, text is cut to those limits and anything that looks like a secret is replaced
with `[redacted]`: `sk-ant-...` keys, `ghp_...` tokens, `AKIA...` keys, `Bearer ...` values, and the
values after `password=`, `token=`, `secret=`, `apikey=` and `api_key=`. Podium never reads transcripts or
files, sends a whole prompt or answer only for `fullPrompts`, and sends what an agent is doing only for
`activityFeed`, while someone watches.

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
mark the session as waiting on you; the `Stop` hook does, unless it lists background work or a scheduled wake-up still in flight, in which case the session shows what it is waiting on instead (Podium reads the hook's `background_tasks` and `session_crons`, never a shell's command).

## Server settings

Environment variables (see `.env.example`). Under `podiumctl` you set them with `podiumctl config set`,
and it chooses `PORT`, `HOST` and `PODIUM_DB` itself.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4317` | Server port (the Vite proxy follows it) |
| `HOST` | `127.0.0.1` | Bind address. Podium is for one machine; leave it on localhost |
| `PODIUM_DB` | `data/podium.sqlite` | SQLite database file (`podiumctl` uses `/data/podium.sqlite` in the container and `~/.podium/data/podium.sqlite` standalone) |
| `PODIUM_HOST_HOME` | the server's own home | Home directory to show as `~` in session paths. `podiumctl` sets it to your home in the container, where the server's own home is `/home/node`. Ignored unless it is an absolute path |
| `PODIUM_TOKEN` | empty | The admin secret. When set, `POST /api/fleet/report`, `POST /api/fleet/hook` and `DELETE` require `X-Podium-Token` (this or a person's token), and it opens Admin |
| `TZ` | the server's own zone | Timezone whose midnight starts "today" for "Est. cost today". `podiumctl` gives the container your host's zone; set it with `podiumctl config set TZ=Europe/Berlin` to override |
| `STALE_AFTER_MS` | `15000` | A session not heard from this long shows as stale |
| `HOOK_STALE_AFTER_MS` | `600000` | Same as `STALE_AFTER_MS`, for sessions known only from settings hooks (they send no heartbeat) |
| `DROP_AFTER_MS` | `60000` | A stale session leaves the fleet after this much more |
| `LINGER_MS` | `8000` | An ended session stays on screen this long |
| `DETACHED_HIDE_AFTER_MS` | `60000` | A session nobody is attached to (a background job left running after `/exit`) shows dimmed this long, then is set aside behind a "background sessions hidden" line |
| `RETAIN_SAMPLES_MS` | 24 hours | Per-second chart samples kept |
| `RETAIN_EVENTS_MS` | 30 days | Activity events kept |
| `RETAIN_SESSIONS_MS` | 30 days | Ended sessions kept |
| `PODIUM_LOG_LEVEL` | `info` | Lowest log level printed and shipped: `debug`, `info`, `warn` or `error`. `debug` adds one line per HTTP request, and in the text format the session, reporter, sweep and Admin lines |
| `PODIUM_LOG_FORMAT` | `text` | `text` prints each line's message, as before; `json` prints one JSON object per line |
| `PODIUM_LOG_SHIP_URL` | empty | Also push every log line to this endpoint, such as a VictoriaLogs server (`http://HOST:9428`; `/insert/jsonline` is added). Empty means nothing leaves the machine |
| `PODIUM_LOG_SHIP_HEADERS` | empty | Headers for that endpoint, `Name=Value;Name2=Value2` (for example `Authorization=Bearer ...;AccountID=1`). Never printed or logged |
| `PODIUM_LOG_SHIP_BUFFER` | `2000` | Log lines kept while the endpoint is down; past that the oldest are dropped |

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
scripts/gpu-sample.sh --help    # sample the Mac's GPU load while a tab is open (macOS)
scripts/agent-context-audit.sh --help  # compare each agent's Tokens with its own transcript
scripts/agent-tokens-sample.sh --help  # log a running agent's Tokens over time
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
| [`docs/THIRD_PARTY_NOTICES.md`](docs/THIRD_PARTY_NOTICES.md) | Credits and licenses for the color theme palettes |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed in each release |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to propose and land a change |
| [`.github/SECURITY.md`](.github/SECURITY.md) | How to report a vulnerability (privately) |
| [`.github/CODE_OF_CONDUCT.md`](.github/CODE_OF_CONDUCT.md) | Community expectations |

Podium is released under the [MIT License](LICENSE).
