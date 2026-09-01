import { Platform } from 'react-native';
import SankofaNativeModule from './SankofaModule';
import type { SankofaInitConfig, SankofaPersonTraits } from './SankofaTypes';
import { markCoreInitialized, routeHandshake, getInstalledModules } from './core/ModuleRegistry';
import { reportIntegrationStatuses } from './core/integrationReporter';
import type { ModuleIntegrationStatus as ModuleIntegrationStatusBase } from './core/integration';
import { setCurrentScreen } from './core/screenTracker';
import { bumpEvent } from './core/eventCounts';
import { startPresenceHeartbeat, stopPresenceHeartbeat } from './core/presenceHeartbeat';
import { emitScreenSeen } from './core/screenSeen';
import { SankofaCatch } from './catch/SankofaCatch';
import { SankofaDeploy as SankofaDeployClass } from './deploy/SankofaDeploy';
import { SankofaSwitch as SankofaSwitchClass } from './switch/SankofaSwitch';
import { SankofaConfig as SankofaConfigClass } from './config/SankofaConfig';
import { SankofaPulse as SankofaPulseClass } from './pulse';
import type {
  Breadcrumb,
  CaptureOptions,
  UserContext as CatchUserContext,
} from './catch/CatchTypes';

// SankofaInitConfig is the canonical name for the init options; the old
// `SankofaConfig` TYPE is now a deprecated alias kept inside
// ./SankofaTypes for back-compat. From this re-export path we only
// surface the new name so the `SankofaConfig` value (the remote-config
// class below) has the identifier to itself.
export type { SankofaInitConfig, SankofaPersonTraits } from './SankofaTypes';
export { useSankofaScreen } from './hooks/useSankofaScreen';
export { useSankofaNavigationTracking } from './hooks/useSankofaNavigationTracking';
export type { SankofaNavigationContainerRef } from './hooks/useSankofaNavigationTracking';

// Sankofa Deploy — OTA update module
export { SankofaDeploy } from './deploy/SankofaDeploy';
export type { DeployConfig, UpdateCheckResult, DeployStatus } from './deploy/DeployTypes';

// Sankofa Switch — feature flags + A/B variants
export { SankofaSwitch } from './switch/SankofaSwitch';
export type {
  FlagDecision,
  FlagReason,
  FlagChangeListener,
  SankofaSwitchAPI,
} from './switch/SwitchTypes';

// Sankofa Config — remote config with typed values
export { SankofaConfig } from './config/SankofaConfig';
export type {
  ItemDecision,
  ItemReason,
  ConfigType,
  ConfigChangeListener,
  SankofaConfigAPI,
} from './config/ConfigTypes';

// Sankofa Catch — error tracking + crash reporting
export { SankofaCatch } from './catch/SankofaCatch';
export type { SankofaCatchOptions } from './catch/SankofaCatch';
export type {
  CatchEvent,
  Breadcrumb,
  CaptureOptions,
  DebugImage,
  DebugMeta,
  Exception,
  EventType,
  Level,
  Mechanism,
  Platform as CatchPlatform,
  SankofaCatchAPI,
  StackFrame,
  StackTrace,
  UserContext as CatchUserContext,
  DeviceContext as CatchDeviceContext,
} from './catch/CatchTypes';

// Traffic Cop — module registry (public for advanced use / future modules)
export type { SankofaModule, SankofaModuleName } from './core/ModuleRegistry';
export { hasModule, getInstalledModules } from './core/ModuleRegistry';

// Module integration self-audit — surfaced so hosts can render their own
// "SDK integration incomplete" UI from `Sankofa.deploy.checkIntegration()`.
export type {
  ModuleIntegrationLevel,
  ModuleIntegrationStatus,
} from './core/integration';

// Sankofa Pulse — surveys (NPS, CSAT, custom). Renders an inline modal,
// resolves targeting + branching locally against the same DSL the
// server + web SDK use. Operators flip survey IDs from the dashboard;
// the host app calls `pulse.show(surveyId)`.
export { SankofaPulse, SurveyModal, SurveyModalHost, evaluateTargeting, resolveNext } from './pulse';
export type {
  Survey,
  SurveyKind,
  SurveyStatus,
  SurveyQuestion,
  QuestionKind,
  QuestionOption,
  QuestionValidation,
  TargetingRule,
  RuleKind,
  MatchOp,
  FrequencyScope,
  EligibilityContext,
  Decision,
  BranchingRule,
  BranchingActionKind,
  BranchingCondition,
  CondKind,
  CondOp,
  AnswerState,
  Outcome,
  SurveyBundle,
  SurveyTheme,
  SubmitPayload,
  PulseShowOptions,
  PulseEvent,
  PulseEventListener,
  PulseEventPayload,
  SurveyModalProps,
} from './pulse';

/**
 * Module configuration returned by the unified handshake.
 *
 * There are three canonical modules: analytics, deploy, catch. Replay
 * and heatmap are features that live UNDER analytics — new SDK code
 * should read `modules.analytics.replay` / `modules.analytics.heatmap`.
 *
 * `modules.replay` is preserved at the top level for backwards
 * compatibility with older builds that still read it directly; the
 * server mirrors the same payload to both locations.
 */
export interface ReplayFeatureConfig {
  enabled: boolean;
  sample_rate?: number;
  mask_all_inputs?: boolean;
  capture_network?: boolean;
  high_fidelity_triggers?: string[];
  high_fidelity_duration_seconds?: number;
}

export interface HandshakeModules {
  analytics?: {
    enabled: boolean;
    sampling_rate?: number;
    replay?: ReplayFeatureConfig;
    heatmap?: { enabled: boolean };
  };
  catch?: { enabled: boolean };
  deploy?: {
    enabled: boolean;
    has_update?: boolean;
    download_url?: string;
    label?: string;
    sha256?: string;
    size?: number;
    is_mandatory?: boolean;
    release_id?: string;
    reason?: string;
  };
  /** Sankofa Switch — full payload is passed to SankofaSwitch.applyHandshake. */
  switch?: {
    enabled: boolean;
    flags?: Record<string, unknown>;
    etag?: string;
    reason?: string;
    error?: string;
  };
  /** Sankofa Config — full payload is passed to SankofaConfig.applyHandshake. */
  config?: {
    enabled: boolean;
    values?: Record<string, unknown>;
    etag?: string;
    reason?: string;
    error?: string;
  };
  /** @deprecated Read from `modules.analytics.replay` instead. Kept for back-compat. */
  replay?: ReplayFeatureConfig;
}

/** Shared config set by Sankofa.initialize(). Readable by SankofaDeploy. */
let _sharedApiKey: string = '';
let _sharedEndpoint: string = 'https://api.sankofa.dev';

/** Returns the API key from the last Sankofa.initialize() call. */
export function getSharedApiKey(): string { return _sharedApiKey; }
/** Returns the endpoint from the last Sankofa.initialize() call. */
export function getSharedEndpoint(): string { return _sharedEndpoint; }

/** Cached handshake response. Readable by SankofaDeploy and other modules. */
let _handshakeModules: HandshakeModules | null = null;
let _handshakePromise: Promise<HandshakeModules | null> | null = null;

/**
 * Composite ETag from the last successful handshake. Sent as
 * If-None-Match on the next refresh so the server can respond with
 * 304 when nothing has changed. Server computes this by hashing the
 * union of per-module etags (see server/engine/ee/deploy/handshake.go).
 */
let _handshakeEtag = '';
export function getHandshakeEtag(): string {
  return _handshakeEtag;
}

/** Debug flag captured from the last initialize(), so runHandshake()
 *  (which can be re-invoked on identity change) can log consistently. */
let _handshakeDebug = false;

/**
 * Module singletons constructed by `Sankofa.initialize()` when the
 * corresponding `enableX` flag is true. Exposed via `Sankofa.deploy`,
 * `Sankofa.flags`, `Sankofa.config`, `Sankofa.pulse`. Catch follows the
 * same shape via `Sankofa.errors` (delegates to `SankofaCatch.instance`).
 *
 * Legacy `new SankofaDeploy(...)` / `new SankofaSwitch(...)` etc still
 * work — they're independent of these refs and exist for backward
 * compatibility.
 */
let _deployModule: SankofaDeployClass | null = null;
let _switchModule: SankofaSwitchClass | null = null;
let _configModule: SankofaConfigClass | null = null;
let _pulseModule: SankofaPulseClass | null = null;

/**
 * Last Deploy integration audit result, cached for the reverse handshake
 * + host UIs that want to render their own "SDK integration incomplete"
 * banner. Populated asynchronously by `Sankofa.initialize()` after the
 * native bridge has had a moment to invoke the bundle provider.
 *
 * Read via `Sankofa.lastDeployIntegrationStatus`.
 */
import type { ModuleIntegrationStatus as _DeployIntegrationStatus } from './core/integration';
let _lastDeployIntegrationStatus: _DeployIntegrationStatus | null = null;
export function getLastDeployIntegrationStatus(): _DeployIntegrationStatus | null {
  return _lastDeployIntegrationStatus;
}

/**
 * Returns the cached handshake modules. If the handshake hasn't
 * completed yet, returns null. Use `waitForHandshake()` to await.
 */
export function getHandshakeModules(): HandshakeModules | null {
  return _handshakeModules;
}

/**
 * Awaits the handshake completion. Returns null if the handshake
 * failed or hasn't been initiated (call Sankofa.initialize first).
 */
export function waitForHandshake(): Promise<HandshakeModules | null> {
  return _handshakePromise ?? Promise.resolve(null);
}

/**
 * Perform the unified handshake and route module flags to their handlers.
 * Extracted so it can be re-run on identity change (identify/reset) — see
 * `refreshHandshakeForIdentity`. Reads shared apiKey/endpoint live so a
 * post-init key change is respected. Returns the routed modules (or null).
 */
function runHandshake(): Promise<HandshakeModules | null> {
  return (async () => {
    try {
      // Defer to the next tick so modules constructed on the same
      // synchronous pass land in the registry before we send the
      // reverse handshake.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      const apiKey = getSharedApiKey();
      const endpoint = getSharedEndpoint();
      const installed = getInstalledModules().join(',');
      const params = new URLSearchParams({
        installed,
        sdk: 'react-native',
        platform: Platform.OS,
        os_version: String(Platform.Version ?? ''),
      });
      let resolvedDistinctId = '';
      try {
        const maybeGetId = (SankofaNativeModule as any).getDistinctId;
        if (typeof maybeGetId === 'function') {
          const id = await maybeGetId();
          if (id) {
            resolvedDistinctId = String(id);
            params.set('distinct_id', resolvedDistinctId);
          }
        }
      } catch {
        // Native module error — ignore, fall through.
      }
      try {
        const maybeGetAnon = (SankofaNativeModule as any).getAnonymousId;
        if (typeof maybeGetAnon === 'function') {
          const anonId = await maybeGetAnon();
          if (anonId && String(anonId) !== resolvedDistinctId) {
            params.set('anon_id', String(anonId));
          }
        }
      } catch {
        // Older bridge builds don't expose getAnonymousId; skipping is fine.
      }
      const url = `${endpoint.replace(/\/$/, '')}/api/v1/handshake?${params}`;

      const headers: Record<string, string> = { 'x-api-key': apiKey };
      if (_handshakeEtag) headers['If-None-Match'] = _handshakeEtag;

      const res = await fetch(url, { headers });

      if (res.status === 304 && _handshakeModules) {
        if (_handshakeDebug) {
          console.log('[Sankofa] Handshake 304 — cached modules still current');
        }
        await routeHandshake(_handshakeModules);
        return _handshakeModules;
      }

      if (!res.ok) return null;
      const data = await res.json();
      _handshakeModules = (data.modules as HandshakeModules) ?? null;
      _handshakeEtag = res.headers.get('etag') ?? res.headers.get('ETag') ?? '';

      if (_handshakeDebug) {
        const mods = _handshakeModules;
        console.log(
          `[Sankofa] Handshake OK — analytics:${mods?.analytics?.enabled} replay:${mods?.replay?.enabled} deploy:${mods?.deploy?.enabled} catch:${mods?.catch?.enabled} switch:${mods?.switch?.enabled} config:${mods?.config?.enabled} (installed: ${installed})`,
        );
      }

      await routeHandshake(_handshakeModules);
      return _handshakeModules;
    } catch (err) {
      if (_handshakeDebug) {
        console.warn('[Sankofa] Handshake failed:', err);
      }
      return null;
    }
  })();
}

/**
 * Re-run the handshake for a changed identity (identify/reset). Clears the
 * cached etag + modules first so the server can't reply 304 with the
 * PRIOR user's flag/config payload (which routeHandshake would otherwise
 * apply to the new identity). Fire-and-forget — updates modules in place.
 */
function refreshHandshakeForIdentity(): void {
  _handshakeEtag = '';
  _handshakeModules = null;
  _handshakePromise = runHandshake();
}

/**
 * # Sankofa React Native SDK
 *
 * The primary entry point for all analytics operations.
 * Bridges to the native iOS (SankofaIOS) and Android (Sankofa) SDKs.
 *
 * ## Quick Start
 * ```tsx
 * // In your root _layout.tsx or App.tsx:
 * import { Sankofa } from 'sankofa-react-native';
 *
 * Sankofa.initialize('YOUR_API_KEY', {
 *   endpoint: 'https://api.sankofa.dev',
 *   recordSessions: true,
 * });
 *
 * // In any screen:
 * import { useSankofaScreen, Sankofa } from 'sankofa-react-native';
 *
 * const HomeScreen = () => {
 *   useSankofaScreen('Home');
 *   return <Button onPress={() => Sankofa.track('cta_clicked')} title="Go" />;
 * };
 * ```
 */
export const Sankofa = {
  /**
   * Initialize the SDK. Call once at app startup, before any other method.
   *
   * Triggers the unified handshake in the background — one HTTP call
   * that fetches the config for ALL Sankofa products (Analytics, Deploy,
   * Catch, Replay). The native SDKs (Android/iOS) also call the
   * handshake independently on their side for native-layer config
   * (session replay, heatmap capture). This JS-layer call is for the
   * Deploy module and any future JS-side features.
   *
   * @param apiKey - Your Sankofa project API key.
   * @param config - Optional configuration overrides.
   */
  initialize(apiKey: string, config: SankofaInitConfig = {}): void {
    const endpoint = config.endpoint ?? 'https://api.sankofa.dev';

    // Store for SankofaDeploy and other modules to read
    _sharedApiKey = apiKey;
    _sharedEndpoint = endpoint;

    // Mark core as initialized so modules instantiated AFTER this point
    // can register without emitting the "created before initialize()" warning.
    markCoreInitialized();

    // Live-presence heartbeat — independent of analytics flush so it
    // ticks at its own cadence (15s) while the app is foregrounded.
    // Cheap one-tiny-POST-per-tick; paused on background.
    startPresenceHeartbeat(endpoint, apiKey);

    // Phase A: Catch is rolled up into the parent SDK.  Defaults match
    // the "Crashlytics on by default" expectation — hosts that want it
    // OFF (custom transport, billing-tier downgrade) pass
    // `enableCatch: false`.  The native bridge auto-starts its own
    // native SankofaCatch when this is true so iOS NSException +
    // POSIX-signal crashes and Android JVM + ANR crashes flow into
    // the same dashboard stream as JS errors.
    const enableCatch = config.enableCatch ?? true;
    const catchEnvironment = config.catchEnvironment ?? 'live';

    // 1. Initialize native layer (sync — bridges to Swift/Kotlin).
    SankofaNativeModule.initialize(apiKey, {
      endpoint,
      debug: config.debug ?? false,
      trackLifecycleEvents: config.trackLifecycleEvents ?? true,
      recordSessions: config.recordSessions ?? true,
      maskAllInputs: config.maskAllInputs ?? true,
      flushIntervalSeconds: config.flushIntervalSeconds ?? 30,
      batchSize: config.batchSize ?? 50,
      enableCatch,
      catchEnvironment,
      catchRelease: config.release,
      catchAppVersion: config.appVersion,
    });

    // 2. Auto-construct the JS-side SankofaCatch singleton for JS
    //    error capture (ErrorUtils + unhandled rejections).  The
    //    native side handles native crashes independently — together
    //    they cover the full Crashlytics surface area.  Idempotent —
    //    if a host manually constructed one BEFORE initialize (legacy
    //    boilerplate path) the singleton lock-in inside SankofaCatch
    //    keeps that instance and we skip.
    if (enableCatch && !SankofaCatch.instance) {
      // eslint-disable-next-line no-new — constructor self-registers
      // and self-installs handlers; we don't need the reference here
      // because every consumer reads through `SankofaCatch.instance`
      // or the static helpers on `Sankofa`.
      new SankofaCatch({
        environment: catchEnvironment,
        release: config.release,
        appVersion: config.appVersion,
        beforeSend: config.beforeSend,
      });
    }

    // ── Module enables (unified init) ───────────────────────────────
    //
    // Boolean `enableX` flags auto-construct the corresponding product
    // singletons. After init, the host reaches them via
    // `Sankofa.deploy`, `Sankofa.flags`, `Sankofa.config`,
    // `Sankofa.pulse` (and `Sankofa.errors` for Catch above).
    //
    // Skipped when the host already constructed the class manually
    // (legacy `new SankofaDeploy(...)` path) — we keep that working
    // for backward compatibility. Detection is "instance already
    // tracked", because each module's constructor calls
    // registerModule(this) in the ModuleRegistry.

    if (config.enableDeploy && !_deployModule) {
      _deployModule = new SankofaDeployClass(config.deployOptions ?? {});
    }
    if (config.enableFlags && !_switchModule) {
      _switchModule = new SankofaSwitchClass(config.flagsOptions ?? {});
    }
    if (config.enableConfig && !_configModule) {
      _configModule = new SankofaConfigClass(config.configOptions ?? {});
    }
    if (config.enablePulse && !_pulseModule) {
      _pulseModule = new SankofaPulseClass(config.pulseOptions ?? {});
    }

    // ── Reverse handshake — batched integration audit ───────────────
    // Deferred 1.5s so RN's bridge has time to call the Deploy bundle
    // provider at least once (sets the `bundle_loader_wired` flag) and
    // the GET handshake has time to deliver Switch/Config flags. Each
    // module's audit runs even if it throws; one POST goes out with
    // every status the audit could collect. Errors stay non-fatal.
    setTimeout(() => {
      void (async () => {
        const statuses: ModuleIntegrationStatusBase[] = [];

        if (_deployModule) {
          try {
            const s = await _deployModule.checkIntegration();
            _lastDeployIntegrationStatus = s;
            statuses.push(s);
            if (__DEV__ && s.level !== 'full') {
              const banner =
                s.level === 'broken'
                  ? '[Sankofa.deploy] SDK INTEGRATION BROKEN'
                  : '[Sankofa.deploy] SDK integration incomplete';
              const lines: string[] = [banner];
              for (const m of s.missing) lines.push(`  ✗ ${m}`);
              for (const w of s.warnings) lines.push(`  ⚠ ${w}`);
              console.warn(lines.join('\n'));
            }
          } catch {
            // Audit errors are non-fatal; the next launch retries.
          }
        }

        const catchInstance = SankofaCatch.instance;
        if (catchInstance) {
          try {
            statuses.push(await catchInstance.checkIntegration());
          } catch {
            // ignore
          }
        }
        if (_switchModule) {
          try {
            statuses.push(await _switchModule.checkIntegration());
          } catch {
            // ignore
          }
        }
        if (_configModule) {
          try {
            statuses.push(await _configModule.checkIntegration());
          } catch {
            // ignore
          }
        }
        if (_pulseModule) {
          try {
            statuses.push(await _pulseModule.checkIntegration());
          } catch {
            // ignore
          }
        }

        if (statuses.length > 0) {
          void reportIntegrationStatuses(apiKey, endpoint, statuses, {
            appVersion: config.appVersion,
            debug: config.debug,
          });
        }
      })();
    }, 1500);

    // 2. Call unified handshake (async — doesn't block initialization)
    // Reverse Handshake: we append `installed=core,deploy,...` so the
    // server knows what this app binary can actually run. The dashboard
    // uses this to gate UI toggles for modules the SDK doesn't have.
    // Legacy SDKs (no `installed` param) default to "allow everything"
    // server-side so we stay backward compatible.
    _handshakeDebug = config.debug ?? false;
    _handshakePromise = runHandshake();
  },

  /**
   * Explicitly tag the screen the user is currently viewing.
   * Crucial for building accurate Heatmaps in the dashboard.
   *
   * Prefer using the `useSankofaScreen` hook instead in function components.
   *
   * @param name - Human-readable screen name.
   * @param properties - Optional extra properties attached to the $screen_view event.
   */
  screen(name: string, properties: Record<string, unknown> = {}): void {
    setCurrentScreen(name);
    SankofaNativeModule.screen(name, properties);
    // Canonical screen signal — fires regardless of which Sankofa
    // products the host has enabled, so the lexicon + dwell + presence
    // are always populated.
    void emitScreenSeen(name, properties);
  },

  /**
   * Track a custom event with optional properties.
   * The SDK automatically attaches the current screen name as `$screen_name`.
   *
   * @param event - Event name (e.g. 'pay_clicked', 'item_added').
   * @param properties - Optional key-value metadata for the event.
   */
  track(event: string, properties: Record<string, unknown> = {}): void {
    bumpEvent(event); // JS-side tally so Pulse KindEvent targeting can match
    SankofaNativeModule.track(event, properties);
  },

  /**
   * Identify a logged-in user. Merges anonymous history into the user profile.
   *
   * @param userId - Your app's unique user identifier.
   */
  identify(userId: string): void {
    SankofaNativeModule.identify(userId);
    // Identity changed — re-handshake so flags/config are evaluated for the
    // new user, and so a stale etag can't 304-reuse the prior user's payload.
    refreshHandshakeForIdentity();
  },

  /**
   * Set profile attributes for the current user.
   *
   * @param traits - User traits like name, email, avatar, or custom fields.
   */
  setPerson(traits: SankofaPersonTraits): void {
    SankofaNativeModule.setPerson(traits);
  },

  /**
   * Reset identity and start a fresh anonymous session.
   * Call on logout.
   */
  reset(): void {
    SankofaNativeModule.reset();
    // Back to anonymous — drop the cached etag/modules and re-handshake so
    // the prior user's flags/config aren't served to the anonymous session.
    refreshHandshakeForIdentity();
  },

  /**
   * Force an immediate upload of all queued events.
   */
  flush(): void {
    SankofaNativeModule.flush();
  },

  // ─────────────────────────────────────────────────────────────────
  //  Catch helpers — Crashlytics + Sentry style.
  // ─────────────────────────────────────────────────────────────────
  //
  // These delegate to the active `SankofaCatch` singleton (auto-
  // constructed by `Sankofa.initialize({ enableCatch: true })`).
  // Calls before initialize runs degrade to no-ops so host code never
  // has to guard.
  //
  // Why they're on the `Sankofa` object: this is the API surface the
  // host should reach for from anywhere — `Sankofa.captureException(err)`
  // from a deeply nested screen, no `getSankofaCatch()` getter
  // pattern, no setter at app root.  The full instance API
  // (`SankofaCatch.instance!.foo`) stays available for advanced users.

  /**
   * Record a handled exception with optional metadata.
   *
   * Uncaught errors are captured automatically — only call this when
   * you caught an error yourself but still want it reported (e.g.
   * inside a `try/catch` that recovered gracefully but should log).
   * Returns the event id ('' when Catch isn't initialized).
   */
  captureException(err: unknown, options: CaptureOptions = {}): string {
    return SankofaCatch.instance?.captureException(err, options) ?? '';
  },

  /**
   * Record a free-form message as a standalone Catch event.
   *
   * Use for "interesting non-error" reports where you want a billable
   * event (e.g. "payment retry exhausted").  For pure "log this
   * breadcrumb" use [log] instead — it's free.
   */
  captureMessage(message: string, options: CaptureOptions = {}): string {
    return SankofaCatch.instance?.captureMessage(message, options) ?? '';
  },

  /**
   * Crashlytics-style structured log.  Adds a breadcrumb that rides
   * on the next captured event.  Free — doesn't bill — use liberally
   * to narrate user activity ("entered checkout", "tapped pay").
   * Mirrors `FirebaseCrashlytics.log(msg)`.
   */
  log(message: string, category?: string): void {
    SankofaCatch.instance?.log(message, category);
  },

  /**
   * Identify the user.  Sticky — pass `null` to clear (e.g. on logout).
   */
  setUser(user: CatchUserContext | null): void {
    SankofaCatch.instance?.setUser(user);
  },

  /**
   * Attach a single tag to every subsequent event.  Sticky — call
   * again with a new value to update.  For per-event scoping use
   * [withScope] instead.
   */
  setTag(key: string, value: string): void {
    SankofaCatch.instance?.setTag(key, value);
  },

  /**
   * Attach multiple tags at once.  Sticky.
   */
  setTags(tags: Record<string, string>): void {
    SankofaCatch.instance?.setTags(tags);
  },

  /**
   * Attach an arbitrary contextual value to every subsequent event.
   * Sticky.  Use for non-string context (numbers, lists, maps) that
   * doesn't fit the tag shape.
   */
  setExtra(key: string, value: unknown): void {
    SankofaCatch.instance?.setExtra(key, value);
  },

  /**
   * Push a custom breadcrumb.  Auto-captured ones (console, fetch)
   * already flow without this; reach for it when you want a
   * structured marker like `addBreadcrumb({ category: 'auth',
   * message: 'token refreshed' })`.
   */
  addBreadcrumb(crumb: Omit<Breadcrumb, 'ts_ms'> & { ts_ms?: number }): void {
    SankofaCatch.instance?.addBreadcrumb(crumb);
  },

  /**
   * Run [fn] with a temporary scope.  Mutations made via the scope
   * (tags, extras, user, level, fingerprint) overlay onto any
   * [captureException] / [captureMessage] calls inside [fn].  Outside
   * [fn] the scope is gone — async captures deferred past the
   * closure's return will NOT see the scope.
   *
   * No-op when Catch isn't initialized; [fn] still runs with a sink
   * scope so host code that does work alongside captures isn't skipped.
   *
   * ```ts
   * Sankofa.withScope((scope) => {
   *   scope.setTag('flow', 'checkout');
   *   scope.setExtra('cart_id', cart.id);
   *   Sankofa.captureException(err);
   * });
   * ```
   */
  withScope<T>(fn: (scope: import('./catch/CatchTypes').SankofaCatchScope) => T): T {
    const c = SankofaCatch.instance;
    if (c) return c.withScope(fn);
    const noop: import('./catch/CatchTypes').SankofaCatchScope = {
      setTag: () => noop,
      setTags: () => noop,
      setExtra: () => noop,
      setUser: () => noop,
      setLevel: () => noop,
      setFingerprint: () => noop,
    };
    return fn(noop);
  },

  /**
   * Force a flush of any pending Catch events.  No-op when Catch
   * isn't initialised.
   */
  async flushCatch(): Promise<void> {
    const c = SankofaCatch.instance;
    if (!c) return;
    await c.flush();
  },

  // ─────────────────────────────────────────────────────────────────
  //  Module accessors — `Sankofa.deploy`, `Sankofa.flags`,
  //  `Sankofa.config`, `Sankofa.errors`, `Sankofa.pulse`.
  //
  // Each getter returns the singleton constructed during
  // `Sankofa.initialize()` (via the corresponding `enableX` flag), or
  // the legacy instance if the host built one manually with
  // `new SankofaDeploy(...)`. Returns null if neither.
  //
  // Why getters and not properties: lazy resolution means the
  // initialize-then-construct sequence stays one synchronous pass
  // without circular timing pitfalls.
  // ─────────────────────────────────────────────────────────────────

  /** Sankofa Deploy — OTA updates. Construct via `enableDeploy: true` in Sankofa.initialize. */
  get deploy(): SankofaDeployClass | null {
    return _deployModule;
  },

  /** Sankofa Switch — feature flags. Construct via `enableFlags: true` in Sankofa.initialize. */
  get flags(): SankofaSwitchClass | null {
    return _switchModule;
  },

  /**
   * Sankofa Config — remote configuration values. Construct via
   * `enableConfig: true` in Sankofa.initialize.
   *
   * Note: the parameter passed to `Sankofa.initialize(apiKey, config)`
   * is named `config` in this scope, but that is the *init* config; the
   * `Sankofa.config` accessor here is the remote-config module
   * (a different concept).
   */
  get config(): SankofaConfigClass | null {
    return _configModule;
  },

  /**
   * Sankofa Catch — errors + crashes. Construct via `enableCatch: true`
   * in Sankofa.initialize (default true). The static helpers on
   * `Sankofa` (`captureException`, `log`, etc.) also route here.
   */
  get errors(): SankofaCatch | null {
    return SankofaCatch.instance;
  },

  /** Sankofa Pulse — surveys. Construct via `enablePulse: true` in Sankofa.initialize. */
  get pulse(): SankofaPulseClass | null {
    return _pulseModule;
  },

  /**
   * Last result of `Sankofa.deploy.checkIntegration()` from the
   * automatic post-init audit. `null` until the audit runs (~1.5s after
   * `initialize()`). Hosts that want their own "SDK integration
   * incomplete" UI can read this and skip a fresh probe.
   *
   * In `__DEV__` builds the same status is printed via `console.warn`
   * when level !== 'full'.
   */
  get lastDeployIntegrationStatus(): _DeployIntegrationStatus | null {
    return _lastDeployIntegrationStatus;
  },
};
