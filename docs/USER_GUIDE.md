# User guide

How to set up Podium and read the dashboard. For the option and environment variable tables, see the
[README](../README.md). If something looks wrong, see [GOTCHAS.md](GOTCHAS.md).

Podium shows every Claude Code session on your machine in one browser tab. It only watches: it never sends
a prompt to a session, stops an agent or changes anything. The one request the mod can make to keep a cache
warm is off until you turn it on, and it does not touch the session either (see "Prompt cache" below).

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
`/plugin configure podium-reporter@eengelking-marketplace`. If someone else runs the server, ask them for
your own token and enter it as `token`, with your name as `userName` (see "Admin" below). To run one
server for several people, see "Several people on one Podium" in the README: it covers the bind address,
the firewall and what everyone who can reach the server can see.

### 3. Check that it works

In a session, run `/podium`. You should see `Connection: online`. Then send the session a prompt. A session
appears in the browser within a couple of seconds of doing its first bit of work, not before, so a brand new
session is not on the wall yet and its status line reads `podium ● 0 live`. Once it has run, the status line
reads `podium ● 1 live`. If it says `podium ○ offline`, see "Something is wrong" below, and for the other
case see "Sessions that have not done anything yet".

Give a session a name that shows on its card with `/podium name <text>`.

## Reading the dashboard

The top bar shows a "Fleet" pill that names the page, then the connection (`N reporters live, synced Xs ago`,
or a red "disconnected, retrying"). The row under it has the theme picker. The left rail lists your sessions. The right panel shows activity.
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

**What it costs to run.** The more sessions and agents report, the more Podium needs: every agent adds data
that the server stores and sends to the browser, and the browser draws it. The server's CPU and memory (ingest,
SQLite, the state sent to every client) are used whether or not a browser is open. The browser's CPU, memory and
GPU (more rows, charts, animations and updates to draw) are used by each open tab. As one example, Chrome on an
M5 MacBook Pro used about 24% GPU with ten simulated sessions and a hundred agents on screen, against about 15%
for a plain page. That is one machine and one browser, not a promise; `scripts/gpu-sample.sh` (macOS) measures
your own. To lower it, keep fewer sessions on screen, leave the tab hidden (animations pause while it is), use
wall mode, which hides the side panes and top bar so the browser stops drawing them, and close the dashboard
when nobody is looking.

### The wall

The default view (`#/`) is a card per session. At the top are six tiles: sessions live, agents running,
context blowouts, plan steps done, estimated cost today and tokens in the last minute. Below them you can:

- filter by status (All, Running, Waiting, Stale, Blowouts),
- sort (Status, Model, Context blowouts, Context used, Cost, Newest),
- search by name, project or branch.

A card shows the session's name and status, its project and git branch (or worktree, with ahead and behind
counts and how many files changed), its model, effort and context fill, its plan with the current step,
a strip with one square per agent, and its cost, tokens and running time. Tokens is the context the session and its agents hold right now, the
same figure Claude Code shows for an agent; hover it for the definition. A path or branch that is too long
for the card is shortened (the path from the front, the branch at the end); hover it to see the full value.
A red callout means the session has blown out its context window twice or more, which usually means it has lost context. A **waiting** card
means the session wants you: a permission prompt, a question, or the end of its turn. It says whether it needs
your approval or your input. A **stale** card means it has
stopped reporting. It says how long until it goes away by itself, and has a **Remove** button (also on its
rail row, and **Remove now** on its page) to clear it at once. The session stays in History, and the card
comes back if the session reports again.

### People

When several people report to one Podium with their own tokens (see "Admin" below), the console groups
their sessions. Nothing changes until a session reports with a person's token: sessions sent with the admin
secret, or to a server with no token, keep the plain wall.

A row above the filters then holds:

- **Group by**: People (a band per person), Group (a band per group from Admin) or None (the plain wall, with
  the owner on each card).
- **Order by**: Needs attention (your own band first, then whoever has the most sessions waiting or stale),
  Spend, or Name.
- **You are**: pick your own name. Podium cannot tell who is looking, so this browser remembers it. It marks
  your band "you" (your group's band "your group"), puts it first under Needs attention, and makes
  **Only me** show just your sessions.

A person's band header shows their initials and name, their group, the machines their sessions run on, how
many are live, how many are waiting or stale, and their share of today's estimated spend. Click the header
to fold the band to that line; Podium remembers which bands you folded. Each card in the band says which
machine it runs on. One person on two machines is one band, and when two of their machines have the same
name, the card adds the start of the machine's id. Sessions reported with the admin secret are in an
**Admin** band, and sessions with no owner (only possible on a server with no token) are under
**Unassigned**, after everyone else. In Group, people without a group, Admin and Unassigned are under
**No group**, and a group with no live sessions has no band.

The left list groups the same way. Click a person or group there to show only theirs on the wall; click it
again, **Show everyone**, or **All orchestrators** to see everyone again. On the right, **Spend today, by
person** (or by group) shows today's estimated spend as bars, largest first, with a **Table** view that adds a
total equal to the "Est. cost today" tile. It counts sessions that started today, so someone whose sessions
have all ended still has a row there, but no band on the wall.

A person is shown as initials and a name, never a color: color already means the model and the status.

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
- A session with no window on it is marked. After `/exit` the card turns dashed and muted with a "nobody attached" chip and a countdown. After `DETACHED_HIDE_AFTER_MS` (a minute by default) it leaves the wall and a line under the wall says how many background sessions are hidden and what they cost, with a Show them button. It still counts in the totals and in History. Run `claude attach` and the card comes back as a normal card at once. A one-off `claude -p` run reads the same way, because it never has a window. This needs the mod at 0.7.0 or later; an older mod's sessions are never marked.
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
and a bar of facts: agents (the orchestrator counts as one; a red "N failed" button opens the first
failure), estimated cost for the whole session, tokens, running time, and agent time (the orchestrator's time
plus every agent's, which is longer than running time when agents run at once).

Below that, on the left, is the plan, as a checklist with the agent that owns each step, with a **Files** tab
beside it. Files lists every file the session changed since it started, committed or not, each with how many
lines were added and removed (a binary file shows the word "binary"), 20 to a page. The column gets wider
while Files is open. The list comes from `git diff` against the commit the session began on, so two sessions
in the same checkout see the same changes; use a worktree to keep them apart. It needs podium-reporter 0.6.0
or later, and says so when the reporter is older. On the right is the agent tree: every
subagent and fork with its task, type, model, effort, context bar, tokens, cost, time and status. Click a
column header to sort: each agent's own agents stay under it, sorted among themselves. Click the header again
to reverse, and **Launch order** to go back. **Copy resume command** copies the command that resumes the session.

A subagent or a fork can launch agents of its own, and those can too. Each is indented under the agent that
launched it, as deep as it goes; past two levels the Task column gets wider and the table scrolls sideways
inside its box, so the task stays readable. Hover a row for its full task. The caption over the tree says how
many agents were launched by other agents. On the wall card, the squares follow the same order, and hovering a
nested one names the agent that launched it. In Activity, a launch by another agent ends with "launched by"
and that agent's task.

A row that is running but has agents of its own running, such as the orchestrator waiting on a subagent, reads
"delegating" in blue with a hollow dot, and hovering it lists the agents it is waiting on. It is not asking
anything of you: amber and "waiting on you" are the ones that need a reply. The fleet wall and the status
filters still count the session as running. Podium cannot tell an agent launched in the background from one
the row is really blocked on, so a row with a background agent running also reads "delegating".

Click an agent to open its detail in the right panel. **Launched by** names the agent that launched it (click it
to go there) or says "the orchestrator". **Est. cost** is the agent's own. The orchestrator's row shows its own share, so the rows add up to the facts bar. For an agent that launched others,
**With its agents** adds up the agent and every agent under it, each once. Its **Tokens** line is the context it holds now, and
**Used so far** under it lists the running totals (input, output, cache read, cache write); cache read is large
because the cached context is read again on every request. If it failed, you get the failing call, the last lines
of its output, the evidence behind the likely cause and what happened next. If its context blew out, you get a
timeline of each overflow.

The **Report** group has two buttons, **Task prompt** and **Final answer**. Click one to read the text in a window
over the dashboard, with markdown shown as formatting (headings, lists, code, links). Esc, the X or a click outside
closes it, and **Copy** copies the raw text. A button is dimmed until there is something to show; the answer stays
dimmed while the agent runs. By default Podium only has the first 400 characters of each, and the window says so.
To see the whole text, turn on the mod's `fullPrompts` option (podium-reporter 0.10.0 or later); the full text then
goes to the server, and everyone who can open the console can read it.

Click the orchestrator's own row, at the top of the tree, to open its detail. It shows the same facts as an agent's
and, with podium-reporter 0.4.0 or later, its own steps, the tools it used and the skills it loaded. Calls made by
the agents it launched are counted in those agents' panels, not here.

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
the exact ledger from Claude Code and covers the orchestrator and every agent, nested ones included; the
figures for agents are estimates of each agent's own use, and the dashboard labels them so. The orchestrator's
row in the agent tree shows the session figure.
A session on a model that is not a Claude model (a local model served by Ollama, for example) has no price, so its cost reads "n/a" and the "Est. cost today" tile leaves it out and says how many sessions it skipped. Context fill is the share of the model's window in use; when Podium does not know a model's window the bar is empty and marked unknown rather than computed against a guessed size. A blowout is a loop that overflowed its window and was
compacted or stopped.

The effort shown is read from each model request, so after `/effort` it updates at your next prompt.

Effort is drawn as five bars with no text: more lit bars mean more effort, and the color changes with the level (low orange, medium green, high blue, xhigh purple, max rainbow). Hover the bars to read the level. Dimmed bars mean the level was not reported.

### Prompt cache

While you use a session, its requests keep Claude's prompt cache warm. When you step away for 5 minutes the
cache expires, and your next prompt writes the whole conversation to the cache again, which costs more than
reading it. About a minute before that happens to a session that is waiting on you, its card shows an alert
with a countdown and what going cold costs ("About 410k tokens would be written to the cache again, roughly
$1.97 more."), and its row in the left list shows the countdown too. A running session never alerts: its own
requests keep the cache warm. When you come back the alert goes away. After `/model` the new model starts with a
cold cache, so there is nothing to warn about until its first request. The mod assumes the 5-minute lifetime
unless Claude Code says the session uses the 1-hour one (on a model switch, or when you resume it); `/podium`
shows which.

To keep the cache warm while you are away, turn on cache warming. For one session, type `/podium warm on` in
it (`/podium warm off` turns it off again). For every session, set the mod's `cacheWarming` option with
`/plugin configure podium-reporter@eengelking-marketplace`. While the session waits on you, the mod then sends
one small request about a minute before the cache would expire: "Reply with OK." over the session's own
conversation, read from the cache. The reply is thrown away. Nothing is added to the conversation and nothing
is typed into your terminal. Each one costs about a tenth of the prompt's input price, so it is not free:
warming stops after `cacheWarmingMinutes` of waiting (30 by default), when a request gets an API error such
as a rate limit or no answer within 2 minutes, and when the session runs, ends or is cleared. The card then shows
"cache kept warm" or "cache warming stopped", with how many requests were sent and what they cost, and each one
is a line in Activity. While warming keeps the cache warm there is no cooling alert. Once it has stopped, nothing
keeps the cache warm, so the alert comes back and says why warming stopped; to keep the cache, send that session
a prompt before it expires.

Warming works only while a session waits for your next prompt, not while it waits on a permission prompt (a
request then would not fit the conversation). A session waiting on a permission prompt still gets the alert,
which says so instead of telling you to turn warming on.

The first two alerts carry a tip: how to turn warming on, or, if it is on and has stopped, what to do. If neither
helped by the third, Podium stops showing them, on the guess that you do not want them. Alerts during a
permission wait carry no tip and do not count. The count is across all your sessions and survives a
restart, and a dashboard that is not open does not count. The wall then says "Prompt cache alerts are off"
with a **Turn cache alerts back on** button that starts the count over. The server owner can set
`PODIUM_CACHE_ALERTS=on` to always show them or `off` to never show them.

## Admin

Admin is for the person who runs the server. Open it with the **Admin** button in the top bar's upper right
(or `#/admin`) and enter the admin secret, which `podiumctl token` prints. It locks again after 10 minutes
without activity, and five wrong secrets lock it for 15 minutes. A server started without a token has no Admin,
because there would be nothing to protect it.

Admin has four tabs. Every list is paged by the server, 50 rows at a time (25 and 100 are also offered).

- **People.** Type a name and choose Create token. Podium shows the token once, above the tabs, with the
  settings to paste into that person's reporter: `userName`, `token` and `serverUrl`. Copy them before you
  choose "I have saved it", because Podium keeps only a hash and cannot show the token again. The list shows
  the last four characters, when each person last reported and from which machines. Rotate gives a person a
  new token and stops the old one. Revoke refuses their reports from the next one on, and their sessions go
  stale and drop as usual. The search finds a person by name, group or machine.
- **Groups.** Create groups such as Frontend or DevOps, and pick one for a person on the People tab. A group is
  a label for arranging the console (Group by Group, see "People" above) and grants nothing. Deleting a group
  moves its people to "No group". A change shows on the wall with each session's next report, within a few
  seconds.
- **Reporting and security.** A switch for reporting with the admin secret. When it is off, a reporter that still
  sends the secret is refused. Sessions that report with the secret show under the owner **Admin**.
- **Admin log.** Unlocks, failed unlocks, new people, rotations, revocations and group changes, with the
  address each came from. It never holds a token or the secret.

A report is accepted when its token belongs to the person whose name it also sends. The server decides who a
report is from by the token, so a valid token with someone else's name is refused. A person cannot see or
rotate their own token; only the owner can.

## Everyday commands

| Command | What it does |
|---|---|
| `podiumctl status` | Mode, state, health, URL, whether it starts on boot (exit 3 if stopped) |
| `podiumctl logs -f` | Follow the server log |
| `podiumctl restart` | Apply a config change |
| `podiumctl stop` | Stop it; your data is kept |
| `podiumctl token` | Print the admin secret (`--rotate` makes a new one and ends every open Admin session after a restart; people's own tokens keep working) |
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
| `/podium` says offline, `HTTP 401` | The token is missing, wrong, or revoked, or it does not belong to the `userName` setting. `podiumctl token`, then `/plugin configure`. On a shared server, ask the owner for a new token |
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
Podium never reads transcripts or files. An agent's whole task prompt and final answer leave the session only
if you turn on the mod's `fullPrompts` option, which is off by default.

With cache warming off, which it is by default, the mod sends no request of its own for the cache; it only
reports when the session's last request started. With it on, its requests go to Claude through the session's
own client, never to Podium's server.

Your name and your machine leave the session only once you set the mod's `userName` option, which is empty
by default. Then each report carries that name, the machine's short host name and a random id the mod keeps
for this machine. Everyone who can open the console sees them. Podium never reads your operating system user
name or `git config` for this. The name shown on a session comes from the token that sent it, not from
`userName`: the server checks that the two match, so nobody can report under your name without your token.

## Remove it

```sh
podiumctl disable                 # if you enabled start on boot
podiumctl rm --purge --yes        # removes the container, its data volume and the image
```

Then remove the mod with `claude plugin uninstall podium-reporter@eengelking-marketplace`, and delete `~/.podium`
if you want the saved config and token gone too.
