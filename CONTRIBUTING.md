# Contributing

Thanks for considering a contribution to Podium. This doc covers what belongs here, how to set up, how to
propose a change, and how it gets merged.

## What belongs in this repo

Podium shows every Claude Code session on one machine in one browser tab. This repo holds the whole thing:
the reporter mod (`mod/podium-reporter/`), the server (`server/`), the UI (`frontend/`), `podiumctl` and the
container image.

A change fits if it makes Podium better at watching sessions. Some things are out on purpose, and
`docs/SPEC.md` ("Non-goals") lists them:

- **No control surface.** Podium never sends a prompt, stops an agent, approves a permission or edits a
  session. The two requests the mod can make of its own (`explainFailures`, `cacheWarming`) are opt-in,
  separate from the session, and cannot be turned on from the dashboard.
- **One machine, one user.** No multi-machine fleets, accounts or cloud sync.
- **No billing accuracy.** Cost is an estimate and the UI says so.

If your idea needs one of those, open an issue and say why before writing code.

## Setting up

You need Node 24 and npm. The mod's own tests and type check also need Claude Code installed.

```sh
git clone https://github.com/eengelking/podium.git && cd podium
npm install
npm run dev          # server on http://127.0.0.1:4317, Vite UI on http://localhost:5173
npm run podium:sim -- --sessions 5 --chaos    # fake sessions, in a second terminal
```

To try the mod in a real session, load it from your checkout:

```sh
claude --plugin-dir /path/to/podium/mod/podium-reporter
```

## Checks to run

```sh
npm test               # server, UI, simulator and podiumctl tests (vitest)
npm run build          # UI and server build, scripts type-check
npm run test:mod       # the mod's tests (needs Claude Code)
npm run typecheck:mod  # the mod against Claude Code's plugin API declarations (needs Claude Code)
npm run podium:smoke   # end to end: server, simulator, SSE
```

CI runs `npm test` and `npm run build` on every PR. It cannot run the two mod checks, because a stock runner
has no Claude Code, so run those yourself when you touch the mod.

When you fix a bug in code, add a test that fails for the right reason first, then fix it.

## Proposing a change

Open an issue first for anything non-trivial (a new feature, a behavior change, a change to the report
format). A small, obvious fix, such as a typo or a broken link, can go straight to a PR.

`docs/SPEC.md` is the source of truth for intended behavior. If your change makes the code differ from it,
the spec wins unless the maintainer agrees to change the spec. Say so in the PR and expect that to be its
own conversation. Other docs should link to the spec section instead of restating it.

### Where things are documented

| Doc | Owns |
|---|---|
| `README.md` | Orientation, install, run, settings tables |
| `docs/USER_GUIDE.md` | Using the dashboard, day-to-day |
| `docs/SPEC.md` | Intended behavior and requirements |
| `docs/ARCHITECTURE.md` | How it was built, departures from the spec, verification, known issues |
| `docs/DECISIONS.md` | Why a significant choice was made |
| `docs/GOTCHAS.md` | Sharp edges that are easy to hit |
| `docs/DEMO.md` | A script for showing Podium to other people |
| `CHANGELOG.md` | One entry per release |

Update the docs that describe your change in the same PR, and add a line under `[Unreleased]` in
`CHANGELOG.md` for anything a user would notice.

### The mod version bump

If your PR changes the mod (anything under `mod/podium-reporter/` other than its tests), bump `version` in
`mod/podium-reporter/.claude-plugin/plugin.json` and `VERSION` in `mod/podium-reporter/hooks/register.ts`
in the same PR (a test checks that they match). Installed copies only update when that
number changes, so a mod fix that lands without a bump reaches nobody. CI (`mod-version-check`) fails a PR
that forgets. Bump the patch number for a fix and the minor number for new behavior. A release sets the mod
and the `package.json` versions to the same number, and the maintainer handles that when cutting one.

If the bump is a new minor version, also move `max` in `REPORTER_SUPPORT` (`server/src/fleet/compat.ts`) to
that version. Otherwise the server tells every up-to-date mod it is newer than the server supports. Raise
`min` only when the server stops reading older reports correctly. SPEC 6.8 has the rule.

### The report format

The mod and the server share one set of report types, copied between `<protocol:begin>` and
`<protocol:end>` markers in `server/src/fleet/protocol.ts` and `mod/podium-reporter/hooks/protocol.ts`. A
test compares them. Change both together.

### Voice

Write docs and PR text like a person wrote them: say the thing plainly, no em-dashes, no marketing filler,
no formulaic constructions. Reread what you wrote once before opening the PR.

## Branching, PRs and merging

Every change lands on a branch, never directly on `main`, however small. Branch off a current `main`:

```sh
git checkout main && git pull
git checkout -b <your-branch-name>
```

When the change is ready, open a PR against `main`. Say in the PR body that it is to be squash-merged.
This repo keeps one commit per PR on `main`, however many commits your branch has. The PR template has a
checklist.

Only the maintainer merges PRs into `main`, however small the change looks. Open the PR and wait for
review.

## Filing issues

Bug reports and proposals both go through GitHub issues, and the templates ask for what is useful. Check
for an existing issue first. If you are reporting several problems with one cause, one issue is more
useful than one per symptom.

**Security problems are different.** Please do not open a public issue for a suspected vulnerability.
Follow [SECURITY.md](.github/SECURITY.md) and report it privately.

By taking part you agree to follow the [Code of Conduct](.github/CODE_OF_CONDUCT.md).
