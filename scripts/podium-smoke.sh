#!/usr/bin/env bash
# End-to-end smoke check for Podium: server + simulator + SSE (directly and through the Vite proxy).
set -uo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/podium-smoke.sh [--no-vite] [--keep] [-h|--help]

Starts the Podium server on a free port with a temporary database, runs the
simulator against it for 20 seconds, and asserts that:
  - GET /api/fleet/state lists live sessions while the simulator runs
  - GET /api/fleet/stream yields `snapshot`, then `session` and `tick` events
  - the stream also works through the Vite dev proxy without buffering
    (ticks arrive spread over time, not all at once), unless --no-vite
  - after the simulator ends its sessions, they leave the live set within the
    linger time and the stream says `removed`
Then it stops everything it started, deletes its temporary files, and checks
that no process it started is left running.

  --no-vite   Skip the Vite proxy check
  --keep      Keep the temporary directory (logs, database) for inspection
  -h, --help  Show this help

Exit code 0 when every check passes, 1 when one fails, 2 on a setup error.
USAGE
}

VITE=1
KEEP=0
for a in "$@"; do
  case "$a" in
    -h|--help) usage; exit 0 ;;
    --no-vite) VITE=0 ;;
    --keep) KEEP=1 ;;
    *) echo "unknown option: $a (see --help)" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TSX="$ROOT/node_modules/.bin/tsx"
VITE_BIN="$ROOT/node_modules/.bin/vite"
[[ -x "$TSX" ]] || { echo "tsx not found; run npm install" >&2; exit 2; }
TMP="$(mktemp -d "${TMPDIR:-/tmp}/podium-smoke.XXXXXX")"
PIDS=()
FAILED=0
LINGER_MS=3000

free_port() { node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"; }
pass() { echo "  ok    $*"; }
fail() { echo "  FAIL  $*"; FAILED=1; }

cleanup() {
  for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && kill "$p" 2>/dev/null; done
  sleep 0.5
  for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && kill -9 "$p" 2>/dev/null; done
  local left=0
  for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && kill -0 "$p" 2>/dev/null && left=1; done
  if pgrep -f "$TMP" >/dev/null 2>&1; then left=1; fi
  if [[ $left == 1 ]]; then echo "  FAIL  processes left running"; FAILED=1; else echo "  ok    no process left running"; fi
  if [[ $KEEP == 1 ]]; then echo "kept $TMP"; else rm -rf "$TMP"; fi
}
trap 'cleanup; exit $([[ $FAILED == 0 ]] && echo 0 || echo 1)' EXIT
trap 'exit 1' INT TERM

PORT="$(free_port)"
echo "podium-smoke: server on 127.0.0.1:$PORT, temp $TMP"

PODIUM_DB="$TMP/podium.sqlite" PORT="$PORT" LINGER_MS="$LINGER_MS" "$TSX" "$ROOT/server/src/index.ts" >"$TMP/server.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/api/fleet/health" >/dev/null && break; sleep 0.25; done
curl -sf "http://127.0.0.1:$PORT/api/fleet/health" >/dev/null || { echo "server did not start:"; cat "$TMP/server.log"; exit 2; }

# Long enough to outlast the simulator's duration plus the linger time even when starting Vite is slow; cleanup kills it.
curl -sN --max-time 90 "http://127.0.0.1:$PORT/api/fleet/stream" >"$TMP/stream.txt" 2>/dev/null &
PIDS+=($!)

if [[ $VITE == 1 ]]; then
  VPORT="$(free_port)"
  # --host 127.0.0.1: by default Vite binds only ::1 on some machines, and this script curls 127.0.0.1.
  (cd "$ROOT/frontend" && PORT="$PORT" exec "$VITE_BIN" --host 127.0.0.1 --port "$VPORT" --strictPort --clearScreen false) >"$TMP/vite.log" 2>&1 &
  PIDS+=($!)
  for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$VPORT/api/fleet/health" >/dev/null && break; sleep 0.25; done
  # Stamp each line as it arrives: a buffering proxy would deliver everything at the end.
  (curl -sN --max-time 12 "http://127.0.0.1:$VPORT/api/fleet/stream" 2>/dev/null | while IFS= read -r line; do echo "$(node -e 'console.log(Date.now())') $line"; done) >"$TMP/vite-stream.txt" &
  PIDS+=($!)
fi

"$TSX" "$ROOT/scripts/podium-sim.ts" --url "http://127.0.0.1:$PORT" --sessions 4 --seed 7 --duration 20 >"$TMP/sim.log" 2>&1 &
SIM=$!
PIDS+=($SIM)

sleep 8
LIVE="$(curl -s "http://127.0.0.1:$PORT/api/fleet/state" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const a=j.sessions.reduce((n,x)=>n+x.agents.length,0);console.log(j.sessions.length+" "+a+" "+(j.sessions[0]?.series?.tokensPerSec?.length??0))})')"
read -r NSESS NAGENTS NPTS <<<"$LIVE"
echo "checks:"
[[ "${NSESS:-0}" -ge 1 ]] && pass "/state lists $NSESS live sessions with $NAGENTS agents" || fail "/state lists no sessions"
[[ "${NPTS:-0}" == 60 ]] && pass "series have 60 points" || fail "series length is ${NPTS:-?}"

wait "$SIM"
SIM_EXIT=$?
[[ $SIM_EXIT == 0 ]] && pass "simulator exited 0 after --duration" || fail "simulator exited $SIM_EXIT"
grep -q "ended" "$TMP/sim.log" && pass "simulator ended its sessions" || fail "simulator did not report ending its sessions"

sleep $(( LINGER_MS / 1000 + 3 ))
LEFT="$(curl -s "http://127.0.0.1:$PORT/api/fleet/state" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).sessions.length))')"
[[ "$LEFT" == 0 ]] && pass "done sessions left the live set after the linger time" || fail "$LEFT sessions still live after the linger time"

sleep 1
grep -q '^event: snapshot' "$TMP/stream.txt" && pass "stream sent snapshot" || fail "stream sent no snapshot"
grep -q '^event: session' "$TMP/stream.txt" && pass "stream sent session events" || fail "stream sent no session events"
grep -q '^event: activity' "$TMP/stream.txt" && pass "stream sent activity events" || fail "stream sent no activity events"
grep -q '^event: tick' "$TMP/stream.txt" && pass "stream sent tick events" || fail "stream sent no tick events"
grep -q '^event: removed' "$TMP/stream.txt" && pass "stream sent removed events" || fail "stream sent no removed events"
FIRST="$(grep -m1 -n '^event:' "$TMP/stream.txt" | cut -d: -f3 | tr -d ' ')"
[[ "$FIRST" == "snapshot" ]] && pass "first stream event is snapshot" || fail "first stream event is ${FIRST:-none}"

if [[ $VITE == 1 ]]; then
  if grep -q 'event: snapshot' "$TMP/vite-stream.txt"; then
    SPREAD="$(grep 'event: tick' "$TMP/vite-stream.txt" | awk '{print $1}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=s.trim().split("\n").filter(Boolean).map(Number);console.log(t.length>1?Math.round((t[t.length-1]-t[0])/1000):0, t.length)})')"
    read -r SECS NTICK <<<"$SPREAD"
    [[ "${NTICK:-0}" -ge 3 && "${SECS:-0}" -ge 4 ]] && pass "Vite proxy streams without buffering ($NTICK ticks over ${SECS}s)" || fail "Vite proxy stream looks buffered ($NTICK ticks over ${SECS}s)"
  else
    fail "no snapshot through the Vite proxy"
  fi
fi

[[ $FAILED == 0 ]] && echo "podium-smoke: all checks passed" || echo "podium-smoke: some checks FAILED (rerun with --keep to inspect logs)"
