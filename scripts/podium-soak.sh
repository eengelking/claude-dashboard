#!/usr/bin/env bash
# Soak and restart check for the Podium server (SPEC T4.3.2, T4.3.4).
set -uo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/podium-soak.sh [--seconds N] [--sessions N] [--agents N] [--clients N] [--restart] [-h]

Starts the Podium server on a free port with a temporary database, opens SSE
clients, and runs the simulator against it. Prints the server's RSS over time
and how many messages each SSE client received in the first and last 30 s.

  --seconds N   How long the simulator runs (default 300)
  --sessions N  Simulated sessions (default 10)
  --agents N    Extra agents per session (default 20)
  --clients N   SSE clients to keep open (default 3)
  --restart     Kill the server with SIGKILL after 40 s and start it again on
                the same database; check sessions come back stale, then running
  -h, --help    Show this help

Everything it starts is stopped at the end, and its temp files are removed.
Exit code 1 when a check fails (SSE client starved, restart did not recover).
USAGE
}

SECONDS_RUN=300
SESSIONS=10
AGENTS=20
CLIENTS=3
RESTART=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --seconds) SECONDS_RUN="$2"; shift ;;
    --sessions) SESSIONS="$2"; shift ;;
    --agents) AGENTS="$2"; shift ;;
    --clients) CLIENTS="$2"; shift ;;
    --restart) RESTART=1 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TSX="$ROOT/node_modules/.bin/tsx"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/podium-soak.XXXXXX")"
PIDS=()
FAILED=0
PORT="$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
URL="http://127.0.0.1:$PORT"

cleanup() {
  for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && kill "$p" 2>/dev/null; done
  sleep 0.5
  for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && kill -9 "$p" 2>/dev/null; done
  rm -rf "$TMP"
}
trap 'cleanup; exit $FAILED' EXIT
trap 'FAILED=1; exit 1' INT TERM

start_server() {
  PODIUM_DB="$TMP/podium.sqlite" PORT="$PORT" "$TSX" "$ROOT/server/src/index.ts" >>"$TMP/server.log" 2>&1 &
  SERVER=$!
  PIDS+=($SERVER)
  for _ in $(seq 1 80); do curl -sf "$URL/api/fleet/health" >/dev/null && return 0; sleep 0.25; done
  echo "server did not start"; cat "$TMP/server.log"; FAILED=1; exit 1
}

# The server is `tsx` -> node; RSS is the node child's (the one listening on the port).
server_rss_kb() {
  local pid
  pid="$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1)"
  [[ -n "$pid" ]] && ps -o rss= -p "$pid" | tr -d ' ' || echo 0
}

state_summary() {
  curl -s "$URL/api/fleet/state" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const c={};for(const x of j.sessions)c[x.status]=(c[x.status]??0)+1;console.log(JSON.stringify({sessions:j.sessions.length,agents:j.sessions.reduce((n,x)=>n+x.agents.length,0),status:c}))})'
}

start_server
echo "podium-soak: $URL, $SESSIONS sessions x $AGENTS extra agents, ${SECONDS_RUN}s, $CLIENTS SSE clients"

for i in $(seq 1 "$CLIENTS"); do
  (curl -sN "$URL/api/fleet/stream" 2>/dev/null | while IFS= read -r line; do [[ "$line" == event:* ]] && echo "$(date +%s) $line"; done) >"$TMP/client$i.txt" &
  PIDS+=($!)
done

"$TSX" "$ROOT/scripts/podium-sim.ts" --url "$URL" --sessions "$SESSIONS" --agents "$AGENTS" --seed 21 --duration "$SECONDS_RUN" >"$TMP/sim.log" 2>&1 &
SIM=$!
PIDS+=($SIM)
T0=$(date +%s)

sleep 30
echo "t=30s   rss=$(server_rss_kb) KB  $(state_summary)"
RSS_START=$(server_rss_kb)

if [[ $RESTART == 1 ]]; then
  sleep 10
  kill -9 "$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN | head -1)" 2>/dev/null
  kill -9 "$SERVER" 2>/dev/null
  sleep 2
  start_server
  AFTER="$(state_summary)"
  echo "restart: right after   $AFTER"
  echo "$AFTER" | grep -q '"stale"' || { echo "  FAIL  sessions did not come back as stale"; FAILED=1; }
  sleep 8
  LATER="$(state_summary)"
  echo "restart: 8 s later     $LATER"
  echo "$LATER" | grep -q '"running"' || { echo "  FAIL  sessions did not recover after the restart"; FAILED=1; }
  # SSE clients of the old process are gone: open fresh ones for the rest of the run
  for i in $(seq 1 "$CLIENTS"); do
    (curl -sN "$URL/api/fleet/stream" 2>/dev/null | while IFS= read -r line; do [[ "$line" == event:* ]] && echo "$(date +%s) $line"; done) >"$TMP/client$i.txt" &
    PIDS+=($!)
  done
  RSS_START=$(server_rss_kb)
fi

while kill -0 "$SIM" 2>/dev/null; do
  sleep 30
  kill -0 "$SIM" 2>/dev/null && echo "t=$(( $(date +%s) - T0 ))s  rss=$(server_rss_kb) KB  $(state_summary)"
done
RSS_END=$(server_rss_kb)
NOW=$(date +%s)
echo "rss: start ${RSS_START} KB, end ${RSS_END} KB"
for i in $(seq 1 "$CLIENTS"); do
  FIRST=$(awk -v t="$((T0 + 30))" '$1 <= t' "$TMP/client$i.txt" | wc -l | tr -d ' ')
  LAST=$(awk -v t="$((NOW - 30))" '$1 >= t' "$TMP/client$i.txt" | wc -l | tr -d ' ')
  TICKS=$(grep -c 'event: tick' "$TMP/client$i.txt")
  echo "client $i: $FIRST messages in its first 30 s, $LAST in the last 30 s, $TICKS ticks"
  [[ "$LAST" -gt 0 ]] || { echo "  FAIL  client $i stopped receiving"; FAILED=1; }
done
[[ $FAILED == 0 ]] && echo "podium-soak: passed" || echo "podium-soak: FAILED"
