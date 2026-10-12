import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createRouter } from "./routes.js";

describe("routes", () => {
  it("GET /api/health returns ok", async () => {
    const app = express();
    app.use(createRouter());
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("answers an unknown /api path with a JSON 404, not the single-page app, so the removed usage routes read as gone", async () => {
    const app = express();
    app.use(createRouter());
    for (const url of ["/api/claude-code", "/api/api-usage", "/api/anything-else"]) {
      const res = await request(app).get(url);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Not found" });
    }
  });
});
