import { useState } from "react";
import type { ModelPriceRow, ModelPricesView, PriceSet } from "./adminApi";
import { Panel, Section } from "./Page";

const FIELDS = [
  { f: "input", head: "Input", aria: "input" },
  { f: "output", head: "Output", aria: "output" },
  { f: "cacheRead", head: "Cache read", aria: "cache read" },
  { f: "cacheWrite", head: "Cache write, 5 min", aria: "cache write 5 minutes" },
  { f: "cacheWrite1h", head: "Cache write, 1 hour", aria: "cache write 1 hour" },
] as const;
type Field = (typeof FIELDS)[number]["f"];
type Draft = Record<Field, string>;

/** The most one price can be, per million tokens. Keep in step with `MAX_PRICE` in server/src/fleet/pricing.ts, which enforces it (as the 120-character model id limit is in modelPrices.ts). */
const MAX_PRICE = 1000;

/** A price as the text in its box; a model just added has none yet, so its boxes start empty. */
const text = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? "" : String(n));
const toDraft = (p: PriceSet | undefined): Draft => ({
  input: text(p?.input),
  output: text(p?.output),
  cacheRead: text(p?.cacheRead),
  cacheWrite: text(p?.cacheWrite),
  cacheWrite1h: text(p?.cacheWrite1h),
});

/** The prices a draft holds, or the message for the first field that is not a valid price. */
function parseDraft(d: Draft): { ok: PriceSet } | { err: string; field: Field } {
  const out = {} as PriceSet;
  for (const { f, aria } of FIELDS) {
    const t = d[f].trim();
    const n = t === "" ? NaN : Number(t);
    const name = aria[0]!.toUpperCase() + aria.slice(1);
    if (!Number.isFinite(n)) return { err: `${name} must be a number.`, field: f };
    if (n < 0) return { err: `${name} must be zero or more.`, field: f };
    if (n > MAX_PRICE) return { err: `${name} must be at most ${MAX_PRICE} US dollars per million tokens.`, field: f };
    out[f] = n;
  }
  return { ok: out };
}

const same = (a: Draft, b: Draft) => FIELDS.every(({ f }) => a[f] === b[f]);

/** What a row's save and reset do; the message comes back when the server refuses. */
export interface PriceActions {
  save: (key: string, std: PriceSet, long: PriceSet | undefined) => Promise<string | null>;
  reset: (key: string) => Promise<string | null>;
}

function PriceInputs({ label, draft, set, bad, changed }: { label: string; draft: Draft; set: (f: Field, v: string) => void; bad: Field | null; changed: Draft }) {
  return (
    <>
      {FIELDS.map(({ f, aria }) => (
        <td className="n" key={f}>
          <input
            className={`price${draft[f] !== changed[f] ? " changed" : ""}${bad === f ? " bad" : ""}`}
            inputMode="decimal"
            aria-label={`${label} ${aria}`}
            aria-invalid={bad === f ? true : undefined}
            value={draft[f]}
            onChange={(e) => set(f, e.target.value)}
          />
        </td>
      ))}
    </>
  );
}

/** One model: its prices, a second set for long prompts where the model has one, and the actions for this row. */
function ModelRow({ row, actions, startDirty }: { row: ModelPriceRow; actions: PriceActions; startDirty: boolean }) {
  const saved = toDraft(row.std);
  const savedLong = row.long ? toDraft(row.long) : null;
  const [std, setStd] = useState<Draft>(saved);
  const [long, setLong] = useState<Draft | null>(savedLong);
  const [err, setErr] = useState("");
  const [bad, setBad] = useState<{ tier: "std" | "long"; field: Field } | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = startDirty || !same(std, saved) || (long && savedLong ? !same(long, savedLong) : false);

  const run = async (go: () => Promise<string | null>) => {
    setBusy(true);
    const msg = await go();
    setBusy(false);
    if (msg) setErr(msg);
  };
  const save = () => {
    setErr("");
    setBad(null);
    const a = parseDraft(std);
    if ("err" in a) {
      setBad({ tier: "std", field: a.field });
      return setErr(a.err);
    }
    let b: PriceSet | undefined;
    if (long) {
      const r = parseDraft(long);
      if ("err" in r) {
        setBad({ tier: "long", field: r.field });
        return setErr(`For prompts over 100,000 tokens: ${r.err[0]!.toLowerCase()}${r.err.slice(1)}`);
      }
      b = r.ok;
    }
    void run(() => actions.save(row.key, a.ok, b));
  };
  const cancel = () => {
    setStd(saved);
    setLong(savedLong);
    setErr("");
    setBad(null);
  };
  const tag = !row.builtin ? "Added by you" : row.overridden ? "Changed" : null;
  const builtinNote = row.builtin && row.overridden && row.builtinStd ? `Built-in input is ${row.builtinStd.input}` : null;
  return (
    <>
      <tr className={long ? "tier first" : undefined}>
        <td className="name">
          <b className={row.builtin ? undefined : "mono"}>{row.label}</b> {tag && <span className="tag">{tag}</span>}
          {builtinNote && <span className="hint">{builtinNote}</span>}
          {long && <span className="hint">Prompts up to 100,000 tokens</span>}
          {!row.builtin && <span className="hint">Podium has no built-in price for this model</span>}
        </td>
        <PriceInputs label={row.label} draft={std} set={(f, v) => setStd({ ...std, [f]: v })} bad={bad?.tier === "std" ? bad.field : null} changed={saved} />
        <td>
          <div className="acts">
            {dirty && (
              <>
                <button type="button" className="btn sm" aria-label={`Cancel ${row.label}`} disabled={busy} onClick={startDirty ? () => void actions.reset(row.key) : cancel}>
                  Cancel
                </button>
                <button type="button" className="btn sm pri" aria-label={`Save ${row.label}`} disabled={busy} onClick={save}>
                  Save
                </button>
              </>
            )}
            {!dirty && row.builtin && row.overridden && (
              <button type="button" className="btn sm" aria-label={`Reset ${row.label} to built-in`} disabled={busy} onClick={() => void run(() => actions.reset(row.key))}>
                Reset to built-in
              </button>
            )}
            {!dirty && !row.builtin && (
              <button type="button" className="btn sm" aria-label={`Remove ${row.label}`} disabled={busy} onClick={() => void run(() => actions.reset(row.key))}>
                Remove
              </button>
            )}
          </div>
        </td>
      </tr>
      {long && savedLong && (
        <tr className="tier last">
          <td className="name">
            <b>{row.label}</b>
            <span className="hint">Prompts over 100,000 tokens</span>
          </td>
          <PriceInputs label={`${row.label} over 100,000`} draft={long} set={(f, v) => setLong({ ...long, [f]: v })} bad={bad?.tier === "long" ? bad.field : null} changed={savedLong} />
          <td />
        </tr>
      )}
      {err && (
        <tr>
          <td colSpan={7} className="err" role="alert">
            {err}
          </td>
        </tr>
      )}
    </>
  );
}

/** Admin > Model prices (issue #117, its own page since #143): the prices every cost figure on the wall is worked out from. */
export function ModelPrices({ view, actions }: { view: ModelPricesView; actions: PriceActions }) {
  const [drafts, setDrafts] = useState<string[]>([]);
  const [id, setId] = useState("");
  const [addErr, setAddErr] = useState("");
  const add = () => {
    const key = id.trim().toLowerCase();
    if (!key) return setAddErr("Enter the model's id.");
    if (key.length > 120) return setAddErr("A model id can be at most 120 characters.");
    if (view.models.some((m) => m.key === key) || drafts.includes(key)) return setAddErr(`${key} is already in the table.`);
    setAddErr("");
    setDrafts([...drafts, key]);
    setId("");
  };
  const saved = (key: string, std: PriceSet, long: PriceSet | undefined) =>
    actions.save(key, std, long).then((m) => {
      if (!m) setDrafts((d) => d.filter((k) => k !== key));
      return m;
    });
  return (
    <>
      <Section id="admin-prices-add-h" title="Add a model" help={'A model with no price shows "n/a" for cost until you add one.'}>
        <Panel>
          <form
            className="tool alone"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <div className="f grow">
              <label htmlFor="mp-new">Model id</label>
              <input id="mp-new" className="field mono" placeholder="for example llama3.1:8b" value={id} onChange={(e) => setId(e.target.value)} />
            </div>
            <button type="submit" className="btn pri">
              Add model
            </button>
          </form>
          {addErr && (
            <div className="err" role="alert">
              {addErr}
            </div>
          )}
        </Panel>
      </Section>
      <Section
        id="admin-prices-h"
        title="Prices by model"
        help={`US dollars per million tokens, as Anthropic lists them. Podium multiplies each model's tokens by these prices, so changing one changes today's cost everywhere at once: the wall, each orchestrator, Est. cost today and History. Built-in prices are from Anthropic's pricing sheet of ${view.asOf}.`}
      >
        <Panel>
          <div className="tw2">
            <table className="ptab">
              <thead>
                <tr>
                  <th>Model</th>
                  {FIELDS.map(({ f, head }) => (
                    <th className="n" key={f}>
                      {head}
                    </th>
                  ))}
                  <th>
                    <span className="vh">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.models.map((m) => (
                  <ModelRow key={`${m.key}:${JSON.stringify([m.std, m.long])}`} row={m} actions={{ ...actions, save: saved }} startDirty={false} />
                ))}
                {drafts.map((key) => (
                  <ModelRow
                    key={`draft:${key}`}
                    row={{ key, label: key, builtin: false, overridden: true, std: { input: NaN, output: NaN, cacheRead: NaN, cacheWrite: NaN, cacheWrite1h: NaN } }}
                    actions={{ ...actions, save: saved, reset: async () => (setDrafts((d) => d.filter((k) => k !== key)), null) }}
                    startDirty
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </Section>
    </>
  );
}
