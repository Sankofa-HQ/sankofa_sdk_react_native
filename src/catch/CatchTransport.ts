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
    void this.persist();
    if (this.buffer.length >= this.batchSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch: CatchBatch = {
      wire_version: WireVersionCurrent,
      events: this.buffer.splice(0, this.buffer.length),
    };
    await this.persist();

    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify(batch),
      });
    } catch (err) {
      this.debug('catch flush failed — requeuing', err);
      this.buffer.unshift(...batch.events);
      await this.persist();
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
      const raw = await CatchStorage.getItem(QUEUE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.buffer = [...(parsed as CatchEvent[]), ...this.buffer];
          this.debug(`catch: recovered ${parsed.length} persisted events`);
        }
      }
    } catch {
      /* corrupted blob — drop it */
      await CatchStorage.removeItem(QUEUE_KEY);
    } finally {
      this.hydrated = true;
    }
  }

  private async persist(): Promise<void> {
    try {
      let serialised = JSON.stringify(this.buffer);
      while (serialised.length > this.maxStorageBytes && this.buffer.length > 1) {
        this.buffer.shift();
        serialised = JSON.stringify(this.buffer);
      }
      await CatchStorage.setItem(QUEUE_KEY, serialised);
    } catch {
      /* storage full / native unavailable — continue */
    }
  }
}
