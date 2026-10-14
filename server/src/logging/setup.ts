// Builds the server's logger and, when PODIUM_LOG_SHIP_URL is set, its shipper, from the environment (#140).
// A setting that cannot be used falls back to its default with one `log.config_invalid` warning, never a crash:
// a typo in a log setting should not keep the fleet console from starting.
import { serverVersion } from '../fleet/compat.js';
import { createLogger, parseFormat, parseLevel, type Level, type LogFormat, type Logger } from './logger.js';
import { displayUrl, LogShipper, parseShipHeaders, shipUrl } from './shipper.js';

export interface LoggingSettings {
  level: Level;
  format: LogFormat;
  shipping: boolean;
  /** The endpoint without credentials or query, for the startup line. */
  shipEndpoint: string | null;
  shipBuffer: number;
}

export interface ServerLogging {
  logger: Logger;
  shipper: LogShipper | null;
  settings: LoggingSettings;
  /** Sends what the shipper still holds, for at most `maxMs`. */
  close(maxMs?: number): Promise<void>;
}

export const DEFAULT_SHIP_BUFFER = 2000;
const MAX_SHIP_BUFFER = 100_000;

export function createServerLogging(
  env: NodeJS.ProcessEnv,
  over: { write?: (line: string, level: Level) => void; fetch?: typeof fetch; secrets?: readonly string[]; host?: string } = {},
): ServerLogging {
  const problems: { setting: string; message: string }[] = [];

  const level = parseLevel(env.PODIUM_LOG_LEVEL);
  if (env.PODIUM_LOG_LEVEL && !level) problems.push({ setting: 'PODIUM_LOG_LEVEL', message: 'PODIUM_LOG_LEVEL must be debug, info, warn or error; using info' });
  const format = parseFormat(env.PODIUM_LOG_FORMAT);
  if (env.PODIUM_LOG_FORMAT && !format) problems.push({ setting: 'PODIUM_LOG_FORMAT', message: 'PODIUM_LOG_FORMAT must be text or json; using text' });

  let shipBuffer = DEFAULT_SHIP_BUFFER;
  if (env.PODIUM_LOG_SHIP_BUFFER) {
    const n = Number(env.PODIUM_LOG_SHIP_BUFFER);
    if (Number.isInteger(n) && n >= 1 && n <= MAX_SHIP_BUFFER) shipBuffer = n;
    else problems.push({ setting: 'PODIUM_LOG_SHIP_BUFFER', message: `PODIUM_LOG_SHIP_BUFFER must be a whole number from 1 to ${MAX_SHIP_BUFFER}; using ${DEFAULT_SHIP_BUFFER}` });
  }

  const { headers, invalid } = parseShipHeaders(env.PODIUM_LOG_SHIP_HEADERS);
  if (invalid.length > 0) {
    problems.push({ setting: 'PODIUM_LOG_SHIP_HEADERS', message: `PODIUM_LOG_SHIP_HEADERS has ${invalid.length} pair(s) that are not Name=Value (${invalid.join(', ')}); they are skipped` });
  }

  let shipTo: string | null = null;
  const rawUrl = env.PODIUM_LOG_SHIP_URL?.trim();
  if (rawUrl) {
    try {
      shipTo = shipUrl(rawUrl);
    } catch {
      problems.push({ setting: 'PODIUM_LOG_SHIP_URL', message: 'PODIUM_LOG_SHIP_URL is not an http(s) URL; log shipping is off' });
    }
  }

  // The header values and any password in the URL are secrets too: never in a line, local or shipped.
  const secrets = [...(over.secrets ?? []), ...Object.values(headers), ...urlSecrets(rawUrl)];

  let shipper: LogShipper | null = null;
  const logger = createLogger({
    level: level ?? 'info',
    format: format ?? 'text',
    version: serverVersion(),
    host: over.host,
    write: over.write,
    secrets,
    ship: (json) => shipper?.push(json),
  });
  if (shipTo) {
    shipper = new LogShipper({
      url: shipTo,
      headers,
      maxBuffer: shipBuffer,
      fetch: over.fetch,
      notify: (event, message, fields) => logger.log('warn', event, message, fields, { ship: false }),
    });
  }
  for (const p of problems) logger.warn('log.config_invalid', `podium: ${p.message}`, { setting: p.setting });

  return {
    logger,
    shipper,
    settings: { level: level ?? 'info', format: format ?? 'text', shipping: shipper !== null, shipEndpoint: shipTo ? displayUrl(shipTo) : null, shipBuffer },
    close: async (maxMs = 1000) => {
      await shipper?.close(maxMs);
    },
  };
}

function urlSecrets(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const u = new URL(raw);
    return [u.password, decodeURIComponent(u.password)].filter(Boolean);
  } catch {
    return [];
  }
}
