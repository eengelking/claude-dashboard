// Issue #137: supertest listens on the wildcard address and connects to 127.0.0.1. On macOS a server
// bound to 127.0.0.1:P in another process wins those connections even though the wildcard bind of P
// succeeds, so a test could be answered by someone else's server (404s, 401s, `{}`). testSetup.ts
// makes a bare `listen(0)` bind to loopback so that cannot happen.
import { describe, it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

function listening(server: http.Server, ...args: unknown[]): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    (server.listen as (...a: unknown[]) => void)(...args, () => resolve(server.address() as AddressInfo));
  });
}

describe('test servers bind to loopback only', () => {
  it('a bare listen(0), as supertest does, binds 127.0.0.1', async () => {
    const server = http.createServer();
    try {
      expect((await listening(server, 0)).address).toBe('127.0.0.1');
    } finally {
      server.close();
    }
  });

  it('an explicit host is left alone', async () => {
    const server = http.createServer();
    try {
      expect((await listening(server, 0, '0.0.0.0')).address).toBe('0.0.0.0');
    } finally {
      server.close();
    }
  });
});
