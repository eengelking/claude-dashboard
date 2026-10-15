# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Project Overview

Podium is a live fleet console for Claude Code. It shows every session running on one machine in one
browser tab: each orchestrator's model, effort, plan, the agents it launched, what they cost, how full
their context windows are, why anything failed, and which git branch it works in. It is for someone who
runs several Claude Code sessions and agents at once and wants to see what they are doing and costing
without watching each terminal. Podium watches, and since #206 it can also answer a session that waits on its person
(a question, a plan, a tool's permission prompt, a message, `/clear` or `/compact`), only where the Admin and the
session's owner have both turned that on. It never types into a terminal or changes a session's permission rules.

It ships as a server and UI (this repo, run with `podiumctl` in a Podman container or as a plain Node
process) and a reporter mod, `podium-reporter`, installed from `eengelking-marketplace`. `docs/SPEC.md` is
the source of truth for intended behavior; `docs/ARCHITECTURE.md` records how it was built.

## Shortcuts

The operator uses shorthand in place of typing a full request out. Case-insensitive — treat any casing the same. Expand the shorthand below and act on it as if the full phrase had been typed. Add project- or user-specific entries as they come up.

| Shorthand | Expands to |
|---|---|
| `plmk` | "Please let me know if you have any questions or if I can provide any further context and/or information." |
| `wni` | "What is the next GitHub issue to resolve?" |
| `pmm` | "PR has been merged to main." |
| `cii` | "Please review outstanding docs/ISSUES.md and create GitHub issues for anything not yet tracked. Let me know when done." |
| `pnb` | "Please process the next batch of queued items." |

## Do Not

- Edit directly on `main` — for any change, no matter how small (a one-line doc fix included) or how informal (no tracking issue) — or merge a PR into `main` yourself. Both are always the user's call, no exceptions. See "Always Branch First" below.
- Commit secrets, API keys, tokens, or credentials.
- Force-push, skip commit safety checks, or bypass signing without the user's explicit, in-the-moment approval.
- Delegate any task via a fork, no matter how narrow or read-only it looks — no exception.
- Start implementing an issue just because it (or you) filed it — filing and authorization are separate steps.
- Create a new standing doc when an existing one can hold the content.
- Document architecture in this file — use `docs/ARCHITECTURE.md`.
- Record current-state facts or status narrative in this file — facts belong in `CHANGELOG.md`; narrative belongs in commit history, PR descriptions, or `docs/ISSUES.md`.
- Silently pick a reading, or "fix" it in passing, when code and `docs/SPEC.md` disagree — flag the contradiction and ask.
- Re-invoke `/code-review` a second time on the same diff "to confirm" a fix. There's no defined stopping rule for a fix→review→fix cycle, and the review skill's own finder/verifier fan-out is not guaranteed to converge on a repeat run — it can spawn a large batch of sub-agents and stall indefinitely. Verify fixes by running the project's own test/lint suite directly instead (see the Review (pre-PR) row below); if that fails, stop and ask rather than looping back into another review round.

## Always Branch First

Before the first `Edit` or `Write` of *any* change to this repo — check the current branch. If it's `main`, create or switch to a working branch before touching a single file. This holds regardless of size ("just a typo fix"), formality ("no issue for this, just drafting"), or how the request was phrased ("draft a revised README" is still a change once you start writing it to disk) — the decision to skip a tracking issue and the decision to skip a branch are unrelated, and only the first is ever legitimate. See `git-branching` for the mechanics, including the pre-commit hook that backstops this rule technically rather than relying on memory alone.

## Skills

Procedural detail — the *how* behind the rules this file states — lives in skills, loaded on demand rather than carried in every session's context. "Orchestrator" means whichever agent is coordinating a piece of work (driving a single issue end to end, or running a parallel batch); "sub-agent" means an agent it spawned to do a scoped piece of that work. For a single issue worked solo, there's only one agent, so both columns apply to it.

| Skill | Load it when... | Orchestrator | Sub-agent |
|---|---|---|---|
| `git-branching` | Creating any branch — for an issue, a sub-agent, or a batch integration branch | Creates the batch integration branch (if parallel) | Branches off `main` (solo work) or off the integration branch (parallel batch) |
| `github-pr-merge` | Opening a PR; running any merge command; proposing a release tag | Reviews and merges a sub-agent's PR into the integration branch; never merges into `main` | Opens its own PR; never merges any PR itself |
| `github-release` | Cutting an actual release once a PR has merged `main` to a releasable state | Runs the release steps | N/A — releases aren't a sub-agent's job |
| `github-issue-filing` | Filing issues — grouping related reports, checking for duplicates | Runs standalone, on explicit request | Same as orchestrator |
| `github-issue-workflow` | Starting, resuming, or closing GitHub-issue-tracked work | Decides sequencing and whether a parallel batch applies | Follows the same checklist/Validation discipline within its own issue |
| `documentation-sync` | Before committing any change | Runs the batch-wide consolidation commit (if parallel) | Keeps its own PR's changes in sync |
| `documentation-bootstrap` | Backfilling or topping up a project's missing doc set (bulk scaffolding, not a single commit's worth of sync) | Runs the doc-type selection pass, sets the sequencing rule, and runs the parallel batch (integration branch, post-bootstrap validation) | Writes its one assigned doc type per the orchestrator's sequencing rule; no merge authority |
| `development-commands` | Running tests/lint, starting the app for UI review, seeding a database | Yes | Yes |
| `git-safety` | Force-push, skipping commit checks, secrets review | Yes | Yes |
| `retrospective` | Asked for a retrospective, or "what went well/could be improved," after nontrivial or multi-agent work | Yes | Yes |

## Working Style

- **Prefer acting to asking** when the request and the codebase together make the right move obvious; ask when you're genuinely blocked — ambiguous intent, a decision only the user can make, or a destructive/hard-to-reverse action.
- **Verify with real runs, not just lint/build.** A passing type-check or test suite verifies correctness, not that the feature actually works. Where practical, run the thing and exercise the change before calling it done — and say so explicitly when you can't (no way to run the app, no browser access, etc.) rather than implying it was checked.
- **Leave no mess behind.** Stop dev servers you started, close browser tabs you opened, delete branches once their merge is confirmed. A task isn't finished just because the code is right — clean up the process/session state too. Validate the cleanup completed successfully and left no orphans behind.
- **Don't let a stale run fool you.** If you changed code, restart whatever's serving it before treating its behavior as evidence. Testing against cached/stale state produces false confidence.
- **If this project has a `docs/NON_NEGOTIABLES.md`, read it before starting any task.** Its constraints are absolute — they don't get traded away for convenience, ever.
- **Prefer a fresh session per PR or unit of work** rather than accumulating context across many PRs in one long-running session. A long session replays its whole accumulated transcript every turn; starting fresh per PR keeps that small instead of letting it compound.
- **When fixing a bug in code, first write a test that reproduces the failure and confirm it fails for the expected reason, before writing the fix.** A test only ever run against the fixed code doesn't prove it would have caught the regression. This applies to code fixes specifically — it doesn't apply to documentation or other non-code changes.
- **When waiting on a background agent or task, wait for it properly rather than repeatedly checking its status in a loop.** Polling — check, wait a bit, check again — burns tokens re-sending the whole conversation on every check, for no benefit over a real blocking wait. This is a real, recurring waste, not a hypothetical: an orchestrator managing sub-agents or background work is exactly where this loop tends to happen.
- **Before writing a one-off helper script, check whether `scripts/` already has one that does the job** (if it exists — otherwise create it). Run the candidate with `--help`/`-h` to confirm what it does rather than assuming from its name. If nothing fits, write the new script into `scripts/`, give it a `--help`/`-h` flag, and keep it there rather than deleting it once the task is done — a future agent solving the same problem should find it instead of re-writing it from scratch.

## Git & GitHub Workflow

Order of operations for any tracked change. The policy is the invariant that holds regardless of mechanics; the skill covers the how.

| Phase | Policy | Skill |
|---|---|---|
| Start | Branch first, synced from current `main`. | `git-branching` |
| Review (pre-PR) | Applies only when the branch changes code (logic, scripts, config with behavioral effect) — a docs/prose-only diff (`CLAUDE.md`, `CHANGELOG.md`, `README.md`, comments) has no code for `/code-review` to check and skips this row entirely; a mixed branch still runs it, scoped to the code files. When it applies, run `/code-review` on the branch **exactly once** before opening the PR, then apply its findings with `--fix` (or explicitly defer/note larger, out-of-scope suggestions with reasoning) — never loop back into a second automated round to "confirm" the fixes. Verification of the fixed code is the orchestrator's own job, done directly against the project's real test/lint commands (`development-commands`), not by re-invoking the skill. If that verification passes, move on to the PR; if it fails, stop and ask the user rather than re-running review. This caps the process at one review round plus one orchestrator-run verification pass — see "Do Not" for why a second round is off the table. Reserve post-PR `--comment`/`ultra` review for a genuinely separate pass (e.g. a deeper multi-agent review, or a check the user explicitly wants visible as PR comments), never as a stand-in for pre-PR confirmation. | `code-review`, `development-commands` |
| Develop → PR | Changes land via PR; the user reviews and merges. Once a change — issue-tracked or informal — is complete, has been through pre-PR review above, and passes its relevant checks, commit, push, and open the PR without waiting for a separate go-ahead; that's normal completion of the work, not a separate action to confirm. Opening a PR is still a stopping point, not a launchpad — it doesn't authorize starting the next unit of work unprompted, and merging remains the user's call, always. | `github-pr-merge` |
| Merge & cleanup | A branch is deleted only after its merge is confirmed, not assumed. | `github-pr-merge` |
| Release (if applicable) | A deliberate step after a PR merges, never an automatic side effect of merging — ask if it's unclear whether this project does releases at all. | `github-release` |
| Dangerous git actions | See Do Not — a prior approval doesn't carry forward to the next instance. | `git-safety` |
| Committing | Review staged changes for anything sensitive before committing, especially in files that don't look like they'd contain any. If a secret is committed anyway, treat it as compromised and flag it to the user for rotation rather than just removing it from the latest commit. | `git-safety` |
| Remote access | The `gh` CLI is available and authenticated — use it for PRs, issues, and other GitHub operations rather than assuming it's missing. If a `git push`/`fetch`/`clone` fails with an SSH error (e.g. `git@github.com: Permission denied (publickey)`), that means this environment's SSH key isn't set up for GitHub — switch the affected remote to HTTPS (`git remote set-url origin https://github.com/<owner>/<repo>.git`) and retry, rather than treating it as a dead end or asking the user to fix SSH first. | — |

**Versioning:** If this repo opts into `spec-writing`'s Staged-DAG weight class, add a line here mapping each stage gate to the release version it produces (e.g. G-0 → `v0.1.0`, G-1 → `v0.2.0`, …) — that mapping is the one fact specific to this repo. The mechanics (independently verifying a gate before treating it as passed, what to bump and where, tagging) are `github-release`'s and `spec-writing`'s job to know, not this file's — load them when a gate task merges rather than re-deriving the steps here. Projects using Flat or Phased spec classes, or no `spec-writing` spec at all, don't need this row.

## Releases

`github-release` owns the steps. This is what is specific to this repo.

- **Verify first:** `npm test` and `npm run build` (CI runs both). If the mod changed, also `npm run test:mod` and `npm run typecheck:mod`, which need Claude Code installed and cannot run in CI.
- **Publish:** nothing. There is no package registry and no container registry; users build the image with `podiumctl build`. Skip the skill's publish step.
- **Tag and GitHub Release:** `vMAJOR.MINOR.PATCH`, annotated, from `main` after the release PR has merged. The release notes are the CHANGELOG section verbatim. Propose the tag and wait for approval; never push one unprompted.
- **Doc-only PRs get no release.** A mod-only fix between releases bumps only the mod's version (CI's `mod-version-check` enforces that) and does not need a release of its own. Pre-1.0, a minor release may include breaking changes.

Everything below changes in the release PR itself, in the same commit, never as a follow-up after the tag:

| File | What changes |
|---|---|
| `CHANGELOG.md` | Rename `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD` and add a fresh empty `[Unreleased]` above it. Update the two links at the bottom (`[Unreleased]` compares `vX.Y.Z...HEAD`; `[X.Y.Z]` points at the release) |
| `package.json`, `server/package.json`, `frontend/package.json` | `version`, all three the same number |
| `package-lock.json` | Run `npm install --package-lock-only` so its entries follow the manifests |
| `mod/podium-reporter/.claude-plugin/plugin.json` | `version`, set to the same release number |
| `mod/podium-reporter/hooks/register.ts` | `VERSION`, equal to `plugin.json` (`scripts/versions.test.ts` fails if they differ) |

Then grep the repo for the old version string and look at every hit before assuming the table is complete. Known hits that are sample data and do not change: `docs/fixtures/report.sample.json`, the fixtures in `server/src/fleet/*.test.ts`, `mod/podium-reporter/hooks/scripted.ts`, the simulator's `0.1.0-sim`, and the manifest example in `docs/SPEC.md`.

## Issue Management

| Phase | Policy | Skill |
|---|---|---|
| Filing | Group related reports under one issue by root cause rather than one per symptom — but split back out when a report actually bundles more than one distinct Definition of Done. | `github-issue-filing` |
| Working | Work one open issue at a time by default — closing one, even by a merged PR, doesn't authorize starting the next unprompted — unless the user has deliberately scoped a parallel batch, in which case an orchestrator may run multiple issues at once via sub-agents. Each sub-agent stays scoped to its own issue's files; never let one touch a shared, single-section file (e.g. `CHANGELOG.md`'s `[Unreleased]` section, this file's own status content) — independent agents editing the same lines is a guaranteed conflict. | `github-issue-workflow` |
| Starting | When told to start an issue (e.g. "review issue N and begin work"), maintain a live task list via TaskCreate/TaskUpdate for the entire duration of the work — every step, including any sub-agents to be spawned — with no exceptions. This is always visible progress tracking, not optional bookkeeping. If TaskCreate/TaskUpdate aren't available in the session (they're off by default on some models), don't fall back to informal status updates — ask the user for permission to add `CLAUDE_CODE_ENABLE_TODO_TOOLS: "1"` to `~/.claude/settings.json`'s `env` block, make the edit once approved, and confirm the tools are now available before proceeding. | `github-issue-workflow` |

## Delegation & Sub-agents

- **Scope a sub-agent's authority to what you actually asked it to do.** A sub-agent asked to research or review should not commit, push, or open/merge a PR on its own initiative — those actions belong to the coordinating session unless explicitly delegated.
- **A forked agent inherits its parent's entire conversation** — full context and full authority, including merge permissions — whether or not the task you gave it needs any of that (see Do Not). This has already caused real incidents (an unauthorized merge, corrupted files from forks racing on the same working directory). "It's just read-only," "it's just reviewing one PR," "the prompt only asked for one thing" — none of these make a fork safe; a fork's authority isn't bounded by what its prompt asked for. Use a fresh, non-fork sub-agent for every delegated step instead — reviewing a PR, running a validation pass, even read-only research. When you spawn it, state its authority explicitly in the prompt ("report a verdict; you do not have merge authority for this"), not just its scope — scope alone doesn't bound what an agent can decide to do.

## Commands

How to build, test, lint, and run this project is procedural — it belongs in a skill, not here. _See skill: `development-commands`._
