#!/usr/bin/env bash
# Sample the Apple GPU's "Device Utilization %" (macOS, no sudo) once a second and print per-window averages.
# Reads the whole GPU, not one browser tab, so close other windows and tabs that are using it first.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/gpu-sample.sh [--seconds N] [--window S] [--skip S] [--csv FILE]

  --seconds N   Total sampling time in seconds (default 60)
  --window S    Report one average per S-second window (default: one window for the whole run)
  --skip S      Ignore the first S seconds of each window, so a change can settle (default 0)
  --csv FILE    Also write "elapsed,percent" rows to FILE
  -h, --help    Show this help

Prints one line per window: index, average %, min %, max %, samples. Used for the #81 GPU-load work.
EOF
}

seconds=60 window=0 skip=0 csv=""
while [ $# -gt 0 ]; do
  case "$1" in
    --seconds) seconds="$2"; shift 2 ;;
    --window) window="$2"; shift 2 ;;
    --skip) skip="$2"; shift 2 ;;
    --csv) csv="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[ "$window" -gt 0 ] || window="$seconds"

start=$(date +%s)
rows=""
for _ in $(seq 1 "$seconds"); do
  pct=$(ioreg -r -d 1 -w0 -c IOAccelerator | grep -o '"Device Utilization %"=[0-9]*' | head -1 | cut -d= -f2)
  elapsed=$(( $(date +%s) - start ))
  rows+="${elapsed},${pct:-0}"$'\n'
  sleep 1
done
[ -z "$csv" ] || printf '%s' "$rows" > "$csv"
printf '%s' "$rows" | awk -F, -v w="$window" -v k="$skip" '
  { i = int($1 / w); t = $1 - i * w; if (t < k) next
    s[i] += $2; c[i]++; if (!(i in lo) || $2 < lo[i]) lo[i] = $2; if ($2 > hi[i]) hi[i] = $2; if (i > last) last = i }
  END { for (i = 0; i <= last; i++) if (c[i]) printf "window %d: avg %.1f%%  min %d%%  max %d%%  (%d samples)\n", i, s[i] / c[i], lo[i], hi[i], c[i] }'
