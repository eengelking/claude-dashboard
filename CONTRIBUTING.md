# Contributing

Thanks for considering a contribution to Podium. This doc covers what belongs here, how to set up, how to
propose a change, and how it gets merged.

## What belongs in this repo

Podium shows every Claude Code session on one machine in one browser tab. This repo holds the whole thing:
the reporter mod (`mod/podium-reporter/`), the server (`server/`), the UI (`frontend/`), `podiumctl` and the
container image.

A change fits if it makes Podium better at watching sessions. Some things are out on purpose, and
`docs/SPEC.md` ("Non-goals") lists them:

- **Answers only when asked.** Podium never types into a terminal, stops or starts an agent, or changes a
  session's permission rules. It can answer a session that waits on its person, but only where the Admin and
  the session's owner both turn that on.
- **One server you run.** No hosted service, accounts or cloud sync. Several people can report to it, each
  with their own token.
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

CI runs `npm test` and `npm run build` on every PR into `development` or `main`. It cannot run the two mod checks, because a stock runner
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

Do not bump the version in a feature or fix PR, including one that changes the mod (anything under
`mod/podium-reporter/` other than its tests). Add a line under `[Unreleased]` in `CHANGELOG.md` and leave the
version files alone. The maintainer decides when `development` is ready to release. A release-prep PR into
`development` then sets one number in `plugin.json`, `VERSION` in `mod/podium-reporter/hooks/register.ts`, the three
`package.json` files and the lockfile (`npm install --package-lock-only`), and renames `[Unreleased]`; a test checks
that they all match. Installed copies of the mod only update when that number changes. A `development` to `main`
PR carries the release, and CI (the "Mod version bump check" workflow in `.github/workflows/mod-version-check.yml`)
fails it if the mod changed and the number did not. The maintainer tags the release after it merges. `CLAUDE.md`,
"Releases", has the full list of files and how the bump level is chosen.

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

`development` holds unreleased work and is where every PR goes. `main` is the GitHub default branch (so a clone and the mod's marketplace listing get released code) and moves only on a release. Every change
lands on a branch, never directly on `development` or `main`, however small. Branch off a current `development`:

```sh
git checkout development && git pull
git checkout -b <your-branch-name>
```

When the change is ready, open a PR against `development` (`gh pr create --base development`). Say in the PR body that it is to be squash-merged.
This repo keeps one commit per PR on `development`, however many commits your branch has. The PR template has a
checklist. A release is a PR from `development` to `main`, merged with a regular merge commit and never squashed.
A hotfix branches from `main`, goes to `main` by PR, and is cherry-picked back into `development` afterwards.

Install the pre-commit hook that refuses a commit on either branch: `git config core.hooksPath scripts/hooks`.

Only the maintainer merges PRs into `development` or `main`, however small the change looks. Open the PR and wait for
review.

## Filing issues

Bug reports and proposals both go through GitHub issues, and the templates ask for what is useful. Check
for an existing issue first. If you are reporting several problems with one cause, one issue is more
useful than one per symptom.

For a bug report, paste the output of `/podium` along with `podiumctl status`. Run `/podium` inside the
Claude Code session that shows the problem (it is a Claude Code command, not a shell one like `podiumctl`).
It shows the connection state, the `Versions:` line and the report counts, so we can tell whether the mod is
connected, refused (HTTP 401) or out of step with the server. It does not print your token, but check what you
paste and remove any token or other secret before posting.

**Security problems are different.** Please do not open a public issue for a suspected vulnerability.
Follow [SECURITY.md](.github/SECURITY.md) and report it privately.

By taking part you agree to follow the [Code of Conduct](.github/CODE_OF_CONDUCT.md).
