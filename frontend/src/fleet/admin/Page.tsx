// The pieces every Admin page is built from (#143): a header, then sections, each a title and help line above a panel.
import type { ReactNode } from "react";
import { COPYRIGHT, LICENSE_URL, NOTICES_URL } from "../types";

export function PageHeader({ title, lead }: { title: string; lead: string }) {
  return (
    <div className="page-h">
      <div>
        <h1>{title}</h1>
        <p className="lead">{lead}</p>
      </div>
    </div>
  );
}

/** `id` names the heading so the section is a labelled region. */
export function Section({ id, title, help, children }: { id: string; title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <section className="asec" aria-labelledby={id}>
      <div className="asec-h">
        <div>
          <h2 id={id}>{title}</h2>
          {help && <p className="hint">{help}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export function Panel({ children }: { children: ReactNode }) {
  return <div className="panel">{children}</div>;
}

/**
 * One on/off setting: its name and what it does on the left, the switch and its state on the right. The switch is named by
 * the setting's name plus its state ("Terminal On"). `on` is undefined while the setting is loading.
 */
export function SwitchRow(props: { id: string; name: string; tag?: string; description: ReactNode; on: boolean | undefined; onFlip: () => void }) {
  const { id, on } = props;
  return (
    <div className="srow">
      <div className="setname">
        <b id={`${id}-n`}>{props.name}</b>
        {props.tag && <span className="fid">{props.tag}</span>}
        <p className="hint ink2">{props.description}</p>
      </div>
      <div className="sw">
        <button type="button" role="switch" aria-checked={on ?? false} aria-labelledby={`${id}-n ${id}-s`} disabled={on === undefined} onClick={props.onFlip} />
        <span id={`${id}-s`}>{on === undefined ? "Loading…" : on ? "On" : "Off"}</span>
      </div>
    </div>
  );
}

/** Theme credits, the license, the version and the copyright: the same footer as the fleet page's rail. */
export function AdminFoot({ version, className = "" }: { version: string | null; className?: string }) {
  return (
    <footer className={`rail-foot ${className}`.trim()}>
      <span>
        <a href={NOTICES_URL} target="_blank" rel="noreferrer">
          Theme credits
        </a>
        {" · "}
        <a href={LICENSE_URL} target="_blank" rel="noreferrer">
          License
        </a>
      </span>
      <span>
        {version && version !== "unknown" ? `Podium v${version} · ` : ""}
        {COPYRIGHT}
      </span>
    </footer>
  );
}
