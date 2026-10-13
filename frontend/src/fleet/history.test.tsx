import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { HistoryView, localDay } from "./HistoryView";
import { makeAgent, makeSession } from "./fixtures";
import type { HistoryRow } from "./types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const row: HistoryRow = {
  id: "s1", name: "api-refactor", project: "~/dev/billing", model: "claude-opus-5-5", modelFamily: "opus",
  startedAt: 1_000_000, endedAt: 4_600_000, durationSec: 3600, costUsd: 12.84, blowouts: 2, agents: 3, endReason: "prompt_input_exit",
};

function server(rows: HistoryRow[], sessionOver: Parameters<typeof makeSession>[0] = {}) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    if (url.includes("/history?day=")) return new Response(JSON.stringify({ day: "x", sessions: rows }), { status: 200 });
    if (url.endsWith("/sessions/s1")) return new Response(JSON.stringify(makeSession({ ...sessionOver, status: "done", agents: [makeAgent({ id: "a1", description: "Map call sites", status: "done" })] })), { status: 200 });
    return new Response("{}", { status: 404 });
  }));
  return calls;
}

describe("history page", () => {
  it("lists a day's ended sessions with summary columns", async () => {
    const calls = server([row]);
    render(<HistoryView initialDay="2026-10-10" />);
    expect(await screen.findByRole("button", { name: "api-refactor" })).toBeInTheDocument();
    expect(calls[0]).toBe("/api/fleet/history?day=2026-10-10");
    const cells = [...document.querySelectorAll("tbody td")].map((td) => td.textContent);
    expect(cells).toEqual(["api-refactor", "~/dev/billing", "Opus 5.5", expect.any(String), "1h 00m", "$12.84", "2", "3", "prompt_input_exit"]);
    expect(screen.getByText("1 sessions ended")).toBeInTheDocument();
  });

  it("opens a read-only orchestrator page from stored rows, with agent detail, and goes back", async () => {
    server([row]);
    render(<HistoryView initialDay="2026-10-10" />);
    fireEvent.click(await screen.findByRole("button", { name: "api-refactor" }));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("api-refactor");
    fireEvent.click(document.querySelector('button.trow[data-agent="a1"]')!);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Map call sites");
    fireEvent.click(screen.getByRole("button", { name: /Back to 2026-10-10/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "api-refactor" })).toBeInTheDocument());
  });

  it("shows the orchestrator's steps, tools and skills on its page when the session reported them (#75)", async () => {
    server([row], { loop: { skills: ["code-review"], lastTool: "Edit", toolCalls: 5, toolCounts: { Edit: 3, Read: 2 }, steps: { done: 7, total: null } } });
    render(<HistoryView initialDay="2026-10-10" />);
    fireEvent.click(await screen.findByRole("button", { name: "api-refactor" }));
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(document.querySelector("button.trow.root")!);
    const side = document.querySelector(".side") as HTMLElement;
    expect(side.textContent).toContain("7 model requests");
    expect(side.textContent).toContain("Tools used (5 calls)");
    expect(side.textContent).toContain("code-review");
  });

  it("changes day, and says so when nothing ended", async () => {
    const calls = server([]);
    render(<HistoryView initialDay="2026-10-10" />);
    expect(await screen.findByText("No sessions ended on 2026-10-10.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2026-10-09" } });
    await waitFor(() => expect(calls).toContain("/api/fleet/history?day=2026-10-09"));
    expect(localDay(new Date(2026, 0, 5).getTime())).toBe("2026-01-05");
  });
});
