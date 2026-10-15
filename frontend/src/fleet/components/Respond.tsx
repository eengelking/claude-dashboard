import { useCallback, useEffect, useState, type ReactNode } from "react";
import { familyName, ORCHESTRATOR_ROW as MAIN_LOOP, reporterBelow } from "../logic";
import { RespondError } from "../respondApi";
import { askLead, ASK_WORD, canAnswer, clockOf, deliverySummary, isMine, minSec, planBackOnly, respondGate, shownAsk } from "../respond";
import type { AskDetail, SessionView } from "../types";
import { readEvery, useActivityFeed, writeEvery } from "../useActivityFeed";
import { useRespond } from "../useRespond";
import { ACTIVITY_REPORTER_MINOR, AdminOffNote, EverySelect, FeedList, FeedStatus, footer } from "./ActivityFeed";
import { Compose, OffNote } from "./Compose";
import { Modal } from "./Modal";
import { draftToAnswer, ICONS, Outcome, PermissionForm, PlanForm, Q, QuestionForm, type Draft, type PlanChoice } from "./RespondForms";
import { SignInPanel } from "./SignIn";

// Responding to a waiting session from Podium (#206, mockup/podium-respond.html). Respond sits at the right end of the
// amber band and opens the existing Activity modal, which gains the answer panel between the feed and the message box.

/** Respond on a band (the card's and the orchestrator page's), or nothing (mockup section 1, "Rules for the button"). */
export function RespondButton({ s }: { s: SessionView }) {
  const ctx = useRespond();
  if (!ctx) return null;
  const gate = respondGate(s, ctx.me, ctx.flagsOn);
  if (gate.show === "none") return null;
  const dimmed = gate.show === "dimmed";
  return (
    <span className="respond-wrap">
      {dimmed && <span className="why">{gate.owner}'s session</span>}
      <button
        type="button"
        className="respond"
        aria-haspopup="dialog"
        disabled={dimmed}
        title={dimmed ? `Only ${gate.owner}, who owns this session, or an Admin can respond.` : undefined}
        onClick={(e) => {
          e.stopPropagation();
          ctx.open(s.id, e.currentTarget);
        }}
      >
        {ICONS.reply}
        Respond
        {gate.count && <span className="n">{gate.count}</span>}
      </button>
    </span>
  );
}

type Case = "form" | "sending" | "undelivered" | "terminal" | "other" | "closed" | "hidden";

/** Which frame the panel shows for an ask the signed-in person may answer, from what the server says about it. */
function caseOf(detail: AskDetail, stale: boolean): Case {
  const d = detail.delivery;
  if (detail.state === "closed") {
    const c = detail.closed;
    if (c?.outcome === "podium") return d && !d.mine ? "other" : "hidden";
    return c?.outcome === "terminal" ? "terminal" : "closed";
  }
  if (d && !d.mine) return "other";
  if (detail.state === "pending" && stale && d && !d.handedOver) return "undelivered";
  if (detail.state === "pending" || detail.state === "not-taken") return "sending";
  return "form";
}

/** The panel's frame around its body: the wait's icon and lead, how long ago it was asked, and what else applies. */
function Panel(props: { lead: string; ago: string; also: string; children: ReactNode }) {
  return (
    <section className="ask" aria-label={props.lead}>
      <div className="ah">
        <span className="bi">{ICONS.wait}</span>
        <b>{props.lead}</b>
        {props.ago && <span className="ago">{props.ago}</span>}
        <span className="also">{props.also}</span>
      </div>
      {props.children}
    </section>
  );
}

const foot = (text: string) => (
  <div className="af">
    <span className="grow">{text}</span>
  </div>
);

export function RespondModal(props: { s: SessionView; now: number; adminFeedOn: boolean }) {
  const { s, now } = props;
  const ctx = useRespond()!;
  const me = ctx.me;
  const signedIn = !!me?.signedIn;
  const mine = isMine(s, me);
  const ask = shownAsk(s);
  const kind = ask?.kind ?? null;
  const can = canAnswer(s, kind);
  const edge: "off" | "old" | null = !ctx.flagsOn || !me?.enabled ? "off" : can === "ok" ? null : can;

  // The feed, as the Activity modal shows it today.
  const [every, setEvery] = useState(readEvery);
  const [nudge, setNudge] = useState(0);
  const feedOn = s.reporter === "mod" && !reporterBelow(s, ACTIVITY_REPORTER_MINOR) && s.activityFeed !== false;
  const active = s.status !== "done";
  const feed = useActivityFeed({ sessionId: s.id, loop: MAIN_LOOP, enabled: feedOn, active, every, adminOn: props.adminFeedOn, nudge });
  const [count, when] = footer(feed, active, true, Date.now());

  // The whole ask, for its owner or an Admin; read again whenever its state changes.
  const [detail, setDetail] = useState<AskDetail | null>(null);
  const askKey = ask ? `${ask.id}:${ask.state}` : "";
  const load = useCallback(async () => {
    if (!ask || !signedIn || !mine || edge) {
      setDetail(null);
      return;
    }
    try {
      setDetail(await ctx.api.ask(s.id, ask.id));
    } catch (err) {
      if (err instanceof RespondError && err.status === 403) void ctx.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askKey, signedIn, mine, edge, s.id, ctx.api]);
  useEffect(() => {
    void load();
  }, [load]);

  // What the person has chosen so far, kept per ask.
  const [forAsk, setForAsk] = useState("");
  const [tab, setTab] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [plan, setPlan] = useState<PlanChoice>("auto");
  const [feedback, setFeedback] = useState("");
  const [allow, setAllow] = useState(true);
  const [reason, setReason] = useState("");
  if (ask && forAsk !== ask.id) {
    setForAsk(ask.id);
    setTab(0);
    setDrafts([]);
    setPlan("auto");
    setFeedback("");
    setAllow(true);
    setReason("");
  }
  const [draft, setDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const after = useCallback(async () => {
    setNudge((n) => n + 1);
    await load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      if (err instanceof RespondError) {
        if (err.status === 403 && err.message === "sign in to respond") void ctx.refresh();
        else if (err.status !== 409 && err.status !== 410) setError(err.message);
      } else setError("Could not reach the Podium server. Try again.");
      return false;
    } finally {
      setBusy(false);
      await after();
    }
  };

  const answer = (body: Record<string, unknown>) => (ask ? run(() => ctx.api.answer(s.id, ask.id, body)) : Promise.resolve(false));

  const stale = s.status === "stale";
  const kase: Case = detail && ask && detail.ask.id === ask.id ? caseOf(detail, stale) : ask?.state === "closed" ? "hidden" : "form";
  const formShowing = !!ask && ask.state !== "closed" && kase === "form" && !!detail;
  const backOnly = kind === "plan" && planBackOnly(s);

  const send = async (text: string) => {
    if (text === "/clear" || text === "/compact") {
      if (await run(() => ctx.api.message(s.id, { command: text === "/clear" ? "clear" : "compact" }))) setDraft("");
      return;
    }
    if (formShowing && ask) {
      if (await answer({ kind: "reply", text })) setDraft("");
      return;
    }
    if (await run(() => ctx.api.message(s.id, { text }))) setDraft("");
  };

  // ---- the answer panel ----
  let panel: ReactNode = null;
  const lead = askLead(kind);
  const ago = ask ? `asked ${minSec(now - ask.openedAt)} ago` : "";
  if (!edge && !signedIn) {
    panel = (
      <Panel lead={lead} ago={ask && ask.state !== "closed" ? ago : ""} also={ask && ask.state !== "closed" ? "Also open in the terminal" : ""}>
        <SignInPanel />
      </Panel>
    );
  } else if (!edge && ask && !mine && ask.state !== "closed") {
    const owner = s.owner ?? "Unassigned";
    panel = (
      <Panel lead={lead} ago={ago} also="">
        <Outcome cls="info" icon={ICONS.info} title={`This is ${owner}'s session.`}>
          Only {owner}, or an Admin, can respond to it from Podium. You can still watch its activity.
        </Outcome>
      </Panel>
    );
  } else if (!edge && ask && detail && detail.ask.id === ask.id && kase !== "hidden") {
    const what = ASK_WORD[detail.ask.kind];
    const d = detail.delivery;
    const summary = d ? deliverySummary(detail, d) : "";
    if (kase === "form") {
      const body =
        detail.ask.kind === "question" ? (
          <QuestionForm
            detail={detail}
            tab={tab}
            drafts={drafts}
            onTab={setTab}
            onDraft={(i, v) => setDrafts((list) => Object.assign([...list], { [i]: v }))}
            busy={busy}
            onSubmit={() => {
              const qs = detail.ask.questions ?? [];
              void answer({ kind: "question", answers: qs.map((_, i) => draftToAnswer(drafts[i] ?? null)) });
            }}
          />
        ) : detail.ask.kind === "plan" ? (
          <PlanForm
            detail={detail}
            backOnly={backOnly}
            choice={plan}
            feedback={feedback}
            onChoice={setPlan}
            onFeedback={setFeedback}
            busy={busy}
            onSubmit={() => void answer(backOnly || plan === "keep" ? { kind: "plan-feedback", text: feedback } : { kind: "plan-approve", mode: plan })}
          />
        ) : (
          <PermissionForm detail={detail} allow={allow} reason={reason} onAllow={setAllow} onReason={setReason} busy={busy} onSubmit={(ok) => void answer(ok ? { kind: "allow-once" } : { kind: "deny", text: reason })} />
        );
      panel = (
        <Panel lead={lead} ago={ago} also="Also open in the terminal">
          {body}
        </Panel>
      );
    } else if (kase === "sending") {
      const notTaken = detail.state === "not-taken";
      panel = (
        <Panel lead={lead} ago={ago} also={notTaken ? "Also open in the terminal" : ""}>
          <div className="ab">
            <Outcome cls="wait" icon={<span className="spin" role="img" aria-label="Sending" style={{ transform: `rotate(${(Math.floor(now / 1000) % 4) * 90}deg)` }} />} title={`Sending to ${s.name}.`}>
              Your answer, <Q>{summary}</Q>, goes out with the reporter's next check-in. It counts as answered once the session confirms it, usually within 2 seconds.
              {notTaken && <span className="nt">Claude Code didn't take this approval. Approve it in the terminal.</span>}
            </Outcome>
          </div>
          {foot("If the terminal answers first, that answer stands and this one is dropped.")}
        </Panel>
      );
    } else if (kase === "undelivered" && d) {
      const secs = Math.max(0, Math.round((now - s.lastSeenAt) / 1000));
      panel = (
        <Panel lead={lead} ago={ago} also={`Last check-in ${minSec(now - s.lastSeenAt)} ago`}>
          <div className="ab">
            <Outcome
              cls="bad"
              icon={ICONS.x}
              title="Not delivered yet."
              acts={
                <button className="btn" type="button" disabled={busy} onClick={() => void run(() => ctx.api.discard(d.id))}>
                  Discard my answer
                </button>
              }
            >
              {s.name} has not checked in for {secs} seconds, so your answer, <Q>{summary}</Q>, is waiting here. It is sent when the session reports again, unless it was answered in the terminal by then.
            </Outcome>
          </div>
          {foot("The session may be busy, asleep or closed. Its terminal can still answer.")}
        </Panel>
      );
    } else if (kase === "terminal" && detail.closed) {
      const c = detail.closed;
      const there =
        detail.ask.kind === "plan" ? (
          c.planApproved ? (
            "The plan was approved there."
          ) : (
            <>
              The answer there was <Q>No, keep planning</Q>.
            </>
          )
        ) : (
          <>
            The answer there was <Q>{detail.ask.kind === "permission" ? (c.answer === "denied" ? "Denied" : "Allowed") : (c.answer ?? "")}</Q>.
          </>
        );
      panel = (
        <Panel lead={lead} ago={ago} also="">
          <div className="ab">
            <Outcome cls="info" icon={ICONS.info} title={`Answered in the terminal at ${clockOf(c.at)}.`}>
              {there} Nothing from here was sent, and your draft was dropped.
            </Outcome>
          </div>
          {foot("The session has moved on.")}
        </Panel>
      );
    } else if (kase === "other" && d) {
      panel = (
        <Panel lead={lead} ago={ago} also="">
          <div className="ab">
            <Outcome cls="info" icon={ICONS.info} title={`${d.by} answered from Podium at ${clockOf(d.at)}.`}>
              Their answer was taken first: <Q>{summary}</Q>. Yours was not sent.
            </Outcome>
          </div>
          {foot(`Only the first answer to a ${what} is accepted.`)}
        </Panel>
      );
    } else if (kase === "closed" && detail.closed) {
      panel = (
        <Panel lead={lead} ago={ago} also="">
          <div className="ab">
            <Outcome cls="bad" icon={ICONS.x} title={`This ${what} was closed in the session before you answered.`}>
              It was closed without an answer at {clockOf(detail.closed.at)}, so Claude stopped waiting. Nothing was sent. Send a message below if you want to pick it up again.
            </Outcome>
          </div>
          {foot("The session is now waiting for a new message.")}
        </Panel>
      );
    }
  }

  // ---- the message box ----
  let compose: ReactNode = null;
  if (edge) compose = <OffNote edge={edge} reporterVersion={s.reporterVersion} />;
  else if (signedIn && mine)
    compose = (
      <Compose
        name={s.name}
        pending={formShowing ? (detail?.ask.kind ?? null) : null}
        draft={draft}
        onDraft={setDraft}
        confirmClear={confirmClear}
        onConfirmClear={setConfirmClear}
        onSend={(t) => void send(t)}
        error={error}
        busy={busy}
      />
    );

  // As the Activity modal this replaces (#118): the Admin's switch wins, and the empty text follows the feed's state.
  const adminOff = !props.adminFeedOn || feed.adminOff;
  const empty = !feed.live
    ? "This session is no longer live. Activity is kept only while someone watches a running session."
    : active
      ? "Watching from now. Earlier activity is not kept, and nothing is kept after you close this."
      : "The session has ended. Activity is kept only while someone watches it run.";
  const model = familyName(s.modelFamily, s.model);
  return (
    <Modal
      titleId="respondTitle"
      title="Activity"
      sub={`${s.name} · orchestrator · ${model}`}
      onClose={ctx.close}
      className="modal-feed modal-respond"
      onEscape={() => {
        if (!confirmClear) return false;
        setConfirmClear(false);
        return true;
      }}
      actions={active && !adminOff ? <EverySelect id="every-respond" every={every} onChange={(n) => (setEvery(n), writeEvery(n))} /> : undefined}
    >
      <div className="mb feedmb respondmb">
        {adminOff ? (
          <AdminOffNote />
        ) : (
          <>
            <FeedList feed={feed} startedAt={s.startedAt} empty={empty} />
            <FeedStatus count={count} when={when} />
          </>
        )}
        {panel}
        {compose ?? <div className="mpad" />}
      </div>
    </Modal>
  );
}

