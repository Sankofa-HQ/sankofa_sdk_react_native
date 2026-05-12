import { Platform } from 'react-native';
import { getSharedApiKey, getSharedEndpoint } from '../index';
import type { SankofaModule } from '../core/ModuleRegistry';
import { getModule, registerModule } from '../core/ModuleRegistry';
import { getCurrentScreen } from '../core/screenTracker';

import SankofaNativeModule from '../SankofaModule';
import { CatchBreadcrumbsAutocapture, CatchBreadcrumbsBuffer } from './CatchBreadcrumbs';
import { installGlobalHandlers, type InstalledHandlers } from './CatchHandlers';
import { errorToException } from './CatchStackParser';
import { CatchTransport } from './CatchTransport';
import type {
  BeforeSendFn,
  Breadcrumb,
  CaptureOptions,
  CatchEvent,
  CatchHandshakeConfig,
  DeviceContext,
  Level,
  SankofaCatchAPI,
  SankofaCatchScope,
  UserContext,
} from './CatchTypes';
import { WireVersionCurrent } from './CatchTypes';

/**
 * Internal scope implementation. Mutations layer onto the next
 * captured event inside the `withScope` closure that pushed this
 * scope onto the stack.
 */
class CatchScope implements SankofaCatchScope {
  tags: Record<string, string> = {};
  extra: Record<string, unknown> = {};
  user: UserContext | null = null;
  userTouched = false;
  level: Level | undefined;
  fingerprint: string[] | undefined;

  setTag(key: string, value: string): this {
    this.tags[key] = value;
    return this;
  }
  setTags(tags: Record<string, string>): this {
    this.tags = { ...this.tags, ...tags };
    return this;
  }
  setExtra(key: string, value: unknown): this {
    this.extra[key] = value;
    return this;
  }
  setUser(user: UserContext | null): this {
    this.user = user;
    this.userTouched = true;
    return this;
  }
  setLevel(level: Level): this {
    this.level = level;
    return this;
  }
  setFingerprint(fingerprint: string[]): this {
    this.fingerprint = fingerprint;
    return this;
  }

  /** Layer this scope on top of caller `options` (caller wins). */
  applyTo(options: CaptureOptions): CaptureOptions {
    return {
      level: options.level ?? this.level,
      tags: { ...this.tags, ...(options.tags ?? {}) },
      extra: { ...this.extra, ...(options.extra ?? {}) },
      // User: caller wins, then scope. `userTouched` distinguishes
      // "scope explicitly cleared user with setUser(null)" from
      // "scope never set user".
      user: options.user ?? (this.userTouched ? (this.user ?? undefined) : undefined),
      fingerprint: options.fingerprint ?? this.fingerprint,
      contexts: options.contexts,
    };
  }
}

/**
 * Sankofa Catch — error tracking for React Native. Construct once
 * after Sankofa.initialize():
 *
 *   Sankofa.initialize('sk_live_...');
 *   const catcher = new SankofaCatch({
 *     environment: 'live',
 *     readFlagSnapshot: () => getSwitchSnapshot(),
 *     readConfigSnapshot: () => getConfigSnapshot(),
 *   });
 *
 *   // anywhere:
 *   try { doThing(); } catch (e) { catcher.captureException(e); }
 *
 * The instance self-registers with the Traffic Cop. Uncaught JS
 * exceptions and unhandled promise rejections are captured
 * automatically via `ErrorUtils.setGlobalHandler` and the bundled
 * rejection-tracking polyfill.
 */
export interface SankofaCatchOptions {
  environment?: 'live' | 'test';
  release?: string;
  appVersion?: string;
  /** Attach uncaught exceptions via ErrorUtils.setGlobalHandler. Default true. */
  captureUnhandled?: boolean;
  /** Attach unhandled promise rejections. Default true. */
  captureRejections?: boolean;
  /** Hook console.* into breadcrumbs. Default true. */
  autocaptureConsole?: boolean;
  /** Wrap global.fetch for breadcrumb capture. Default true. */
  autocaptureFetch?: boolean;
  /** Optional reader for the current flag decisions — attached to every event. */
  readFlagSnapshot?: () => Record<string, string> | undefined;
  /** Optional reader for the current config values — attached to every event. */
  readConfigSnapshot?: () => Record<string, unknown> | undefined;
  /**
   * Synchronous hook called AFTER an event has been composed but
   * BEFORE the transport sends it. Return the (possibly modified)
   * event to ship it; return `null` to drop it entirely. Use for PII
   * scrubbing, noise filtering, or late tag enrichment.
   *
   * Throws are swallowed — a host hook can never block the capture
   * pipeline.
   */
  beforeSend?: BeforeSendFn;

  /**
   * Optional identity supplier called at capture time. Host apps
   * that track their own session/identity (e.g. Sankofa Analytics,
   * a custom auth layer) wire this to join Catch events with the
   * same session's replays + analytics events on the dashboard.
   *
   * Return shape:
   *   { distinctId?: string; anonymousId?: string; sessionId?: string }
   *
   * Any field may be undefined; the server tolerates missing ids.
   */
  readIdentity?: () => {
    distinctId?: string;
    anonymousId?: string;
    sessionId?: string;
  } | undefined;
}

export class SankofaCatch implements SankofaModule, SankofaCatchAPI {
  readonly name = 'catch' as const;

  /**
   * Singleton accessor for the active Catch instance.  Set the first
   * time `SankofaCatch` is constructed (typically during
   * `Sankofa.initialize({ enableCatch: true })`).  The static helpers
   * on the public `Sankofa` object — `Sankofa.captureException`,
   * `Sankofa.log`, etc. — read this so host code never needs to
   * thread a `getSankofaCatch()` getter through every screen.
   * Returns null when Catch was disabled at init or `initialize()`
   * hasn't run yet — the helpers all degrade to no-ops in that case.
   */
  private static _instance: SankofaCatch | null = null;
  static get instance(): SankofaCatch | null {
    return SankofaCatch._instance;
  }

  private transport: CatchTransport | null = null;
  private buffer = new CatchBreadcrumbsBuffer(100);
  private autocapture: CatchBreadcrumbsAutocapture;
  private installedHandlers: InstalledHandlers | null = null;

  private readonly environment: 'live' | 'test';
  private readonly release?: string;
  private readonly appVersion?: string;
  private readonly readFlagSnapshot?: () => Record<string, string> | undefined;
  private readonly readConfigSnapshot?: () => Record<string, unknown> | undefined;
  // Identity supplier — called at event-capture time so a mid-session
  // login / logout is reflected on subsequent errors.
  private readonly readIdentity?: () => {
    distinctId?: string;
    anonymousId?: string;
    sessionId?: string;
  } | undefined;

  // Sticky context — merged into every outgoing event.
  private user: UserContext | null = null;
  private tags: Record<string, string> = {};
  private extra: Record<string, unknown> = {};

  // Phase B — temporary scopes pushed by withScope(). The top scope
  // layers onto every capture inside the closure that pushed it.
  private readonly scopeStack: CatchScope[] = [];

  // Phase B — synchronous hook called before the transport sees the
  // event. Set via the constructor options.
  private readonly beforeSend?: BeforeSendFn;

  // Handshake-driven.
  private enabled = true;
  private errorSampleRate = 1.0;

  constructor(options: SankofaCatchOptions = {}) {
    // Static singleton lock-in.  First instance wins so multiple
    // accidental constructions (hot reload, nested test setup) don't
    // shadow each other.  Hosts that genuinely need a fresh instance
    // call [shutdown] first to clear it.
    if (!SankofaCatch._instance) {
      SankofaCatch._instance = this;
    }

    this.environment = options.environment ?? 'live';
    this.release = options.release;
    this.appVersion = options.appVersion;
    this.readFlagSnapshot = options.readFlagSnapshot;
    this.readConfigSnapshot = options.readConfigSnapshot;
    this.readIdentity = options.readIdentity;
    this.beforeSend = options.beforeSend;

    this.autocapture = new CatchBreadcrumbsAutocapture({
      buffer: this.buffer,
      console: options.autocaptureConsole ?? true,
      fetch: options.autocaptureFetch ?? true,
    });

    registerModule(this);

    const apiKey = getSharedApiKey();
    const endpoint = getSharedEndpoint();
    if (!apiKey || !endpoint) {
      // Construct anyway — handshake may still route decisions in
      // later when host calls Sankofa.initialize. Capture APIs will
      // no-op until transport is wired.
      return;
    }

    this.transport = new CatchTransport({
      endpoint: resolveCatchEndpoint(endpoint),
      apiKey,
    });

    this.autocapture.install();

    this.installedHandlers = installGlobalHandlers({
      captureRaw: (err, meta) => this.captureRaw(err, meta),
      captureUnhandled: options.captureUnhandled,
      captureRejections: options.captureRejections,
    });
  }

  // ── SankofaModule (Traffic Cop hook) ───────────────────────────

  async applyHandshake(config: unknown): Promise<void> {
    const cfg = config as CatchHandshakeConfig | undefined;
    if (!cfg) return;
    if (cfg.enabled === false) {
      this.enabled = false;
      return;
    }
    this.enabled = true;
    if (cfg.sampling?.error_sample_rate !== undefined) {
      this.errorSampleRate = clamp01(cfg.sampling.error_sample_rate);
    }
    if (cfg.breadcrumbs?.max_buffer !== undefined) {
      this.buffer.setCapacity(cfg.breadcrumbs.max_buffer);
    }
  }

  // ── Public API ──────────────────────────────────────────────────

  captureException(err: unknown, options: CaptureOptions = {}): string {
    return this.capture(err, 'unhandled_exception', options, { handled: true });
  }

  captureMessage(message: string, options: CaptureOptions = {}): string {
    return this.capture(message, 'console_error', options, { handled: true });
  }

  addBreadcrumb(crumb: Omit<Breadcrumb, 'ts_ms'> & { ts_ms?: number }): void {
    this.buffer.push(crumb);
  }

  setUser(user: UserContext | null): void {
    this.user = user;
  }

  setTag(key: string, value: string): void {
    this.tags = { ...this.tags, [key]: value };
  }

  setTags(tags: Record<string, string>): void {
    this.tags = { ...this.tags, ...tags };
  }

  setExtra(key: string, value: unknown): void {
    this.extra[key] = value;
  }

  /**
   * Run `fn` with a fresh scope. Mutations made via the scope
   * (tags, extras, user, level, fingerprint) overlay onto any
   * `captureException` / `captureMessage` calls inside `fn`. Outside
   * `fn` the scope is gone — async captures deferred past `fn`'s
   * return will NOT see the scope.
   */
  withScope<T>(fn: (scope: SankofaCatchScope) => T): T {
    const scope = new CatchScope();
    this.scopeStack.push(scope);
    try {
      return fn(scope);
    } finally {
      this.scopeStack.pop();
    }
  }

  /**
   * Crashlytics-style structured log.
   *
   * Adds an entry to the in-memory breadcrumb ring buffer that rides
   * on the next captured event — perfect for narrating user activity
   * ("entered checkout", "tapped pay") so when a crash fires the
   * dashboard shows the lead-up.  Does NOT emit a billable event on
   * its own; pair with [captureException] / [captureMessage] when you
   * want a standalone event.  Mirrors `FirebaseCrashlytics.log(msg)`
   * and `Sentry.addBreadcrumb({ category: 'log', ... })`.
   */
  log(message: string, category?: string): void {
    this.buffer.push({
      type: 'log',
      category: category ?? 'log',
      message,
      level: 'info',
    });
  }

  async flush(): Promise<void> {
    await this.transport?.flush();
  }

  // ── Internal: called by global handlers ─────────────────────────

  private captureRaw(
    err: unknown,
    meta: { type: string; mechanismType: string; handled: boolean },
  ): string {
    return this.capture(err, meta.type as CatchEvent['type'], {}, {
      mechanismType: meta.mechanismType,
      handled: meta.handled,
    });
  }

  // ── Event composition ──────────────────────────────────────────

  private capture(
    errOrMessage: unknown,
    type: CatchEvent['type'],
    optionsIn: CaptureOptions,
    mechanism: { mechanismType?: string; handled?: boolean } = {},
  ): string {
    if (!this.enabled || !this.transport) return '';
    if (!this.shouldSample()) return '';

    // Apply active withScope() overlay (if any). Layering order:
    //   global setUser/setTags/setExtra (read below)
    //   → top-of-stack scope (applyTo here)
    //   → caller-supplied options (already merged in by applyTo)
    const scope = this.scopeStack.length > 0
      ? this.scopeStack[this.scopeStack.length - 1]
      : null;
    const options: CaptureOptions = scope ? scope.applyTo(optionsIn) : optionsIn;

    const level: Level = options.level ?? (type === 'console_error' ? 'warning' : 'error');

    let exception: CatchEvent['exception'];
    let message: string | undefined;
    if (typeof errOrMessage === 'string') {
      message = errOrMessage;
    } else {
      exception = errorToException(errOrMessage, {
        type: mechanism.mechanismType ?? 'manual',
        handled: mechanism.handled ?? true,
      });
    }

    const eventId = randomId();
    // Pull identity at capture time (not init time) so a user that
    // logs in mid-session gets the correct distinct_id on subsequent
    // events. readIdentity is a user-supplied hook so the SDK stays
    // unopinionated about where identity comes from.
    const identity = (() => {
      try {
        return this.readIdentity?.() ?? {};
      } catch {
        return {};
      }
    })();

    const event: CatchEvent = {
      wire_version: WireVersionCurrent,
      event_id: eventId,
      ts_ms: Date.now(),
      environment: this.environment,

      level,
      type,

      exception,
      message,

      distinct_id: identity.distinctId,
      anon_id: identity.anonymousId,
      session_id: identity.sessionId,

      tags: { ...this.tags, ...(options.tags ?? {}) },
      extra: { ...this.extra, ...(options.extra ?? {}) },
      user: options.user ?? this.user ?? undefined,
      device: this.buildDeviceContext(),
      release: this.release,
      platform: 'react-native',
      sdk: {
        name: 'sankofa.react-native',
        version: 'rn-0.1.0',
      },

      breadcrumbs: this.buffer.snapshot(),
      fingerprint: options.fingerprint,
      screen: getCurrentScreen(),
      flag_snapshot: this.readFlagSnapshot?.() ?? this.autoFlagSnapshot(),
      config_snapshot: this.readConfigSnapshot?.() ?? this.autoConfigSnapshot(),
      trace_id: options.contexts?.trace?.trace_id,
      span_id: options.contexts?.trace?.span_id,
    };

    // beforeSend hook — host gets final say. A null return drops the
    // event; a thrown error is treated as "pass through unchanged"
    // because losing telemetry from a buggy hook is worse than the
    // hook misbehaving.
    let outgoing: CatchEvent | null = event;
    if (this.beforeSend) {
      try {
        outgoing = this.beforeSend(event);
      } catch (err) {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.warn('[Sankofa Catch] beforeSend threw — sending original event', err);
        }
        outgoing = event;
      }
    }
    if (!outgoing) return '';

    this.transport.push(outgoing);
    return outgoing.event_id;
  }

  private shouldSample(): boolean {
    if (this.errorSampleRate >= 1) return true;
    if (this.errorSampleRate <= 0) return false;
    return Math.random() < this.errorSampleRate;
  }

  private buildDeviceContext(): DeviceContext {
    return {
      os: Platform.OS,
      os_version: String(Platform.Version ?? ''),
      app_version: this.appVersion,
    };
  }

  /**
   * Auto-discover the active feature-flag decisions by introspecting
   * the registered `SankofaSwitch`.  Lets every captured event carry
   * the live flag state without the host wiring a closure by hand.
   * Returns undefined when no Switch module is registered or when
   * the snapshot would be empty.
   *
   * Typed structurally — we duck-type the methods we need (`getAllKeys`,
   * `getDecision`) so this file doesn't take a hard import on the
   * Switch module (which would couple the bundle even when Switch
   * isn't used).
   */
  private autoFlagSnapshot(): Record<string, string> | undefined {
    const mod = getModule('switch') as
      | undefined
      | {
          getAllKeys?: () => string[];
          getDecision?: (k: string) => {
            variant?: string;
            value?: unknown;
          } | null;
        };
    if (!mod || typeof mod.getAllKeys !== 'function' || typeof mod.getDecision !== 'function') {
      return undefined;
    }
    const out: Record<string, string> = {};
    for (const key of mod.getAllKeys()) {
      const dec = mod.getDecision(key);
      if (!dec) continue;
      const variant = dec.variant && dec.variant.length > 0 ? dec.variant : null;
      out[key] = variant ?? String(dec.value);
    }
    return Object.keys(out).length === 0 ? undefined : out;
  }

  /**
   * Same as [autoFlagSnapshot] but for the registered `SankofaConfig`
   * remote-config module.  Reads the active value for every key the
   * host passed into the Config defaults map.
   */
  private autoConfigSnapshot(): Record<string, unknown> | undefined {
    const mod = getModule('config') as
      | undefined
      | {
          getAllKeys?: () => string[];
          getDecision?: <V>(k: string) => { value?: V } | null;
        };
    if (!mod || typeof mod.getAllKeys !== 'function' || typeof mod.getDecision !== 'function') {
      return undefined;
    }
    const out: Record<string, unknown> = {};
    for (const key of mod.getAllKeys()) {
      const dec = mod.getDecision(key);
      if (!dec || dec.value === undefined) continue;
      out[key] = dec.value;
    }
    return Object.keys(out).length === 0 ? undefined : out;
  }

  /**
   * Teardown — called when the host app wants to stop Catch without
   * tearing down the whole Sankofa SDK. Uninstalls handlers, stops
   * the autocapture wrappers, and cancels the periodic flush timer.
   */
  shutdown(): void {
    this.installedHandlers?.uninstall();
    this.installedHandlers = null;
    this.autocapture.uninstall();
    this.transport?.shutdown();
    this.transport = null;
    // Clear the singleton only if THIS instance was the one registered
    // — guards against the "two-instance hot-reload" case where
    // shutting down a stale instance would otherwise null out the
    // active one.
    if (SankofaCatch._instance === this) {
      SankofaCatch._instance = null;
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function randomId(): string {
  // RN lacks crypto.randomUUID on Hermes; fall back to Date+Math.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 6)}`;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// Resolve the Catch ingest URL from the endpoint the core SDK knows.
// Mirrors the server-side route group.
function resolveCatchEndpoint(endpoint: string): string {
  const trimmed = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
  return `${trimmed}/api/catch/events`;
}

// Suppress unused-import warning on hosts that don't link the native
// bridge (ejected Expo dev clients). The module is still imported for
// its side-effects via SankofaCatchStorage.
void SankofaNativeModule;
