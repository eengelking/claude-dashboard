import type { ReactNode } from "react";
import type { Phase } from "../store";
import { BrandLink } from "./BrandLink";

export function TopBar(props: { phase: Phase; reporters: number; outdated?: number; newer?: number; lastMessageAt: number; now: number; collapsed?: boolean; onCollapse?: () => void; wall?: ReactNode }) {
  const { phase, reporters, lastMessageAt, now } = props;
  const synced = lastMessageAt ? Math.max(0, (now - lastMessageAt) / 1000) : null;
  return (
    <header className="top" id="podium-top" hidden={props.collapsed}>
      <BrandLink />
      <span className="pill">Fleet</span>
      {/* Do not add anything to the right of the connection pill below. Its text changes width as "synced 0.0s
          ago" ticks, so everything after it would shift. Leave that space empty for now. */}
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
      <a className="btn" href="#/admin" title="Tokens, groups and the admin log">
        Admin
      </a>
    </header>
  );
}
