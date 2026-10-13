#!/usr/bin/env bash
# Compares Podium's stored Tokens for every agent with the context its own transcript says it ended with.
set -u

usage() {
  cat <<'EOF'
Usage: scripts/agent-context-audit.sh [-u URL] [-m MIN_GAP]

For each agent Podium reports, finds its transcript (~/.claude/projects/*/*/subagents/agent-<id>.jsonl),
takes the last request's input + cache read + cache write plus every output token the agent has
written (what Claude Code's agent line shows, and what Podium's Tokens should be: issue #108).
Prints Podium's figure, the transcript's, and the gap as a percentage. Read-only.

  -u URL      Podium base URL (default http://localhost:4317)
  -m MIN_GAP  only print agents whose gap exceeds MIN_GAP percent (default 0: print all)
  -h, --help  show this help
EOF
}

url=http://localhost:4317
min=0
while getopts "u:m:h-" opt; do
  case "$opt" in
    u) url=$OPTARG ;;
    m) min=$OPTARG ;;
    *) usage; exit 0 ;;
  esac
done

curl -s "$url/api/fleet/state" | MIN="$min" node -e '
  const fs = require("fs"), path = require("path"), os = require("os");
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const root = path.join(os.homedir(), ".claude", "projects");
    const find = (id) => {
      for (const p of fs.readdirSync(root)) {
        const dir = path.join(root, p);
        let subs; try { subs = fs.readdirSync(dir); } catch { continue; }
        for (const sess of subs) {
          const f = path.join(dir, sess, "subagents", `agent-${id}.jsonl`);
          if (fs.existsSync(f)) return f;
        }
      }
      return null;
    };
    console.log("agent             status   podium  transcript  gap%  description");
    for (const x of JSON.parse(s).sessions || []) {
      for (const a of x.agents || []) {
        const f = find(a.id);
        if (!f) continue;
        const byId = new Map();
        for (const l of fs.readFileSync(f, "utf8").split("\n")) {
          if (!l) continue;
          let j; try { j = JSON.parse(l); } catch { continue; }
          const u = j.message && j.message.usage;
          if (u) byId.set(j.message.id || String(byId.size), u);
        }
        const all = [...byId.values()];
        if (!all.length) continue;
        const last = all[all.length - 1];
        const req = (last.input_tokens || 0) + (last.cache_read_input_tokens || 0) + (last.cache_creation_input_tokens || 0);
        const withOut = req + all.reduce((n, u) => n + (u.output_tokens || 0), 0);
        const podium = ((a.context && a.context.tokens) || 0) + ((a.tokens && a.tokens.output) || 0);
        const gap = withOut ? ((withOut - podium) / withOut) * 100 : 0;
        if (Math.abs(gap) < Number(process.env.MIN)) continue;
        console.log(`${a.id.slice(0, 16).padEnd(17)} ${String(a.status).padEnd(8)} ${String(podium).padStart(7)} ${String(withOut).padStart(11)} ${gap.toFixed(1).padStart(5)}  ${(a.description || "").slice(0, 40)}`);
      }
    }
  });'
