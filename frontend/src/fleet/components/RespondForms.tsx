import { useId, type ReactNode } from "react";
import { cleanLabel, countWord, PLAN_LABELS } from "../respond";
import type { AskDetail, PlanMode, QuestionAnswer } from "../types";
import { Markdown } from "./Markdown";

// The answer panel's forms (#206, mockup/podium-respond.html section 3): a question as tabs like Claude Code's own, a
// plan with three ways to approve it or a way to send it back, and a tool's Allow once or Deny. Every text from the
// session is drawn as text nodes; the plan's markdown goes through the existing renderer (SPEC 7.7).

export const ICONS = {
  wait: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.8v3.6M8 10.6v.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  reply: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.5 4 2.5 8l4 4M3 8h6.5a4 4 0 0 1 4 4v.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  ok: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="m5.3 8.2 1.8 1.8 3.6-3.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  info: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 7.2v4M8 4.8v.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  x: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
};

/** An outcome that replaces the form: its icon, a sentence, the detail, and any action. */
export function Outcome(props: { cls: "ok" | "info" | "bad" | "wait"; icon: ReactNode; title: ReactNode; children: ReactNode; acts?: ReactNode }) {
  return (
    <div className={`out ${props.cls}`}>
      <span className="oi">{props.icon}</span>
      <b>{props.title}</b>
      <span className="od">{props.children}</span>
      {props.acts && <span className="acts">{props.acts}</span>}
    </div>
  );
}

/** A quoted answer, as the mockup sets it: bold, without quote marks drawn by the browser. */
export const Q = ({ children }: { children: ReactNode }) => <q>{children}</q>;

// ---- a question --------------------------------------------------------------------------------

/** One question's answer while it is being chosen: the options picked, or Type something with its text. */
export type Draft = { options: number[] } | { other: string } | null;

export function draftToAnswer(d: Draft): QuestionAnswer {
  if (!d) return null;
  if ("other" in d) return d.other.trim() ? { text: d.other.trim() } : null;
  return d.options.length ? { options: d.options } : null;
}

function answerText(detail: AskDetail, i: number, d: Draft): string {
  const a = draftToAnswer(d);
  if (!a) return "";
  if ("text" in a) return a.text;
  return a.options.map((n) => cleanLabel(detail.ask.questions![i]!.options[n]?.label ?? "").label).join(", ");
}

export function QuestionForm(props: { detail: AskDetail; tab: number; drafts: Draft[]; onTab: (n: number) => void; onDraft: (i: number, d: Draft) => void; onSubmit: () => void; busy: boolean }) {
  const { detail, tab, drafts } = props;
  const qs = detail.ask.questions ?? [];
  const n = qs.length;
  const onReview = tab === n;
  const id = useId();
  let inner: ReactNode;
  if (onReview) {
    inner = (
      <>
        <p className="qh">Review your answers</p>
        <dl className="review">
          {qs.map((q, i) => {
            const a = answerText(detail, i, drafts[i] ?? null);
            return (
              <div key={i}>
                <dt>{q.question}</dt>
                <dd className={a ? "" : "blank"}>{a || "Not answered. Claude sees it as skipped."}</dd>
              </div>
            );
          })}
        </dl>
      </>
    );
  } else {
    const q = qs[tab]!;
    const d = drafts[tab] ?? null;
    const chosen = (i: number) => !!d && "options" in d && d.options.includes(i);
    const withPreview = q.options.some((o) => o.preview);
    const sel = q.options.find((o, i) => chosen(i) && o.preview) ?? (withPreview ? q.options[0] : undefined);
    const pick = (i: number) => {
      if (q.multiSelect) {
        const cur = d && "options" in d ? d.options : [];
        props.onDraft(tab, { options: cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort((a, b) => a - b) });
      } else props.onDraft(tab, { options: [i] });
    };
    const other = d && "other" in d ? d.other : "";
    inner = (
      <>
        <p className="qh" id={`${id}-qh`}>
          {q.question}
        </p>
        {q.multiSelect && <p className="qhint">Pick any that apply.</p>}
        <div className={`qgrid${sel ? " pv" : ""}`}>
          <fieldset className="opts" aria-labelledby={`${id}-qh`}>
            {q.options.map((o, i) => {
              const l = cleanLabel(o.label);
              return (
                <label className="opt" key={i}>
                  <input type={q.multiSelect ? "checkbox" : "radio"} name={`${id}-q${tab}`} checked={chosen(i)} onChange={() => pick(i)} />
                  <span className="ol">
                    {l.label}
                    {l.recommended && <span className="rec">Recommended</span>}
                  </span>
                  <span className="od">{o.description}</span>
                </label>
              );
            })}
            {!q.multiSelect && (
              <label className="opt">
                <input type="radio" name={`${id}-q${tab}`} checked={!!d && "other" in d} onChange={() => props.onDraft(tab, { other })} />
                <span className="ol">Type something</span>
                <input
                  type="text"
                  placeholder="Your own answer"
                  aria-label="Your own answer"
                  value={other}
                  onFocus={() => {
                    if (!(d && "other" in d)) props.onDraft(tab, { other });
                  }}
                  onChange={(e) => props.onDraft(tab, { other: e.target.value })}
                />
              </label>
            )}
          </fieldset>
          {sel && (
            <div className="preview">
              <div className="pl">Preview: {cleanLabel(sel.label).label}</div>
              <pre>{sel.preview}</pre>
            </div>
          )}
        </div>
      </>
    );
  }
  return (
    <>
      <div className="ab">
        <div className="tabs" role="tablist" aria-label="Questions">
          {qs.map((q, i) => (
            <button key={i} type="button" role="tab" className={`tab${answerText(detail, i, drafts[i] ?? null) ? " done" : ""}`} aria-selected={tab === i} onClick={() => props.onTab(i)}>
              <span className="box" />
              {q.header}
            </button>
          ))}
          <button type="button" role="tab" className="tab" aria-selected={onReview} onClick={() => props.onTab(n)}>
            Review
          </button>
        </div>
        {inner}
      </div>
      <div className="af">
        <span className="grow">{onReview ? (n === 1 ? "Submitting sends it, as Claude Code does." : `Submitting sends all ${countWord(n)} at once, as Claude Code does.`) : `Question ${tab + 1} of ${n}`}</span>
        {tab > 0 && (
          <button className="btn" type="button" onClick={() => props.onTab(tab - 1)}>
            Back
          </button>
        )}
        {onReview ? (
          <button className="btn pri" type="button" disabled={props.busy} onClick={props.onSubmit}>
            Submit answers
          </button>
        ) : (
          <button className="btn pri" type="button" onClick={() => props.onTab(Math.min(tab + 1, n))}>
            Next
          </button>
        )}
      </div>
    </>
  );
}

// ---- a plan ------------------------------------------------------------------------------------

export type PlanChoice = PlanMode | "keep";

const PLAN_DESC: Record<PlanMode, string> = {
  auto: "Claude decides which tools need asking.",
  acceptEdits: "File edits run without asking; commands still ask.",
  default: "Every edit asks first.",
};

export function PlanForm(props: { detail: AskDetail; backOnly: boolean; choice: PlanChoice; feedback: string; onChoice: (c: PlanChoice) => void; onFeedback: (t: string) => void; onSubmit: () => void; busy: boolean }) {
  const id = useId();
  const plan = props.detail.ask.plan;
  const choice = props.backOnly ? "keep" : props.choice;
  const keep = (
    <label className="opt">
      <input type="radio" name={`${id}-plan`} checked={choice === "keep"} onChange={() => props.onChoice("keep")} />
      <span className="ol">No, keep planning</span>
      {choice === "keep" && <textarea rows={2} placeholder="Tell Claude what to change" aria-label="Tell Claude what to change" value={props.feedback} onChange={(e) => props.onFeedback(e.target.value)} />}
    </label>
  );
  return (
    <>
      <div className="ab">
        <p className="qh">Ready to code?</p>
        {plan?.filePath && <p className="planfile">{plan.filePath}</p>}
        <div className="planbox">
          <Markdown source={plan?.text ?? ""} />
        </div>
        {props.backOnly ? (
          <>
            <p className="signnote">
              This session can't take an approval from Podium, because Claude Code doesn't run podium-reporter's permission hooks on this computer. That happens where an organization manages Claude Code. Approve the plan in the terminal, or send it back from here.
            </p>
            <fieldset className="opts" aria-label="Send the plan back">
              {keep}
            </fieldset>
          </>
        ) : (
          <fieldset className="opts" aria-label="Approve the plan">
            {(Object.keys(PLAN_LABELS) as PlanMode[]).map((m) => (
              <label className="opt" key={m}>
                <input type="radio" name={`${id}-plan`} checked={choice === m} onChange={() => props.onChoice(m)} />
                <span className="ol">{PLAN_LABELS[m]}</span>
                <span className="od">{PLAN_DESC[m]}</span>
              </label>
            ))}
            {keep}
          </fieldset>
        )}
      </div>
      <div className="af">
        <span className="grow">Editing the plan text (Ctrl+G) is only in the terminal.</span>
        <button className="btn pri" type="button" disabled={props.busy} onClick={props.onSubmit}>
          {choice === "keep" ? "Send feedback" : "Approve plan"}
        </button>
      </div>
    </>
  );
}

// ---- a tool permission -------------------------------------------------------------------------

export function PermissionForm(props: { detail: AskDetail; allow: boolean; reason: string; onAllow: (allow: boolean) => void; onReason: (t: string) => void; onSubmit: () => void; busy: boolean }) {
  const id = useId();
  const tool = props.detail.ask.tool;
  const input = tool?.input ?? {};
  const command = typeof input.command === "string" ? input.command : null;
  const description = typeof input.description === "string" ? input.description : null;
  return (
    <>
      <div className="ab">
        <p className="qh">{tool?.name === "Bash" ? "Bash wants to run a command" : `${tool?.name ?? "A tool"} wants your permission`}</p>
        <div className="cmd">{command ?? JSON.stringify(input, null, 2)}</div>
        {description && <p className="cmdd">{description}</p>}
        <fieldset className="opts" aria-label="Allow or deny">
          <label className="opt">
            <input type="radio" name={`${id}-perm`} checked={props.allow} onChange={() => props.onAllow(true)} />
            <span className="ol">Allow once</span>
            <span className="od">Runs this command now. The next one asks again.</span>
          </label>
          <label className="opt">
            <input type="radio" name={`${id}-perm`} checked={!props.allow} onChange={() => props.onAllow(false)} />
            <span className="ol">Deny</span>
            <span className="od">Claude is told no and keeps going.</span>
            {!props.allow && <textarea rows={2} placeholder="Tell Claude why, or what to do instead (optional)" aria-label="Tell Claude why" value={props.reason} onChange={(e) => props.onReason(e.target.value)} />}
          </label>
        </fieldset>
      </div>
      <div className="af">
        <span className="grow">"Always allow" changes the session's rules, so it is only in the terminal.</span>
        <button className={`btn ${props.allow ? "pri" : "bad"}`} type="button" disabled={props.busy} onClick={props.onSubmit}>
          {props.allow ? "Allow once" : "Deny"}
        </button>
      </div>
    </>
  );
}
