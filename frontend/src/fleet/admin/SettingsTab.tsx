import { useEffect, useState } from "react";
import { AdminError, type AdminApi } from "./adminApi";
import { Panel, Section, SwitchRow } from "./Page";
import { failText, useList } from "./useList";
import { plainHttpCaution } from "./plainHttpCaution";

interface NoticeRow {
  id: string;
  name: string;
  description: string;
  on: boolean;
}
interface Settings {
  /** Server-wide feature flags (#118); the same row shape as a notice. */
  features: NoticeRow[];
  notices: NoticeRow[];
  showBackgroundSessions: boolean;
  /** Issue #167: remove reporters not heard from for this many days. Off by default. */
  forgetReporters?: { enabled: boolean; days: number };
}

/**
 * Server settings: the feature flags (#118), one switch per informational wall notice and whether background sessions
 * show on the wall (#114). The model prices have their own page (#143).
 */
export function SettingsTab({ api, onLocked }: { api: AdminApi; onLocked: () => void }) {
  const list = useList<Settings>(api, "/settings", onLocked);
  const [err, setErr] = useState("");
  const put = async (body: object) => {
    setErr("");
    try {
      await api("PUT", "/settings", body);
      list.reload();
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) onLocked();
      else setErr(failText(e));
    }
  };
  const data = list.data;
  const row = (id: string, name: string, description: string, on: boolean | undefined, flip: () => void, tag?: string) => (
    <SwitchRow key={id} id={`set-${id}`} name={name} tag={tag} description={description} on={on} onFlip={flip} />
  );
  return (
    <>
      <Section id="admin-features-h" title="Feature flags" help="Turn a feature off for everyone on this server. A flag that is off hides the feature in the console and stops its data. New features that can be switched off appear here.">
        <Panel>
          {data
            ? (data.features ?? []).map((f) => row(`feature-${f.id}`, f.name, f.id === "respond" ? `${f.description} ${plainHttpCaution()}`.trim() : f.description, f.on, () => put({ features: { [f.id]: !f.on } }), f.id))
            : row("feature-loading", "Feature flags", "", undefined, () => {})}
        </Panel>
      </Section>
      <Section id="admin-notices-h" title="Wall notices" help="Notices sit at the bottom of the wall. Closing one there turns it off here, for everyone.">
        <Panel>
          {data
            ? data.notices.map((n) => row(`notice-${n.id}`, n.name, n.description, n.on, () => put({ notices: { [n.id]: !n.on } })))
            : row("notice-loading", "Notices", "", undefined, () => {})}
        </Panel>
      </Section>
      <Section id="admin-wall-h" title="The wall">
        <Panel>
          {row(
            "background",
            "Show background sessions on the wall",
            "Sessions nobody is attached to are set aside after a minute. Turn this on to keep them in view. Off by default.",
            data?.showBackgroundSessions,
            () => data && put({ showBackgroundSessions: !data.showBackgroundSessions }),
          )}
        </Panel>
      </Section>
      <Section id="admin-forget-h" title="Reporters">
        <Panel>
          {row(
            "forget-reporters",
            "Forget old reporters",
            "Remove a reporter from Admin > Reporters once the server has not heard from it for the number of days below. It is checked every hour, and each removal is written to the Admin log. Sessions are not touched, and a reporter comes back if it reports again. Off by default.",
            data ? (data.forgetReporters?.enabled ?? false) : undefined,
            () => data && put({ forgetReporters: { enabled: !(data.forgetReporters?.enabled ?? false) } }),
          )}
          <ForgetDays days={data?.forgetReporters?.days ?? 30} disabled={!data} onSave={(days) => put({ forgetReporters: { days } })} />
        </Panel>
      </Section>
      {(err || list.error) && (
        <div className="errbox" role="alert">
          {err || `Could not load the settings (${list.error}).`}
        </div>
      )}
    </>
  );
}

/** The number of days for "Forget old reporters": saved when the box loses focus, and only if it is a whole number from 1 to 3650. */
function ForgetDays(props: { days: number; disabled: boolean; onSave: (days: number) => void }) {
  const [text, setText] = useState(String(props.days));
  const [msg, setMsg] = useState("");
  useEffect(() => setText(String(props.days)), [props.days]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() === "" || !Number.isInteger(n) || n < 1 || n > 3650) return setMsg("Enter a whole number of days from 1 to 3650.");
    setMsg("");
    if (n !== props.days) props.onSave(n);
  };
  return (
    <div className="srow">
      <div className="setname">
        <label htmlFor="forget-days">
          <b>Days</b>
        </label>
        <p className="hint ink2">How long a reporter can be silent before it is forgotten.</p>
        {msg && (
          <p className="err" role="alert">
            {msg}
          </p>
        )}
      </div>
      <input className="field mono daysbox" id="forget-days" type="number" min={1} max={3650} step={1} value={text} disabled={props.disabled} onChange={(e) => setText(e.target.value)} onBlur={commit} />
    </div>
  );
}
