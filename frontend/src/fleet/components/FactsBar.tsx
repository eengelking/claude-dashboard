import { useEffect, useRef, useState } from "react";
import { fmtDur, fmtTok } from "../format";
import { AGENT_TIME_HINT, AGENTS_HINT, COST_HINT_SESSION, sessionAgentSec, sessionCounts, sessionElapsedSec, sessionTokens, TOKENS_HINT } from "../logic";
import type { SessionView } from "../types";
import { Cost } from "./Chips";
import { IconX } from "./Icons";

export const COPIED_MS = 1600;

/** Copies the resume command; "Copied" for 1.6 s, or a selected text field when the clipboard refuses. */
export function CopyResume({ command }: { command: string }) {
  const [state, setState] = useState<"idle" | "copied" | "fallback">("idle");
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    if (state === "fallback") input.current?.select();
  }, [state]);
  const onClick = () => {
    const fallback = () => setState("fallback");
    try {
      const p = navigator.clipboard?.writeText(command);
      if (!p) return fallback();
      p.then(() => {
        setState("copied");
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), COPIED_MS);
      }, fallback);
    } catch {
      fallback();
    }
  };
  return (
    <div className="fact act">
      <button type="button" className="btn" onClick={onClick} title="Copies the command that resumes this session in a terminal">
        {state === "copied" ? "Copied" : state === "fallback" ? "Select and copy" : "Copy resume command"}
      </button>
      {state === "fallback" && (
        <input ref={input} readOnly value={command} aria-label="Resume command" onFocus={(e) => e.currentTarget.select()} />
      )}
    </div>
  );
}

export function FactsBar({ s, now, onAgent }: { s: SessionView; now: number; onAgent: (id: string) => void }) {
  const c = sessionCounts(s);
  const firstFail = s.agents.find((a) => a.status === "failed");
  return (
    <div className="facts">
      <div className="fact agents" title={AGENTS_HINT}>
        <div className="k">Agents</div>
        <div className="v mono">
          <span className="n-running">{c.running} running</span>
          <span className="n-done">{` / ${c.done} done`}</span>
          {firstFail && (
            <button type="button" className="blow l2" onClick={() => onAgent(firstFail.id)} title="Show the first failure">
              <IconX />
              {c.failed} failed
            </button>
          )}
        </div>
      </div>
      <div className="fact slim cost" title={COST_HINT_SESSION}>
        <div className="k">Est. cost</div>
        <div className="v mono"><Cost usd={s.costUsd} family={s.modelFamily} /></div>
      </div>
      <div className="fact slim">
        <div className="k" title={TOKENS_HINT}>Tokens</div>
        <div className="v mono" title={TOKENS_HINT}>{fmtTok(sessionTokens(s))}</div>
      </div>
      <div className="fact slim">
        <div className="k">Running for</div>
        <div className="v mono">{fmtDur(sessionElapsedSec(s, now))}</div>
      </div>
      <div className="fact slim" title={AGENT_TIME_HINT}>
        <div className="k">Agent time</div>
        <div className="v mono">{fmtDur(sessionAgentSec(s, now))}</div>
      </div>
      <CopyResume command={s.resumeCommand} />
    </div>
  );
}
