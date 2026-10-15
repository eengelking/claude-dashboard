import { useEffect, useState, type FormEvent } from "react";
import { AdminError, query, type AdminApi, type GroupRow, type Paged } from "./adminApi";
import { Pager } from "./Pager";
import { Panel, Section } from "./Page";
import { failText, useList } from "./useList";

export function GroupsTab(props: {
  api: AdminApi;
  page: number;
  pageSize: number;
  onPaging: (p: { page?: number; pageSize?: number }) => void;
  onCount: (n: number) => void;
  onLocked: () => void;
}) {
  const { api, page, pageSize, onCount } = props;
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [pending, setPending] = useState<number | null>(null);
  const list = useList<Paged<GroupRow>>(api, `/groups${query({ page, pageSize })}`, props.onLocked);
  const total = list.data?.total;
  useEffect(() => {
    if (total !== undefined) onCount(total);
  }, [total, onCount]);

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) props.onLocked();
      else setErr(failText(e));
    }
  };
  const create = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setErr("Enter a group name.");
    setErr("");
    void guard(async () => {
      await api("POST", "/groups", { name: n });
      setName("");
      list.reload();
    });
  };
  const remove = (g: GroupRow) => {
    setErr("");
    void guard(async () => {
      await api("DELETE", `/groups/${g.id}`);
      setPending(null);
      list.reload();
    });
  };

  const rows = list.data?.rows ?? [];
  return (
    <>
      <Section id="admin-create-group-h" title="Create group" help="A person belongs to one group at most. Groups only change how the console is arranged; they grant nothing.">
        <Panel>
          <form className="tool alone" onSubmit={create} autoComplete="off">
            <div className="f grow">
              <label htmlFor="admin-new-group">Name</label>
              <input className="field" id="admin-new-group" placeholder="For example Frontend, Backend or DevOps" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <button type="submit" className="btn pri">
              Create group
            </button>
          </form>
          {err && (
            <div className="err" role="alert">
              {err}
            </div>
          )}
        </Panel>
      </Section>
      <Section id="admin-groups-h" title="Manage groups" help="Deleting a group leaves its people without a group.">
        <Panel>
          {list.error && (
            <div className="err" role="alert">
              Could not load groups ({list.error}).
            </div>
          )}
          {list.data && rows.length === 0 ? (
            <div className="empty">No groups yet. Create one above, then pick it for a person on the People page.</div>
          ) : (
            list.data && (
              <div className="tw2 scroll" tabIndex={0} aria-label="Groups">
                <table className="ptab">
                  <thead>
                    <tr>
                      <th>Group</th>
                      <th>People</th>
                      <th>
                        <span className="vh">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((g) => (
                      <tr key={g.id}>
                        <td>
                          <span className="who">{g.name}</span>
                        </td>
                        <td>
                          {g.members.length ? (
                            <>
                              <span className="mchips">
                                {g.members.slice(0, 5).map((m) => (
                                  <span key={m} className="chip">{m}</span>
                                ))}
                                {g.members.length > 5 && <span className="hint">and {g.members.length - 5} more</span>}
                              </span>
                              <span className="hint gap">{g.members.length} in total</span>
                            </>
                          ) : (
                            <span className="hint">No one yet. Pick this group for a person on the People page.</span>
                          )}
                        </td>
                        <td>
                          {pending === g.id ? (
                            <div className="confirm">
                              <span>
                                Delete? {g.members.length ? `${g.members.length} ${g.members.length === 1 ? "person goes" : "people go"} to No group.` : "No one is in it."}
                              </span>
                              <button type="button" className="btn sm dng" onClick={() => remove(g)}>
                                Delete group
                              </button>
                              <button type="button" className="btn sm" onClick={() => setPending(null)}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="acts">
                              <button type="button" className="btn sm dng" onClick={() => setPending(g.id)}>
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
          {list.data && list.data.total > 0 && (
            <Pager id="admin-groups" page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(n) => props.onPaging({ page: n })} onSize={(n) => props.onPaging({ pageSize: n, page: 1 })} />
          )}
        </Panel>
      </Section>
    </>
  );
}
