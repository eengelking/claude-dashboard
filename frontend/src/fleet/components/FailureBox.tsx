import { fmtClock } from "../format";
import type { Failure } from "../types";
import { IconX } from "./Icons";

const BAD_LINE = /^(Error|FAIL|fatal|\d{3} |PreToolUse)/;

/** The failing call, its output (text only, never HTML), the evidence, and what happened next. */
export function FailureBox({ f }: { f: Failure }) {
  const out = f.outputTail;
  return (
    <div className="failbox">
      <div className="fh2">
        <IconX />
        {f.class}
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontWeight: 400, color: "var(--ink2)" }}>
          {fmtClock(f.at)}
        </span>
      </div>
      <div className="fb">
        <div>
          <span className="lab">
            Failing call{f.tool ? ` · ${f.tool}` : ""}
            {f.exitCode !== null ? ` · exit ${f.exitCode}` : ""}
          </span>
          <pre className="code">{f.call ?? "not recorded"}</pre>
        </div>
        {out.length > 0 && (
          <div>
            <span className="lab">Output</span>
            <pre className="code">
              {out.map((l, i) => (
                <span key={i} className={i === out.length - 1 || BAD_LINE.test(l) ? "bad" : undefined}>
                  {l}
                  {i < out.length - 1 ? "\n" : ""}
                </span>
              ))}
            </pre>
          </div>
        )}
        {f.evidence.length > 0 && (
          <div>
            <span className="lab">Evidence</span>
            <ul className="evid">
              {f.evidence.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {f.explanation && (
          <div className="cause">
            <span className="lab">Likely root cause</span>
            {f.explanation}
          </div>
        )}
        <div style={{ color: "var(--muted)", fontSize: 12 }}>
          {f.retriedAs ? "The step went back to the plan. A new agent takes it up." : "No retry is queued. The orchestrator carried on without this result."}
        </div>
      </div>
    </div>
  );
}
