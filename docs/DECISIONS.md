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
dashboard stays in the same repo at `#/usage`.
**Why.** The repo is published, and the name should say what the product is. "Podium" was already the
working name in the spec (open question 10, kept in one constant).
**Cost.** Old links to `claude-dashboard` rely on GitHub's redirect. Historical docs under
`docs/superpowers/` keep the old name on purpose.
