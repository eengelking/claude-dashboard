import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import App from "./App";
import type { ApiUsage, ClaudeCodeUsage } from "./api";

afterEach(() => {
  vi.restoreAllMocks();
});

function claudeCodeFixture(): ClaudeCodeUsage {
  return {
    logs: { available: true, dir: "/home/node/.claude/projects" },
    daily: [{ date: "2026-07-21", inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 }],
    byModel: [{ model: "claude-opus-4-8", inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 }],
    byProject: [{ project: "app-a", inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 }],
    today: { totalTokens: 1500 },
    week: { totalTokens: 5000 },
    month: { totalTokens: 20000 },
  };
}

function apiUsageFixture(): ApiUsage {
  return {
    configured: true,
    daily: [{ date: "2026-07-21", totalTokens: 800, costUsd: 3.5 }],
    byModel: [{ model: "claude-opus-4-8", totalTokens: 800, costUsd: 3.5 }],
    today: { totalTokens: 800, costUsd: 3.5 },
    week: { totalTokens: 2000, costUsd: 10 },
    month: { totalTokens: 8000, costUsd: 40 },
  };
}

describe("App", () => {
  it("renders the dashboard title and KPI tiles once data loads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const href = url.toString();
        if (href.includes("/api/claude-code")) {
          return new Response(JSON.stringify(claudeCodeFixture()), { status: 200 });
        }
        if (href.includes("/api/api-usage")) {
          return new Response(JSON.stringify(apiUsageFixture()), { status: 200 });
        }
        throw new Error(`Unexpected fetch: ${href}`);
      }),
    );

    render(<App />);

    expect(screen.getByText("Claude Usage Dashboard")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("1.5K")).toBeInTheDocument());
    expect(screen.getByText("$3.50")).toBeInTheDocument();
  });

  it("shows a not-configured hint for API spend when the admin key is unset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const href = url.toString();
        if (href.includes("/api/claude-code")) {
          return new Response(JSON.stringify(claudeCodeFixture()), { status: 200 });
        }
        if (href.includes("/api/api-usage")) {
          return new Response(
            JSON.stringify({
              configured: false,
              daily: [],
              byModel: [],
              today: { totalTokens: 0, costUsd: 0 },
              week: { totalTokens: 0, costUsd: 0 },
              month: { totalTokens: 0, costUsd: 0 },
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch: ${href}`);
      }),
    );

    render(<App />);

    await waitFor(() => expect(screen.getByText("Admin API key not configured")).toBeInTheDocument());
  });

  it("says the logs are not visible, and why, instead of showing zeros", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const href = url.toString();
        if (href.includes("/api/claude-code")) {
          return new Response(
            JSON.stringify({
              ...claudeCodeFixture(),
              logs: { available: false, dir: "/home/node/.claude/projects", reason: "Folder not found." },
              daily: [],
              byModel: [],
              byProject: [],
              today: { totalTokens: 0 },
              week: { totalTokens: 0 },
              month: { totalTokens: 0 },
            }),
            { status: 200 },
          );
        }
        if (href.includes("/api/api-usage")) {
          return new Response(JSON.stringify(apiUsageFixture()), { status: 200 });
        }
        throw new Error(`Unexpected fetch: ${href}`);
      }),
    );

    render(<App />);

    await waitFor(() => expect(screen.getByText(/can't see any Claude Code logs/i)).toBeInTheDocument());
    expect(screen.getByText(/Folder not found\./)).toBeInTheDocument();
    expect(screen.getByText(/PODIUMCTL_MOUNT_LOGS/)).toBeInTheDocument();
  });
});
