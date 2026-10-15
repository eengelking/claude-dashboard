import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { HistoryView, localDay } from "./HistoryView";
import { makeAgent, makeSession } from "./fixtures";
import type { HistoryRow } from "./types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "#/history");
});

const row: HistoryRow = {
  id: "s1", name: "api-refactor", project: "~/dev/billing", model: "claude-opus-5-5", modelFamily: "opus",
  startedAt: 1_000_000, endedAt: 4_600_000, durationSec: 3600, costUsd: 12.84, blowouts: 2, agents: 3, endReason: "prompt_input_exit", clearedFrom: null, clearedInto: null,
};

function server(rows: HistoryRow[], sessionOver: Parameters<typeof makeSession>[0] = {}, total = rows.length) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    if (url.includes("/history?day=")) {
      const q = new URL(url, "http://x").searchParams;
      return new Response(JSON.stringify({ day: q.get("day"), sessions: rows, total, page: Number(q.get("page")), pageSize: Number(q.get("pageSize")) }), { status: 200 });
    }
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
    expect(calls[0]).toBe("/api/fleet/history?day=2026-10-10&page=1&pageSize=50");
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
    await waitFor(() => expect(calls).toContain("/api/fleet/history?day=2026-10-09&page=1&pageSize=50"));
    expect(localDay(new Date(2026, 0, 5).getTime())).toBe("2026-01-05");
  });

  describe("paging (#195)", () => {
    it("counts the whole day in the header, not the rows on the page", async () => {
      server([row], {}, 120);
      render(<HistoryView initialDay="2026-10-10" />);
      expect(await screen.findByText("120 sessions ended")).toBeInTheDocument();
      expect(screen.getByText("Showing 1 to 50 of 120")).toBeInTheDocument();
      expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    });

    it("asks the server for the next page and keeps it in the address", async () => {
      const calls = server([row], {}, 120);
      render(<HistoryView initialDay="2026-10-10" />);
      fireEvent.click(await screen.findByRole("button", { name: "Next" }));
      await waitFor(() => expect(calls).toContain("/api/fleet/history?day=2026-10-10&page=2&pageSize=50"));
      expect(window.location.hash).toBe("#/history?day=2026-10-10&page=2&size=50");
      expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    });

    it("goes back to page 1 when the rows per page or the day changes", async () => {
      const calls = server([row], {}, 120);
      render(<HistoryView initialDay="2026-10-10" />);
      fireEvent.click(await screen.findByRole("button", { name: "Next" }));
      await screen.findByText("Page 2 of 3");
      fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "25" } });
      await waitFor(() => expect(calls).toContain("/api/fleet/history?day=2026-10-10&page=1&pageSize=25"));
      fireEvent.click(await screen.findByRole("button", { name: "Next" }));
      await screen.findByText("Page 2 of 5");
      fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2026-10-09" } });
      await waitFor(() => expect(calls).toContain("/api/fleet/history?day=2026-10-09&page=1&pageSize=25"));
    });

    it("starts from the page named in the address", async () => {
      window.history.replaceState(null, "", "#/history?day=2026-10-08&page=3&size=25");
      const calls = server([row], {}, 120);
      render(<HistoryView />);
      await screen.findByRole("button", { name: "api-refactor" });
      expect(calls[0]).toBe("/api/fleet/history?day=2026-10-08&page=3&pageSize=25");
    });

    it("returns to the same page when the browser goes back from an opened session", async () => {
      server([row], {}, 120);
      render(<HistoryView initialDay="2026-10-10" />);
      fireEvent.click(await screen.findByRole("button", { name: "Next" }));
      await screen.findByText("Page 2 of 3");
      fireEvent.click(screen.getByRole("button", { name: "api-refactor" }));
      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("api-refactor");
      expect(window.location.hash).toContain("open=s1");
      window.history.back();
      expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();
      expect(window.location.hash).not.toContain("open=");
    });

    it("shows no pager when nothing ended, and keeps the error message", async () => {
      server([]);
      render(<HistoryView initialDay="2026-10-10" />);
      expect(await screen.findByText("No sessions ended on 2026-10-10.")).toBeInTheDocument();
      expect(screen.queryByText(/Rows per page/)).toBeNull();
      cleanup();
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
      render(<HistoryView initialDay="2026-10-10" />);
      expect(await screen.findByText(/Cannot reach the Podium server/)).toBeInTheDocument();
    });
  });
});
