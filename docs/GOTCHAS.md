# Gotchas

Sharp edges that are easy to hit. Each has what you see, why, and what to do. The full list of known
limitations is under "Known issues" in `docs/ARCHITECTURE.md`; this file is the short, practical version.

## Connecting the mod

### `/podium` says "offline" and "Last error: HTTP 401"

The server has a token and the mod is not sending a right one. Get it with `podiumctl token` (or, on a
shared server, ask the owner for your own token) and enter it with
`/plugin configure podium-reporter@eengelking-marketplace`. A person's token only works with the `userName`
it was made for, and a revoked or rotated-away token is refused too. The mod logs the refusal once and
tries again about once a minute, so queued reports go out within a minute of the settings being right.

### The status line says "update mod", "update available" or "upgrade server"

The server and the mod are released separately, and the server keeps a range of mod versions it reads
correctly (SPEC 6.8). `update mod` means the mod in this session is older than that range. `upgrade server`
means it is newer. `update available` is the mild one: the mod is inside the range, but the server
supports a newer `major.minor` than this mod, so a newer mod exists that the server reads. The status line
always starts with the mod's version (`podium v0.11.1 ● 3 live`). Reports still arrive either way. Only `major.minor` is compared, so a patch release never
triggers it, and a version the server cannot read (the simulator's `0.1.0-sim`) shows nothing. `/podium`
prints both versions. A mod older than 0.3.0 cannot show this itself, but the dashboard still marks its card.
To fix `update mod`, run `claude plugin update podium-reporter@eengelking-marketplace`, then `/reload-plugins` in the
session. A running session keeps the version it loaded until you do. If the update says it is already at the latest
version, refresh the listing first with `claude plugin marketplace update eengelking-marketplace`.

### The token option has no row in the `/config` menu

It is marked `sensitive`, and Claude Code only draws menu rows for options that are not secret. Use
`/plugin configure`. For a copy loaded with `--plugin-dir`, putting the token in `~/.claude/settings.json`
under `pluginConfigs`, `podium-reporter`, `options`, `token` also worked when we tried it.

### The status line has a warning sign in front of `podium v0.11.1 ● 1 live`

The line reads `⚠ podium-reporter: podium v0.11.1 ● 1 live`. Claude Code adds the `⚠` and the mod's name to every
line a mod pins with `$.ui.status`; its [mods API docs](https://code.claude.com/docs/en/plugins/mods/api.md)
give the format as `⚠ my-mod: checks: 3 passing`. It is not a Podium warning and not a trust marker: the docs
describe no approval, signing or marketplace step that clears it, and the mod passes only `podium v0.11.1 ● 1 live`.
Nothing you can do removes it. `podium v0.11.1 ○ offline` is the real warning. We have not checked it against a
mod loaded with `--plugin-dir`, but the docs do not say the icon depends on where the mod came from.

### The effort shown is the old one after I run `/effort`

The mod reads the effort the session sends with each model request, and the plugin API has no event for the
setting changing. The new level shows after your next prompt. This is expected.

### Installing the mod from the marketplace fails with "Permission denied (publickey)"

A marketplace entry that points at a subfolder of another repo with the `owner/repo` shorthand makes Claude
Code clone over SSH. The `podium-reporter` entry uses the full `https://github.com/eengelking/podium.git`
URL for that reason. If you add your own entry for a public repo, do the same.

## Reporters and machines

The Reporters page in Admin lists reporters, not sessions and not machines. The rules that decide what counts as
one reporter are in `docs/SPEC.md` section 7.7 ("Which reporters the server knows"). Nothing here is a bug in
the server; each entry says what you see, why, and what to do.

**Check it yourself.** On Admin > Reporters, the row shows the machine, the person and the token (as `pdm_` and
a key id); select a row for its machine id, source address and refused reports. A session's card shows its
owner. In the server log, `reporter.connected` says which owner and machine was heard and `report.conflict` says
a report was refused because its session belongs to someone else (see "Logs" in `docs/USER_GUIDE.md`).

### The page shows more reporters than I have machines

Each running Claude Code session is its own card, and a machine can run several. The page counts reporters, so
three sessions on one Mac can look like extra reporters when they show as separate rows (the next entries say
why they do). Count the cards on the wall for sessions and the machine ids on the page for machines.

### One machine showed as two rows with different machine ids (fixed in #267)

Before #267 each load of the mod kept its own machine id in its own store, so an inline copy and the marketplace
install reported as two machines. Every load now shares `podium-machine-id` in the Claude config directory
(`CLAUDE_CONFIG_DIR`, else `~/.claude`). A machine that already had two ids settles on one: the first load to run
after the upgrade writes the file and the others adopt it. Two sessions that start in the same instant can each
keep the id they wrote until they end, and agree from the next session on. The other id's row stays live only
while its session does. If the config directory is copied to
another machine the id goes with it, and two machines then share one id. Where the file cannot be read or written
the mod falls back to its own store, as before. The id is made in `mod/podium-reporter/hooks/machine.ts`.

### One machine shows an extra row ending in `#` and a name

Since #221 a machine gets one row for each account that reports from it, keyed `<machine id>#<owner>` for every
account after the first. Since #226 a session keeps the name and token it started with, so a machine can carry
two people at once (two terminals, or one before and one after a change of settings) and shows two rows. This is by
design. Whether a machine should collapse to one row across accounts would reverse part of #221 and is not decided.

### A reporter with no name has a row of its own, and another once it has one

The mod sends a machine id only when the `userName` option is set. A reporter without a name is keyed by its
source address (`addr:...`), and when the same machine later reports with a name it becomes a second row. Set
`userName` and the person's token on every reporter (see "A name set with the shared secret, or with no token,
shows no person" above). Remove the old `addr:` row from Admin when you no longer need it.

### Rows that read "Not since restart" and never go away

A reporter with no name is matched by its sessions, so a container that comes back on a new address stays one row
when a session it already reported turns up from the new address. A reporter that has not reported such a session
gets a row of its own, and a container's address changes on every restart, so each restart can leave an
`addr:` row behind. Nothing removes them but you: tick them on Admin > Reporters and choose **Remove N…** (or
**Remove all Not since restart**), or turn on **Forget old reporters** under Settings. A reporter that reports
again comes back.

### I changed my reporter settings and a running session did not change who it reports as

A running Claude Code session cannot be handed to another Podium user. A session takes its name and token once,
when it starts, and keeps them. Saving new values in `/plugin configure`, `/reload-plugins` and `/clear` do not
change them (#226), and a session that tries is refused. To report as someone else, quit Claude Code and start
a new session, or start the terminal with `PODIUM_USER` and `PODIUM_TOKEN` set. A session with no token has
nothing held yet, so adding one later does apply. The settings hold one login for each Claude config directory, so
two logins on one machine need the environment variables (#230, blocked on what Claude Code offers a mod).

The server log shows no refusal for a person whose reporter simply sent nothing, so from the server's side that
person looks as if they do not exist. If a reporter shows as signed in on the person's side and nothing appears
in Podium, restart Claude Code first.

### The status line says "refused: session belongs to someone else"

Full text: `podium-reporter: podium v0.14.2 refused: session belongs to someone else` (your version will differ). The
session is stored as owned by one person (Admin, say) and the mod is now sending as another. The server refuses
with a 409 (#209) and logs a `report.conflict` warning for the same session id every 5 to 10 seconds. The server
is right to refuse. The fix is the same as above: quit Claude Code and start a new session. The message clears at
the next accepted report. Whether the mod should keep a session's identity through a settings change, a reload and
a clear is not decided.

## Running the server

### `podiumctl start` fails with "port N ... is already in use"

Something else already listens on the bind address and port: often a leftover `podiumctl run` or
`npm run dev`, or a Podium started another way. In standalone mode `start` checks before it spawns
anything, so nothing is left running and no pid file is written. Run `podiumctl status` to see whether it
is Podium (and stop it if it is), or choose another port with `--port`. Container mode needs no check:
`podman run` fails with `address already in use` and `start` exits non-zero (tested with Podman 6.1.2).

If the server exits right after `start` spawns it (a bind error, a bad setting), `start` says so, prints
the tail of `~/.podium/podium.log` and removes the pid file, instead of reporting success.

### I changed a setting and nothing happened

`podiumctl config set` only edits `~/.podium/config.env`. Run `podiumctl restart` to apply it. The
`--mode`, `--port` and `--bind` flags are saved by `start`, `restart`, `build` and `enable`.

### On macOS the first `podiumctl start` takes a while

Podman runs in a VM. If it is not running, `podiumctl` starts it, and the first start also builds the
image (about 20 seconds on a warm cache).

### `podiumctl disable` stopped my standalone server

Under the launchd or systemd service the server is the service's child, so removing the service stops it.
In container mode the container keeps running. Check with `podiumctl status`.

### A restart shows every session as stale

Sessions come back from SQLite as stale and recover when their reporters next send, within about five
seconds. A session whose reporter never comes back is dropped about a minute after the server's own start. Its card counts down to that time. Remove clears it sooner.

### `podman inspect podium` shows the token

`podiumctl` keeps the token out of the command line, but it is part of the container's environment, and
`podman inspect` prints that. Anyone who can run Podman as you can read it. See `.github/SECURITY.md`.

### Anyone on localhost can read the dashboard

The token guards reports, hooks and deletes, and Admin has its own lock. Reads (`GET /api/fleet/*`) are open on localhost by design
(`docs/SPEC.md`, 7.7). With `--bind` or `HOST` set to anything but `127.0.0.1`, other machines can read it
too.

### A name set with the shared secret, or with no token, shows no person

The people view groups sessions by who the server decided sent them, and that comes from the token. A
reporter that sends `userName` with the admin secret shows under Admin, and one that sends it to a server
with no `PODIUM_TOKEN` shows under Unassigned; neither turns the people view on. Give each person a token in
Admin. The name and machine still travel in those reports and are stored, so they are not private either.

### A group change shows a few seconds late

Admin's groups are read when a session's view is built, so moving someone to another group shows on the wall
with their next report (the heartbeat is five seconds), not at once. The Spend page in Admin updates on the next tick.

### `systemctl --user start podium.service` does nothing after `podiumctl stop` (container mode)

In container mode the unit is `Type=oneshot` with `RemainAfterExit=yes`. `podiumctl stop` stops the
container but systemd still counts the unit as active, so a plain `start` is a no-op. Use `podiumctl start`,
or `systemctl --user stop podium.service` and then `start`. A container that dies is not restarted by the
unit; standalone mode restarts a crashed server after 3 seconds.

### The Linux start-on-boot unit has not been through a reboot

`podiumctl enable` has run on Bazzite 44 (Fedora Atomic, systemd 259, Podman 5.8.7, SELinux enforcing) in
both modes, with Node from Homebrew (#268). Starting, `stop` and `disable` behave as described above. A
reboot, with and without `loginctl enable-linger $USER`, has not been tried. If you have, tell us.

## What the dashboard shows

### A session shows no plan

The card reads "No plan reported. Agents were launched ad hoc." Podium builds the plan only from the
session's task list: the `TaskCreate` and `TaskUpdate` tools (or `TodoWrite`). If Claude did not use them
for the work, there is nothing to show. That happens when the tools are not available to the session, and
also when they are, but Claude chose not to use them for a small job. Plan mode does not make a plan
appear: Podium does not read it, so `ExitPlanMode` alone gives no steps.

To get a plan, make sure the task tools are on. Start Claude Code with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`
in its environment, or add it to the `env` block of `~/.claude/settings.json`, then ask Claude to track
the work as a task list. The agent tree is shown either way.

### A plan step has no owner

Podium links an agent to a plan step by matching the agent's description to the step's title, and the match
is literal. "Count .ts files under server" and "Count .ts files in server" do not match.

### An agent's cost does not add up to the session's

An agent's row shows its own estimated cost, not the agents it launched. The facts bar and the card show the
session's figure from Claude Code, which includes every agent at every depth once, plus the orchestrator itself.
The orchestrator's row shows its own share: that figure less each agent's estimate, so the rows add up to it. To see a branch, open the agent: **With its agents** adds it and everything under it.
From reporter 0.12.0 the server prices the session and every agent from the same per-model token totals and the
prices in Admin > Settings, so the rows add up. A session from an older reporter shows Claude Code's ledger as its
figure while an agent's is an estimate from a price table, so its rows will not sum exactly.

### Every agent sits under the orchestrator in a session started without the mod

The settings hooks (`SubagentStart`, `SubagentStop`) say which agent started but not which agent launched it,
so a hook-only session cannot nest. The mod reads the parent from `agent.spawn` and nests correctly at any
depth (SPEC 5.3).

### Elapsed times freeze when the tab is in the background

Browsers throttle timers in hidden tabs. The numbers catch up when you look at the tab again.

### The dashboard's GPU use goes up after adding an animation

A CSS animation that repeats forever and uses a smooth timing function (`ease`, `linear`) makes the browser
draw a frame on every display refresh, 120 or more a second, for as long as the tab is open, however small
the element is. Several of them at different phases are worse: together they change the screen on almost
every refresh. The pulse and blink in `fleet.css` therefore read one shared `data-beat` that `useHeartbeat`
steps four times every 1.8 seconds, and the pulse ring is a pseudo-element scaled and faded instead of a
`box-shadow`. A progress bar that slides between values redraws after each update the same way.
`gpuLoad.test.tsx` fails on any infinite CSS animation and on a bar transition. Applying incoming data on
the same beat was tried and gained nothing you could measure, so it is not done. The viewer's own **Refresh every** choice (#138) holds incoming data back between redraws on purpose: `useHeldState` shows the newest state once per interval, and `FleetView` is memoized so a parent render does not redraw it in between. To measure a change, close other tabs and windows that use the GPU, run the simulator
(`npm run podium:sim -- --sessions 10 --agents 10`) and run `scripts/gpu-sample.sh`.

### A resumed session's running time starts when Podium first saw it

Podium keeps the start time a session reports only if it is within 2 minutes of the moment the server first
heard of it. If the mod reports an earlier start (a session you resumed, or one that was already running when
you installed the mod), the card counts from the first report instead. The engine's start time is not always
the session's own: under Claude Code's background daemon, sessions that began minutes apart reported the same
one. Once stored, a session's start never changes.

### A session sitting at the prompt shows as waiting

That is correct, since it is waiting on you. With many idle sessions the wall fills with waiting callouts.

### A new session is not on the wall until I send a prompt

Podium keeps a session off the wall until it has done something (it is running, or has tokens, cost,
context use, a blowout, an agent or a plan). Claude Code's background daemon runs a parked twin of each
interactive window and a pool of spares, and each of them reports as a session. Without this rule one
window showed three identical cards. See "Sessions that have not done anything yet" in the user guide and
SPEC.md 7.5. A session known only from settings hooks is never hidden.

### The status line says `podium ● 0 live`

That session is one of the hidden ones: it has not done anything yet. The number is the cards on the wall,
not the Claude Code processes. It becomes `1` or more after the session's first prompt.

### A session I closed is still on the wall

Closing the window can move the conversation to the background instead of ending it. It is a real session,
so its card stays. `claude agents` lists background sessions, `claude attach <id|name>` opens one and
`claude stop <id>` ends it, after which the card leaves. The id to use is the one `claude agents` shows, not
the id on the card, which differs after `/clear`. `claude rm <id>` also deletes the session's worktree. See
"Closing a background session" in the user guide.

### A session started without the mod stays "live" for ten minutes after it goes quiet

Settings hooks send no heartbeat, so a hook-only session gets `HOOK_STALE_AFTER_MS` (10 minutes) before it
shows as stale. A session the mod reports uses the 15-second default.

## Developing

### An Admin style does nothing, or looks like the fleet page's

Admin's CSS is scoped under `.adminv`, but `fleet.css` styles bare class names under `.podium` (`.sec`, `.main`, `.code`, `.back`, `.field`, `.btn` and more) with higher specificity, so a class of the same name in Admin picks up its rules. Before you add a class to `admin.css`, search `fleet.css` for it, and prefix a layout class that collides (Admin uses `asec` and `apage` for this reason).

### `npm run test:mod` and `npm run typecheck:mod` fail on a clean machine

Both need Claude Code installed, and CI cannot run them. Run them locally when you change the mod.

### A test run with `claude -p` cannot launch a fork

Forks are off in a non-interactive run, and the Agent tool answers "Agent type 'fork' not found". Set
`CLAUDE_CODE_FORK_SUBAGENT=1` for the run. Subagents launching subagents work without it. To watch a nested
run without touching your own server, copy the mod, point its `serverUrl` default at a server on another port
with its own `PODIUM_DB`, and pass `--settings '{"enabledPlugins":{"podium-reporter@eengelking-marketplace":false}}'`
so the installed copy stays quiet. The simulator's `--nested` flag shows the same shapes with no run at all.

### A server test fails now and then with a 404, a 401 or a body of `{}`, and passes on the next run

supertest listens on the wildcard address and then connects to `127.0.0.1`. On macOS, if another process holds
`127.0.0.1:P`, the wildcard bind of the same port `P` still succeeds, and connections to `127.0.0.1:P` go to the
other process. So a busy machine (the full run's own workers, the container, a second run, a browser) sometimes
answers a test's request with someone else's server (#137). The fix is `server/src/testSetup.ts`, which vitest
loads for every file and which makes a bare `listen(0)` bind `127.0.0.1`. A test that starts its own server should
say `127.0.0.1` too, and a new test setup file that replaces `setupFiles` must keep `testSetup.ts` in the list.
It binds with Node's internal `_listen2`, because supertest reads the port the moment `listen(0)` returns and a
public `listen(0, '127.0.0.1')` is not synchronous; `testSetup.test.ts` fails if a Node upgrade breaks that. To
check for the flake, run several full runs at once, for example six loops of `npx vitest run` in parallel, which
failed about 7% of runs before the fix and none of 60 after. Keep it to three loops, and let the sockets drain
between rounds (`netstat -an -p tcp | grep -c TIME_WAIT` under a few hundred): a run opens about 3,000
connections, macOS has about 16,000 ephemeral ports, and with vitest 5 six loops run out of them and fail with
`listen EADDRNOTAVAIL 127.0.0.1` all over the suite. That is the machine, not a test. One real timing flake
remains: `shipper.test.ts` "sends a full batch on its own" waits a fixed 20 ms for a gzip to finish and fails now
and then under load, on vitest 2 as well.

### The frontend build says `Property 'toBeInTheDocument' does not exist on type 'Assertion'`

vitest 5 declares `Assertion<R, T>` with two type parameters, and `@testing-library/jest-dom` declares it with
one, so TypeScript drops jest-dom's own matcher types. `frontend/src/jest-dom.d.ts` redeclares them for two
parameters. If a jest-dom release fixes its types, delete that file.

### Finished nested agents are missing from `$.agent.list()`

Once a parent agent finishes, the engine's list drops the finished agents it launched (SPEC 5.3). The mod keeps
every agent it has seen, and the server never deletes an agent a later report leaves out, so the console keeps
them. A hot reload after that point rebuilds only what the list still has.

### A `turn.step` hook that reads the stream loses the step's result

`turn.step` is a streaming hook. `yield* next(e)` passes the chunks on and evaluates to the step's result, but
`for await (const chunk of next(e))` throws the result away: a generator's return value is not a value of the
loop. The activity feed (#118) has to see the text chunks, so for a watched loop the reporter keeps the stream,
reads it with `for await`, yields each chunk on as it came, and then takes the result from `await stream.result`.
Forget that last step and every watched step reports no usage, no stop reason and no blowout. The same applies to
a test that drives `$.turn.step` by hand: read it with `next()` until `done`, as `stepOnce` in `register.test.ts`
does. Only a watched loop takes this path; every other step still uses `yield* next(e)`.

### A mod fix did not reach anyone

Installed copies only update when `version` in `mod/podium-reporter/.claude-plugin/plugin.json` changes.
Bump it in the same PR, together with `VERSION` in `mod/podium-reporter/hooks/register.ts` (the number the
mod reports; a test checks the two match). CI (`mod-version-check`) fails a PR that forgets the first.

### A new color theme shows up in the dropdown but the page stays on Podium's colors

A theme lives in three places: its entry in `frontend/src/fleet/themes.ts`, its light and dark token blocks
in `themes.css`, and the id list in the inline script in `frontend/index.html` that applies the choice
before first paint. `themes.test.ts` fails if they disagree, or if a block lacks a color token such as `--deleg`, `--deleg-text` and `--admin-text`. A new palette also needs an entry in
`docs/THIRD_PARTY_NOTICES.md` and a clean run of `npx tsx scripts/theme-contrast.ts`.
