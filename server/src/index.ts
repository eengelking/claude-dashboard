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
import { REPORTER_SUPPORT } from "./fleet/compat.js";
import { createServerLogging } from "./logging/setup.js";
import { requestLog } from "./logging/requestLog.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 4317;
const HOST = process.env.HOST || "127.0.0.1";
const DB_PATH = process.env.PODIUM_DB || path.join(REPO_ROOT, "data", "podium.sqlite");
const TOKEN = process.env.PODIUM_TOKEN || null;

// Logging (#140): levels, a text or JSON format, and optional shipping to a central platform such as VictoriaLogs.
const logging = createServerLogging(process.env, { secrets: TOKEN ? [TOKEN] : [] });
const { logger } = logging;

const fleetDb = new FleetDb(openDb(DB_PATH));
const fleetConfig = configFromEnv(process.env, { home: os.homedir(), dbPath: DB_PATH });
const fleet = new Fleet(fleetDb, fleetConfig, Date.now, logger);
const people = new PeopleStore(fleetDb.db);
const stopSweeper = startSweeper(fleet, undefined, logger);

const app = express();
app.disable("x-powered-by");
app.use(requestLog(logger));
app.use("/api/fleet", createFleetRouter(fleet, { token: TOKEN, people, logger }));
app.use("/api/admin", createAdminRouter({ secret: TOKEN, people, wall: fleet.wall, prices: fleet.prices, features: fleet.features, logger }));
app.use(createRouter());

const frontendDist = path.join(REPO_ROOT, "frontend", "dist");
app.use(express.static(frontendDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

const server = app.listen(PORT, HOST, () => {
  // The settings an agent needs to read a deployment; never the token, a header value or a ship URL's password.
  const s = logging.settings;
  logger.info("server.start", `Podium server listening on http://${HOST}:${PORT}`, {
    bind: HOST,
    port: PORT,
    db_path: DB_PATH,
    auth: TOKEN !== null,
    node_version: process.version,
    reporter_min: REPORTER_SUPPORT.min,
    reporter_max: REPORTER_SUPPORT.max,
    log_level: s.level,
    log_format: s.format,
    log_shipping: s.shipping,
    log_ship_endpoint: s.shipEndpoint,
    log_ship_buffer: s.shipBuffer,
    stale_after_ms: fleetConfig.staleAfterMs,
    hook_stale_after_ms: fleetConfig.hookStaleAfterMs,
    drop_after_ms: fleetConfig.dropAfterMs,
    linger_ms: fleetConfig.lingerMs,
    detached_hide_after_ms: fleetConfig.detachedHideAfterMs,
    retain_samples_ms: fleetConfig.retention.samplesMs,
    retain_events_ms: fleetConfig.retention.eventsMs,
    retain_sessions_ms: fleetConfig.retention.sessionsMs,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  logger.info("server.console", `Podium fleet console: http://${HOST}:${PORT}/#/  (database ${DB_PATH})`, { url: `http://${HOST}:${PORT}/#/` });
});

let closing = false;
function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info("server.stop", `Received ${signal}, shutting down`, { signal });
  stopSweeper();
  fleet.close();
  server.close(() => {
    fleetDb.close();
    // The last lines (this shutdown among them) go out before the process does, for at most a second.
    void logging.close(1000).finally(() => process.exit(0));
  });
  // SSE sockets were ended above; anything still open after 2 s is cut.
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
