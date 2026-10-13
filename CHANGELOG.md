# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/). Podium is
pre-1.0, so a minor release can include breaking changes.

A release sets the version in `package.json` (root, `server` and `frontend`) and in
`mod/podium-reporter/.claude-plugin/plugin.json` to the same number. Between releases the mod's version can
be ahead, because a mod fix is bumped in its own PR.

## [Unreleased]

### Documentation

- The README and the user guide now say that load grows with the number of sessions and agents reporting, what grows on the server and in each open tab, an example measurement from #81, how to measure your own with `scripts/gpu-sample.sh`, and what lowers it. (#107)

### Fixed

- The facts bar on the orchestrator page now adds up. The orchestrator's row showed the whole session's cost, the same figure as the bar, so the rows summed to far more than the total; it now shows its own share (the session's cost less each agent's estimate) and the rows add up to the bar. A real run confirmed that Claude Code's session figure includes every agent: it rose by about the new agent's estimate when one finished. The Agents cell counts the orchestrator (running while the session runs, done once it is done, neither while it is stale), as do the rail and the card. A new **Agent time** cell sums the orchestrator's time and every agent's, beside the wall-clock **Running for**. The Orchestrator model and Context cells are gone, because the orchestrator's row in the agent table already shows its model, effort and context. The wall's "agents running" tile still counts agents only. (#109)
- An agent's Tokens no longer falls behind Claude Code's figure as the agent runs. Claude Code shows the context at the agent's latest request plus every output token it has written so far; Podium showed the context alone, so the gap grew with each reply (about 10k at 280k in a real run) and the final figure always ended lower. Podium now adds the output the agent has written, which the reporter already sent, so no reporter update is needed. The orchestrator row is unchanged. SPEC 6.5 records the definition. `scripts/agent-context-audit.sh` compares each agent's figure with its own transcript, and `scripts/agent-tokens-sample.sh` logs a running agent's figure over time. (#108)

### Added

- The agent panel has a **Report** group with two buttons, Task prompt and Final answer, that open the text in a modal with markdown rendered as formatting. A button is dimmed and inert when there is nothing to show (and the answer says "not finished" while the agent runs). The modal blurs the page behind it, closes with the X, Esc or a click outside, keeps focus inside and gives it back, and has a Copy button. Raw HTML in the text is shown as text. The whole prompt and answer need the new opt-in `fullPrompts` reporter option (mod 0.10.0, off by default): they are redacted, cut at 20,000 characters, sent once, stored in a new `agent_texts` table and fetched when the modal opens from `GET /api/fleet/sessions/:id/agents/:agentId/text`. Without it, or with an older mod, the modal shows the 400-character excerpt and says why. The supported reporter range is now 0.2.0–0.10.0. (#97)

### Changed

- Agents that launch agents now show correctly everywhere. A real run on Claude Code 2.1.296 showed that a subagent can launch a subagent or a fork, and a fork a subagent, and that the mod already reports the real parent at every depth, so the mod is unchanged (SPEC 5.3 records what the engine gives). Sorting the agent tree by a column used to flatten it into one list; it now keeps every agent under the one that launched it and sorts each group of siblings, and "Show as tree" is now "Launch order". Past two levels the Task column widens and the table scrolls sideways, so a deep row keeps its text, and each row's full task is its tooltip. The agent panel says who launched the agent and, for an agent that launched others, adds its branch up ("With its agents"). Cost tooltips say that an agent's row is its own estimate and that the orchestrator's row, the facts bar and the card are the whole session. The card's squares follow the tree and name a nested agent's parent, and a nested launch in Activity says which agent launched it. The note on a settings-hooks session now says it cannot show who launched an agent. (#101)

- A row in the agent tree that is running while agents it launched are running now reads "delegating" (blue, hollow dot) instead of "running", and so does the orchestrator in the page header; hover it for the agents it waits on. This covers an agent waiting on its own subagents and forks too. It is display-only: the session status, the fleet wall, the filters and every count still say running, and a session waiting on you still shows "waiting on you". New `--deleg` colors are defined for every theme and mode, and `scripts/theme-contrast.ts` checks them. A background agent also counts, since Podium cannot tell the launch modes apart. (#98)
- An agent's Tokens figure now matches Claude Code's own agent line. It was a running total of input, output, cache read and cache write, so each request counted the whole cached context again and the number read about 100 times too large (38.95M against 395.4k for the same agent). It is now the context the agent holds at its newest request. The orchestrator row shows its own context, and the facts bar and wall card add the orchestrator and its agents. Every Tokens label has a tooltip with this definition, and the agent panel lists the running totals under "Used so far". The tokens-per-second charts and the "tokens in the last minute" tile are unchanged. (#96)
- The Fleet page's top bar drops the local-time clock and gets a "Fleet" pill after the logo and name, the same kind of pill the Admin page has, so each page says which one it is. Nothing is placed to the right of the connection pill, because its width changes as "synced Xs ago" ticks. (#91)
- The legend (what the agent squares mean, and the model colors) is now a footer at the bottom of the middle column instead of the last thing in the wall's content. It no longer scrolls away with the cards or sinks off screen when there are many sessions. It shows on the fleet wall and on the orchestrator page, is centered on a background halfway between the card color and the page, with a top border, and stays visible in wall mode. The left rail and the right panel keep their full height beside it. In the stacked layout below 1040 px it is the last thing on the page, with extra padding. The wording and swatches are unchanged. (#92)
- The dashboard uses still less GPU. The running-dot pulse and the agent and plan-step blinks no longer each run their own CSS animation. They all step on one shared beat, four times every 1.8 seconds, so the page changes a few times a second instead of at a different moment for every dot. With ten simulated sessions and a hundred agents on screen, Chrome on an M5 MacBook Pro went from about 31% to about 24% GPU (a plain page reads about 15%), alternating the previous build and this one in one tab. The animation looks the same as the stepped one from the last release. Reduced motion and a hidden tab still stop it. Applying incoming data on the same beat was tried and measured no gain, so it was left out. (#81)
- The dashboard uses less GPU. With ten simulated sessions and a hundred agents on screen, Chrome on an M5 MacBook Pro went from about 41% to about 27% GPU (a plain page reads about 15%), measured with `scripts/gpu-sample.sh` alternating the old and new styling in one tab. The running-dot pulse is now a ring that scales and fades instead of animating `box-shadow`, and the pulse and the agent and plan-step blinks move in a few steps a second instead of a smooth fade, because a smooth animation that never ends makes the browser draw a frame on every display refresh for as long as the tab is open. The progress bars no longer slide between values, and every animation pauses while the tab is hidden. The pulse and blink look slightly more stepped than before; reduced motion still turns them off. Safari and Firefox were not measured. (#81)
- A session that runs a model that is not a Claude model, such as one served by Ollama, is no longer priced as Sonnet or given a 1,000,000-token window. It keeps its own model name with an "other" chip that says it is not a Claude model, its cost reads "n/a" with the reason, its context shows as unknown when Claude Code does not report a window, and the "Est. cost today" tile leaves it out and says how many sessions it skipped. A model whose name merely contains `opus`, `sonnet`, `haiku` or `fable` (`my-sonnet-finetune`) is no longer taken for that family; only a bare alias or an id containing `claude` is. Claude models are unchanged. A report can now carry `null` for an agent's `costUsdEst`, so this moves the mod to 0.5.0 and the supported reporter range to 0.2.0–0.5.0; a 0.5.0 mod talking to an older server may have a report with a null cost rejected, and the version notice says to upgrade the server. (#66)

### Added

- `npm run podium:sim -- --nested` keeps one session running agents that launch agents: a subagent under a subagent four levels deep, a fork under a subagent and a subagent under a fork. In every scenario an agent now waits for the agents it launched before it finishes, and a nested fork inherits its parent agent's model and effort. (#101)

- A people view for a Podium that several people report to. Once any live session belongs to a named person (from a person's token, see #36), the wall groups orchestrators into a band per person: the person's monogram and name, their group, the machines they report from, how many sessions are live, waiting or stale, and their share of today's estimated spend. Each card names its machine. Sessions sent with the admin secret are under Admin and sessions with no owner under Unassigned, after the people. Group by switches between People, Group (a band per group from Admin, each card naming its owner, people without a group under No group) and None (the flat wall with an owner on each card). Bands can be ordered by who needs attention, by spend or by name, and collapse to their header. The left list groups the same way, and clicking a person or group there narrows the wall to them. "You are" tells this browser who is looking (remembered in `localStorage`), which pins your own band first and makes "Only me" work. The right panel starts with "Spend today, by person" (or by group), as a bar chart or a table. With no named person the console looks exactly as before. The simulator takes `--person NAME[=TOKEN]` and `--unnamed` to demo it. (#34)
- Sessions now say which machine they run on. A reporter with a `userName` set also sends `machine`: the short host name and a random id the mod keeps in its own store, so two machines with the same host name stay apart. An unnamed reporter sends neither, and nothing is read from the operating system user or `git config`. The server stores it (database migration 7, `sessions.machine_json`) and returns it on every session with the owner's group (`machine`, `ownerGroup`), and the KPIs split today's estimated spend by owner (`costTodayByOwner`). The mod moves to 0.9.0 and the supported reporter range to 0.2.0–0.9.0; an older reporter works unchanged. (#34)

- An Admin section where the server owner makes a token for each person, bound to that person's name. Open it from the new Admin button in the top bar's upper right (`#/admin`) and enter the admin secret, which is the `PODIUM_TOKEN` that `podiumctl token` prints. Admin has four tabs, People, Groups, Reporting and security and Admin log, and every list is paged by the server (50 rows by default, at most 100) with a search over name, group and machine. A token (`pdm_<key id>_<secret>`, 192 bits of randomness) is shown once with the settings to paste, then only its last four characters; the database keeps a SHA-256, never the token. A report is accepted only when its token is live and the `userName` it sends is that token's person, so a valid token with another person's name, an unknown name, a revoked token or a token rotated away is refused with a 401. The server decides who a session belongs to from the token and stores it in `sessions.owner`; the shared `PODIUM_TOKEN` keeps working for reporting (owner `Admin`, with a switch in Admin to turn that off), so an existing setup is unchanged. Groups are labels for arranging people, one per person, and deleting a group moves its people to "No group". Admin locks after 10 idle minutes, five wrong secrets lock a source address for 15 minutes, every change needs an `X-Podium-Admin` header and the server's own origin, responses are `no-store`, and unlocks, failed unlocks, changes and their source addresses go in the admin log; no token or secret is logged, returned again or kept in browser storage. Without a `PODIUM_TOKEN` Admin is off. This adds a database migration (version 6: `people`, `groups`, `person_machines`, `admin_log`, `settings` and `sessions.owner`), `userName` on the report and `owner` on a session, a `userName` mod option, and moves the mod to 0.8.0 and the supported reporter range to 0.2.0–0.8.0. The mod now treats a 401 as a refused credential: it keeps its events, logs it once, shows `podium ○ token refused` and tries again about once a minute, where it used to retry with a short backoff and say nothing. Tokens still travel over plain HTTP, so a server reachable over a network needs a trusted network or a TLS proxy. (#36)
- A session nobody is attached to is marked and then set aside. After `/exit` under the Claude Code daemon the conversation keeps running as a background job, and its card used to look like any live session. Now the card turns dashed and muted with a "nobody attached" chip and a countdown, and after `DETACHED_HIDE_AFTER_MS` (60 seconds by default) it leaves the wall behind a "N background sessions hidden" line with a Show them button. `claude attach` brings it back at once. The mod reads `$.session.surfaces()` and the `session.attach` and `session.detach` events and reports `session.attached`; the server stores it with a database migration (version 5) and serves `attached` and `hideAt`. A report with no field, from a mod older than 0.7.0, counts as attached. Mod 0.7.0. (#45)
- The orchestrator page's plan section is now two tabs, Plan and Files. Files lists every file the session changed, with its status and the lines added and removed (`+12 −3`), a summary with the totals, and a pager at 20 files a page. It reads the changes from `git diff` against the commit the session started on, so committed work stays listed after the git row's `N modified` has gone, and a binary file shows the word `binary` instead of counts. The left column grows from 300 to 400 px while Files is open. With nothing changed the tab says where files will appear, and when the session's mod is older than 0.6.0 a note says to update it. The report gains `session.files` (SPEC 5.7, 6.2), stored in a new `sessions.files_json` column (migration 4) and cut at 200 files with totals over all of them. This moves the mod to 0.6.0 and the supported reporter range to 0.2.0–0.6.0; an older mod keeps working and shows the empty tab. File paths and line counts now leave the session, never contents (README). (#26)
- The orchestrator panel now shows Steps, the tools it used as chips (most used first, as in the agent panel) and Skills loaded, on the live page and on the History page. They are the orchestrator's own: calls made by the agents it launched stay in those agents' panels. This adds a `loop` block to the report's `session` (SPEC 6.2), a database migration (version 3, a nullable `sessions.loop_json`), and moves the mod to 0.4.0 and the supported reporter range to 0.2.0–0.4.0. A mod older than 0.4.0 sends no `loop`, so its panel stays as it was and one note says the rows need podium-reporter 0.4.0 or later; a settings-hooks session shows neither the rows nor the note. The update notes (this one and the agent panel's tool-counts one) now ignore a version that is not plain `major.minor.patch`, such as the simulator's `0.1.0-sim`, and this one is not shown for an ended session. (#75)
- The agent panel now says why it shows a Last tool line instead of tool chips: when the session's mod is older than 0.2.0, a note says tool counts need podium-reporter 0.2.0 or later and how to update it. A current mod and a settings-hooks session show no note. (#76)
- Podium now says when a reporter and the server are on versions that do not match. The server keeps a range of reporter versions it supports (SPEC 6.8) and tells each reporter where it stands in the reply to a report. The mod shows `update mod` or `upgrade server` on its status line, in `/podium` and as a toast. The dashboard marks the affected cards, counts them in the top bar and says what to do on the session's page. Reports from a mismatched reporter are still accepted. The left rail footer now shows the server's version beside the credits and the license. This adds `serverVersion`, `reporterSupport` and `reporterCompat` to the reply, `reporterVersion` and `compat` to each session, a `server` block to the state, `--reporter-version` to `npm run podium:sim`, and a mod bump to 0.3.0. (#49)
- The orchestrator's row in the agent tree is now a button, like an agent row. Clicking it, or pressing Enter on it, opens an orchestrator panel on the right with its name, status, model, effort, context, tokens, cost, time and git line, and a Back button. It works the same on the History page and for a session reported by settings hooks. Steps, tools and skills were left out of it at first, because the report did not carry them for the main loop; #75 adds them. (#63)
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

- The Agents tile on the orchestrator page no longer wraps "· 0 done" onto its own line and leaves the dot hanging. The tile now reads "N running / N done" on one line that never wraps (the done count in muted ink), with the "N failed" button after it. It sizes to its content (about 320 px at "9999 running / 9999 done" with a "9999 failed" button), and the Est. cost, Tokens and Running for tiles now start at their content width instead of 110 px to leave it room, so the facts bar stays on one row down to about 860 px wide (950 px with the failed button); when the bar is too narrow, whole tiles move to a second row instead of text wrapping inside one. No other tile had a separator inside a wrapping item. (#100)
- The heartbeat-lost message on a card, and the same notice on the orchestrator page, now reads as one sentence.
  It used to show wide gaps around the time and a gap before the final period (`Last heartbeat 0:34 ago. Goes
  away in 41 s .`), because the alert box spaced every piece of text and every time as a separate item. The
  wording and the countdown format are unchanged. (#87)
- In the activity list the colored square now sits level with the time and the first line of text. It used to
  be centered in the row, so on a row that wrapped to two lines (the text and the `Open agent` link) it floated
  between them. The square keeps its size and color; the yellow ring on a waiting row moves with it. (#88)
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
