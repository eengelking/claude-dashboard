import { useState } from "react";
import { AdminError, type AdminApi } from "./adminApi";
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
    <div className="two2">
      <section aria-labelledby="admin-leg-h">
        <h2 id="admin-leg-h">Reporting with the admin secret</h2>
        <div className="stack">
          <div className="sw">
            <button type="button" role="switch" aria-checked={allowed ?? false} aria-labelledby="admin-leg-txt" disabled={allowed === undefined} onClick={flip} />
            <span id="admin-leg-txt">{allowed === undefined ? "Loading…" : allowed ? "Allowed" : "Refused"}</span>
          </div>
          <div className="hint ink2">
            {allowed === false
              ? "Reporters that still send the admin secret are refused. Create a token for them first."
              : "Reporters that send the admin secret show in the Admin band. Anyone who has this secret can also open Admin, so keep it to your own machine and give everyone else their own token."}
          </div>
          {(err || list.error) && (
            <div className="err" role="alert">
              {err || `Could not load the setting (${list.error}).`}
            </div>
          )}
        </div>
      </section>
      <section aria-labelledby="admin-sec-h">
        <h2 id="admin-sec-h">What protects this</h2>
        <ul className="plain">
          <li>Tokens are stored hashed. Podium cannot show one again.</li>
          <li>Podium decides who a report is from by its token, not by the name in it.</li>
          <li>Revoking takes effect on the next report.</li>
          <li>Wrong guesses at the admin secret are limited and logged in the Admin log.</li>
          <li>Tokens travel as they do today. On a network, use a trusted network or a TLS proxy.</li>
        </ul>
      </section>
    </div>
  );
}
