import { useState } from "react";
import { AdminError, type AdminApi } from "./adminApi";
import { Panel, Section, SwitchRow } from "./Page";
import { failText, useList } from "./useList";

export function ReportingTab({ api, onLocked }: { api: AdminApi; onLocked: () => void }) {
  const list = useList<{ allowAdminSecretReporting: boolean }>(api, "/settings", onLocked);
  const [err, setErr] = useState("");
  const allowed = list.data?.allowAdminSecretReporting;
  const flip = async () => {
    if (allowed === undefined) return;
    setErr("");
    try {
      await api("PUT", "/settings", { allowAdminSecretReporting: !allowed });
      list.reload();
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) onLocked();
      else setErr(failText(e));
    }
  };
  return (
    <>
      <Section id="admin-leg-h" title="Reporting with the admin secret">
        <Panel>
          <SwitchRow
            id="admin-leg"
            name="Allow reporters to use the admin secret"
            description={
              allowed === false
                ? "Reporters that still send the admin secret are refused. Create a token for them first."
                : "Reporters that send the admin secret show in the Admin band. Anyone who has this secret can also open Admin, so keep it to your own machine and give everyone else their own token."
            }
            on={allowed}
            onFlip={flip}
          />
        </Panel>
        {(err || list.error) && (
          <div className="errbox" role="alert">
            {err || `Could not load the setting (${list.error}).`}
          </div>
        )}
      </Section>
      <Section id="admin-sec-h" title="What protects this">
        <Panel>
          <ul className="plain">
            <li>Tokens are stored hashed. Podium cannot show one again.</li>
            <li>Podium decides who a report is from by its token, not by the name in it.</li>
            <li>Revoking takes effect on the next report.</li>
            <li>Wrong guesses at the admin secret are limited and logged in the Admin log.</li>
            <li>Tokens travel as they do today. On a network, use a trusted network or a TLS proxy.</li>
          </ul>
        </Panel>
      </Section>
    </>
  );
}
