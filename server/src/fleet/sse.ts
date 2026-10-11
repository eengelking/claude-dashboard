// Server-Sent Events client registry and broadcast (SPEC 7.6). A client is anything with `write`;
// the route adapts an Express response. A write that throws removes that client and never
// propagates, so one broken socket cannot crash the process or stop the others.

export interface SseSink {
  write(chunk: string): unknown;
  end?(): void;
}

export type SseEventName = 'snapshot' | 'session' | 'activity' | 'removed' | 'tick';

export function formatSse(event: SseEventName, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export class SseHub {
  private readonly clients = new Map<number, SseSink>();
  private nextId = 1;

  constructor(readonly maxClients = 100) {}

  get size(): number {
    return this.clients.size;
  }

  /** True when `add` would refuse a new client. */
  get isFull(): boolean {
    return this.clients.size >= this.maxClients;
  }

  /** Registers a client and sends it `retry` plus the given first messages. Returns its id, or null when full or when the client was already gone. */
  add(sink: SseSink, first: string[] = []): number | null {
    if (this.clients.size >= this.maxClients) return null;
    const id = this.nextId++;
    this.clients.set(id, sink);
    this.writeTo(id, sink, 'retry: 2000\n\n' + first.join(''));
    return this.clients.has(id) ? id : null;
  }

  remove(id: number): void {
    this.clients.delete(id);
  }

  broadcast(event: SseEventName, data: unknown): void {
    if (this.clients.size === 0) return;
    const chunk = formatSse(event, data);
    for (const [id, sink] of this.clients) this.writeTo(id, sink, chunk);
  }

  /** Ends every client (server shutdown). */
  closeAll(): void {
    for (const [id, sink] of this.clients) {
      try {
        sink.end?.();
      } catch {
        // ignore: the socket is going away either way
      }
      this.clients.delete(id);
    }
  }

  private writeTo(id: number, sink: SseSink, chunk: string): void {
    try {
      sink.write(chunk);
    } catch {
      this.clients.delete(id);
    }
  }
}
