// Responding to a waiting session from Podium (#206, mockup/podium-respond.html): the button's rules, the modal's
// frames, the forms and the message box, against a fake respond API.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import { makeSession } from "./fixtures";
import { canAnswer, respondGate } from "./respond";
import { RespondProvider, useRespond } from "./useRespond";
import { RespondButton, RespondModal } from "./components/Respond";
import { TopBar } from "./components/TopBar";
import { ActivityFeed } from "./components/ActivityFeed";
import { RespondError, type RespondApi } from "./respondApi";
import type { Ask, AskDetail, AskSummary, RespondMe, SessionView } from "./types";

const T0 = 1_800_000_000_000;
const ME: RespondMe = { enabled: true, signedIn: true, name: "Ed", admin: false };
const ALL = ["question", "message", "plan-approve", "plan-feedback", "permission", "command"] as const;

const QUESTION: Ask = {
  id: "toolu_q",
  kind: "question",
  agentId: null,
  openedAt: T0,
  questions: [
    { question: "How many History rows per page?", header: "Page size", multiSelect: false, options: [{ label: "25/50/100, default 50 (Recommended)", description: "Same Pager as Admin.", preview: null }, { label: "Fixed 50, no choice", description: "Previous and Next.", preview: null }] },
    { question: "What should Back restore?", header: "Back state", multiSelect: true, options: [{ label: "The page number", description: "", preview: null }, { label: "The scroll position", description: "", preview: null }] },
  ],
};
const PLAN: Ask = { id: "toolu_p", kind: "plan", agentId: null, openedAt: T0, plan: { text: "# Paginate History\n\n1. Page it", filePath: "~/.claude/plans/wise.md" } };
const TOOL: Ask = { id: "toolu_t", kind: "permission", agentId: null, openedAt: T0, tool: { name: "Bash", input: { command: "git push -u origin issue/195", description: "Push the branch to GitHub" }, cut: false } };

const summary = (a: Ask, state: AskSummary["state"] = "open"): AskSummary => ({ id: a.id, kind: a.kind, agentId: null, openedAt: a.openedAt, count: a.questions?.length ?? 1, state });

function session(over: Partial<SessionView> = {}, ask: Ask | null = QUESTION, state: AskSummary["state"] = "open"): SessionView {
  return makeSession({
    id: "sess-ed",
    name: "claude-dashboard",
    status: "waiting",
    waitReason: "input",
    owner: "Ed",
    reporterVersion: "0.14.0",
    activityFeed: true,
    respond: { level: "everything", accepts: [...ALL], limits: [] },
    asks: ask ? [summary(ask, state)] : [],
    lastSeenAt: T0,
    ...over,
  });
}

const detailOf = (ask: Ask, over: Partial<AskDetail> = {}): AskDetail => ({ ask, state: "open", delivery: null, closed: null, lastSeenAt: T0, ...over });

function fakeApi(over: Partial<RespondApi> = {}, me: RespondMe = ME, detail: AskDetail = detailOf(QUESTION)) {
  return {
    me: vi.fn(async () => me),
    signIn: vi.fn(async () => ({ ok: true as const, name: "Ed", admin: false })),
    signOut: vi.fn(async () => ({ ok: true as const })),
    ask: vi.fn(async () => detail),
    answer: vi.fn(async () => ({ ok: true as const, deliveryId: "dlv_1" })),
    message: vi.fn(async () => ({ ok: true as const, deliveryId: "dlv_2", queued: false })),
    discard: vi.fn(async () => ({ ok: true as const })),
    ...over,
  } satisfies RespondApi;
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ entries: [], since: T0, live: true, enabled: true, serverTime: T0 }) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Opens the modal on a session, with the given API behind it. */
async function modal(s: SessionView, api: RespondApi, flagsOn = true) {
  function Opener() {
    const ctx = useRespond();
    return ctx?.openFor ? <RespondModal s={s} now={T0 + 42_000} adminFeedOn /> : <button onClick={() => ctx?.open(s.id)}>open</button>;
  }
  const r = render(
    <RespondProvider api={api} flagsOn={flagsOn}>
      <Opener />
    </RespondProvider>,
  );
  await flush();
  fireEvent.click(screen.getByText("open"));
  await flush();
  return r;
}

describe("the Respond button", () => {
  it("is live on a waiting card, with the number of questions, and gone with a switch off or an old reporter", () => {
    const s = session();
    expect(respondGate(s, ME, true)).toEqual({ show: "live", count: "2" });
    expect(respondGate(s, ME, false)).toEqual({ show: "none" });
    expect(respondGate(s, { ...ME, enabled: false }, true)).toEqual({ show: "none" });
    expect(respondGate(session({ respond: null }), ME, true)).toEqual({ show: "none" });
    expect(respondGate(session({ respond: { level: "off", accepts: [], limits: [] } }), ME, true)).toEqual({ show: "none" });
    expect(respondGate(session({ status: "running", waitReason: null }), ME, true)).toEqual({ show: "none" });
    expect(respondGate(session({ waitReason: null, background: { tasks: [{ type: "shell", description: "npm run dev", status: "running" }], wakeAt: null } }), ME, true)).toEqual({ show: "none" });
  });

  it("stays live signed out, and is dimmed with the owner's name on someone else's session", () => {
    const s = session({ owner: "Alex" });
    expect(respondGate(s, { ...ME, signedIn: false, name: null }, true)).toEqual({ show: "live", count: "2" });
    expect(respondGate(s, ME, true)).toEqual({ show: "dimmed", count: "2", owner: "Alex" });
    expect(respondGate(s, { ...ME, admin: true }, true)).toEqual({ show: "live", count: "2" });
    render(
      <RespondProvider api={fakeApi()} flagsOn>
        <RespondButton s={s} />
      </RespondProvider>,
    );
  });

  it("tells a switch that is off from a reporter that can't", () => {
    expect(canAnswer(session(), "question")).toBe("ok");
    expect(canAnswer(session({ respond: null }), "question")).toBe("old");
    // A current reporter with its respond option off is a switch that is off, not a reporter that can't.
    expect(canAnswer(session({ respond: { level: "off", accepts: [], limits: [] } }), "question")).toBe("off");
    expect(canAnswer(session({ respond: { level: "questions", accepts: ["question", "message"], limits: [] } }), "permission")).toBe("off");
    expect(canAnswer(session({ respond: { level: "everything", accepts: ["question", "message", "plan-feedback", "command"], limits: ["no-permission-hooks"] } }), "permission")).toBe("old");
    expect(canAnswer(session({ respond: { level: "everything", accepts: [], limits: ["not-interactive"] } }), null)).toBe("old");
  });

  it("draws the dimmed button with whose session it is", async () => {
    render(
      <RespondProvider api={fakeApi()} flagsOn>
        <RespondButton s={session({ owner: "Alex" })} />
      </RespondProvider>,
    );
    await flush();
    const b = screen.getByRole("button", { name: /Respond/ });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("title", "Only Alex, who owns this session, or an Admin can respond.");
    expect(screen.getByText("Alex's session")).toBeInTheDocument();
  });
});

describe("signing in", () => {
  it("shows the sign-in form in the panel while signed out, and no message box", async () => {
    await modal(session(), fakeApi({}, { enabled: true, signedIn: false, name: null, admin: false }));
    expect(screen.getByText("Sign in to respond")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Message to claude-dashboard" })).toBeNull();
  });

  it("says a wrong pair without saying which, keeps the name and clears the token", async () => {
    const api = fakeApi({ signIn: vi.fn(async () => Promise.reject(new RespondError(401, { error: "wrong name or token" }))) }, { enabled: true, signedIn: false, name: null, admin: false });
    await modal(session(), api);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ed" } });
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "pdm_x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("That name and token don't match. Check the userName and token options in podium-reporter.");
    expect(screen.getByLabelText("Name")).toHaveValue("Ed");
    expect(screen.getByLabelText("Token")).toHaveValue("");
  });

  it("locks the form after too many wrong tries", async () => {
    const api = fakeApi({ signIn: vi.fn(async () => Promise.reject(new RespondError(429, { error: "too many wrong tries" }))) }, { enabled: true, signedIn: false, name: null, admin: false });
    await modal(session(), api);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ed" } });
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Too many wrong tries from this address. Try again in 15 minutes.");
    expect(screen.getByLabelText("Token")).toBeDisabled();
  });

  it("puts Sign in, then Signed in as and Sign out, at the far end of the top bar", async () => {
    const api = fakeApi({}, { enabled: true, signedIn: false, name: null, admin: false });
    const r = render(
      <RespondProvider api={api} flagsOn>
        <TopBar phase="live" reporters={1} />
      </RespondProvider>,
    );
    await flush();
    const top = r.container.querySelector("header")!;
    expect(top.lastElementChild).toHaveTextContent("Sign in");
    expect(top.querySelector(".tb-sep")).not.toBeNull();
    fireEvent.click(within(top).getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("dialog", { name: "Sign in" })).toHaveTextContent("To answer and message your own sessions");
  });

  it("shows Signed in as and Sign out once signed in, and Sign out signs out", async () => {
    const api = fakeApi({ me: vi.fn().mockResolvedValueOnce(ME).mockResolvedValue({ ...ME, signedIn: false, name: null }) });
    const r = render(
      <RespondProvider api={api} flagsOn>
        <TopBar phase="live" reporters={1} />
      </RespondProvider>,
    );
    await flush();
    const top = r.container.querySelector("header")!;
    expect(top).toHaveTextContent("Signed in as Ed");
    fireEvent.click(within(top).getByRole("button", { name: "Sign out" }));
    await flush();
    expect(api.signOut).toHaveBeenCalled();
    expect(within(top).getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("says the server signed you out before asking again", async () => {
    const api = fakeApi(
      { me: vi.fn().mockResolvedValueOnce(ME).mockResolvedValue({ ...ME, signedIn: false, name: null }), answer: vi.fn(async () => { throw new RespondError(403, { ok: false, error: "sign in to respond" }); }) },
      ME,
      detailOf(TOOL),
    );
    await modal(session({ waitReason: "permission" }, TOOL), api);
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    await flush();
    await flush();
    expect(screen.getByText("You were signed out. A sign-in ends after 12 hours without use, when the server restarts, and when your token changes.")).toBeInTheDocument();
    expect(screen.getByText("Sign in to respond")).toBeInTheDocument();
  });
});

describe("a question", () => {
  it("shows the questions as tabs, marks the recommended option, and sends the answers by position", async () => {
    const api = fakeApi();
    await modal(session(), api);
    expect(screen.getByText("Waiting for your input.")).toBeInTheDocument();
    expect(screen.getByText("asked 0:42 ago")).toBeInTheDocument();
    expect(screen.getByText("Also open in the terminal")).toBeInTheDocument();
    expect(screen.getByText("How many History rows per page?")).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/^25\/50\/100, default 50/));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Pick any that apply.")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/The scroll position/));
    fireEvent.click(screen.getByLabelText(/The page number/));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Review your answers")).toBeInTheDocument();
    expect(screen.getByText("The page number, The scroll position")).toBeInTheDocument();
    expect(screen.getByText("Submitting sends both at once, as Claude Code does.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));
    await flush();
    expect(api.answer).toHaveBeenCalledWith("sess-ed", "toolu_q", { kind: "question", answers: [{ options: [0] }, { options: [0, 1] }] });
  });

  it("shows an option's preview beside the options", async () => {
    const withPreview: Ask = { ...QUESTION, questions: [{ ...QUESTION.questions![0]!, options: [{ label: "Keep it, page within the day (Recommended)", description: "Restart at page 1.", preview: "History  [Today]\n Page 1 of 3" }, { label: "One paged list", description: "", preview: "History\n Page 1 of 9" }] }] };
    await modal(session({}, withPreview), fakeApi({}, ME, detailOf(withPreview)));
    expect(screen.getByText("Preview: Keep it, page within the day")).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
  });

  it("marks a question left blank as skipped on Review, and takes a typed answer", async () => {
    const api = fakeApi();
    await modal(session(), api);
    fireEvent.change(screen.getByLabelText("Your own answer"), { target: { value: "50, and remember it" } });
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    expect(screen.getByText("Not answered. Claude sees it as skipped.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));
    await flush();
    expect(api.answer).toHaveBeenCalledWith("sess-ed", "toolu_q", { kind: "question", answers: [{ text: "50, and remember it" }, null] });
  });

  it("warns that a message closes the question, and sends it in place of an answer", async () => {
    const api = fakeApi();
    await modal(session(), api);
    const box = screen.getByRole("textbox", { name: "Message to claude-dashboard" });
    expect(box).toHaveAttribute("placeholder", "Chat about this instead of answering");
    fireEvent.change(box, { target: { value: "How busy is a busy day?" } });
    expect(screen.getByText('Sending this closes the question without an answer and gives Claude your message instead, like "Chat about this" in the terminal.')).toBeInTheDocument();
    fireEvent.keyDown(box, { key: "Enter" });
    await flush();
    expect(api.answer).toHaveBeenCalledWith("sess-ed", "toolu_q", { kind: "reply", text: "How busy is a busy day?" });
  });
});

describe("a plan and a tool", () => {
  it("approves a plan in a mode, or sends it back with feedback", async () => {
    const api = fakeApi({}, ME, detailOf(PLAN));
    await modal(session({ waitReason: "permission" }, PLAN), api);
    expect(screen.getByText("Waiting for your approval.")).toBeInTheDocument();
    expect(screen.getByText("Ready to code?")).toBeInTheDocument();
    expect(screen.getByText("~/.claude/plans/wise.md")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Paginate History" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Yes, manually approve edits/));
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    await flush();
    expect(api.answer).toHaveBeenLastCalledWith("sess-ed", "toolu_p", { kind: "plan-approve", mode: "default" });
    fireEvent.click(screen.getByLabelText(/No, keep planning/));
    fireEvent.change(screen.getByLabelText("Tell Claude what to change"), { target: { value: "Also cover search." } });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    await flush();
    expect(api.answer).toHaveBeenLastCalledWith("sess-ed", "toolu_p", { kind: "plan-feedback", text: "Also cover search." });
  });

  it("offers only No, keep planning where Claude Code can't take an approval", async () => {
    const api = fakeApi({}, ME, detailOf(PLAN));
    await modal(session({ waitReason: "permission", respond: { level: "everything", accepts: ["question", "message", "plan-feedback", "command"], limits: ["no-permission-hooks"] } }, PLAN), api);
    expect(screen.queryByLabelText(/Yes, and use auto mode/)).toBeNull();
    expect(screen.getByText(/This session can't take an approval from Podium/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    await flush();
    expect(api.answer).toHaveBeenCalledWith("sess-ed", "toolu_p", { kind: "plan-feedback", text: "" });
  });

  it("allows a tool once, or denies it with a reason", async () => {
    const api = fakeApi({}, ME, detailOf(TOOL));
    await modal(session({ waitReason: "permission" }, TOOL), api);
    expect(screen.getByText("Bash wants to run a command")).toBeInTheDocument();
    expect(screen.getByText("git push -u origin issue/195")).toBeInTheDocument();
    expect(screen.getByText("Push the branch to GitHub")).toBeInTheDocument();
    expect(screen.getByText('"Always allow" changes the session\'s rules, so it is only in the terminal.')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/^Deny/));
    fireEvent.change(screen.getByLabelText("Tell Claude why"), { target: { value: "Not yet. Run npm run build first." } });
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await flush();
    expect(api.answer).toHaveBeenCalledWith("sess-ed", "toolu_t", { kind: "deny", text: "Not yet. Run npm run build first." });
  });

  it("names a tool other than Bash, and says Allow once lets it run once", async () => {
    const write: Ask = { ...TOOL, tool: { name: "Write", input: { file_path: "/tmp/x.txt", content: "hi" }, cut: false } };
    await modal(session({ waitReason: "permission" }, write), fakeApi({}, ME, detailOf(write)));
    expect(screen.getByText("Write wants your permission")).toBeInTheDocument();
    expect(screen.getByText("Lets Write run this once. The next one asks again.")).toBeInTheDocument();
    expect(screen.queryByText("Runs this command now. The next one asks again.")).toBeNull();
  });

  it("offers only Deny, with a note, for a tool whose input was cut", async () => {
    const cut: Ask = { ...TOOL, tool: { ...TOOL.tool!, cut: true } };
    const api = fakeApi({}, ME, detailOf(cut));
    await modal(session({ waitReason: "permission" }, cut), api);
    expect(screen.queryByLabelText(/^Allow once/)).toBeNull();
    expect(screen.getByText("This command is too long to show in full here, so it can only be allowed in the terminal. You can still deny it from here.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Deny/)).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await flush();
    expect(api.answer).toHaveBeenCalledWith("sess-ed", "toolu_t", { kind: "deny", text: "" });
  });
});

describe("when Podium can't send the answer", () => {
  const mine = { id: "dlv_1", askId: "toolu_q", by: "Ed", at: T0, kind: "question" as const, answers: [{ options: [0] }, null], mine: true, handedOver: true, result: null };

  it("Sent, not confirmed yet", async () => {
    await modal(session({}, QUESTION, "pending"), fakeApi({}, ME, detailOf(QUESTION, { state: "pending", delivery: mine })));
    expect(screen.getByText("Sending to claude-dashboard.")).toBeInTheDocument();
    expect(screen.getByText(/goes out with the reporter's next check-in/)).toHaveTextContent("Your answer, 25/50/100, default 50, goes out");
    expect(screen.getByText("If the terminal answers first, that answer stands and this one is dropped.")).toBeInTheDocument();
  });

  it("Approval not taken", async () => {
    const d = { ...mine, askId: "toolu_p", kind: "plan-approve" as const, mode: "auto" as const, answers: undefined, result: "not-taken" as const };
    await modal(session({ waitReason: "permission" }, PLAN, "not-taken"), fakeApi({}, ME, detailOf(PLAN, { state: "not-taken", delivery: d })));
    expect(screen.getByText("Claude Code didn't take this approval. Approve it in the terminal.")).toBeInTheDocument();
    expect(screen.getByText("Also open in the terminal")).toBeInTheDocument();
  });

  it("Answered in the terminal, a plan approved there, and a tool allowed there", async () => {
    await modal(session({ status: "running", waitReason: null }, QUESTION, "closed"), fakeApi({}, ME, detailOf(QUESTION, { state: "closed", closed: { outcome: "terminal", at: T0, by: null, answer: "25/50/100; The page number", planApproved: false } })));
    expect(screen.getByText(/^Answered in the terminal at \d\d:\d\d\.$/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing from here was sent, and your draft was dropped\./)).toHaveTextContent("The answer there was 25/50/100; The page number.");
    cleanup();
    await modal(session({ status: "running", waitReason: null }, PLAN, "closed"), fakeApi({}, ME, detailOf(PLAN, { state: "closed", closed: { outcome: "terminal", at: T0, by: null, answer: null, planApproved: true } })));
    expect(screen.getByText(/The plan was approved there\./)).toBeInTheDocument();
    cleanup();
    await modal(session({ status: "running", waitReason: null }, TOOL, "closed"), fakeApi({}, ME, detailOf(TOOL, { state: "closed", closed: { outcome: "terminal", at: T0, by: null, answer: "allowed", planApproved: false } })));
    expect(screen.getByText(/Nothing from here was sent/)).toHaveTextContent("The answer there was Allowed.");
  });

  it("Answered by someone else", async () => {
    const theirs = { ...mine, by: "Alex", mine: false, answers: [{ options: [1] }, null] };
    await modal(session({}, QUESTION, "pending"), fakeApi({}, ME, detailOf(QUESTION, { state: "pending", delivery: theirs })));
    expect(screen.getByText(/^Alex answered from Podium at \d\d:\d\d\.$/)).toBeInTheDocument();
    expect(screen.getByText(/Their answer was taken first/)).toHaveTextContent("Their answer was taken first: Fixed 50, no choice. Yours was not sent.");
    expect(screen.getByText("Only the first answer to a question is accepted.")).toBeInTheDocument();
  });

  it("Closed in the session", async () => {
    await modal(session({ status: "running", waitReason: null }, QUESTION, "closed"), fakeApi({}, ME, detailOf(QUESTION, { state: "closed", closed: { outcome: "closed", at: T0, by: null, answer: null, planApproved: false } })));
    expect(screen.getByText("This question was closed in the session before you answered.")).toBeInTheDocument();
    expect(screen.getByText(/It was closed without an answer at \d\d:\d\d, so Claude stopped waiting\./)).toBeInTheDocument();
    expect(screen.getByText("The session is now waiting for a new message.")).toBeInTheDocument();
  });

  it("Session not checking in, with Discard my answer", async () => {
    const api = fakeApi({}, ME, detailOf(QUESTION, { state: "pending", delivery: { ...mine, handedOver: false } }));
    await modal(session({ status: "stale" }, QUESTION, "pending"), api);
    expect(screen.getByText("Not delivered yet.")).toBeInTheDocument();
    expect(screen.getByText("Last check-in 0:42 ago")).toBeInTheDocument();
    expect(screen.getByText(/has not checked in for 42 seconds/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard my answer" }));
    await flush();
    expect(api.discard).toHaveBeenCalledWith("dlv_1");
  });

  it("Turned off, and Reporter can't answer", async () => {
    await modal(session(), fakeApi(), false);
    expect(screen.getByText("Responding from Podium is turned off.")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for your input.")).toBeNull();
    cleanup();
    await modal(session({ respond: null, reporterVersion: "0.13.0" }), fakeApi());
    expect(screen.getByText("This session can't be answered from Podium.")).toBeInTheDocument();
    expect(screen.getByText(/It reports with podium-reporter 0.13.0/)).toBeInTheDocument();
  });

  it("says why a reporter can't answer, and only asks for an update when it is old", async () => {
    await modal(session({ respond: null, reporterVersion: null }), fakeApi());
    expect(screen.getByText(/It reports with an older podium-reporter\./)).toBeInTheDocument();
    cleanup();
    await modal(session({ reporter: "hooks", respond: null }), fakeApi());
    expect(screen.getByText("It reports through the settings hooks, which can't take an answer. Answer in the terminal or desktop app.")).toBeInTheDocument();
    expect(screen.queryByText(/claude plugin update/)).toBeNull();
    cleanup();
    await modal(session({ respond: { level: "everything", accepts: [], limits: ["not-interactive"] } }), fakeApi());
    expect(screen.getByText(/which can't take an answer from Podium\./)).toBeInTheDocument();
    expect(screen.queryByText(/claude plugin update/)).toBeNull();
    cleanup();
    const managed = { level: "everything" as const, accepts: ["question" as const, "message" as const, "plan-feedback" as const, "command" as const], limits: ["no-permission-hooks" as const] };
    await modal(session({ waitReason: "permission", respond: managed }, TOOL), fakeApi({}, ME, detailOf(TOOL)));
    expect(screen.getByText("This can't be answered from Podium.")).toBeInTheDocument();
    expect(screen.getByText("Claude Code doesn't run podium-reporter's permission hooks on this computer, which happens where an organization manages Claude Code. Answer it in the terminal. Questions and messages still work from here.")).toBeInTheDocument();
  });

  it("says in plain words why the server refused an answer", async () => {
    const api = fakeApi({ answer: vi.fn(async () => { throw new RespondError(422, { ok: false, error: "not accepted" }); }) }, ME, detailOf(TOOL));
    await modal(session({ waitReason: "permission" }, TOOL), api);
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    await flush();
    expect(screen.getByText("This session doesn't take that from Podium now. Answer it in the terminal.")).toBeInTheDocument();
    expect(screen.queryByText("not accepted")).toBeNull();
  });

  it("Someone else's session", async () => {
    await modal(session({ owner: "Alex" }), fakeApi());
    expect(screen.getByText("This is Alex's session.")).toBeInTheDocument();
    // In the panel's body, like every other outcome, so it keeps the panel's padding.
    expect(screen.getByText("This is Alex's session.").closest(".ab")).not.toBeNull();
    expect(screen.getByText("Only Alex, or an Admin, can respond to it from Podium. You can still watch its activity.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Message to claude-dashboard" })).toBeNull();
  });
});

describe("the orchestrator page", () => {
  it("Expand on the orchestrator's Activity panel opens the Respond modal", async () => {
    let openFor: string | null | undefined;
    function Probe() {
      openFor = useRespond()?.openFor;
      return null;
    }
    render(
      <RespondProvider api={fakeApi()} flagsOn>
        <ActivityFeed s={session()} loop="@orchestrator" title="Activity" startedAt={T0} active now={T0} isMain adminOn />
        <Probe />
      </RespondProvider>,
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Expand/ }));
    await flush();
    expect(openFor).toBe("sess-ed");
  });
});

describe("a closed ask (#208)", () => {
  it("does not lead the header with Waiting for…", async () => {
    const closed = { outcome: "terminal" as const, at: T0, by: null, answer: null, planApproved: false };
    await modal(session({ status: "running", waitReason: null }, QUESTION, "closed"), fakeApi(undefined, ME, detailOf(QUESTION, { state: "closed", closed })));
    expect(screen.queryByText(/Waiting for your/)).toBeNull();
    expect(screen.getByText("No longer waiting.")).toBeInTheDocument();
  });
});

describe("its turn ended", () => {
  it("sends a new message, and has no answer panel", async () => {
    const api = fakeApi();
    await modal(session({}, null), api);
    expect(screen.queryByText("Also open in the terminal")).toBeNull();
    const box = screen.getByRole("textbox", { name: "Message to claude-dashboard" });
    expect(box).toHaveAttribute("placeholder", "Message claude-dashboard, or type / for a command");
    fireEvent.change(box, { target: { value: "Start on issue #205." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await flush();
    expect(api.message).toHaveBeenCalledWith("sess-ed", { text: "Start on issue #205." });
  });

  it("lists the two commands, refuses any other, and confirms /clear first", async () => {
    const api = fakeApi();
    await modal(session({}, null), api);
    const box = screen.getByRole("textbox", { name: "Message to claude-dashboard" });
    fireEvent.change(box, { target: { value: "/c" } });
    const list = screen.getByRole("listbox", { name: "Commands" });
    expect(within(list).getByText("Start over with an empty conversation")).toBeInTheDocument();
    expect(within(list).getByText("Summarize the conversation to free context")).toBeInTheDocument();
    expect(within(list).getByText("Other commands run only in the terminal.")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "/model" } });
    expect(screen.getByText("/model runs only in the terminal. From here you can send /clear and /compact.")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "/clear" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByRole("alertdialog", { name: "Clear the conversation?" })).toHaveTextContent(
      "Clear the conversation? claude-dashboard starts over with an empty context. Podium shows the cleared part as its own session in History, linked to this one.",
    );
    expect(api.message).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear conversation" }));
    await flush();
    expect(api.message).toHaveBeenCalledWith("sess-ed", { command: "clear" });
  });

  it("says a command takes nothing after it, instead of doing nothing", async () => {
    const api = fakeApi();
    await modal(session({}, null), api);
    const box = screen.getByRole("textbox", { name: "Message to claude-dashboard" });
    fireEvent.change(box, { target: { value: "/compact focus on tests" } });
    expect(screen.getByText("/compact takes nothing after it from here. Send /compact on its own, or use the terminal.")).toBeInTheDocument();
    fireEvent.keyDown(box, { key: "Enter" });
    await flush();
    expect(api.message).not.toHaveBeenCalled();
  });
});
