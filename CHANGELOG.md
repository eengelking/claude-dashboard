# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/). Podium is
pre-1.0, so a minor release can include breaking changes.

A release sets the version in `package.json` (root, `server` and `frontend`) and in
`mod/podium-reporter/.claude-plugin/plugin.json` to the same number. Between releases the mod's version can
be ahead, because a mod fix is bumped in its own PR.

## [Unreleased]

### Removed

- **Breaking:** the usage dashboard is gone: the "Usage dashboard" link in the top bar, the `#/usage` page
  (a `#/usage` link now opens the fleet console), the `/api/claude-code` and `/api/api-usage` routes, and
  the `recharts` dependency. The `ANTHROPIC_ADMIN_API_KEY` setting is retired: `podiumctl` ignores a
  leftover value and `podiumctl config unset ANTHROPIC_ADMIN_API_KEY` clears it. (#30)

### Fixed

- A session card whose content is shorter than the card beside it now starts at the top, with the extra
  space at the bottom, instead of centering its content vertically. The cards in a row still stretch to the
  same height. (#17)
- A session card for a session waiting on you now says only `Waiting for your input.`, for a permission
  prompt and a question alike, instead of a block of the prompt's text that filled most of the card. The
  orchestrator page still shows the full note. (#50)
- In the agent detail panel, the Kind row is now an icon and one word (`Subagent`, `Fork` or `Teammate`) on
  one line, aligned with its label. The icon takes the agent's model color, as the squares in the session
  card's agent strip do. The explanation moved into a tooltip, on hover or keyboard focus, and is the
  value's accessible description. (#28)
- Sessions nobody asked for no longer show up as cards. Claude Code's background daemon runs a parked
  twin of an interactive window and a pool of pre-warmed spares, and each one loads the reporter and
  reported as a session of its own. Opening one window in a project could put three identical "waiting on
  you" cards on the wall. A session now appears once it has done something (tokens, cost, context, an agent,
  a plan or a blowout, or it is running), and stays off the wall, the activity feed, the history and the
  cleared-today count until then. Sessions known only from settings hooks are not filtered, since hooks
  carry no usage. (#42)
- `podiumctl start --mode standalone` no longer reports "Podium is up" when another process already holds
  the port. It fails before spawning, names the port and suggests `podiumctl status` or `--port`. If the
  server it spawned exits during startup, `start` now fails, shows the end of `podium.log` and leaves no
  pid file behind.
- In the Agents table, the Status text and icon no longer sit about a pixel lower than the Tokens, Cost and
  Time values on the same row. The Model and Effort cells had the same small offset and are centred with it.
  (#31)
- On a session card, the cost, token count and duration line no longer breaks in the middle of a value.
  When the three do not fit beside the sparkline, whole values move to the next line, so `15h 54m` stays
  together. (#18)
- In the Agents table, the Time column is wide enough for the longest duration the dashboard shows
  (`23h 59m`, or `999d 23h` for a very long session) and no longer wraps `16h 21m` onto two lines. A test
  fails if the duration format ever gets longer than the column. (#23)

## [0.1.0] - 2026-10-11

First release. The repo started as a usage dashboard and became Podium, a live
fleet console for Claude Code sessions, with a container, a command-line manager
and a plugin you can install from a marketplace.

### Added

- **Podium fleet console** (`#/`, the default view). Every Claude Code session
  running with the reporter mod shows up in one browser tab within about two
  seconds: model and effort, plan, the agents it launched (subagents and forks),
  estimated cost, context-window fill, context blowouts, failures with the
  failing call and its last output, and the git branch or worktree. Sessions
  appear and leave on their own. Podium only observes; it never sends a prompt or
  touches a session. (PR #2)
- **Reporter mod** (`mod/podium-reporter/`): a Claude Code mod that reports a
  full snapshot plus unacknowledged events, redacts anything that looks like a
  secret, queues reports while the server is down, and adds the `/podium`
  command and a status line entry. Options: `serverUrl`, `token`,
  `flushIntervalMs`, `heartbeatMs`, `sessionName`, `showStatus`,
  `explainFailures`. (PR #2)
- **Server** (`server/src/fleet/`): hand-written validation of every report,
  SQLite storage through `node:sqlite`, Server-Sent Events for live updates,
  stale and drop timers, retention, and a `/history` endpoint. A shared token
  (`PODIUM_TOKEN`) guards reports, hooks and deletes. (PR #2)
- **Settings-hook ingest** (`POST /api/fleet/hook`): a reduced view of sessions
  started without the mod, from Claude Code's settings hooks. (PR #2)
- **History page** (`#/history`) listing the sessions that ended on a chosen
  day. (PR #2)
- **Simulator, smoke and soak scripts** (`scripts/podium-sim.ts`,
  `podium-smoke.sh`, `podium-soak.sh`) for developing and checking Podium with no
  real sessions. (PR #2)
- **`podiumctl`** (`bin/podiumctl.mjs`): start, stop, restart, status, logs,
  health, token, config, enable and disable (start on boot through launchd or a
  systemd user unit), shell and rm, in either a Podman container or a standalone
  Node process. The first start generates an auth token and saves it to
  `~/.podium/config.env`. (PR #3)
- **Container image** (`Containerfile`): a two-stage Node 24 build that runs as
  a non-root user and keeps its database in a `/data` volume. (PR #3)
- **Marketplace install.** `podium-reporter` is listed in
  `eengelking-marketplace` (`eengelking/skills`):
  `/plugin install podium-reporter@eengelking-marketplace`. (`eengelking/skills`
  PRs #32 and #33)
- **Docs:** `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DEMO.md`,
  `docs/DECISIONS.md`, `docs/GOTCHAS.md`, `docs/USER_GUIDE.md`, `CONTRIBUTING.md`
  and the `.github/` community files, issue and PR templates, and CI.
  (PRs #1, #4, #6 and this release)
- **Usage dashboard** (`#/usage`, the earlier app): charts Claude Code and
  Anthropic Admin API usage from local logs and the Admin API.

### Changed

- The project was renamed from `claude-dashboard` to `podium`
  (`eengelking/podium`). (PR #5)

[Unreleased]: https://github.com/eengelking/podium/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/eengelking/podium/releases/tag/v0.1.0
