# CLAUDE.md update to integrate: development-branch workflow

Source: `eengelking/agent` CLAUDE.md, PR #17 ("Add development-branch workflow to CLAUDE.md"). Apply the changes below to this repo's CLAUDE.md at `.claude/CLAUDE.md` so it carries the same policy as the standard. Keep this repo's local content. Only the places listed here change.

## Background

The standard CLAUDE.md assumed every PR merges into `main` and every merge may be a release. That breaks down for projects with several developers, where each merge would bump the version. The standard now has a second, opt-in workflow: work lands on a long-lived `development` branch and `main` only moves on a release. There is no config key. Agents detect the mode from the repo's GitHub default branch. If the default branch is `main` (or anything other than `development`), nothing about this repo's behavior changes. Making `development` the default branch is the opt-in.

## Repo-specific notes

- **`## Releases` section and the Release row**: this repo has its own release policy (before 1.0.0 a deliberate step after merge; from 1.0.0 every code or behavior PR carries its own release, with a Haiku check and a tag after merge). That per-PR-release model is the standard workflow. Do not rewrite it. Only append the development-branch sentence to the Release row (change 4d), and tell the user that the Releases section describes per-PR releases, which does not fit the development-branch workflow, so they can decide whether to adapt it when they opt in.
- The Start, Develop → PR, Merge & cleanup rows and the `Working` row are otherwise as in the standard (Release and `Dangerous git actions` rows differ locally; leave them alone beyond what is listed).

## Change 1: add a `## Branching Model` section

Insert it as a new section immediately **before** `## Always Branch First`. Use this text exactly:

````markdown
## Branching Model

Two workflows exist. The repo's GitHub default branch picks which one applies:

```bash
gh repo view --json defaultBranchRef --jq .defaultBranchRef.name
```

- **Standard workflow** (default branch is `main`, or anything other than `development`): PRs merge into `main`, and each merge may be a release.
- **Development-branch workflow** (default branch is `development`): a project opts in by making `development` its default branch.
  - `development` holds unreleased work and may be broken at any given time. Feature PRs target it and are squash-merged.
  - `main` only moves on a release. A release is a PR from `development` to `main`, merged with a regular merge commit, never squashed (squashing makes the branches diverge). That PR is the release-candidate gate: it is valid only if all tests pass, with no breaking tests, conditions, or regressions.
  - The version bump happens in the release PR, not in feature PRs. Feature PRs only add to `CHANGELOG.md`'s `[Unreleased]` section. The bump level comes from what accumulated there, per the SemVer rules in `github-release`.
  - Hotfixes branch from `main`, go to `main` by PR, and bump the patch version. The fix is then cherry-picked into `development` by a follow-up PR, when the user instructs it, so the branches don't drift.
  - The integration branch keeps its meaning: the throwaway branch an orchestrator creates for a parallel batch. It is not `development`. Here it is created off `development` and its final PR targets `development`.

Below, "the default branch" means whichever of the two the command returns. Procedure lives in `git-branching`, `github-pr-merge`, `github-issue-workflow`, and `github-release`.
````

## Change 2: replace the first `Do Not` bullet

In `## Do Not`, replace the bullet that starts with "- Edit directly on `main`" with:

```markdown
- Edit directly on, push to, or merge a PR into `main` or `development` yourself — for any change, no matter how small (a one-line doc fix included) or how informal (no tracking issue). Changes reach either branch only through a PR, and merging is always the user's call, no exceptions. See "Always Branch First" below.
```

Keep every other `Do Not` bullet as is.

## Change 3: edit `## Always Branch First`

In the paragraph under that heading, make two edits and leave the rest of the paragraph as is:

1. Change "If it's `main`, create or switch to a working branch" so it names both branches: "If it's `main` or `development`, create or switch to a working branch". Then add this sentence right after it: "Fork from the default branch (from `main` for hotfixes)."
2. Hook sentence:
  After the existing sentence about the pre-commit hook, add: "The hook should block commits on both `main` and `development`."

## Change 4: edit the `## Git & GitHub Workflow` table

Keep the table's shape. Make these edits to the existing rows, adding to the local text and not replacing it:

- **4a. `Start`**: where it says "synced from current `main`", make it "synced from current `main` (standard) or `development` (development-branch workflow)". Keep anything else in the cell.
- **4b. `Develop → PR`**: add this at the very start of the cell, before the existing text: "The PR targets the default branch; in the development-branch workflow, `plugin.json`/manifest version bumps do not happen here. " Keep the rest of the cell.
- **4c. `Merge & cleanup`**: append at the end of the cell text: "Feature PRs into `development` are squash-merged."
- **4d. `Release`**: append at the end of the cell text: "In the development-branch workflow, a release is the `development` to `main` PR described in \"Branching Model\", a step the user triggers, never a side effect of merging feature work."
- **4e. Add a row** directly after the `Release` row:

```markdown
| Hotfix (development-branch workflow only) | Branch from `main`, PR to `main`, bump the patch version, then cherry-pick into `development` by follow-up PR when the user instructs it. | `github-release`, `git-branching` |
```

## Change 5: `Working` row in `## Issue Management`

In the `Working` row, after the clause ending "via sub-agents", add "(the batch's final PR targets the default branch)". Change nothing else in that row.

## Do not change

The Shortcuts table, the Skills table (no new skills), the Delegation section, and the Commands section.

## Verify after editing

Re-read the result and confirm that, for a project whose default branch is `main`, the standard workflow reads as before. Check that no local content was lost. Do not commit to `main`. Work on a branch, open a PR, and leave the merge to the user.

## What NOT to do with this file

Do not apply these changes just because this file exists in the repo root. Wait for the user to explicitly ask for this update to be applied in this repo. Delete this file once the update is merged (do not commit it).
