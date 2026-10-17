## What this changes and why

<!-- One or two sentences. Link the tracking issue if there is one. -->

## Checklist

- [ ] Targets `development` (or the batch's integration branch, for a parallel-batch sub-agent PR). Only a release or hotfix targets `main`.
- [ ] No version was bumped, unless this is a release-prep or hotfix PR. A release bumps `version` in
      `mod/podium-reporter/.claude-plugin/plugin.json` and `VERSION` in `hooks/register.ts` together with
      the rest of the files `CLAUDE.md` lists; CI (the "Mod version bump check" workflow) enforces it for PRs into `main`.
- [ ] If the report format changed, `server/src/fleet/protocol.ts` and `mod/podium-reporter/hooks/protocol.ts`
      match (`npm test` compares them).
- [ ] If this changes intended behavior, `docs/SPEC.md` was updated (or the mismatch is called out here
      and the maintainer has agreed to it). Other docs describing the change are updated in the same PR.
- [ ] `npm test` and `npm run build` pass. If the mod changed, `npm run test:mod` and `npm run typecheck:mod`
      pass too (they need Claude Code installed).
- [ ] `CHANGELOG.md` has a line under `[Unreleased]` for anything a user would notice.
- [ ] If this PR targets `development`, the body says it is to be squash-merged and carries `Closes #N` for the issue
      it resolves (the issue is closed by hand after the merge, since `development` is not the default branch).
      A `development` to `main` release PR says instead that it is not to be squashed, and carries no `Closes #N`.

## Test plan

<!-- How you verified this, or why verification doesn't apply. For UI changes, say what you looked at. -->
