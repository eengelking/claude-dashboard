# Architecture

This repo holds two apps that share one Express server and one Vite frontend:

- the earlier **usage dashboard** (`server/src/*.ts`, `frontend/src/App.tsx`), reachable at `#/usage`;
- **Podium**, a live fleet console for Claude Code sessions (`mod/podium-reporter/`, `server/src/fleet/`,
  `frontend/src/fleet/`), the default view at `#/`.

`docs/SPEC.md` is the build spec for Podium. This file records how it was actually built, where it differs
from the spec and why, what was verified, and what is still open.

## Spec questions

Places where the spec was silent, ambiguous or wrong, the reading chosen, and why.

1. **"Identical type declarations" in both `protocol.ts` files (T0.1).** The mod has no use for the view
   types (`SessionView`, `Kpis`, ...). Reading chosen: the Report family (`Report`, `SessionReport`, `Plan`,
   `AgentReport`, `Failure`, `ActivityEvent` and their small helper types) lives between
   `// <protocol:begin>` and `// <protocol:end>` markers in both files, and the comparison covers that block.
   The view types live only in the server's file.
2. **Where the "sibling file" comparison runs (T0.1).** `claude plugin test` runs the mod's tests in the
   hooks sandbox, which has no file system, so a mod test cannot read the server's file. Reading chosen: the
   comparison lives in `server/src/fleet/protocol.test.ts` and reads both files. The comparison is
   symmetric, so one test covers both directions.
3. **Named sub-types.** Sections 6.2 and 7.4 write some shapes inline (`tokens`, `context`, `git`). The code
   names them (`TokenCounts`, `ContextFill`, `GitInfo`, `RateLimit`, `PlanStep`, `SessionReport`) so the
   validator, the server and the UI share them. The structure is unchanged.
4. **Omitted optional fields.** 6.2 says missing optional fields are `null`, never omitted. The validator
   accepts an omitted nullable field as `null` rather than rejecting the report (7.7: "reject, never crash,
   on junk" is about junk; a missing nullable is not junk). Required fields must be present.
5. **Over-long line lists.** `outputTail` keeps the **last** 12 lines and `evidence` the **first** 5;
   each line is clamped to 240 characters. These are clamped, not rejected, like other strings.
6. **Control characters.** Every reported string has C0 control characters (except tab) and DEL replaced
   by a space before it is stored. Newlines in single-line fields would break the UI's one-line layouts.

7. **Extra server files.** Besides the files 4.1 lists, `server/src/fleet/` has `fleet.ts` (the service
   that owns the live set and turns ingests and sweeps into SSE messages, used by `routes.ts` and
   `sweeper.ts`) and `testing.ts` (fixture loader for tests). `server/vitest.config.ts` adds
   `scripts/*.test.ts` to the server suite so the simulator is tested by `npm test`.
8. **Samples between reports.** 7.2 says one sample row per second per live session, but a quiet session
   reports only every 5 s. The sweeper writes a carry-forward sample (same totals, delta 0) for each
   second a live, non-stale session has none, so its charts do not drop to zero between heartbeats.
   Missing seconds (server down, stale session) are still zero-filled.
9. **First sample of a session.** `tokens_delta` of a session's first sample is 0, not its whole total,
   so a session first seen with 2M tokens (say after a server restart) does not show a 2M spike.
10. **Series end.** The 60-point series end at the last complete second, not the second in progress,
    whose sample is partial. `blowoutSecondsAgo` counts back from that point (a blowout in the second in
    progress is age 0).
11. **`tokensTotal`** counts all four token kinds (input, output, cache read, cache write) for the main
    loop and every agent. Cache reads dominate, which is what the requests really processed.
12. **`costPerMinute`** (the KPI sparkline) is 60 one-minute buckets of fleet cost added, from the
    samples' cumulative `cost_usd`. **`tokensPerSec`** is 60 one-second points of Σ `tokens_delta`.
13. **`clearedToday`** is a count: sessions that ended or were dropped since local midnight and are no
    longer in the live set.
14. **`session` throttle.** One message per session per 500 ms, trailing edge: the first change in a
    window schedules a send 500 ms later carrying the latest state. Ten ingests in 200 ms give one
    message. Activity messages are not throttled.
15. **Stale and drop after a restart.** Stored, not-done sessions are stale until they report. A session
    never heard since the restart is dropped `DROP_AFTER_MS` after `max(last_seen + STALE_AFTER_MS,
    server start)`, so reporters get a full minute to come back after the server was down.
16. **A repeated final report.** A `done` report for a session that already ended and left the live set
    is stored but does not bring the session back for another linger.
17. **Retention env names.** 7.2 says the three thresholds are env-configurable but names none:
    `RETAIN_SAMPLES_MS`, `RETAIN_EVENTS_MS`, `RETAIN_SESSIONS_MS`.
18. **`GET /history`** is listed under Phase 4 in 7.1 but has no Phase 4 task. It was cheap, so it exists
    from T1.5: summary rows for sessions that ended or were dropped on a local day.
19. **Simulator haiku window.** The simulator runs its haiku agents as `claude-haiku-4-5` (200K window)
    so blowouts happen often, as 1.6.2 asks; the current Haiku 5.5 has a 1M window.

## Dependencies added

None at run time. `@types/node` in `server/` went from 20 to 24 so `node:sqlite` is declared.

## Phase log

### Phase 0: contract and scaffolding

Built: `server/src/fleet/protocol.ts` (types and `validateReport`), the mod's copy of the Report types,
`docs/fixtures/report.sample.json`, `.gitignore` entries for `data/` and `*.sqlite*`, the Vite proxy to
`127.0.0.1:$PORT`, and the `podium:sim` and `podium:smoke` root scripts.

Verified: `npm test` (server 26, frontend 15 tests) and `npm run build` pass. The fixture validates. The two
Report blocks match.

Found: `import { DatabaseSync } from 'node:sqlite'` fails under vitest 2 (Vite strips the `node:` prefix
and then cannot resolve `sqlite`). `process.getBuiltinModule('node:sqlite')` works under vitest, `tsx` and
plain `node`, and is typed by `@types/node` 24, so `db.ts` uses it. No fallback to `better-sqlite3` was
needed.

Not verified yet: the SSE proxy through Vite (T4.1 checks it).

### Phase 1: server

Built: `db.ts` (schema, migrations, `FleetDb` queries), `ingest.ts`, `derive.ts`, `fleet.ts`, `sse.ts`,
`sweeper.ts`, `routes.ts`, wiring in `server/src/index.ts` (binds `127.0.0.1` unless `HOST`, database at
`PODIUM_DB` or `data/podium.sqlite`, graceful shutdown on SIGINT/SIGTERM), and `scripts/podium-sim.ts`.

Verified by tests (server suite 91 tests, incl. the simulator's 4): idempotent ingest, agent retention and
abort-on-done, revive, sample deltas, blowout level (12 table cases), stale/drop/linger with an injected
clock, restart behavior, SSE throttle, client removal on write error, every route incl. 400/401/404/413,
event paging, and simulator determinism and report validity.

Verified by running: `npm run dev -w server` creates `data/podium.sqlite`, logs its URL and listens on
`127.0.0.1:4317` only (checked with `lsof`). With the simulator (`--sessions 5 --chaos`), `/state` showed
five sessions with agents, plans and 60-point series; `curl -N /stream` printed `snapshot`, then
`session`, `activity` and `tick`; after Ctrl-C the simulator reported all five `done`, and 8 s later the
live set was empty with `clearedToday: 5`.

Found while running: the newest series point was always 0 (the current second's sample is partial).
Fixed test-first (see Spec question 10).

