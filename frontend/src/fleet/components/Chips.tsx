// Small shared pieces: model chip, effort meter, status chip, blowout badge, git line.
import type { CSSProperties } from "react";
import { fmtUsd } from "../format";
import { EFFORTS, familyName } from "../logic";
import type { GitInfo, ModelFamily } from "../types";
import { IconBranch, IconCheck, IconClock, IconDown, IconMod, IconTree, IconUp, IconWarn, IconX } from "./Icons";

export const FAMILY_COLOR: Record<ModelFamily, string> = {
  opus: "var(--opus)",
  sonnet: "var(--sonnet)",
  haiku: "var(--haiku)",
  fable: "var(--fable)",
  other: "var(--other)",
};

export function cssVar(c: string): CSSProperties {
  return { ["--c" as string]: c } as CSSProperties;
}

export const NO_PRICE_TITLE = "Not a Claude model, so Podium has no price for it and shows no cost estimate";

/** A cost figure. A non-Claude model has no price: it reads "n/a" with the reason, not a made-up dollar amount. */
export function Cost({ usd, family }: { usd: number | null; family: ModelFamily }) {
  if (usd === null && family === "other") return <span title={NO_PRICE_TITLE}>n/a</span>;
  return <>{fmtUsd(usd)}</>;
}

export function ModelChip({ family, model }: { family: ModelFamily; model?: string | null }) {
  const title = family === "other" && model ? `${model} (not a Claude model)` : (model ?? undefined);
  return (
    <span className="chip" style={cssVar(FAMILY_COLOR[family])} title={title}>
      <i />
      {familyName(family, model ?? null)}
    </span>
  );
}

/** Five bars filled one to five, colored by level; the level is the tooltip and the accessible name, not text. */
export function EffortMeter({ effort }: { effort: string | null }) {
  const n = effort ? EFFORTS.indexOf(effort as (typeof EFFORTS)[number]) + 1 : 0;
  const label = n ? `Effort: ${effort}` : "Effort not reported";
  return (
    <span className={`eff eff-${n ? effort : "none"}`} role="img" aria-label={label} title={label}>
      {[1, 2, 3, 4, 5].map((i) => (
        <b key={i} className={i <= n ? "on" : ""} />
      ))}
    </span>
  );
}

export type StatusKind = "running" | "waiting" | "stale" | "done" | "failed" | "queued" | "aborted";

export const STATUS_LABEL: Record<StatusKind, string> = {
  running: "running",
  done: "done",
  failed: "failed",
  queued: "queued",
  waiting: "waiting on you",
  stale: "heartbeat lost",
  aborted: "aborted",
};

export function StatusIcon({ status }: { status: StatusKind }) {
  if (status === "running") return <i className="dot running" aria-hidden="true" />;
  if (status === "done") return <IconCheck />;
  if (status === "failed" || status === "aborted") return <IconX />;
  if (status === "waiting") return <i className="dot waiting" aria-hidden="true" />;
  if (status === "stale") return <IconWarn />;
  return <IconClock />;
}

export function StatusChip({ status }: { status: StatusKind }) {
  return (
    <span className={`st ${status}`}>
      <StatusIcon status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** `n` blowouts; red when `level` is 2 (a session's level), else when this one loop has 2 or more. */
export function BlowBadge({ n, level }: { n: number; level?: 0 | 1 | 2 }) {
  if (!n) return null;
  const red = level !== undefined ? level === 2 : n >= 2;
  const title = `Context window exceeded ${n} time${n > 1 ? "s" : ""}${red ? ". Earlier work was compacted away; output may be unreliable." : ""}`;
  return (
    <span className={`blow${red ? " l2" : ""}`} title={title}>
      <IconWarn />
      {n}×<span className="vh"> context blowouts</span>
    </span>
  );
}

/** Branch, worktree or main checkout, ahead/behind, modified count or clean. Nothing for `git: null`. */
export function GitLine({ git }: { git: GitInfo | null }) {
  if (!git) return null;
  const wtName = git.worktreePath ? git.worktreePath.split("/").filter(Boolean).pop() : null;
  return (
    <div className="git">
      <span className="br" title={`${git.detached ? "Detached HEAD" : "Branch"}: ${git.branch ?? "unknown"}`}>
        <IconBranch />
        <span className="brn">
          {git.branch ?? "unknown"}
          {git.detached ? " (detached)" : ""}
        </span>
      </span>
      {git.isWorktree ? (
        <span className="wt" title={`Git worktree at ${git.worktreePath ?? "unknown path"}`}>
          <IconTree />
          <span className="wtn">worktree{wtName ? ` · ${wtName}` : ""}</span>
        </span>
      ) : (
        <span className="wt no" title="Working in the main checkout">
          main checkout
        </span>
      )}
      {git.ahead > 0 && (
        <span title="Commits ahead of origin">
          <IconUp />
          {git.ahead}
          <span className="vh"> ahead</span>
        </span>
      )}
      {git.behind > 0 && (
        <span title="Commits behind origin">
          <IconDown />
          {git.behind}
          <span className="vh"> behind</span>
        </span>
      )}
      {git.dirty > 0 ? (
        <span className="dirty" title="Modified files">
          <IconMod />
          {git.dirty} modified
        </span>
      ) : (
        <span title="Clean working tree">clean</span>
      )}
    </div>
  );
}

/** A context bar: amber at 75% or more, amber fill after one blowout, red stripes after two. */
export function ContextBar({ percent, blowouts, width }: { percent: number | null; blowouts: number; width?: number }) {
  const p = Math.max(0, Math.min(100, percent ?? 0));
  const cls = `bar ctx${p >= 75 ? " hot" : ""}${blowouts >= 2 ? " bx2" : blowouts ? " bx" : ""}`;
  return (
    <div className={cls} style={width ? { width } : undefined} role="img" aria-label={`Context ${percent === null ? "unknown" : `${Math.round(p)}%`}`} title={percent === null ? "Context window unknown" : undefined}>
      <i style={{ width: `${p}%` }} />
    </div>
  );
}

export function PlanBar({ pct }: { pct: number }) {
  return (
    <div className="bar plan" aria-hidden="true">
      <i style={{ width: `${Math.round(pct * 100)}%` }} />
    </div>
  );
}

export { IconX };
