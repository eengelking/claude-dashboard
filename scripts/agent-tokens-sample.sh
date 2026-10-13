#!/usr/bin/env bash
# Samples Podium's per-agent Tokens (context.tokens) over time, to compare against Claude Code's own agent line.
set -u

usage() {
  cat <<'EOF'
Usage: scripts/agent-tokens-sample.sh [-s SECONDS] [-u URL] [-n COUNT] [-a]

Prints one line per agent per sample: time, agent id, status, step count, context tokens and the
running totals (in/out/cacheRead/cacheWrite). Read-only; it only calls GET /api/fleet/state.

  -s SECONDS  seconds between samples (default 5)
  -u URL      Podium base URL (default http://localhost:4317)
  -n COUNT    stop after COUNT samples (default: run until interrupted)
  -a          include agents that are not running (default: running only)
  -h, --help  show this help
EOF
}

interval=5
url=http://localhost:4317
count=0
all=0
while getopts "s:u:n:ah-" opt; do
  case "$opt" in
    s) interval=$OPTARG ;;
    u) url=$OPTARG ;;
    n) count=$OPTARG ;;
    a) all=1 ;;
    *) usage; exit 0 ;;
  esac
done

n=0
while :; do
  curl -s "$url/api/fleet/state" | ALL=$all node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const t = new Date().toTimeString().slice(0, 8);
      for (const x of JSON.parse(s).sessions || []) {
        for (const a of x.agents || []) {
          if (!process.env.ALL || process.env.ALL === "0") { if (a.status !== "running") continue; }
          const k = a.tokens || {};
          console.log(`${t} ${a.id} ${a.status} steps=${a.steps && a.steps.done} ctx=${a.context && a.context.tokens} used=${k.input}/${k.output}/${k.cacheRead}/${k.cacheWrite}`);
        }
      }
    });'
  n=$((n + 1))
  if [ "$count" -gt 0 ] && [ "$n" -ge "$count" ]; then break; fi
  sleep "$interval"
done
