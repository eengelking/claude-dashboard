import { useEffect } from "react";
import { query, type AdminApi, type LogRow, type Paged } from "./adminApi";
import { Pager } from "./Pager";
import { Panel, Section } from "./Page";
import { when } from "./PeopleTab";
import { useList } from "./useList";

/** "90 days", "1 day", or hours when the period is under a day (#303). */
function kept(ms: number): string {
  const days = Math.round(ms / 86_400_000);
  if (days >= 1) return `${days} ${days === 1 ? "day" : "days"}`;
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

export function LogTab(props: {
  api: AdminApi;
  page: number;
  pageSize: number;
  onPaging: (p: { page?: number; pageSize?: number }) => void;
  onCount: (n: number) => void;
  onLocked: () => void;
}) {
  const { api, page, pageSize, onCount } = props;
  const list = useList<Paged<LogRow> & { retainMs?: number }>(api, `/log${query({ page, pageSize })}`, props.onLocked);
  const total = list.data?.total;
  useEffect(() => {
    if (total !== undefined) onCount(total);
  }, [total, onCount]);
  const rows = list.data?.rows ?? [];
  return (
    <Section id="admin-log-h" title="Recent activity" help={list.data?.retainMs === undefined ? undefined : `Entries are kept for ${kept(list.data.retainMs)}.`}>
      <Panel>
        {list.error && (
          <div className="err" role="alert">
            Could not load the log ({list.error}).
          </div>
        )}
        {list.data && rows.length === 0 ? (
          <div className="empty">Nothing has happened yet.</div>
        ) : (
          list.data && (
            <div className="tw2 scroll" tabIndex={0} aria-label="Admin log">
              <table className="ptab">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>What happened</th>
                    <th>From</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="mono muted nowrap">{when(r.t)}</td>
                      <td className="nowrap">{r.actor ?? <span className="muted">Not recorded</span>}</td>
                      <td className={r.kind.includes("failed") ? "bad" : ""}>{r.detail}</td>
                      <td className="mono muted">{r.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        {list.data && list.data.total > 0 && (
          <Pager id="admin-log" page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(n) => props.onPaging({ page: n })} onSize={(n) => props.onPaging({ pageSize: n, page: 1 })} />
        )}
      </Panel>
    </Section>
  );
}
