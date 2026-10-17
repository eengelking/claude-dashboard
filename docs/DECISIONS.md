# Decisions

Significant choices and why they were made, newest last. This is the "why" log: `docs/SPEC.md` says what
Podium must do, and `docs/ARCHITECTURE.md` says how it was built and where it departs from the spec. Add an
entry when a choice would otherwise get re-argued, and don't rewrite old ones. If a decision is reversed,
add a new entry that says so and mark the old one superseded.

Each entry has the choice, the reason, and what it costs.

## 1. Podium only observes

**Choice.** No control surface. Podium never sends a prompt, stops an agent, approves a permission or edits
a session. At most the UI copies a resume command to the clipboard.
**Why.** It keeps the trust model simple: the mod can only report, and the server can only store and show.
A dashboard that could steer sessions would need much stronger authentication and would be a much more
attractive target. It is the first "Non-goal" in `docs/SPEC.md`.
**Cost.** Nothing in the UI can act on what it shows. You switch to the terminal for that.
**Superseded** by 28: Podium can now answer a session that waits on its person.

## 2. A Claude Code mod reports from inside the session

**Choice.** The reporter is a Claude Code mod (`mod/podium-reporter/`), not a log parser or an external
process.
**Why.** It is the only mechanism that sees agent spawns, per-step usage, compaction, tool results and plans
from inside a session, and can send them out (`SPEC.md` section 2).
**Cost.** Sessions started without the mod are invisible, except through the reduced settings-hook ingest
(entry 5). The mod depends on Claude Code's mod API, which is new.

## 3. Full snapshots plus unacknowledged events

**Choice.** Each report carries the whole session state and the events the server has not acknowledged.
The server upserts it and never needs an earlier report to understand a later one (`SPEC.md` section 6).
**Why.** A lost or repeated report cannot corrupt anything, and a restarted server recovers from the next
report. The mod owns what is true inside a session; the server owns time (staleness, lingering, dropping,
series).
**Cost.** Reports are larger than a delta would be. At one per second that does not matter.

## 4. SQLite through `node:sqlite`, validation by hand

**Choice.** Storage is SQLite via Node's built-in `node:sqlite`. Every report is validated by hand in
`protocol.ts` instead of with a schema library.
**Why.** No native build step and no new runtime dependency, which is plenty for one machine. The spec
allows no other runtime dependency without a written reason. A hand-written check also lets it clamp long
strings and strip control characters instead of rejecting a whole report (`ARCHITECTURE.md`, spec
questions 4 to 6).
**Cost.** The validator is code to maintain. `node:sqlite` is loaded through `process.getBuiltinModule`
because vitest cannot resolve the `sqlite` specifier, and Podium needs Node 24.

## 5. Settings hooks as a reduced fallback

**Choice.** `POST /api/fleet/hook` accepts Claude Code's settings hooks for sessions that never loaded the
mod. They show up marked "settings hooks" with no tokens, cost or plan.
**Why.** You should not have to restart a session to see it at all. A session the mod reports is never
changed by hooks, so enabling both is harmless (`ARCHITECTURE.md`, spec question 37).
**Cost.** Hook-only sessions send no heartbeat, so they get a longer stale window
(`HOOK_STALE_AFTER_MS`, 10 minutes).

## 6. The report types are copied, and a test keeps them equal

**Choice.** The Report types live in `server/src/fleet/protocol.ts` and, byte for byte between markers, in
`mod/podium-reporter/hooks/protocol.ts`. `server/src/fleet/protocol.test.ts` compares the two.
**Why.** The mod's tests run in the hooks sandbox, which has no file system, so a mod test cannot read the
server's file. The comparison has to live where both files can be read (`ARCHITECTURE.md`, spec
questions 1 and 2).
**Cost.** The mod and the server have to stay in one repo, or this check needs a replacement. This is why
the mod was not moved to a separate repo (entry 12).

## 7. Cost is an estimate, except the session ledger

*Superseded in part by 23 (#117): the server now prices the tokens, with `server/src/fleet/pricing.ts`.*

**Choice.** An orchestrator's own cost is the session's ledger. Agent cost is token counts times a price
table (`mod/podium-reporter/hooks/models.ts`), and the UI always labels it an estimate.
**Why.** The engine only gives a ledger for the session, not per agent. Presenting an estimate as a bill
would be wrong.
A model with no price (anything that is not a Claude model, such as one served by Ollama) gets no estimate at
all: `null` in the report and "n/a" in the UI, and its sessions are left out of the fleet's cost total with a
note (the note counts a session only while its model is unpriced: once the Admin prices the model the session has a
cost and the note goes, #276; the cost-per-minute sparkline stays beside it). A loop that has not reported a model
yet, with no spend, is also unknown and reads as a dash, not $0.00. The earlier fallback priced it as Sonnet so the number was never zero, but an invented figure presented
as an estimate is worse than none (#66).
**Cost.** Agent figures undershoot the ledger a little (known issue 7 in `ARCHITECTURE.md`).

## 8. Podman, one image, one volume

**Choice.** The container runs under Podman (not Docker). The server and the UI ship in one image with a
`/data` volume for the SQLite file. Nothing else runs beside it.
**Why.** Podman was the stated preference for this project. There is no second service to orchestrate, so
a single image is enough. It runs as a non-root user (2026-10-11, PR #3).
**Cost.** Podman's default OCI image format drops a `HEALTHCHECK` instruction, so `podiumctl` passes
`--health-cmd` when it runs the container.

## 9. `podiumctl` has two modes and no dependencies

**Choice.** `bin/podiumctl` is a plain ES module with no dependencies. It manages the server either in
a Podman container or as a standalone Node process, and saves the mode.
**Why.** Some people will not have Podman, and developers want a plain process. A script with no
dependencies installs with `npm link` and nothing else, and `npm link` is how an npm binary is normally
installed (PR #3).
**Cost.** Two code paths to keep working. Both are tested for real, not only in unit tests.

## 10. The token is generated on first start, and secrets stay out of argv

**Choice.** The first `podiumctl start` generates a random `PODIUM_TOKEN` and saves it to
`~/.podium/config.env` (mode 0600). `podiumctl token` shows it. An empty token is the deliberate "auth
off" setting. Secrets reach the server through the process environment (`podman run -e NAME` with no
value), never the command line.
**Why.** This follows how RKE2 handles its join token: generated once, saved in a known place, and easy to
find again. The maintainer likes that approach. A secret on a command line is visible in the process list.
**Cost.** The token is still part of the container's environment, so `podman inspect podium` shows it. See
`docs/GOTCHAS.md`.

## 11. Start on boot through launchd and systemd user units

**Choice.** `podiumctl enable` writes a launchd agent (macOS) or a systemd user unit (Linux). In container
mode the unit runs `podiumctl start`; in standalone mode it runs `podiumctl run` in the foreground and
restarts only after a non-zero exit.
**Why.** A container restart policy is not enough on macOS: Podman runs in a VM that is not up at login,
and `podiumctl start` also starts it. Restarting only on a failure keeps `podiumctl stop` from being undone
by the service.
**Cost.** The Linux path is generated and unit-tested but has not run on a Linux host.

## 12. The mod stays in this repo and is listed from the skills marketplace

**Choice.** `podium-reporter` lives in `mod/podium-reporter/` here. `eengelking-marketplace` (in
`eengelking/skills`) lists it with a `git-subdir` source, using a full `https://` URL
(2026-10-11, `eengelking/skills` PRs #32 and #33).
**Why.** A marketplace is only a listing, so one `eengelking-marketplace` can point at plugins that live
in other repos. The mod has to sit beside the server because of entry 6. The `eengelking/skills`
repo is for project-agnostic skills, and this mod is tied to one project. The `owner/repo` shorthand makes
Claude Code clone over SSH, which fails for anyone without a GitHub SSH key.
**Cost.** A mod fix needs a `plugin.json` version bump or installed copies never update. CI checks it
(`mod-version-check`).

## 13. The `token` option is sensitive

**Choice.** The mod's `token` option is marked `sensitive`.
**Why.** It is a credential, so Claude Code keeps it out of the plain settings display.
**Cost.** A sensitive option has no row in the `/config` menu. Set it with
`/plugin configure podium-reporter@eengelking-marketplace`. (Found when testing, 2026-10-11.)

## 14. The project is named Podium, in one repo

**Choice.** The repo was `claude-dashboard` and is now `eengelking/podium` (PR #5). The earlier usage
dashboard stayed in the same repo at `#/usage` until it was removed (entry 15).
**Why.** The repo is published, and the name should say what the product is. "Podium" was already the
working name in the spec (open question 10, kept in one constant).
**Cost.** Old links to `claude-dashboard` rely on GitHub's redirect.

## 15. The usage dashboard is removed

**Choice.** The earlier usage dashboard is gone: the "Usage dashboard" link, the `#/usage` page, the
`/api/claude-code` and `/api/api-usage` routes, the modules only they used, `recharts` and the
`ANTHROPIC_ADMIN_API_KEY` setting. A `#/usage` link now lands on the fleet console. `podiumctl` ignores a
leftover `ANTHROPIC_ADMIN_API_KEY` in an existing config and lets `config unset` clear it.
**Why.** The maintainer moved away from it. Checking the empty-in-container case (#16) showed the page had
little value, and fixing it would have meant mounting transcripts into the container just to feed it. It
shared the repo and the server but none of the fleet console's code. Overrides the "stays reachable at
`#/usage`" statements in SPEC and entry 14.
**Cost.** A breaking change for anyone who used the page (pre-1.0). Cross-session cost history, if wanted,
would be a new feature in the fleet console built from what the mod reports.

## 16. The host passes its home directory to a containerised server

**Choice.** `podiumctl` sets `PODIUM_HOST_HOME` to the host's home directory when it starts the container,
and `configFromEnv` uses it in place of the server's own `os.homedir()` when it is an absolute path.
Standalone mode and `npm run dev` do not set it and behave as before. The name avoids `PODIUMCTL_HOME`,
which is where `podiumctl` keeps its own files.
**Why.** In a container the server runs as `node`, so its home is `/home/node` and a session's
`/Users/<name>/...` never shortened to `~/...` (#20). Nothing in the report carries the reporter's home. The
other options were worse: having the mod report its home changes the report format and SPEC 6.2 for a
display detail, and guessing `/Users/<name>` or `/home/<name>` can show a wrong `~`. The value is not a
secret and needs no change on the wire.
**Cost.** One more variable for `podiumctl` to set. A server started in a container by hand, without
`podiumctl`, must set it itself or paths stay long.

## 17. Fleet cards keep a fixed width

**Superseded by 27 (#145).**

**Choice.** The wall grid is `repeat(auto-fill, min(360px, 100%))`, left-aligned. A card is 360 px wide
(narrower only when the area is) and extra room adds columns.
**Why.** With `minmax(300px, 1fr)` a new column made every card narrower, so collapsing a pane, which widens
the main area, shrank the cards (#65). Collapsing the 340 px right pane did it most. A steady size is what an
always-on wall display (#33) wants, and one rule covers both panes, the top bar and Wall mode, since they only
change the main area's width.
**Cost.** A last row that is not full leaves empty space on its right, and the cards no longer stretch to fill
a wide row.

## 18. A supported range of reporter versions, not a protocol number

**Choice.** The server keeps one range, `REPORTER_SUPPORT { min, max }`, of mod versions it reads correctly
(SPEC 6.8). It compares `major.minor` of each report's `reporter.version` and tells the reporter in the reply.
Below the range is `outdated`, above it is `newer`, and a version it cannot parse is `unknown` and never warns.
**Why.** The issue (#49) asked whether to follow `kubectl`, which allows a skew of one minor version, or to
add a protocol version that changes only with the report format. A protocol number would warn less often, but
`Report.v` already exists and has never needed to change, and a warning that never fires is not much use. A
range on the mod's own version needs no new field on the wire, works for reporters that already send
`reporter.version`, and gives the opposite direction (a mod newer than the server) for free. Ignoring the
patch number keeps a mod-only fix from warning anyone.
**Cost.** Someone must move `min` or `max` when a change needs it. Forgetting `max` when a new mod minor
ships makes every up-to-date mod show `upgrade server`, and a test cannot catch that on its own. The release
steps are in `CONTRIBUTING.md` ("The mod version bump"), which says to move `max`.

## 19. The changed-files list is a git diff against where the session started

**Choice.** The mod records the commit HEAD pointed at when the session began and lists the files that differ
from it in the working tree, with line counts from `git diff --numstat` and untracked files counted
separately (SPEC 5.7). It does not count only the files the session's own Edit and Write calls touched. If
that commit is no longer an ancestor of HEAD (a rebase, an amend, a branch switch) it diffs against the merge
base with the upstream, and with no upstream against HEAD alone, and the report says which (`since`). The
Files tab pages the list 20 at a time and the left column widens to 400 px while it is open (#26).
**Why.** It matches what GitHub shows, includes changes made by shell commands and formatters, and survives a
commit, which a count of tool calls does not. The starting commit is kept in the mod's store under the session
id, so a hot reload does not move it.
**Cost.** Two sessions in the same checkout both see the same changes, because the diff is of the working
tree; worktrees avoid it. A session that switches to an unrelated branch reads as `upstream` or `worktree`
rather than as its own changes. The mod runs five git queries every 10 seconds instead of one, and counts at
most the first 200 files; untracked files are counted with one `git grep -c` per 100 files (#271), so a folder of hundreds costs a few processes a poll, but an empty or binary untracked file past the first 20 in a read shows no counts, and untracked files past the 200th add no lines to the totals. The report carries the list in every snapshot, since a report is a full snapshot
(SPEC 6.7), and the mod only marks a report due when the list changes.

## 20. Per-person tokens bound to a name, and an Admin section gated by the old shared secret

**Choice.** The shared `PODIUM_TOKEN` becomes the *admin secret*. It opens an Admin section where the server owner
makes a token for each person. A person's token is `pdm_<12 hex key id>_<48 hex secret>`, generated by the server,
shown once, and stored only as its SHA-256 (it also kept the last four characters until #277 dropped them). A report is accepted when its token is live
and the `userName` it carries equals that token's person. The shared secret keeps working for reporting, under the
owner `Admin`, with an off switch. Admin's session is an in-memory id in an `HttpOnly; SameSite=Strict` cookie, with
a 10 minute idle timeout, 5 wrong tries locking a source for 15 minutes, a required `X-Podium-Admin` header on
changes, and an admin log (#36).
**Why.** One shared secret cannot tell who sent a report, and anyone holding it could claim any name. A key id
inside the token means the server finds the person from the token and a name alone gives nothing to guess; names are
visible in the console, so the name match is only a consistency check and the token's randomness is the protection.
A plain SHA-256 is enough because the tokens are random and long: there is no password to guess, and the hash only
keeps a copied database from handing out working tokens. Keeping the old secret means an existing single-token setup
works after upgrade with no change.
**Cost.** Anyone with the admin secret can open Admin and make tokens, so the secret still has to be guarded
(`podman inspect` shows it). Sessions live in memory, so a restart locks Admin. There are no accounts, and a
person cannot see or rotate their own token (the built-in Administrators group, #172, later let its members
open Admin with their own name and token; see 30). Tokens still travel over plain HTTP: a network-reachable server needs a
trusted network or a TLS proxy. Any valid credential can delete any session. The lockout is per source address, so
behind a proxy that hides addresses it is shared.

## 21. People are shown from the token's owner, grouped in the browser, and machines carry a random id

**Choice.** The people view (#34) groups sessions by `sessions.owner`, which the server sets from the token
(decision 20), not by the `userName` a report carries. A named reporter also sends `machine`: the short host name
and a random 12-hex id the mod makes once and keeps in its own store. Bands, ordering and the spend chart are
computed in the browser from live sessions; the server adds only the machine, each owner's group and today's
spend per owner. "Me" is picked in the browser and kept in `localStorage`. The view stays off until a session
belongs to a person, so a one-person setup that reports with the admin secret looks as before.
**Why.** A name is visible to everyone and can be typed by anyone, so trusting it would let one person appear as
another; the token already decides identity. A host name alone cannot tell two machines with the same name apart,
and a hardware or OS identifier says more about the machine than Podium needs, so the id is random and local to
the mod. Deriving people from live sessions keeps the server free of a second, stale copy of who is around, and
the server cannot know who is looking at a page, so only the browser can say "me".
**Cost.** With the admin secret or with auth off, names are sent and stored but no person is shown (GOTCHAS). A
person whose sessions have all ended has no band, though today's spend still lists them. The id is per mod store,
so a copied `~/.claude` makes two machines share one id (the host name still differs in most cases). Group changes
in Admin reach a live session's card with its next report rather than at once.

## 22. Wall notices are server settings, shown at the bottom, with one switch each in Admin

**Choice.** Informational notes about the wall (today, the background-sessions note) sit in one stack at the bottom
of the wall. Each has an X. Closing one turns it off for every browser and tells the user where to turn it back on,
Admin > Settings, which has one switch per notice. The switches, and whether background sessions are shown, are rows in
the `settings` table, sent in the state body and pushed to open tabs as a `wall` stream event. Closing a notice and
the Show them / Hide them link are open routes like Remove, not Admin calls.
**Why.** A note above the cards pushes the work down and a note that cannot be closed gets in the way every time.
The wall has no Admin session, so what it shows has to come in the state it already receives. One setting per server
matches how the rest of Admin works, and keeps "show background sessions" from resetting on every reload, as the
old per-tab state did.
**Cost.** Anyone who can reach the dashboard can close a notice or show background sessions for everyone, the same
trust Remove already has. A notice closed by mistake is easy to restore but affects every viewer until it is. The
list of notices lives in two places, the server's `NOTICES` and the wall's stack, so a new notice touches both.

## 23. The server prices tokens, with prices the Admin can change

**Choice.** The reporter sends tokens per model and per prompt-size tier (`usageByModel`, for the session and for each
agent), and the server turns them into dollars in one module, `pricing.ts`, using a built-in table of Anthropic's list
prices with the Admin's changes laid over it. The cost is worked out when it is read, not when it arrives, so a price
change moves every figure at once. Each model has five prices (input, output, cache read, 5-minute and 1-hour cache
write), and Haiku 5.5 a second set for prompts over 100,000 tokens. Podium does not read Claude Code's own
`modelPricing` or cost figure.
**Why.** The reporter cannot see the Admin's settings, and the session total it used to send was Claude Code's ledger,
which the server cannot reprice. Tokens per model are enough to reprice everything, including the orchestrator's share
(session total minus its agents), so the card, the facts bar and the totals still add up (#109). Pricing on read means
a price change needs no migration of stored rows. A request's tier depends on its own prompt size, so it has to be
decided per request in the reporter, not from totals.
**Cost.** The session figure is now an estimate from the Admin's prices, not Claude Code's ledger, for any reporter
that sends usage (0.12.0 and later); a person who sets a contracted rate in Claude Code's `modelPricing` must set it
here too. Reports grow by a few rows per model, and each sample row stores the session's usage so the cost-per-minute
sparkline can follow the Admin's prices too (#270). Cache writes count at the 5-minute rate unless Claude Code reports the
1-hour part; the `turn.step` usage fields in SPEC 5 carry no such split, so until it does the 1-hour price has no effect.
A session first heard of after midnight, whose start the server believed from before it, counts what it spent since
its first sample (#276). A session that started before midnight and now reports no ledger figure (the reporter sends
`null` for a local model) cannot be split by the ledger, so it is split by the usage its last sample before midnight
kept, priced with the Admin's prices: what it costs now minus what that usage cost, so a session that spent on a Claude
model before midnight and on a local model after adds only its spend after midnight (#286). A session none of whose
samples kept usage (a reporter older than 0.12.0 on a local model) has nothing to split by and counts nothing today.

## 24. An agent's activity is sent only while someone watches it, and never kept

**Choice.** The activity feed (#118) has its own reporter option, `activityFeed`, off by default and separate from
`fullPrompts`. With it on, nothing is captured, sent or stored for a loop until a viewer opens its panel: the panel's
fetch takes a short lease on the server, the reply to each report lists the leased loops (`watch`), and the mod
captures only those. The server keeps the last 20 entries in memory, drops them when the lease lapses (the viewer's
interval plus 15 seconds), when the session leaves or on restart, and never keeps an entry older than the lease, so a
viewer who comes back starts empty. There is no table and no history. The panel fetches on the viewer's interval (5
seconds by default) only while it is open and the tab is visible. Tool calls and the text between them are sent; the
model's thinking is not.
**Why.** What an agent is doing right now is more sensitive than its task prompt or answer, and everyone who can open
the console can read it, so it gets its own switch and is off unless asked for. Capturing only what someone is looking
at keeps the cost at zero for the many agents nobody watches, keeps the reports small, and means there is nothing to
retain, export or leak afterwards. The question it answers, "where is this agent in its work", is about now, so a
history adds little. Thinking may come summarized or not at all depending on the model, and is the most private part.
**Cost.** A viewer sees nothing from before they opened the panel, and the first entries arrive one report cycle
after the lease starts (about a second, more on a long interval). Two viewers share one lease, so a slow viewer keeps
a loop watched for longer than a fast one alone would. A restart of the server loses every feed. The reports of a
watched loop carry up to 20 entries of 300 characters again on every report, because reports are full snapshots.

## 25. The Admin can switch the activity feed off for the whole server

**Choice.** On top of the reporter's `activityFeed` option (24), Admin > Settings > Feature flags has an **Agent
activity feed** switch (`activity-feed`), on by default, kept in the `settings` table with the other Admin settings
and written to the admin log. The feed needs both. With the flag off the server grants no lease, lists nothing in
`watch`, keeps nothing a mod sends and drops what it held when the flag goes off; the activity route answers
`enabled: false`. Open panels keep asking on their interval and say the Admin turned it off, so turning it back on
resumes the feed without a reload. The store is a generic list of flags, `FEATURES`, so the next feature that needs
an off switch adds one entry.
**Why.** The reporter option belongs to whoever runs each machine, and the feed is read by everyone who can open the
console. The person who runs the server needs a way to stop it for everyone without asking every machine to change a
setting, and to have that recorded. Default on, because the reporter option is already off by default, so a flag
that also started off would make the feature take two steps to try for no added safety.
**Cost.** A machine with the option on still captures nothing while the flag is off, which can puzzle its owner
until the panel's note explains it. Open panels keep making one small request per interval while the flag is off.
A flip sends every browser a full snapshot, which is fine for a switch that changes rarely.

## 26. The server logs events, and can push them to a central platform

**Choice.** The server writes each thing it does as an event with a stable dotted name, a level and flat fields
(`server/src/logging/`, #140). Plain text stays the default and prints what the server always printed; `json` prints
one object per line. When `PODIUM_LOG_SHIP_URL` is set, the server also pushes the JSON lines to that endpoint,
shaped for VictoriaLogs' JSON line ingest, from a bounded buffer that drops the oldest lines when the endpoint is
down. Only the server logs this way; the mod does not. Access logging is one `http.request` line per request at
`debug`, so it is off at the default `info`. Admin changes are `admin.*` events with the action and the source
address, and the Admin Log table is unchanged. Node's own `fetch` and `zlib` do the work, with no logging library.
**Why.** The maintainer wants an agent to find out what a deployment did through the VictoriaLogs MCP server: a
rejected report by its reason, a session's start and end. A push from the server needs nothing else installed, and
the same JSON on stdout still serves a collector such as Vector or Fluent Bit for anyone who prefers that. The mod's
logs would leave the user's machine, a different privacy decision, so they stay out until someone asks. A line per
request is noise for most people, and the paths already show in the events that matter.
**Cost.** With shipping on, the server makes network calls on its own, and lines are lost when the endpoint is down
longer than the buffer lasts (it says so once). The default text output stays what it was: the events added with the logger (sessions,
reporters, sweeps, Admin changes, refused tokens, conflicts) print in text only at `debug`, which the maintainer
chose so that turning nothing on changes nothing. They are still at their own level in `json` and in what is
shipped, so someone reading plain text at the default level sees less than an agent reading VictoriaLogs. Field names are checked against a deny list and strings are scrubbed, but a new field still
needs its author to think about what it carries.

## 27. The wall's cards stretch, in at most four columns

**Choice.** The fleet wall counts columns instead of letting the browser fill them (`wallLayout.ts`, `useWallColumns`,
#145). A card is never narrower than 360 px. The wall uses as many 360 px columns, 12 px apart, as its own measured
width holds, at most four and never more than there are cards, and the cards stretch to fill the row. A lone card is
half the wall when two columns fit. Later rows keep the same column width, so a short last row is left-aligned. Bands
in the People and Group views share one set of columns, from the total number of cards shown. A `ResizeObserver` on
the wall keeps the count current. This replaces 17, and applies to the fleet wall only.
**Why.** The maintainer asked for a wall that fills the screen with a steady, predictable shape: one wide card, then
two, three or four across, never more. The 360 px minimum keeps today's card size as the floor, and measuring the
wall itself, not the window, accounts for the panes, which can be dragged to any width. Taking the columns from the
total, not each band's cards, keeps cards in different bands the same width, so the page does not look ragged.
**Cost.** A card is no longer a steady size: opening or closing a pane, or dragging one, changes the columns and can
resize every card, which is what 17 avoided (#65). The count needs JavaScript and a measurement, so before the first
measure the wall falls back to the old fixed 360 px cards.

## 28. Podium can answer a waiting session, through the reporter, not through a terminal

**Choice.** Podium is no longer observe-only (this supersedes 1). When a session waits on its person, the owner
or an Admin can answer from the browser (#206, `SPEC.md` 5.3 and 7.7): an AskUserQuestion form (an option, a typed
answer, or a message in place of an answer), a plan (approve in one of three modes, or send it back with feedback),
a tool's permission prompt (allow once, or deny with a reason), and a turn that ended (a new message, `/clear` or
`/compact`). Everything goes through podium-reporter. Its hooks race Claude Code's own dialog against an answer from
the server, and whichever comes first wins, so the terminal keeps working the whole time. The mod fetches answers
from the server, in the same direction as reporting, and the server never connects to a session. It is off unless
five switches are on: authentication, the Admin's **Respond from Podium** flag, the Admin's activity feed flag, and
on the machine the reporter's `respond` option and `activityFeed` option. The `respond` option has four levels, so
the person running a session decides how much it accepts, and the mod enforces that itself. "Always allow", any
other change to permission rules, and every slash command but `/clear` and `/compact` stay in the terminal. The web
terminal asked for in #21 was not built.
**Why.** The maintainer's real goal behind #21 was answering a session that stopped to ask, without going back to
the terminal or the desktop app. A browser terminal into the session's tmux would do far more than that and cover
too few sessions: it hands the browser raw keystrokes into the session, works only for sessions inside tmux, can't
see the host's tmux from the container, and would need SSH or a tunnel for another machine. The Claude Code mod API
gives a narrower path that reaches every session the reporter already sees. A spike against a real Claude Code
2.1.301 session (comments on #206) showed each case working, once a plan approval echoes the tool's input back as
`updatedInput`. A held request lets an answer land within a second or two, and needs no listening port in the
session. `/model` and `/effort` were left out: `/model` also saves the model as the default for new sessions, and
`/effort` opens a confirmation only the terminal can answer.
**Cost.** The trust model is no longer "the mod can only report". Anyone holding a person's token, or the admin
secret, can put text into that person's opted-in sessions, so the switches are off by default, every answer needs a
credential even though reads are open, and each answer is written to the admin log without its text. The browser now
signs in with a token, which travels over plain HTTP unless a TLS proxy is used. Plan approval rests on behavior
Claude Code doesn't document (anthropics/claude-code#97656 is open), so the mod confirms that each approval took and
otherwise leaves the plan to the terminal. Where an organization manages Claude Code, PermissionRequest hooks don't
run in a user-installed plugin, so tool permissions and plan approval can't be answered there. A pending answer is
kept in memory only, so a server restart loses it. The mod's hooks for an open ask now wait on the network on
purpose, which the reporter never did before.

## 29. A session keeps the Podium identity it started with

**Context.** The reporter's `userName` and `token` options are one set per Claude config directory, and Claude Code
reloads every running session's module when an option changes. Signing in as a second Podium identity on the same
machine therefore switched the first terminal's running sessions to the new token, and the server refused them (409,
a session stored under Admin reported with a person's token). The refusal was right; the switch was the defect (#226).

**Choice.** The mod takes its name and token once, at `session.start`, and holds them in `$.state`, which survives a
reload. At that first start it prefers the terminal's `PODIUM_USER` and `PODIUM_TOKEN` over the shared options.

**Alternatives.** Reading the options live (the old behavior). Holding the pair in `$.store`, which would write a token
to disk. A project-scoped setting, which Claude Code does not offer for plugin options. Letting the server accept a
session from a second owner, which would undo #209.

**Cost.** A running session cannot pick up a corrected token or name. Fixing a wrong token means starting a new
session, where before a reload was enough. Two identities on one machine need the environment variables, not the
settings screen.

## 30. Admin opens from the console's sign-in, with a name and a token

**Context.** Admin and the console had two sign-ins that did not know about each other: an Administrator signed in to respond still typed a token again to open Admin, the Admin button showed to everyone, and Admin took a token alone (#215).

**Choice.** Admin's unlock takes a name and a token, checked by the same function as the sign-in to respond. The respond cookie is scoped to `/api` instead of `/api/fleet/respond`, and `POST /api/admin/unlock/from-respond` opens an Admin session for a browser whose respond sign-in is an Administrator's. The button shows only when `GET respond/me` says `admin`. The idle lock stays; an Administrator still signed in to the console is let back in without a prompt, and anyone else sees the sign-in.

**Alternatives.** One shared cookie for both sessions, which would tie the 10-minute Admin lock to the 12-hour console sign-in. Minting the Admin cookie at respond sign-in, which would not cover the idle lock and would not work if the Admin session had been locked on purpose. Dropping the idle lock.

**Cost.** The respond cookie now travels to every `/api` route, though only the respond and Admin routes read it. The Admin button is gone while responding is switched off (the `respond` flag is off by default), since nobody can sign in at the top bar then; `#/admin` still works. An explicit "Lock Admin" used to leave a reload free to reopen Admin while the console sign-in stood; #272 fixed that (below).

**Update (#272).** "Lock Admin" marks that browser's respond sign-in as held, in memory, and `from-respond` refuses a held sign-in until that person unlocks with their name and token (which lifts the hold; another Administrator unlocking in the same browser does not) or signs in to respond again. The sign-in itself stands, so the person can still answer sessions, and the idle lock still lets a signed-in Administrator back in. Alternative not taken: ending the respond sign-in on Lock Admin, which would also stop the person answering sessions' prompts, something the button's name does not suggest.

## 31. Security sweep (#249): what was found, what was fixed, what is accepted

**Context.** A review of the server, UI, mod, `podiumctl`, the Containerfile and the dependencies, at the time Podium gained responding (#206) and Admin sign-in by name and token (#215).

**Fixed.**
- *High (advisory, not reachable).* `npm audit --omit=dev` reported `proxy-addr` (critical, IP spoofing through a trusted proxy subnet) and `qs` (moderate, denial of service in query parsing, reached through Express). Podium never sets `trust proxy`, so `proxy-addr` could not be steered, but `qs` parses every query string. `npm audit fix` moved them to patched versions; production dependencies now audit clean.
- *Low.* No response carried a content security policy, `X-Frame-Options` or `nosniff`, so any future markup bug would have run with the page's full reach, and the console could be framed. Now set on every response (7.7).
- *Low.* The container ran with Podman's default capability set. It now drops all of them and cannot gain privileges.

**Checked and sound.** Every SQL statement is parameterized, and the two that build an `IN (?, ?)` list or an `ORDER BY` take only counts and whitelisted words. Tokens are 192 bits, stored as SHA-256 and compared in constant time; the lockout covers Admin and the sign-in to respond together. Every Admin route sits behind the unlocked-session check, and every change in Admin and respond needs a custom header and a same-host `Origin`, with `SameSite=Strict` cookies. A session is answerable only by its owner or an Admin, and the answer's text is never logged. The UI has no `dangerouslySetInnerHTML`, and a Markdown link opens only `http(s)` and `mailto`. `podiumctl` passes the token by environment, writes the config at mode 0600 and keeps the token out of the boot file. Log lines redact tokens.

**Accepted.**
- *Guessing the admin secret with `X-Podium-Token`.* Accepted when found, fixed in #255: wrong secrets on the report routes are now throttled with a counter of their own. The shared lockout could not simply count them, since a misconfigured reporter would lock out every reporter and the person's own browser on a shared address (all local reporters arrive from `127.0.0.1`). The throttle counts distinct wrong values, never person tokens, and while it holds it refuses even the right admin secret from that address; see 32.
- *DNS rebinding.* Accepted when found, fixed in #256 (see 33): the server now refuses a `Host` it does not expect. The reads are still open by design (7.1).
- *Open reads and three open writes.* `GET` routes, Remove on a lost card, closing a wall notice and the background-sessions switch take no token (7.1). They change only how the wall looks.
- *Development dependencies.* Accepted when found, cleared in #269: `npm audit` listed `vitest`, `vite`'s `esbuild` and `tinypool`, none of which ships in the image. The test tooling moved to vitest 5, vite 8 and `@vitejs/plugin-react` 6, and `npm audit` (with dev dependencies) now reports nothing. The root `package.json` names vitest itself, because the two workspaces no longer share one copy for the `scripts/` tests to find; and `frontend/src/jest-dom.d.ts` carries jest-dom's matcher types for vitest 5's two-parameter `Assertion` (GOTCHAS).
- *A server's own page loads Google Fonts,* which tells Google that someone opened Podium. The policy names that one origin.

**Cost.** The policy must be edited by hand when the page gains an origin or an inline script.

## 32. Throttling wrong admin-secret guesses on the report routes (#255)

**Context.** Admin's unlock and the console sign-in lock a source after five wrong tries, but `X-Podium-Token` on `POST /report`, `POST /hook`, `DELETE /sessions/:id` and the mod's respond routes had no limit, and a secret found there opens Admin (31). Counting those in the shared lockout would let one reporter with a stale token lock out every other reporter on `127.0.0.1`.

**Decision.** A separate throttle per source address (`GuessThrottle`). It counts *distinct* wrong values (kept as hashes), locking at five for 15 minutes. A person's token is never counted or throttled: it has 192 random bits, so it cannot be guessed, and stale or revoked ones are the common misconfiguration. While throttled, any non-person credential gets `429` with `Retry-After`, including the right admin secret. A short `PODIUM_TOKEN` (under 24 characters) is warned about at start.

**Alternatives.** Counting every wrong token in the shared lockout (the stale-reporter lockout above). A throttle that lets the right secret through while locked, which would let a guesser learn the right one from the one response that differs, so it limits nothing. Delaying wrong answers instead of refusing, which holds connections open.

**Cost.** An attacker who shares an address with an admin-secret reporter can lock that reporter out for 15 minutes (its reports are retried about once a minute and recover when the lock ends). Reporters with a person's token are untouched, which is another reason to give each person one rather than reporting with the admin secret. Behind a container's port mapping or a proxy, clients may all show one source address and then share one throttle (the Admin lockout already has the same limit; Podium sets no `trust proxy`). The counter is in memory, so a restart clears it.

## 33. Refusing a Host the server does not expect (#256)

**Context.** The reads take no token (7.1), and the server did not look at `Host`. A page on another site can rebind its own name to `127.0.0.1` and then read the fleet, including every agent's prompt and answer, as its own origin. It cannot reach Admin or respond, which need a cookie that rebinding never carries (31).

**Decision.** A check ahead of every route answers `403` to a `Host` that is not a loopback name or address, the bound address, or a name in `PODIUM_ALLOWED_HOSTS` (7.7). `localhost` always works, with nothing to list.

**A server bound to `0.0.0.0` (or `::`) allows any IP-literal `Host` by default.** What a rebinding page controls is a DNS name; the browser sends that name in `Host`. An address typed in the bar is not resolved, so no other site can make a browser send one for this server, and allowing it costs nothing. Refusing addresses on a wildcard bind would break the supported `--bind 0.0.0.0` use for no gain, and would make the owner list every address the machine has. A name is never allowed unless listed, on any bind. On a specific bind (`--bind 192.168.1.5`) only that address is allowed, besides loopback. In container mode the server cannot see the host's bind address (it listens on `0.0.0.0` inside), so it takes any address there; the container's published port is still limited to the bind address by Podman.

**Cost.** Reaching a server by a name (`box.lan`, a reverse proxy's name) needs `PODIUM_ALLOWED_HOSTS` and a restart, and a reverse proxy that rewrites `Host` has to send a name that is listed. A request with no `Host` (HTTP/1.0) is refused.
