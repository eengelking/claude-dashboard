import { fmtClock, fmtTok } from "../format";
import type { AgentView, BlowoutLogEntry } from "../types";
import { IconWarn } from "./Icons";

export function BlowoutBox({ a, log }: { a: AgentView; log: readonly BlowoutLogEntry[] }) {
  if (!a.blowouts) return null;
  const mine = log.filter((b) => b.agentId === a.id);
  const l2 = a.blowouts >= 2;
  const window = a.context.window;
  return (
    <div className={`callout${l2 ? " l2" : ""}`} style={{ margin: "12px 0 0" }} role="note">
      <IconWarn />
      <div>
        <b>
          Context exceeded {a.blowouts} time{a.blowouts > 1 ? "s" : ""}.
        </b>{" "}
        {l2
          ? "Each overflow compacts earlier work away, so this agent has likely forgotten files it read and may be inventing details."
          : "Earlier work was compacted. A second overflow flags this agent as unreliable."}
        <ul className="tl" style={{ marginTop: 8 }}>
          {mine.map((b, i) => (
            <li key={`${b.t}-${i}`}>
              <time className="mono">{fmtClock(b.t)}</time>
              <span>
                Overflow #{i + 1}
                {b.tokensBefore !== null ? ` at ${fmtTok(b.tokensBefore)} tokens` : ""}
                {b.tokensAfter !== null
                  ? window
                    ? `, compacted to about ${Math.round((b.tokensAfter / window) * 100)}%`
                    : `, compacted to ${fmtTok(b.tokensAfter)} tokens`
                  : ", compacted"}
                {b.kind === "window-exceeded" ? " (the request exceeded the window)" : ""}
              </span>
            </li>
          ))}
          {mine.length < a.blowouts && (
            <li>
              <time className="mono">earlier</time>
              <span>
                {a.blowouts - mine.length} overflow{a.blowouts - mine.length > 1 ? "s" : ""} reported before Podium saw the details
              </span>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
