import { config as loadEnv } from "dotenv";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..");
loadEnv({ path: path.join(REPO_ROOT, ".env") });

import express from "express";
import { createRouter } from "./routes.js";
import { FleetDb, openDb } from "./fleet/db.js";
import { configFromEnv, Fleet } from "./fleet/fleet.js";
import { createFleetRouter } from "./fleet/routes.js";
import { createAdminRouter } from "./admin/adminRouter.js";
import { PeopleStore } from "./fleet/people.js";
import { startSweeper } from "./fleet/sweeper.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 4317;
const HOST = process.env.HOST || "127.0.0.1";
const DB_PATH = process.env.PODIUM_DB || path.join(REPO_ROOT, "data", "podium.sqlite");

const fleetDb = new FleetDb(openDb(DB_PATH));
const fleet = new Fleet(fleetDb, configFromEnv(process.env, { home: os.homedir(), dbPath: DB_PATH }));
const people = new PeopleStore(fleetDb.db);
const stopSweeper = startSweeper(fleet);

const app = express();
app.disable("x-powered-by");
app.use("/api/fleet", createFleetRouter(fleet, { token: process.env.PODIUM_TOKEN || null, people }));
app.use("/api/admin", createAdminRouter({ secret: process.env.PODIUM_TOKEN || null, people, wall: fleet.wall, prices: fleet.prices }));
app.use(createRouter());

const frontendDist = path.join(REPO_ROOT, "frontend", "dist");
app.use(express.static(frontendDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Podium server listening on http://${HOST}:${PORT}`);
  console.log(`Podium fleet console: http://${HOST}:${PORT}/#/  (database ${DB_PATH})`);
});

let closing = false;
function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.log(`Received ${signal}, shutting down`);
  stopSweeper();
  fleet.close();
  server.close(() => {
    fleetDb.close();
    process.exit(0);
  });
  // SSE sockets were ended above; anything still open after 2 s is cut.
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
