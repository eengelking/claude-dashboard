## What this changes and why

<!-- One or two sentences. Link the tracking issue if there is one. -->

## Checklist

- [ ] Targets `main` (or the batch's integration branch, for a parallel-batch sub-agent PR).
- [ ] If this PR changes the mod (`mod/podium-reporter/`, other than its tests), the `version` in
      `mod/podium-reporter/.claude-plugin/plugin.json` and `VERSION` in `hooks/register.ts` were bumped
      together. Installed copies only update when the version changes, and CI (the "Mod version bump check" workflow)
      enforces it for PRs into `main`.
- [ ] If the report format changed, `server/src/fleet/protocol.ts` and `mod/podium-reporter/hooks/protocol.ts`
      match (`npm test` compares them).
- [ ] If this changes intended behavior, `docs/SPEC.md` was updated (or the mismatch is called out here
      and the maintainer has agreed to it). Other docs describing the change are updated in the same PR.
- [ ] `npm test` and `npm run build` pass. If the mod changed, `npm run test:mod` and `npm run typecheck:mod`
      pass too (they need Claude Code installed).
- [ ] `CHANGELOG.md` has a line under `[Unreleased]` for anything a user would notice.
- [ ] If this PR targets `main`, the body says it is to be squash-merged, and it closes its tracking issue
      (`Closes #N`) if one exists.

## Test plan

<!-- How you verified this, or why verification doesn't apply. For UI changes, say what you looked at. -->
