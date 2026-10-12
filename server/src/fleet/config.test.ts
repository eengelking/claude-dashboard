import { describe, it, expect } from 'vitest';
import { configFromEnv } from './fleet.js';
import { shortenHome } from './derive.js';

const base = { home: '/home/node', dbPath: '/data/podium.sqlite' };

describe('configFromEnv home', () => {
  it('uses PODIUM_HOST_HOME over the server process home, so container paths shorten', () => {
    const cfg = configFromEnv({ PODIUM_HOST_HOME: '/Users/dev' }, base);
    expect(cfg.home).toBe('/Users/dev');
    expect(shortenHome('/Users/dev/dev/x', cfg.home)).toBe('~/dev/x');
  });

  it('keeps the process home when PODIUM_HOST_HOME is unset, empty or not an absolute path', () => {
    expect(configFromEnv({}, base).home).toBe('/home/node');
    expect(configFromEnv({ PODIUM_HOST_HOME: '' }, base).home).toBe('/home/node');
    expect(configFromEnv({ PODIUM_HOST_HOME: 'dev' }, base).home).toBe('/home/node');
    expect(configFromEnv({ PODIUM_HOST_HOME: '/' }, base).home).toBe('/home/node');
  });
});
