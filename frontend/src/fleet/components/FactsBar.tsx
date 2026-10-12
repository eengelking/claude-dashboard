import { useEffect, useRef, useState } from "react";
import { fmtDur, fmtPct, fmtTok } from "../format";
import { agentCounts, sessionElapsedSec } from "../logic";
import type { SessionView } from "../types";
import { BlowBadge, Cost, ContextBar, EffortMeter, ModelChip } from "./Chips";
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
  const c = agentCounts(s.agents);
  const firstFail = s.agents.find((a) => a.status === "failed");
  return (
    <div className="facts">
      <div className="fact">
        <div className="k">Orchestrator model</div>
        <div className="v">
          <ModelChip family={s.modelFamily} model={s.model} />
          <EffortMeter effort={s.effort} />
        </div>
      </div>
      <div className="fact">
        <div className="k">Context</div>
        <div className="v mono">
          <ContextBar percent={s.context.percent} blowouts={s.blowouts.orchestrator} width={70} />
          <span>{fmtPct(s.context.percent)}</span>
          <BlowBadge n={s.blowouts.orchestrator} />
        </div>
      </div>
      <div className="fact">
        <div className="k">Agents</div>
        <div className="v mono">
          {c.running} running
          <span style={{ color: "var(--muted)", fontWeight: 500 }}> · {c.done} done</span>
          {firstFail && (
            <button type="button" className="blow l2" onClick={() => onAgent(firstFail.id)} title="Show the first failure">
              <IconX />
              {c.failed} failed
            </button>
          )}
        </div>
      </div>
      <div className="fact">
        <div className="k">Est. cost</div>
        <div className="v mono"><Cost usd={s.costUsd} family={s.modelFamily} /></div>
      </div>
      <div className="fact">
        <div className="k">Tokens</div>
        <div className="v mono">{fmtTok(s.tokensTotal)}</div>
      </div>
      <div className="fact">
        <div className="k">Running for</div>
        <div className="v mono">{fmtDur(sessionElapsedSec(s, now))}</div>
      </div>
      <CopyResume command={s.resumeCommand} />
    </div>
  );
}
