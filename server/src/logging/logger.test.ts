// The server's structured logger (#140): the line shape, level filtering and the text format.
import { describe, it, expect } from 'vitest';
import { createLogger, loggerFromLine, parseFormat, parseLevel, type Level } from './logger.js';

function capture(opts: Parameters<typeof createLogger>[0] = {}) {
  const lines: { line: string; level: Level }[] = [];
  const shipped: string[] = [];
  const logger = createLogger({
    service: 'podium',
    host: 'box-1',
    version: '9.9.9',
    now: () => Date.UTC(2026, 9, 14, 12, 0, 0, 123),
    write: (line, level) => lines.push({ line, level }),
    ship: (json) => shipped.push(json),
    ...opts,
  });
  return { logger, lines, shipped };
}

describe('the JSON format', () => {
  it('writes one flat JSON object per line with the contract fields', () => {
    const { logger, lines } = capture({ format: 'json' });
    logger.warn('report.rejected', 'podium: rejected report at $.v: unsupported protocol version', { reason: 'unsupported protocol version', path: '$.v', status: 400 });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.line).not.toContain('\n');
    expect(JSON.parse(lines[0]!.line)).toEqual({
      timestamp: '2026-10-14T12:00:00.123Z',
      level: 'warn',
      message: 'podium: rejected report at $.v: unsupported protocol version',
      event: 'report.rejected',
      service: 'podium',
      host: 'box-1',
      version: '9.9.9',
      reason: 'unsupported protocol version',
      path: '$.v',
      status: 400,
    });
  });

  it('keeps fields from overwriting the contract fields and drops nested values', () => {
    const { logger, lines } = capture({ format: 'json' });
    logger.info('x.y', 'hello', { level: 'error', service: 'evil', timestamp: 'never', nested: { a: 1 } as unknown as string, n: 3, gone: undefined });
    const rec = JSON.parse(lines[0]!.line);
    expect(rec.level).toBe('info');
    expect(rec.service).toBe('podium');
    expect(rec.timestamp).toBe('2026-10-14T12:00:00.123Z');
    expect(rec).not.toHaveProperty('nested');
    expect(rec).not.toHaveProperty('gone');
    expect(rec.n).toBe(3);
  });

  it('ships the JSON line whatever the local format', () => {
    const { logger, lines, shipped } = capture({ format: 'text' });
    logger.warn('report.rejected', 'podium: rejected report at $.v: bad', { path: '$.v' });
    expect(lines[0]!.line).toBe('podium: rejected report at $.v: bad');
    expect(JSON.parse(shipped[0]!)).toMatchObject({ event: 'report.rejected', path: '$.v', message: 'podium: rejected report at $.v: bad' });
  });

  it('can keep a line local, so the shipper can talk about itself without feeding its own buffer', () => {
    const { logger, lines, shipped } = capture();
    logger.log('warn', 'log.ship_dropped', 'dropping', {}, { ship: false });
    expect(lines).toHaveLength(1);
    expect(shipped).toHaveLength(0);
  });
});

describe('levels', () => {
  it('drops lines below the level, locally and for shipping', () => {
    const { logger, lines, shipped } = capture({ level: 'warn' });
    logger.debug('a', 'a');
    logger.info('b', 'b');
    logger.warn('c', 'c');
    logger.error('d', 'd');
    expect(lines.map((l) => l.line)).toEqual(['c', 'd']);
    expect(shipped).toHaveLength(2);
    expect(logger.isEnabled('info')).toBe(false);
    expect(logger.isEnabled('error')).toBe(true);
  });

  it('is info by default, so debug lines (one per request) are off', () => {
    const { logger, lines } = capture({ level: undefined });
    logger.debug('http.request', 'GET /');
    logger.info('server.start', 'up');
    expect(lines.map((l) => l.line)).toEqual(['up']);
  });

  it('parses the settings, falling back on junk', () => {
    expect(parseLevel('DEBUG')).toBe('debug');
    expect(parseLevel(' warn ')).toBe('warn');
    expect(parseLevel('loud')).toBeNull();
    expect(parseLevel(undefined)).toBeNull();
    expect(parseFormat('JSON')).toBe('json');
    expect(parseFormat('text')).toBe('text');
    expect(parseFormat('xml')).toBeNull();
  });
});

describe('the text format', () => {
  it('prints the message alone, as the server always has, and passes the level for the stream choice', () => {
    const { logger, lines } = capture();
    logger.warn('report.rejected', 'podium: rejected report at $.v: bad', { path: '$.v' });
    logger.info('server.start', 'Podium server listening on http://127.0.0.1:4317');
    expect(lines).toEqual([
      { line: 'podium: rejected report at $.v: bad', level: 'warn' },
      { line: 'Podium server listening on http://127.0.0.1:4317', level: 'info' },
    ]);
  });

  it('shows the events added in #140 only at debug, so the default output is what it was, but still ships them at their level', () => {
    for (const event of ['session.started', 'session.ended', 'session.deleted', 'reporter.connected', 'reporter.silent', 'sweep.removed', 'admin.unlock', 'admin.unlock_failed', 'auth.failed', 'report.conflict']) {
      const { logger, lines, shipped } = capture();
      logger.warn(event, `line for ${event}`);
      expect(lines, event).toEqual([]);
      expect(JSON.parse(shipped[0]!), event).toMatchObject({ event, level: 'warn' });
    }
    // The lines the server always printed stay at their level.
    for (const event of ['server.start', 'server.console', 'server.stop', 'report.rejected', 'hook.rejected', 'ingest.failed', 'request.failed', 'sweeper.failed']) {
      const { logger, lines } = capture();
      logger.info(event, `line for ${event}`);
      expect(lines.map((l) => l.line), event).toEqual([`line for ${event}`]);
    }
  });

  it('prints those events in text at debug, and in JSON at their own level', () => {
    const dbg = capture({ level: 'debug' });
    dbg.logger.info('session.started', 'podium: session s1 started');
    expect(dbg.lines).toEqual([{ line: 'podium: session s1 started', level: 'info' }]);
    const json = capture({ format: 'json' });
    json.logger.info('session.started', 'podium: session s1 started');
    expect(JSON.parse(json.lines[0]!.line)).toMatchObject({ event: 'session.started', level: 'info' });
  });

  it('adapts a plain log(line) function, for the routers\' existing option', () => {
    const got: string[] = [];
    const logger = loggerFromLine((l) => got.push(l));
    logger.warn('report.rejected', 'podium: rejected report at $.v: bad');
    logger.debug('http.request', 'GET /');
    expect(got).toEqual(['podium: rejected report at $.v: bad']);
  });
});
