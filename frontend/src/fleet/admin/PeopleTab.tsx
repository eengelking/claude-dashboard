import { useEffect, useState, type FormEvent } from "react";
import { AdminError, query, type AdminApi, type GroupChoice, type Paged, type PersonRow } from "./adminApi";
import { Pager } from "./Pager";
import { failText, useList } from "./useList";

export interface Created {
  name: string;
  token: string;
}

export function when(t: number | null): string {
  if (t === null) return "never";
  const d = new Date(t);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

type Pending = { id: number; kind: "rotate" | "revoke" } | null;

export function PeopleTab(props: {
  api: AdminApi;
  page: number;
  pageSize: number;
  q: string;
  onPaging: (p: { page?: number; pageSize?: number; q?: string }) => void;
  onCreated: (c: Created) => void;
  onCount: (n: number) => void;
  onLocked: () => void;
}) {
  const { api, page, pageSize, q, onCount, onPaging } = props;
  const [search, setSearch] = useState(q);
  const [name, setName] = useState("");
  const [addErr, setAddErr] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [rowErr, setRowErr] = useState("");
  const list = useList<Paged<PersonRow> & { groups: GroupChoice[] }>(api, `/people${query({ page, pageSize, q })}`, props.onLocked);
  const total = list.data?.total;
  useEffect(() => {
    if (total !== undefined) onCount(total);
  }, [total, onCount]);
  // The search runs a moment after typing stops, from page one.
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => onPaging({ q: search, page: 1 }), 250);
    return () => clearTimeout(t);
  }, [search, q, onPaging]);

  const guard = async (fn: () => Promise<void>, set: (m: string) => void) => {
    try {
      await fn();
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) props.onLocked();
      else set(failText(e));
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setAddErr("Enter a name.");
    setAddErr("");
    void guard(async () => {
      const out = await api<{ person: PersonRow; token: string }>("POST", "/people", { name: n });
      setName("");
      props.onCreated({ name: out.person.name, token: out.token });
      list.reload();
    }, setAddErr);
  };

  const confirm = (p: PersonRow, kind: "rotate" | "revoke") => {
    setRowErr("");
    void guard(async () => {
      if (kind === "rotate") {
        const out = await api<{ person: PersonRow; token: string }>("POST", `/people/${p.id}/rotate`);
        props.onCreated({ name: out.person.name, token: out.token });
      } else {
        await api("POST", `/people/${p.id}/revoke`);
      }
      setPending(null);
      list.reload();
    }, setRowErr);
  };

  const setGroup = (p: PersonRow, value: string) => {
    setRowErr("");
    void guard(async () => {
      await api("PUT", `/people/${p.id}/group`, { groupId: value === "" ? null : Number(value) });
      list.reload();
    }, setRowErr);
  };

  const rows = list.data?.rows ?? [];
  const groups = list.data?.groups ?? [];
  return (
    <>
      <div className="ptool">
        <div className="f grow">
          <label htmlFor="admin-search" className="strong">
            Find a person
          </label>
          <input className="field" id="admin-search" type="search" placeholder="Name, group or machine" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <form className="addrow" onSubmit={add} autoComplete="off">
          <div className="f">
            <label htmlFor="admin-new-name" className="strong">
              Add a person
            </label>
            <input className="field" id="admin-new-name" placeholder="Full name, as it should appear" maxLength={48} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button type="submit" className="btn pri">
            Create token
          </button>
        </form>
      </div>
      {addErr && (
        <div className="err pad" role="alert">
          {addErr}
        </div>
      )}
      {rowErr && (
        <div className="err pad" role="alert">
          {rowErr}
        </div>
      )}
      {list.error && (
        <div className="err pad" role="alert">
          Could not load people ({list.error}).
        </div>
      )}
      {list.data && rows.length === 0 ? (
        <div className="empty">{q ? `No one matches “${q}”. Check the spelling, or search by group or machine.` : "No one has a token yet. Add the first person above."}</div>
      ) : (
        list.data && (
          <div className="tw2 scroll" tabIndex={0} aria-label="People">
            <table className="ptab">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Group</th>
                  <th>Machines seen</th>
                  <th>Token</th>
                  <th>Created</th>
                  <th>Last report</th>
                  <th>Status</th>
                  <th>
                    <span className="vh">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const revoked = p.revokedAt !== null;
                  const pend = pending && pending.id === p.id ? pending : null;
                  return (
                    <tr key={p.id} className={revoked ? "revoked" : ""}>
                      <td>
                        <span className="who">{p.name}</span>
                      </td>
                      <td>
                        <label className="vh" htmlFor={`admin-grp-${p.id}`}>
                          Group for {p.name}
                        </label>
                        <select className="field sm" id={`admin-grp-${p.id}`} value={p.groupId ?? ""} disabled={revoked} onChange={(e) => setGroup(p, e.target.value)}>
                          <option value="">No group</option>
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span className="mchips">
                          {p.machines.length ? p.machines.map((m) => <span key={m} className="chip mono">{m}</span>) : <span className="hint">none yet</span>}
                        </span>
                      </td>
                      <td>
                        <span className="tail">pdm_…{p.last4}</span>
                      </td>
                      <td>{when(p.createdAt)}</td>
                      <td>{when(p.lastReportAt)}</td>
                      <td>
                        {revoked ? (
                          <span className="badge off">
                            <span className="dot" aria-hidden="true" />
                            revoked
                          </span>
                        ) : (
                          <span className="badge ok">
                            <span className="dot running" aria-hidden="true" />
                            active
                          </span>
                        )}
                      </td>
                      <td>
                        {pend ? (
                          <div className="confirm">
                            <span>{pend.kind === "rotate" ? "Rotate? Their reporter stops until it has the new token." : "Revoke? Their reporter is refused at once."}</span>
                            <button type="button" className={`btn sm ${pend.kind === "revoke" ? "dng" : ""}`} onClick={() => confirm(p, pend.kind)}>
                              {pend.kind === "rotate" ? "Rotate token" : "Revoke token"}
                            </button>
                            <button type="button" className="btn sm" onClick={() => setPending(null)}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="acts">
                            <button type="button" className="btn sm" onClick={() => setPending({ id: p.id, kind: "rotate" })}>
                              {revoked ? "Issue new token" : "Rotate"}
                            </button>
                            {!revoked && (
                              <button type="button" className="btn sm dng" onClick={() => setPending({ id: p.id, kind: "revoke" })}>
                                Revoke
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
      {list.data && list.data.total > 0 && (
        <Pager id="admin-people" page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(n) => props.onPaging({ page: n })} onSize={(n) => props.onPaging({ pageSize: n, page: 1 })} />
      )}
    </>
  );
}
