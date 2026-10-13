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

**Choice.** An orchestrator's own cost is the session's ledger. Agent cost is token counts times a price
table (`mod/podium-reporter/hooks/models.ts`), and the UI always labels it an estimate.
**Why.** The engine only gives a ledger for the session, not per agent. Presenting an estimate as a bill
would be wrong.
A model with no price (anything that is not a Claude model, such as one served by Ollama) gets no estimate at
all: `null` in the report and "n/a" in the UI, and its sessions are left out of the fleet's cost total with a
note. The earlier fallback priced it as Sonnet so the number was never zero, but an invented figure presented
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

**Choice.** `bin/podiumctl.mjs` is a plain ES module with no dependencies. It manages the server either in
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
steps in `CLAUDE.md` do not mention it yet.

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
most the first 200 files; an untracked folder with hundreds of files costs up to 200 extra `git diff --no-index` calls on every poll, and untracked files past the 200th add no lines to the totals. The report carries the list in every snapshot, since a report is a full snapshot
(SPEC 6.7), and the mod only marks a report due when the list changes.

## 20. Per-person tokens bound to a name, and an Admin section gated by the old shared secret

**Choice.** The shared `PODIUM_TOKEN` becomes the *admin secret*. It opens an Admin section where the server owner
makes a token for each person. A person's token is `pdm_<12 hex key id>_<48 hex secret>`, generated by the server,
shown once, and stored only as its SHA-256 and last four characters. A report is accepted when its token is live
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
(`podman inspect` shows it). Sessions live in memory, so a restart locks Admin. There are no accounts or roles, and a
person cannot see or rotate their own token. Tokens still travel over plain HTTP: a network-reachable server needs a
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
here too. Reports grow by a few rows per model. The cost-per-minute sparkline still comes from the ledger's samples
and does not follow the Admin's prices. Cache writes count at the 5-minute rate unless Claude Code reports the
1-hour part; the `turn.step` usage fields in SPEC 5 carry no such split, so until it does the 1-hour price has no effect.
