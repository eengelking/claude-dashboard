import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { ActivityFeed } from "./ActivityFeed";
import { EVERY_KEY, type ActivityReply, type FetchActivity } from "../useActivityFeed";
import { makeAgent, makeSession } from "../fixtures";
import type { SessionView } from "../types";

const T0 = 1_000_000;
const entry = (seq: number, over: Partial<ActivityReply["entries"][number]> = {}) => ({ seq, at: T0 + seq * 1000, kind: "tool" as const, text: `Read f${seq}`, ...over });
const reply = (entries: ActivityReply["entries"], over: Partial<ActivityReply> = {}): ActivityReply => ({ entries, since: T0, live: true, serverTime: T0, ...over });

/** A fetch that answers with each reply in turn, then keeps answering with the last one. */
function fetcher(...replies: ActivityReply[]) {
  const queue = [...replies];
  return vi.fn<FetchActivity>(async () => (queue.length > 1 ? queue.shift()! : queue[0] ?? reply([])));
}

function show(opts: { session?: Partial<SessionView>; active?: boolean; fetch?: ReturnType<typeof fetcher> } = {}) {
  const a = makeAgent({ id: "a1", startedAt: T0 });
  const s = makeSession({ reporterVersion: "0.13.0", activityFeed: true, agents: [a], ...opts.session });
  const fetchActivity = opts.fetch ?? fetcher(reply([]));
  const r = render(<ActivityFeed s={s} loop="a1" title="Map call sites · general-purpose" startedAt={T0} active={opts.active ?? true} now={T0} fetchActivity={fetchActivity} />);
  return { ...r, fetchActivity };
}

const flush = () => act(async () => {
  await vi.advanceTimersByTimeAsync(0);
});
const wait = (ms: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms);
});

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  try {
    window.localStorage.clear();
  } catch {
    // no storage in this environment
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setHidden(false);
  document.body.classList.remove("modal-open");
});

describe("Activity feed", () => {
  it("fetches when the panel opens and then every 5 s by default, for that session and loop", async () => {
    const { fetchActivity } = show();
    await flush();
    expect(fetchActivity).toHaveBeenCalledTimes(1);
    expect(fetchActivity).toHaveBeenLastCalledWith("s1", "a1", 5);
    await wait(4999);
    expect(fetchActivity).toHaveBeenCalledTimes(1);
    await wait(1);
    expect(fetchActivity).toHaveBeenCalledTimes(2);
  });

  it("uses the interval the viewer picks, and remembers it", async () => {
    const { fetchActivity } = show();
    await flush();
    fireEvent.change(screen.getByRole("combobox", { name: "Refresh interval" }), { target: { value: "20" } });
    await flush();
    expect(window.localStorage.getItem(EVERY_KEY)).toBe("20");
    const n = fetchActivity.mock.calls.length;
    await wait(19_999);
    expect(fetchActivity.mock.calls.length).toBe(n);
    await wait(1);
    expect(fetchActivity).toHaveBeenLastCalledWith("s1", "a1", 20);
    cleanup();
    const again = show();
    await flush();
    expect(again.fetchActivity).toHaveBeenLastCalledWith("s1", "a1", 20);
    expect(screen.getByRole("combobox", { name: "Refresh interval" })).toHaveValue("20");
  });

  it("stops fetching once the panel closes", async () => {
    const { fetchActivity, unmount } = show();
    await flush();
    unmount();
    await wait(60_000);
    expect(fetchActivity).toHaveBeenCalledTimes(1);
  });

  it("does not fetch while the tab is hidden, and fetches again when it is shown", async () => {
    const { fetchActivity } = show();
    await flush();
    act(() => setHidden(true));
    await wait(30_000);
    expect(fetchActivity).toHaveBeenCalledTimes(1);
    act(() => setHidden(false));
    await flush();
    expect(fetchActivity).toHaveBeenCalledTimes(2);
  });

  it("starts from now: entries already held when the viewer arrived are not shown, later ones are, newest last", async () => {
    show({ fetch: fetcher(reply([entry(1), entry(2)]), reply([entry(1), entry(2), entry(3), entry(4, { kind: "text", text: "Two failures." })])) });
    await flush();
    expect(screen.getByText(/Watching from now/)).toBeInTheDocument();
    expect(screen.queryByText("f1")).toBeNull();
    await wait(5000);
    const rows = screen.getByRole("list", { name: "Recent activity, newest last" }).querySelectorAll("li");
    expect([...rows].map((li) => li.textContent)).toEqual([expect.stringContaining("Read f3"), expect.stringContaining("Two failures.")]);
    expect(rows[0]!.querySelector(".name")!.textContent).toBe("Read");
    expect(screen.getByText("Last 2 of 2 since you started watching")).toBeInTheDocument();
  });

  it("marks redacted text", async () => {
    show({ fetch: fetcher(reply([]), reply([entry(1, { text: "Bash curl -H x-api-key: [redacted] http://x" })])) });
    await flush();
    await wait(5000);
    expect(document.querySelector(".feed .rd")!.textContent).toBe("[redacted]");
  });

  it("says how to turn the option on, and fetches nothing, when it is off", async () => {
    const { fetchActivity } = show({ session: { activityFeed: false } });
    await flush();
    expect(screen.getByText(/Recent tool calls and text appear here while the agent works/)).toBeInTheDocument();
    expect(screen.getByText(/activityFeed/)).toBeInTheDocument();
    expect(fetchActivity).not.toHaveBeenCalled();
  });

  it("tells a reporter older than 0.13.0 to update, and fetches nothing", async () => {
    const { fetchActivity } = show({ session: { reporterVersion: "0.12.0", activityFeed: null } });
    await flush();
    expect(screen.getByText(/podium-reporter 0.13.0 or later/)).toBeInTheDocument();
    expect(fetchActivity).not.toHaveBeenCalled();
  });

  it("shows nothing for a session reported by settings hooks", () => {
    show({ session: { reporter: "hooks", reporterVersion: null } });
    expect(screen.queryByText("Activity")).toBeNull();
  });

  it("for a finished agent fetches once, offers no interval, and says no more will come", async () => {
    const { fetchActivity } = show({ active: false });
    await flush();
    await wait(60_000);
    expect(fetchActivity).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("combobox", { name: "Refresh interval" })).toBeNull();
    expect(screen.getByText("Agent finished, no more updates")).toBeInTheDocument();
  });
});

describe("Activity modal", () => {
  it("opens over a blurred app and closes with Esc, returning focus to Expand", async () => {
    show({ fetch: fetcher(reply([]), reply([entry(1)])) });
    await flush();
    const expand = screen.getByRole("button", { name: "Expand" });
    expand.focus();
    fireEvent.click(expand);
    const d = screen.getByRole("dialog");
    expect(d).toHaveAttribute("aria-modal", "true");
    expect(d).toHaveAccessibleName("Activity");
    expect(document.body.classList.contains("modal-open")).toBe(true);
    expect(screen.getByRole("button", { name: "Close (Esc)" })).toHaveFocus();
    await wait(5000);
    expect(d.querySelectorAll(".feed li")).toHaveLength(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.classList.contains("modal-open")).toBe(false);
    expect(expand).toHaveFocus();
  });

  it("closes with the X and with a click on the dimmed area, not on the dialog", async () => {
    show();
    await flush();
    const open = () => fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    open();
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close (Esc)" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps fetching on one schedule while the modal is open", async () => {
    const { fetchActivity } = show();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    await wait(5000);
    expect(fetchActivity).toHaveBeenCalledTimes(2);
  });
});
