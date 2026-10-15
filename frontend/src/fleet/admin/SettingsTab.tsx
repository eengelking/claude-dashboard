import { useState } from "react";
import { AdminError, type AdminApi } from "./adminApi";
import { Panel, Section, SwitchRow } from "./Page";
import { failText, useList } from "./useList";

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
            ? (data.features ?? []).map((f) => row(`feature-${f.id}`, f.name, f.description, f.on, () => put({ features: { [f.id]: !f.on } }), f.id))
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
      {(err || list.error) && (
        <div className="errbox" role="alert">
          {err || `Could not load the settings (${list.error}).`}
        </div>
      )}
    </>
  );
}
