import { useState } from "react";
import { AdminError, type AdminApi } from "./adminApi";
import { failText, useList } from "./useList";

interface NoticeRow {
  id: string;
  name: string;
  description: string;
  on: boolean;
}
interface Settings {
  notices: NoticeRow[];
  showBackgroundSessions: boolean;
}

/** Wall settings: one switch per informational notice, and whether background sessions show on the wall (#114). */
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
  const row = (id: string, name: string, description: string, on: boolean | undefined, flip: () => void) => (
    <div className="setrow" key={id}>
      <div className="setname">
        <b id={`set-${id}-n`}>{name}</b>
        <div className="hint ink2">{description}</div>
      </div>
      <div className="sw">
        <button type="button" role="switch" aria-checked={on ?? false} aria-labelledby={`set-${id}-n set-${id}-s`} disabled={on === undefined} onClick={flip} />
        <span id={`set-${id}-s`}>{on === undefined ? "Loading…" : on ? "On" : "Off"}</span>
      </div>
    </div>
  );
  return (
    <div className="stack">
      <section aria-labelledby="admin-notices-h">
        <h2 id="admin-notices-h">Wall notices</h2>
        <div className="hint ink2">Notices sit at the bottom of the wall. Closing one there turns it off here, for everyone.</div>
        {data
          ? data.notices.map((n) => row(`notice-${n.id}`, n.name, n.description, n.on, () => put({ notices: { [n.id]: !n.on } })))
          : row("notice-loading", "Notices", "", undefined, () => {})}
      </section>
      <section aria-labelledby="admin-wall-h">
        <h2 id="admin-wall-h">The wall</h2>
        {row(
          "background",
          "Show background sessions on the wall",
          "Sessions nobody is attached to are set aside after a minute. Turn this on to keep them in view. Off by default.",
          data?.showBackgroundSessions,
          () => data && put({ showBackgroundSessions: !data.showBackgroundSessions }),
        )}
      </section>
      {(err || list.error) && (
        <div className="err" role="alert">
          {err || `Could not load the settings (${list.error}).`}
        </div>
      )}
    </div>
  );
}
