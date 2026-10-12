import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createRouter } from "./routes.js";

vi.mock("./claudeCode.js", () => ({
  scanClaudeCodeUsage: vi.fn().mockResolvedValue({
    logs: { available: true, dir: "/x" },
    daily: [],
    byModel: [],
    byProject: [],
    today: { totalTokens: 0 },
    week: { totalTokens: 0 },
    month: { totalTokens: 0 },
  }),
}));

vi.mock("./adminApi.js", () => ({
  fetchApiUsage: vi.fn().mockResolvedValue({
    configured: false,
    daily: [],
    byModel: [],
    today: { totalTokens: 0, costUsd: 0 },
    week: { totalTokens: 0, costUsd: 0 },
    month: { totalTokens: 0, costUsd: 0 },
  }),
}));

describe("routes", () => {
  it("GET /api/health returns ok", async () => {
    const app = express();
    app.use(createRouter());
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /api/claude-code returns aggregated usage from the cache", async () => {
    const app = express();
    app.use(createRouter());
    const res = await request(app).get("/api/claude-code");
    expect(res.status).toBe(200);
    expect(res.body.daily).toEqual([]);
    expect(res.body.today).toEqual({ totalTokens: 0 });
  });

  it("GET /api/api-usage reports not-configured when no admin key is set", async () => {
    const app = express();
    app.use(createRouter());
    const res = await request(app).get("/api/api-usage");
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
  });
});
