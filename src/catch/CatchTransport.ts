import type { CatchBatch, CatchEvent } from './CatchTypes';
import { WireVersionCurrent } from './CatchTypes';
import { CatchStorage } from './CatchStorage';

/**
 * Batched event transport for RN. Mirrors the web transport's
 * batching + persistent-queue semantics but uses the RN native-bridge
 * key-value store (UserDefaults / SharedPreferences) instead of
 * localStorage. Offline buffers persist across cold-starts so a
 * crash before flush doesn't lose events.
 */

export interface CatchTransportOptions {
  endpoint: string;
  apiKey: string;
  batchSize?: number;
  flushIntervalMs?: number;
  maxStorageBytes?: number;
  debug?: (msg: string, ...rest: unknown[]) => void;
}

const QUEUE_KEY = 'queue';
/** Events handed to fetch() but not yet acked. Kept in a separate slot so a
 *  process kill mid-request recovers them on next launch instead of losing
 *  them (the buffer is cleared before the network call returns). */
const INFLIGHT_KEY = 'queue.inflight';
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5_000;
const DEFAULT_MAX_STORAGE_BYTES = 512 * 1024;

export class CatchTransport {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxStorageBytes: number;
  private readonly debug: (msg: string, ...rest: unknown[]) => void;

  private buffer: CatchEvent[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private hydrated = false;
  private flushing = false;
  /** Hard cap on in-memory buffer between persists, so a capture storm
   *  can't grow it without bound before the byte-cap eviction in persist(). */
  private readonly maxBufferEvents = 1000;

  constructor(opts: CatchTransportOptions) {
    this.endpoint = opts.endpoint;
    this.apiKey = opts.apiKey;
    this.batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushIntervalMs = opts.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxStorageBytes = opts.maxStorageBytes ?? DEFAULT_MAX_STORAGE_BYTES;
    this.debug = opts.debug ?? (() => {});

    void this.hydrate();

    if (typeof setInterval !== 'undefined') {
      this.intervalId = setInterval(() => void this.flush(), this.flushIntervalMs);
    }
  }

  push(event: CatchEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > this.maxBufferEvents) {
      const dropped = this.buffer.length - this.maxBufferEvents;
      this.buffer.splice(0, dropped);
      this.debug(`catch: buffer cap hit — dropped ${dropped} oldest events`);
    }
    // Before hydrate completes, the persisted backlog hasn't been merged
    // in yet — persisting now would clobber it. hydrate() persists the
    // merged buffer when it finishes. After that, persist eagerly so a
    // crash before flush keeps the event.
    if (this.hydrated) void this.persist();
    if (this.hydrated && this.buffer.length >= this.batchSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    // Never flush before recovery, and only one flush at a time (the
    // interval + a batchSize-triggered flush would otherwise both splice
    // overlapping windows and double-deliver on requeue).
    if (!this.hydrated || this.flushing) return;
    if (this.buffer.length === 0) return;
    this.flushing = true;
    const events = this.buffer.splice(0, this.buffer.length);
    const batch: CatchBatch = {
      wire_version: WireVersionCurrent,
      events,
    };
    try {
      // Park the batch in the in-flight slot so a kill mid-request
      // recovers it on next launch; shrink the persisted buffer too.
      await CatchStorage.setItem(INFLIGHT_KEY, JSON.stringify(events));
      await this.persist();

      let res: Response;
      try {
        res = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
          },
          body: JSON.stringify(batch),
        });
      } catch (err) {
        // Network failure — retry later.
        this.debug('catch flush failed (network) — requeuing', err);
        this.buffer.unshift(...events);
        await this.persist();
        await CatchStorage.removeItem(INFLIGHT_KEY);
        return;
      }

      if (res.ok) {
        await CatchStorage.removeItem(INFLIGHT_KEY);
      } else if (res.status === 408 || res.status === 429 || res.status >= 500) {
        // Transient — requeue and try again next cycle.
        this.debug(`catch flush HTTP ${res.status} — requeuing`);
        this.buffer.unshift(...events);
        await this.persist();
        await CatchStorage.removeItem(INFLIGHT_KEY);
      } else {
        // Permanent 4xx (malformed/rejected batch) — drop it with a log
        // rather than let a poison batch wedge the queue forever.
        this.debug(
          `catch flush HTTP ${res.status} — dropping ${events.length} rejected event(s)`,
        );
        await CatchStorage.removeItem(INFLIGHT_KEY);
      }
    } finally {
      this.flushing = false;
    }
  }

  shutdown(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // ── Persistence ─────────────────────────────────────────────────

  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    try {
      // Recover events that were mid-flight when the app died, plus the
      // persisted backlog. In-flight events were sent first, so they go
      // oldest; any events pushed during this async window stay last.
      const readArray = async (key: string): Promise<CatchEvent[]> => {
        const raw = await CatchStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as CatchEvent[]) : [];
      };
      const recovered = await readArray(INFLIGHT_KEY);
      if (recovered.length) await CatchStorage.removeItem(INFLIGHT_KEY);
      const persisted = await readArray(QUEUE_KEY);
      if (recovered.length || persisted.length) {
        this.buffer = [...recovered, ...persisted, ...this.buffer];
        this.debug(
          `catch: recovered ${recovered.length} in-flight + ${persisted.length} persisted events`,
        );
      }
    } catch {
      /* corrupted blob — drop it */
      await CatchStorage.removeItem(QUEUE_KEY);
      await CatchStorage.removeItem(INFLIGHT_KEY);
    } finally {
      this.hydrated = true;
      // Persist the merged buffer now that recovery is done (push() skipped
      // persisting pre-hydrate to avoid clobbering the backlog above).
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    try {
      let serialised = JSON.stringify(this.buffer);
      let evicted = 0;
      while (serialised.length > this.maxStorageBytes && this.buffer.length > 1) {
        this.buffer.shift();
        evicted++;
        serialised = JSON.stringify(this.buffer);
      }
      if (evicted > 0) {
        this.debug(
          `catch: storage cap (${this.maxStorageBytes}B) — evicted ${evicted} oldest event(s)`,
        );
      }
      await CatchStorage.setItem(QUEUE_KEY, serialised);
    } catch {
      /* storage full / native unavailable — continue */
    }
  }
}
