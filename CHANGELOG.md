# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/). Podium is
pre-1.0, so a minor release can include breaking changes.

A release sets the version in `package.json` (root, `server` and `frontend`) and in
`mod/podium-reporter/.claude-plugin/plugin.json` to the same number. Between releases the mod's version can
be ahead, because a mod fix is bumped in its own PR.

## [Unreleased]

### Added

- Podium now says when a reporter and the server are on versions that do not match. The server keeps a range of reporter versions it supports (SPEC 6.8) and tells each reporter where it stands in the reply to a report. The mod shows `update mod` or `upgrade server` on its status line, in `/podium` and as a toast. The dashboard marks the affected cards, counts them in the top bar and says what to do on the session's page. Reports from a mismatched reporter are still accepted. The left rail footer now shows the server's version beside the credits and the license. This adds `serverVersion`, `reporterSupport` and `reporterCompat` to the reply, `reporterVersion` and `compat` to each session, a `server` block to the state, `--reporter-version` to `npm run podium:sim`, and a mod bump to 0.3.0. (#49)
- The orchestrator's row in the agent tree is now a button, like an agent row. Clicking it, or pressing Enter on it, opens an orchestrator panel on the right with its name, status, model, effort, context, tokens, cost, time and git line, and a Back button. It works the same on the History page and for a session reported by settings hooks. Tools and skills are not shown, because the report does not carry them for the main loop. (#63)
- The agent panel shows every tool an agent used as chips with their call counts, most used first, five at a time with a Show all / Show fewer button, and marks the tool used last. This adds `toolCounts` to each agent in the report, a database migration (version 2), and a mod bump to 0.2.0. A reporter older than 0.2.0 still works and the panel shows its Last tool line as before. (#25)
- Color themes: a Theme dropdown in the row under the top bar (Podium, Solarized, Nord, Gruvbox, Catppuccin, GitHub) with a Light, Dark or System mode for each, replacing the Theme toggle button. A footer in the bottom left of the left rail links the palette credits and the license and shows the copyright. Podium stays the default, an old light or dark choice carries over, and the choice is applied before first paint. The palettes are credited in `THIRD_PARTY_NOTICES.md`, and `scripts/theme-contrast.ts` checks contrast for every theme and mode. (#32)
- The left pane, the right pane and the top bar collapse and expand on their own, from edge buttons and from `[`, `]` and `\`, and are remembered across reloads. A Wall mode button (or `w`) collapses all three at once, asks for fullscreen, hides the cursor and its own buttons after a few idle seconds, and leaves with `Esc` or the Exit button. A lost connection still shows its red alert with everything collapsed. (#33)
- A heartbeat-lost card, its rail row and its page have a Remove control that takes the session off the wall at once in every open tab. The session stays in History and returns if it reports again. (#41)

### Removed

- **Breaking:** the usage dashboard is gone: the "Usage dashboard" link in the top bar, the `#/usage` page
  (a `#/usage` link now opens the fleet console), the `/api/claude-code` and `/api/api-usage` routes, and
  the `recharts` dependency. The `ANTHROPIC_ADMIN_API_KEY` setting is retired: `podiumctl` ignores a
  leftover value and `podiumctl config unset ANTHROPIC_ADMIN_API_KEY` clears it. (#30)

### Changed

- A session that is waiting on you now reads as a plain message in the activity feed, in the same yellow as the card: "Waiting for your approval." or, for a question, "Waiting for your input.", with the tool name (`Bash`, `ExitPlanMode`, `AskUserQuestion`) in a chip under it, instead of the raw tool call cut off at 160 characters. Once the session logs anything newer, the row turns plain and reads "Waited for your approval." The card and the orchestrator page use the same two sentences, so the card now says "approval" for a permission prompt and "input" for a question, where it used to say "input" for both. Events already stored read the same way. (#68)
- Four more activity feed rows read as plain sentences. A turn that ended after a failing call says "Turn ended with an error after a failing call." with the tool in a chip, instead of printing the whole call. A session end says "Session ended (cleared)." instead of `session.end · clear`, a session start from settings hooks says "Session started." (or resumed, or continued after compaction), and an agent seen only by settings hooks says "Spawned Explore." Events already stored read the same way. (#68)
- The orchestrator page's waiting callout now leads with "Waiting for your approval. Answer in its terminal." (or "input" for a question) and shows the tool name, such as `Tool: ExitPlanMode`, as a muted line under it, instead of the raw tool call cut off at 160 characters. A note that was cut off is left out rather than shown as if it were the whole prompt. The card and the activity feed are unchanged. (#64)
- A heartbeat-lost card now counts down to when it goes away ("Goes away in 37 s") instead of showing a fixed "Dropped from the fleet at 1:15". The server sends the time as `dropAt`, so it is right after a server restart and for hook-only sessions. (#41)
- Effort shows as five colored bars with no text, and the level is in a tooltip and the meter's accessible name. Each level has its own color (low orange, medium green, high blue, xhigh purple, max rainbow). The Agents table's Effort column shrank to fit and its freed width went to the Context, Tokens, Cost and Time columns. (#24)
- The README, `docs/GOTCHAS.md` and `docs/SPEC.md` now explain the `⚠` in front of Podium's status line:
  Claude Code adds it, with the mod's name, to every mod's status line, and it is not a Podium warning or a
  trust state. (#29)

### Fixed

- Clicking an agent row no longer flashes orange patches behind its cells. A clicked row now shows only the
  selected background. Opening an agent from an activity entry still flashes its row, now as one band across
  the whole row. (#70)
- Cards on the fleet wall keep a steady 360 px width (narrower only when the area itself is). Collapsing or
  expanding the left pane, the right pane or the top bar, or entering Wall mode, now adds or removes columns
  instead of shrinking every card, and a short last row stays left-aligned. (#65)
- Two sessions no longer show the same running time because the engine reported them one shared start. The
  server keeps a session's reported start only when it is within 2 minutes of the first report; otherwise
  the session counts from when the server first heard of it, and the start never changes after that. A
  resumed session therefore counts from its first report. (#43)
- With the server in a container, project and working-directory paths under your home now show as `~/...`
  on the wall, in the focused view and on the history page, as they do in standalone mode. `podiumctl`
  passes the host's home to the container as `PODIUM_HOST_HOME`; an unset or non-absolute value is
  ignored, so no wrong `~` is shown. (#20)
- A long branch name on a session card no longer wraps mid-name: it ends in an ellipsis, and a long
  worktree name does the same, with the full value in the tooltip. A project path that does not fit is
  now cut from the front, so the last folders stay visible, and its tooltip shows the full path. The focused
  view still shows both in full. (#19)
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
