import { Router } from "express";

export function createRouter(): Router {
  const router = Router();

  router.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Anything else under /api is a real 404, not the single-page app that index.ts serves for other paths.
  router.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return router;
}
