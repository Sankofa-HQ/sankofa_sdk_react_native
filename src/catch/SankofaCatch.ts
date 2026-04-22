import { Platform } from 'react-native';
import { getSharedApiKey, getSharedEndpoint } from '../index';
import type { SankofaModule } from '../core/ModuleRegistry';
import { registerModule } from '../core/ModuleRegistry';

import SankofaNativeModule from '../SankofaModule';
import { CatchBreadcrumbsAutocapture, CatchBreadcrumbsBuffer } from './CatchBreadcrumbs';
import { installGlobalHandlers, type InstalledHandlers } from './CatchHandlers';
import { errorToException } from './CatchStackParser';
import { CatchTransport } from './CatchTransport';
import type {
  Breadcrumb,
  CaptureOptions,
  CatchEvent,
  CatchHandshakeConfig,
  DeviceContext,
  Level,
  SankofaCatchAPI,
  UserContext,
} from './CatchTypes';
import { WireVersionCurrent } from './CatchTypes';

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

  // Handshake-driven.
  private enabled = true;
  private errorSampleRate = 1.0;

  constructor(options: SankofaCatchOptions = {}) {
    this.environment = options.environment ?? 'live';
    this.release = options.release;
    this.appVersion = options.appVersion;
    this.readFlagSnapshot = options.readFlagSnapshot;
    this.readConfigSnapshot = options.readConfigSnapshot;
    this.readIdentity = options.readIdentity;

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

  setTags(tags: Record<string, string>): void {
    this.tags = { ...this.tags, ...tags };
  }

  setExtra(key: string, value: unknown): void {
    this.extra[key] = value;
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
    options: CaptureOptions,
    mechanism: { mechanismType?: string; handled?: boolean } = {},
  ): string {
    if (!this.enabled || !this.transport) return '';
    if (!this.shouldSample()) return '';

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
      flag_snapshot: this.readFlagSnapshot?.(),
      config_snapshot: this.readConfigSnapshot?.(),
      trace_id: options.contexts?.trace?.trace_id,
      span_id: options.contexts?.trace?.span_id,
    };

    this.transport.push(event);
    return eventId;
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
