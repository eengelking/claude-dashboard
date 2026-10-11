import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { scanClaudeCodeUsage } from "./claudeCode.js";

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

async function writeSession(dir: string, project: string, file: string, lines: Array<object | string>) {
  const projectDir = path.join(dir, project);
  await mkdir(projectDir, { recursive: true });
  const content = lines
    .map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
    .join("\n");
  await writeFile(path.join(projectDir, file), content, "utf-8");
}

describe("scanClaudeCodeUsage", () => {
  it("aggregates tokens by day, model, and project, and computes rollups", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "podium-test-"));

    await writeSession(tmpDir, "-Users-eengelking-dev-app-a", "session1.jsonl", [
      {
        type: "assistant",
        timestamp: "2026-07-21T10:00:00.000Z",
        cwd: "/Users/eengelking/dev/app-a",
        message: {
          model: "claude-opus-4-8",
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 5,
          },
        },
      },
      {
        type: "assistant",
        timestamp: "2026-07-20T09:00:00.000Z",
        cwd: "/Users/eengelking/dev/app-a",
        message: {
          model: "claude-sonnet-5",
          usage: {
            input_tokens: 200,
            output_tokens: 20,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
      // malformed line should be skipped, not throw
      "not valid json {{{",
    ]);

    const now = new Date("2026-07-21T12:00:00.000Z");
    const result = await scanClaudeCodeUsage(tmpDir, now);

    expect(result.daily).toEqual([
      { date: "2026-07-20", inputTokens: 200, outputTokens: 20, cacheCreationTokens: 0, cacheReadTokens: 0 },
      { date: "2026-07-21", inputTokens: 100, outputTokens: 50, cacheCreationTokens: 10, cacheReadTokens: 5 },
    ]);

    expect(result.byModel).toEqual([
      { model: "claude-sonnet-5", inputTokens: 200, outputTokens: 20, cacheCreationTokens: 0, cacheReadTokens: 0 },
      { model: "claude-opus-4-8", inputTokens: 100, outputTokens: 50, cacheCreationTokens: 10, cacheReadTokens: 5 },
    ]);

    expect(result.byProject).toEqual([
      {
        project: "app-a",
        inputTokens: 300,
        outputTokens: 70,
        cacheCreationTokens: 10,
        cacheReadTokens: 5,
      },
    ]);

    expect(result.today).toEqual({ totalTokens: 165 }); // 100+50+10+5
    expect(result.week).toEqual({ totalTokens: 385 }); // both days, same week
    expect(result.month).toEqual({ totalTokens: 385 });
  });

  it("returns empty aggregates when the directory does not exist", async () => {
    const result = await scanClaudeCodeUsage("/nonexistent/path/for/test", new Date());
    expect(result.daily).toEqual([]);
    expect(result.byModel).toEqual([]);
    expect(result.byProject).toEqual([]);
    expect(result.today).toEqual({ totalTokens: 0 });
  });
});
