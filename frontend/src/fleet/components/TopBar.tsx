import type { ReactNode } from "react";
import type { Phase } from "../store";
import { BrandLink } from "./BrandLink";
import { ConnectionPill } from "./ConnectionPill";

export function TopBar(props: { phase: Phase; reporters: number; outdated?: number; newer?: number; collapsed?: boolean; onCollapse?: () => void; wall?: ReactNode }) {
  const { phase, reporters } = props;
  return (
    <header className="top" id="podium-top" hidden={props.collapsed}>
      <BrandLink />
      <span className="pill">Fleet</span>
      {/* Do not add anything to the right of the connection pill below. Its text changes width with the
          reporter count, so everything after it would shift. Leave that space empty for now. */}
      <ConnectionPill phase={phase} reporters={reporters} />
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
