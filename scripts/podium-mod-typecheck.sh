#!/usr/bin/env bash
# Type-checks the Podium reporter mod against Claude Code's plugin API declarations.
#
# The engine lays its declarations into <mod>/.claude-plugin/types/ only when an interactive session
# watches the mod folder. This script does the same by hand: it copies a claude-code.d.ts into that
# (git-ignored) folder and runs tsc with mod/podium-reporter/tsconfig.json.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/podium-mod-typecheck.sh [path/to/claude-code.d.ts]

Without an argument it looks for the newest plugin-authoring types under
$TMPDIR / /private/tmp (written when the plugin-authoring skill loads), or uses
types the engine already laid in mod/podium-reporter/.claude-plugin/types/.

  -h, --help   Show this help
USAGE
}

case "${1:-}" in -h|--help) usage; exit 0 ;; esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOD="$ROOT/mod/podium-reporter"
DEST="$MOD/.claude-plugin/types/claude-code"
SRC="${1:-}"

if [[ -z "$SRC" ]]; then
  SRC="$(ls -t /private/tmp/claude-*/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts "${TMPDIR:-/tmp}"/claude-*/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts 2>/dev/null | head -1 || true)"
fi
if [[ -n "$SRC" ]]; then
  mkdir -p "$DEST"
  cp "$SRC" "$DEST/index.d.ts"
  echo "types: $SRC"
elif [[ ! -f "$DEST/index.d.ts" ]]; then
  echo "No claude-code.d.ts found. Load the plugin-authoring skill in a Claude Code session, or pass a path." >&2
  exit 2
fi
"$ROOT/node_modules/.bin/tsc" -p "$MOD/tsconfig.json"
echo "mod type-check passed"
