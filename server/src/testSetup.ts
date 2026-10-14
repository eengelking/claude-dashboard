// Vitest setup (see vitest.config.ts). Not used at run time.
//
// supertest listens on the wildcard address and then connects to 127.0.0.1. On macOS a server bound
// to 127.0.0.1:P in another process wins those connections even though the wildcard bind of P also
// succeeds, so under load a test can be answered by someone else's server (404s, 401s, `{}`).
// Binding a bare `listen(0)` to loopback closes that gap: two binds to 127.0.0.1 cannot share a port.
//
// supertest reads `address().port` right after `listen(0)`, so the bind has to be synchronous. A
// public `listen(0, '127.0.0.1')` resolves the host first and is not, so this uses `_listen2`, the
// call `listen` itself ends in. If a future Node drops it, the plain listen is used and the
// wildcard behaviour (and the flake) comes back.
import net from 'node:net';

type Listen = (this: net.Server, ...args: unknown[]) => net.Server;
type Internal = net.Server & { _listen2?: (address: string, port: number, addressType: 4 | 6, backlog: number) => void };

const listen = net.Server.prototype.listen as unknown as Listen;

net.Server.prototype.listen = function (this: net.Server, ...args: unknown[]) {
  const server = this as Internal;
  if (args[0] === 0 && typeof args[1] !== 'string' && typeof server._listen2 === 'function' && !server.listening) {
    const cb = args.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) server.once('listening', cb);
    server._listen2('127.0.0.1', 0, 4, 511);
    return server;
  }
  return listen.apply(this, args);
} as typeof net.Server.prototype.listen;
