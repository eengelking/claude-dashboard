import { forwardRef } from "react";
import { fmtDur, fmtPct, fmtTok, fmtUsd } from "../format";
import { agentElapsedSec, agentTokens, type Guide } from "../logic";
import type { AgentView } from "../types";
import { BlowBadge, ContextBar, EffortMeter, ModelChip, StatusChip } from "./Chips";
import { IconFork, IconSub } from "./Icons";

function Indent({ guides }: { guides: Guide[] }) {
  if (!guides.length) return null;
  return (
    <span className="indent" aria-hidden="true">
      {guides.map((g, i) => {
        const own = i === guides.length - 1;
        const cls = g === "last" ? "last" : g === "blank" ? "blank" : own ? "tee" : "";
        return <s key={i} className={cls} />;
      })}
    </span>
  );
}

export const AgentRow = forwardRef<HTMLButtonElement, {
  a: AgentView;
  guides: Guide[];
  now: number;
  selected: boolean;
  flash: boolean;
  onSelect: (id: string) => void;
}>(function AgentRow({ a, guides, now, selected, flash, onSelect }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={`trow${flash ? " flash" : ""}`}
      id={`row-${a.id}`}
      aria-current={selected}
      onClick={() => onSelect(a.id)}
      data-agent={a.id}
    >
      <div className="nm">
        <Indent guides={guides} />
        {a.kind === "fork" ? <IconFork /> : <IconSub />}
        <span className="tx">
          <b>{a.description}</b>
          <em>{a.kind === "fork" ? "fork" : a.type}</em>
          {a.failure && <em className="rowerr">{a.failure.class}</em>}
        </span>
      </div>
      <div>
        <ModelChip family={a.modelFamily} model={a.model} />
      </div>
      <div>
        <EffortMeter effort={a.effort} />
      </div>
      <div className="ctxc">
        <ContextBar percent={a.context.percent} blowouts={a.blowouts} />
        <span>{fmtPct(a.context.percent)}</span>
        <BlowBadge n={a.blowouts} />
      </div>
      <div className="num c-tok">{fmtTok(agentTokens(a))}</div>
      <div className="num">{fmtUsd(a.costUsdEst)}</div>
      <div className="num">{fmtDur(agentElapsedSec(a, now))}</div>
      <div>
        <StatusChip status={a.status} />
      </div>
    </button>
  );
});
