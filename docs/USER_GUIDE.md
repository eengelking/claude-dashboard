# User guide

How to set up Podium and read the dashboard. For the option and environment variable tables, see the
[README](../README.md). If something looks wrong, see [GOTCHAS.md](GOTCHAS.md).

Podium shows every Claude Code session on your machine in one browser tab. It only watches: it never sends
a prompt to a session, stops an agent or changes anything.

## What you need

- Claude Code, to run the sessions you want to watch.
- Node 24 and npm, to get the server and `podiumctl`.
- Podman, if you want the server in a container (recommended). Without it, `podiumctl` runs the server as a
  plain Node process.

## Set it up

There are two parts: the server (the dashboard) and the reporter mod (inside each Claude Code session).

### 1. Start the server

```sh
git clone https://github.com/eengelking/podium.git && cd podium && npm link
podiumctl start
```

The first start builds the container image, generates an auth token and saves it to
`~/.podium/config.env`. The dashboard is at http://127.0.0.1:4317/#/. To use a plain Node process instead,
run `podiumctl build --mode standalone` once, then `podiumctl start --mode standalone`.

To have it start when you log in, run `podiumctl enable`.

### 2. Install the reporter mod

In Claude Code:

```
/plugin marketplace add eengelking/skills
/plugin install podium-reporter@eengelking-marketplace
```

Then give it the token. Print it with `podiumctl token`, and enter it with
`/plugin configure podium-reporter@eengelking-marketplace`.

### 3. Check that it works

In a session, run `/podium`. You should see `Connection: online`, and the session appears in the browser
within a couple of seconds. The status line under the prompt reads `podium ● 1 live`. If it says
`podium ○ offline`, see "Something is wrong" below.

Give a session a name that shows on its card with `/podium name <text>`.

## Reading the dashboard

The top bar shows the connection (`N reporters live, synced Xs ago`, or a red "disconnected, retrying"), a
clock and a light or dark theme toggle. The left rail lists your sessions. The right panel shows activity.
Drag the handles between the columns to resize them.

### The wall

The default view (`#/`) is a card per session. At the top are six tiles: sessions live, agents running,
context blowouts, plan steps done, estimated cost today and tokens in the last minute. Below them you can:

- filter by status (All, Running, Waiting, Stale, Blowouts),
- sort (Status, Model, Context blowouts, Context used, Cost, Newest),
- search by name, project or branch.

A card shows the session's name and status, its project and git branch (or worktree, with ahead and behind
counts and how many files changed), its model, effort and context fill, its plan with the current step,
a strip with one square per agent, and its cost, tokens and running time. A red callout means the session
has blown out its context window twice or more, which usually means it has lost context. A **waiting** card
means the session wants you: a permission prompt, or the end of its turn. A **stale** card means it has
stopped reporting.

### One session

Click a card or a rail item. You get the session's goal and working directory, three charts for the last
minute (tokens per second, the largest context fill in any loop with blowout markers, and agents running),
and a bar of facts: model and effort, context, agents (with a red "N failed" button that opens the first
failure), estimated cost, tokens and running time.

Below that is the plan, as a checklist with the agent that owns each step, and the agent tree: every
subagent and fork with its task, type, model, effort, context bar, tokens, cost, time and status. Click a
column header to switch to a sorted flat list, and "Show as tree" to go back. **Copy resume command** copies
the command that resumes the session.

Click an agent to open its detail in the right panel. If it failed, you get the failing call, the last lines
of its output, the evidence behind the likely cause and what happened next. If its context blew out, you get a
timeline of each overflow.

### Activity

The right panel lists what just happened, newest first, 12 at a time. Click a row to jump to the session and
agent it is about. Rows for sessions that have ended are greyed out.

### History and usage

- `#/history` lists the sessions that ended on a day you pick, with their agent detail from stored data. It
  survives a server restart.
- `#/usage` is the earlier dashboard that charts Claude Code and Anthropic Admin API usage. The Claude Code
  half reads the logs under `~/.claude/projects` on the machine the server runs on, so it is empty when
  the server runs in the container; use standalone mode for it. For the API half, add an
  `ANTHROPIC_ADMIN_API_KEY` (see `.env.example`).

### What the numbers mean

Cost is an estimate from token counts and a price table, and it is never a bill. The session's own figure is
the exact ledger from Claude Code; the figures for agents are estimates, and the dashboard labels them so.
Context fill is the share of the model's window in use. A blowout is a loop that overflowed its window and was
compacted or stopped.

The effort shown is read from each model request, so after `/effort` it updates at your next prompt.

## Everyday commands

| Command | What it does |
|---|---|
| `podiumctl status` | Mode, state, health, URL, whether it starts on boot (exit 3 if stopped) |
| `podiumctl logs -f` | Follow the server log |
| `podiumctl restart` | Apply a config change |
| `podiumctl stop` | Stop it; your data is kept |
| `podiumctl token` | Print the auth token (`--rotate` makes a new one) |
| `podiumctl config` | Show the saved settings (`config set KEY=VALUE` changes one) |
| `podiumctl enable` / `disable` | Start on boot or not |

`podiumctl --help` lists the rest.

## Sessions you started without the mod

You do not have to restart them to see them. Claude Code's settings hooks can report a reduced view: the
session, its directory and model, and its agents, marked "settings hooks". See "Sessions without the mod"
in the README for the snippet to add to `~/.claude/settings.json`.

## Something is wrong

| You see | Likely cause |
|---|---|
| `/podium` says offline, `HTTP 401` | The token is missing or wrong. `podiumctl token`, then `/plugin configure` |
| `/podium` says offline, no 401 | The server is not running. `podiumctl status`, then `podiumctl start` |
| The wall is empty | No session has the mod loaded yet, or its token is wrong |
| A card turned stale | The session stopped reporting (closed, crashed or lost the connection) |
| The usage page shows nothing for Claude Code | The server is in the container and cannot see your `~/.claude/projects`. Use standalone mode |
| I changed the config and nothing happened | Run `podiumctl restart` |

More in [GOTCHAS.md](GOTCHAS.md).

## What leaves a session

Only to the server URL you set, and only the fields the README lists under "What leaves the session". Text
is cut to fixed limits, and anything that looks like a secret is replaced with `[redacted]` before it is sent.
Podium never reads whole messages, transcripts or files.

## Remove it

```sh
podiumctl disable                 # if you enabled start on boot
podiumctl rm --purge --yes        # removes the container, its data volume and the image
```

Then remove the mod with `claude plugin uninstall podium-reporter@eengelking-marketplace`, and delete `~/.podium`
if you want the saved config and token gone too.
