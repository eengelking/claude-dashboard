import type { ReactNode } from "react";
import { fmtClock } from "../format";
import type { Phase } from "../store";
import { APP_NAME } from "../types";
import { Logo } from "./Icons";

export function TopBar(props: { phase: Phase; reporters: number; outdated?: number; newer?: number; lastMessageAt: number; now: number; collapsed?: boolean; onCollapse?: () => void; wall?: ReactNode }) {
  const { phase, reporters, lastMessageAt, now } = props;
  const synced = lastMessageAt ? Math.max(0, (now - lastMessageAt) / 1000) : null;
  return (
    <header className="top" id="podium-top" hidden={props.collapsed}>
      <div className="logo">
        <Logo />
        {APP_NAME}
      </div>
      {phase === "disconnected" ? (
        <span className="pill bad" role="status">
          <span className="dot bad" aria-hidden="true" />
          disconnected, retrying
        </span>
      ) : phase === "loading" ? (
        <span className="pill" role="status">
          <span className="dot" aria-hidden="true" />
          connecting…
        </span>
      ) : (
        <span className="pill" role="status">
          <span className="dot running" aria-hidden="true" />
          {reporters} reporter{reporters === 1 ? "" : "s"} live, synced {synced === null ? "–" : `${synced.toFixed(1)}s`} ago
        </span>
      )}
      {!!props.outdated && (
        <span className="pill warn" role="status" title="Update the podium-reporter mod from eengelking-marketplace">
          <span className="dot warn" aria-hidden="true" />
          {props.outdated} reporter{props.outdated === 1 ? "" : "s"} need{props.outdated === 1 ? "s" : ""} an update
        </span>
      )}
      {!!props.newer && (
        <span className="pill warn" role="status" title="Upgrade the Podium server">
          <span className="dot warn" aria-hidden="true" />
          {props.newer} reporter{props.newer === 1 ? "" : "s"} newer than the server
        </span>
      )}
      <span className="pill mono" aria-label="Local time">
        {fmtClock(now)}
      </span>
      <span className="spacer" />
      <a className="btn" href="#/history">
        History
      </a>
      {props.onCollapse && (
        <button type="button" className="btn" onClick={props.onCollapse} aria-expanded={!props.collapsed} aria-controls="podium-top" title={"Hide the top bar (\\)"}>
          Hide top bar
        </button>
      )}
      {props.wall}
    </header>
  );
}
