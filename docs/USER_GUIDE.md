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

In a session, run `/podium`. You should see `Connection: online`. Then send the session a prompt. A session
appears in the browser within a couple of seconds of doing its first bit of work, not before, so a brand new
session is not on the wall yet and its status line reads `podium ● 0 live`. Once it has run, the status line
reads `podium ● 1 live`. If it says `podium ○ offline`, see "Something is wrong" below, and for the other
case see "Sessions that have not done anything yet".

Give a session a name that shows on its card with `/podium name <text>`.

## Reading the dashboard

The top bar shows the connection (`N reporters live, synced Xs ago`, or a red "disconnected, retrying"), a
clock. The row under it has the theme picker. The left rail lists your sessions. The right panel shows activity.
Drag the handles between the columns to resize them.

**Themes.** Pick a color theme from the Theme dropdown in the row under the top bar (Podium, Solarized, Nord, Gruvbox, Catppuccin or GitHub), then choose Light, Dark or System for it. System follows your operating system and changes with it. Podium is the default. Your choice is kept in this browser, and a light or dark choice from an older version carries over as Podium in that mode. The palettes belong to their authors and are credited under Theme credits at the bottom left of the left rail, next to a License link, and in `THIRD_PARTY_NOTICES.md`. The same footer shows the version of the server you are looking at, for example `Podium v0.1.0`, so you can tell which build is live.

For a wall display, collapse what you do not need. Each of the left pane, the right pane and the top bar
collapses from its own button and from a key: `[` for the left pane, `]` for the right pane and `\` for
the top bar. A collapsed pane leaves a slim tab to open it again, and the pane returns to the width you had.
Your choice is remembered. **Wall mode** (the button in the top right, or `w`) collapses all three at once and
asks the browser for fullscreen. Leave it with `Esc` or the Exit wall mode button, and everything goes back
to how it was. After a few seconds without movement the cursor and the buttons hide; move the mouse or press
a key to bring them back. If the connection to the server is lost, a red alert stays on screen even with
everything collapsed. Below 1040 px wide the panes stack, and the buttons fold a stacked section instead.

### The wall

The default view (`#/`) is a card per session. At the top are six tiles: sessions live, agents running,
context blowouts, plan steps done, estimated cost today and tokens in the last minute. Below them you can:

- filter by status (All, Running, Waiting, Stale, Blowouts),
- sort (Status, Model, Context blowouts, Context used, Cost, Newest),
- search by name, project or branch.

A card shows the session's name and status, its project and git branch (or worktree, with ahead and behind
counts and how many files changed), its model, effort and context fill, its plan with the current step,
a strip with one square per agent, and its cost, tokens and running time. A path or branch that is too long
for the card is shortened (the path from the front, the branch at the end); hover it to see the full value.
A red callout means the session has blown out its context window twice or more, which usually means it has lost context. A **waiting** card
means the session wants you: a permission prompt, a question, or the end of its turn. It says whether it needs
your approval or your input. A **stale** card means it has
stopped reporting. It says how long until it goes away by itself, and has a **Remove** button (also on its
rail row, and **Remove now** on its page) to clear it at once. The session stays in History, and the card
comes back if the session reports again.

### Sessions that have not done anything yet

A session is put on the wall once it has done something: it is running, or it has tokens, cost, context
use, a blowout, an agent or a plan. Until you send it a prompt it is not shown, and the status line in a
fresh session reads `podium ● 0 live`. This is on purpose.

Claude Code's background daemon runs sessions you did not start by hand. On Claude Code 2.1.296 we saw a
parked background twin of each interactive window and a pool of pre-warmed spare processes. Every one of
them loads the reporter and reports itself as a session, so a single window could put three identical
"waiting on you" cards on the wall. Podium keeps the ones that have done nothing off the wall, out of the
activity feed and out of the history, and shows them the moment they start work.

What that means in practice:

- Open Claude Code in a project: no card yet. Send a prompt and one card appears.
- The `N` in `podium ● N live` is the number of cards on the wall, not the number of Claude Code processes
  on your machine.
- After `/clear` the old card ends and the new session gets a card once you send its first prompt.
- A card can stay on the wall after you close the window. Closing Claude Code can leave the conversation
  running in the background (the window says "Your conversation moved to the background"). That is a real
  session and it stays until it ends. See "Closing a background session" below for how to list and end it.
- Sessions you started without the mod, reported through settings hooks, are never hidden this way, because
  hooks carry no token or cost figures to judge them by.

The rule is in SPEC.md, section 7.5.

### Closing a background session

Podium only observes, so it cannot close a session for you. Claude Code can:

1. **List them.** `claude agents` opens Claude Code's agent view, with each background session and whether it
   needs input. For a plain list, run `claude agents --json --cwd ~/dev/skills` (use your own project
   directory). Each entry has an `id`, a `name` and a `state`. Add `--all` to include finished ones.
2. **Match the card to the session.** Look for the project directory and the name. Do not match on the id
   shown on a card: a card shows the session id, which changes on `/clear`, while the commands below take
   the background session's own `id` from the list. After a `/clear` the two differ (a card might read
   `ba37e9d6` for the session `claude agents` calls `ee780da5`).
3. **End it.** `claude stop <id>` stops the session and keeps its conversation, so
   `claude attach <id>` can open it again later. The card leaves the wall a few seconds after it stops.
4. **Or delete it.** `claude rm <id>` deletes the session and its worktree, and works on sessions that have
   already exited. If the worktree has unpushed commits or uncommitted changes, `claude rm` reports them and
   does not discard them unless you pass the flag it prints. Use `stop` when you only want it off the wall.

`claude attach <id|name>` opens one in the current terminal (the arrow-left key returns to the agent view,
Ctrl+Z drops back to your shell) and `claude logs <id|name>` prints its recent output. `attach` and `logs`
accept part of the name, but `stop` and `rm` need the id. These are Claude Code's commands, so `claude <command>
--help` is the final word if they change.

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
agent it is about. Rows for sessions that have ended are greyed out. A session that is waiting on you gets a
yellow row that says "Waiting for your approval." or "Waiting for your input." (a question), with the tool
name, such as `Bash` or `AskUserQuestion`, in a chip under it. Once the session moves on, the row turns plain
and reads "Waited for your approval."
A turn that ended after a failing call, a session ending or starting, and an agent seen only by settings hooks
also read as plain sentences, such as "Session ended (cleared)."

### History

- `#/history` lists the sessions that ended on a day you pick, with their agent detail from stored data. It
  survives a server restart.

### What the numbers mean

Cost is an estimate from token counts and a price table, and it is never a bill. The session's own figure is
the exact ledger from Claude Code; the figures for agents are estimates, and the dashboard labels them so.
Context fill is the share of the model's window in use. A blowout is a loop that overflowed its window and was
compacted or stopped.

The effort shown is read from each model request, so after `/effort` it updates at your next prompt.

Effort is drawn as five bars with no text: more lit bars mean more effort, and the color changes with the level (low orange, medium green, high blue, xhigh purple, max rainbow). Hover the bars to read the level. Dimmed bars mean the level was not reported.

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

## Updating the mod

The mod and the server are released separately, so you update them separately. A card marked `reporter 0.1.0 · update`
means the mod in that session is older than the server supports. To update it:

1. In a shell, run `claude plugin update podium-reporter@eengelking-marketplace`. It prints
   `Checking for updates...` and then the new version, or says it is already at the latest version. Inside a
   session you can use `/plugin`, open the Installed tab, pick `podium-reporter` and choose Update now.
2. Apply it. A running session keeps the version it loaded, so run `/reload-plugins` in it, or start a new
   session. Sessions you do not reload keep reporting the old version and stay marked.
3. Run `/podium`. The `Versions:` line shows the mod's version, and the `· update mod` ending on the status
   line goes away after the next report.

If the command says it is already at the latest version but the card is still marked, the marketplace has
not published a newer mod yet. Refresh its listing with `claude plugin marketplace update eengelking-marketplace`
and run the update again. Refreshing the listing alone does not update the installed plugin.

Marketplaces other than Anthropic's do not update plugins by themselves. To have Claude Code do it, open `/plugin`,
choose the Marketplaces tab, pick `eengelking-marketplace` and turn on auto-update. It updates the plugin
on disk some minutes after you send a first message, and the new version loads in your next session.

A card marked `· upgrade server` is the other direction: the mod is newer than the server. Upgrade the server
with `podiumctl build` and then `podiumctl restart` (a plain Node install: pull, `npm run build`, restart).

## Something is wrong

| You see | Likely cause |
|---|---|
| `/podium` says offline, `HTTP 401` | The token is missing or wrong. `podiumctl token`, then `/plugin configure` |
| `/podium` says offline, no 401 | The server is not running. `podiumctl status`, then `podiumctl start` |
| The wall is empty | No session has the mod loaded yet, its token is wrong, or none has been sent a prompt |
| A new session is not on the wall, or its status line says `podium ● 0 live` | It has not done anything yet. Send a prompt |
| A session I closed is still on the wall | It moved to the background. `claude agents` lists it and `claude stop <id>` ends it. See "Closing a background session" |
| A card turned stale | The session stopped reporting (closed, crashed or lost the connection). It goes away by itself, or press Remove |
| I changed the config and nothing happened | Run `podiumctl restart` |
| A card shows `reporter 0.1.0 · update`, the top bar says reporters need an update, or the status line ends in `· update mod` | The mod in that session is older than the server supports. See "Updating the mod" below. It keeps reporting meanwhile |
| A card shows `· upgrade server`, or the status line ends in `· upgrade server` | The mod is newer than the server supports. Upgrade the server (see "Updating the mod" below) |

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
