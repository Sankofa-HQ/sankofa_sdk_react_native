import type { Breadcrumb } from './CatchTypes';

/**
 * Ring buffer for breadcrumbs. Autocapture on RN is deliberately
 * narrower than Web:
 *
 *   - console.log/warn/error patch — captured.
 *   - global.fetch wrapper         — captured.
 *   - clicks / navigation          — NOT autocaptured (RN doesn't
 *                                    have DOM events; React Navigation
 *                                    is an optional dep). Users wire
 *                                    breadcrumbs manually via addBreadcrumb.
 *
 * This keeps the default integration zero-deps while leaving room
 * for host apps to plug in React Navigation or their own trackers
 * via explicit `addBreadcrumb()` calls.
 */
export class CatchBreadcrumbsBuffer {
  private entries: Breadcrumb[] = [];
  private capacity: number;

  constructor(capacity = 100) {
    this.capacity = Math.max(10, capacity);
  }

  setCapacity(n: number): void {
    this.capacity = Math.max(10, n);
    while (this.entries.length > this.capacity) this.entries.shift();
  }

  push(partial: Omit<Breadcrumb, 'ts_ms'> & { ts_ms?: number }): void {
    const entry: Breadcrumb = {
      ts_ms: partial.ts_ms ?? Date.now(),
      type: partial.type ?? 'default',
      category: partial.category,
      message: partial.message,
      level: partial.level,
      data: partial.data,
    };
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.shift();
  }

  snapshot(): Breadcrumb[] {
    return this.entries.map((b) => ({ ...b, data: b.data ? { ...b.data } : undefined }));
  }

  clear(): void {
    this.entries.length = 0;
  }
}

// ── Autocapture ─────────────────────────────────────────────────

export interface AutocaptureOpts {
  buffer: CatchBreadcrumbsBuffer;
  console?: boolean;
  fetch?: boolean;
  debug?: (msg: string, ...rest: unknown[]) => void;
}

export class CatchBreadcrumbsAutocapture {
  private uninstallers: Array<() => void> = [];
  private installed = false;
  private readonly opts: Required<AutocaptureOpts>;

  constructor(opts: AutocaptureOpts) {
    this.opts = {
      buffer: opts.buffer,
      console: opts.console ?? true,
      fetch: opts.fetch ?? true,
      debug: opts.debug ?? (() => {}),
    };
  }

  install(): void {
    if (this.installed) return;
    this.installed = true;
    if (this.opts.console) this.hookConsole();
    if (this.opts.fetch) this.hookFetch();
  }

  uninstall(): void {
    for (const u of this.uninstallers) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
    this.uninstallers = [];
    this.installed = false;
  }

  private hookConsole(): void {
    const levels: Array<['error' | 'warn' | 'info' | 'log', Breadcrumb['level']]> = [
      ['error', 'error'],
      ['warn', 'warning'],
      ['info', 'info'],
      ['log', 'info'],
    ];
    const originals: Partial<Record<string, (...args: unknown[]) => void>> = {};
    for (const [method, level] of levels) {
      const fn = (console as unknown as Record<string, (...args: unknown[]) => void>)[method];
      if (typeof fn !== 'function') continue;
      originals[method] = fn;
      (console as unknown as Record<string, (...args: unknown[]) => void>)[method] = (
        ...args: unknown[]
      ) => {
        try {
          this.opts.buffer.push({
            type: 'console',
            category: 'console',
            level,
            message: args.map(safeStringify).join(' ').slice(0, 2048),
          });
        } catch {
          /* ignore */
        }
        fn.apply(console, args);
      };
    }
    this.uninstallers.push(() => {
      for (const [method] of levels) {
        const orig = originals[method];
        if (orig) (console as unknown as Record<string, unknown>)[method] = orig;
      }
    });
  }

  private hookFetch(): void {
    const g = globalThis as unknown as { fetch?: typeof fetch };
    if (typeof g.fetch !== 'function') return;
    const original = g.fetch.bind(globalThis);
    const buf = this.opts.buffer;

    g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const startTs = Date.now();
      try {
        const res = await original(input as RequestInfo, init);
        buf.push({
          type: 'http',
          category: 'fetch',
          level: res.ok ? 'info' : res.status >= 500 ? 'error' : 'warning',
          message: `${method} ${url} → ${res.status}`,
          data: { method, url, status: res.status, duration_ms: Date.now() - startTs },
        });
        return res;
      } catch (err) {
        buf.push({
          type: 'http',
          category: 'fetch',
          level: 'error',
          message: `${method} ${url} failed`,
          data: { method, url, error: String((err as Error)?.message ?? err) },
        });
        throw err;
      }
    }) as typeof fetch;

    this.uninstallers.push(() => {
      g.fetch = original;
    });
  }
}

function safeStringify(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return v;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try {
    return JSON.stringify(v);
  } catch {
    return '[object]';
  }
}
