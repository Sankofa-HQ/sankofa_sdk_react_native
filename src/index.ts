import SankofaNativeModule from './SankofaModule';
import type { SankofaInitConfig, SankofaPersonTraits } from './SankofaTypes';
import { markCoreInitialized, routeHandshake, getInstalledModules } from './core/ModuleRegistry';

// SankofaInitConfig is the canonical name for the init options; the old
// `SankofaConfig` TYPE is now a deprecated alias kept inside
// ./SankofaTypes for back-compat. From this re-export path we only
// surface the new name so the `SankofaConfig` value (the remote-config
// class below) has the identifier to itself.
export type { SankofaInitConfig, SankofaPersonTraits } from './SankofaTypes';
export { useSankofaScreen } from './hooks/useSankofaScreen';

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

// Traffic Cop — module registry (public for advanced use / future modules)
export type { SankofaModule, SankofaModuleName } from './core/ModuleRegistry';
export { hasModule, getInstalledModules } from './core/ModuleRegistry';

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

    // 1. Initialize native layer (sync — bridges to Swift/Kotlin)
    SankofaNativeModule.initialize(apiKey, {
      endpoint,
      debug: config.debug ?? false,
      trackLifecycleEvents: config.trackLifecycleEvents ?? true,
      recordSessions: config.recordSessions ?? true,
      maskAllInputs: config.maskAllInputs ?? true,
      flushIntervalSeconds: config.flushIntervalSeconds ?? 30,
      batchSize: config.batchSize ?? 50,
    });

    // 2. Call unified handshake (async — doesn't block initialization)
    // Reverse Handshake: we append `installed=core,deploy,...` so the
    // server knows what this app binary can actually run. The dashboard
    // uses this to gate UI toggles for modules the SDK doesn't have.
    // Legacy SDKs (no `installed` param) default to "allow everything"
    // server-side so we stay backward compatible.
    _handshakePromise = (async () => {
      try {
        // Defer to the next tick so modules constructed on the same
        // synchronous pass (e.g. `new SankofaDeploy()` right after
        // `Sankofa.initialize()`) land in the registry before we send
        // the reverse handshake.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        const installed = getInstalledModules().join(',');
        const params = new URLSearchParams({
          installed,
          sdk: 'react-native',
        });
        const url = `${endpoint.replace(/\/$/, '')}/api/v1/handshake?${params}`;

        const headers: Record<string, string> = { 'x-api-key': apiKey };
        if (_handshakeEtag) headers['If-None-Match'] = _handshakeEtag;

        const res = await fetch(url, { headers });

        // 304 — the server says our cached modules are still current.
        // Re-fire routeHandshake anyway so modules constructed between
        // the previous handshake and now (hot reload, lazy imports)
        // pick up the payload they missed.
        if (res.status === 304 && _handshakeModules) {
          if (config.debug) {
            console.log('[Sankofa] Handshake 304 — cached modules still current');
          }
          await routeHandshake(_handshakeModules);
          return _handshakeModules;
        }

        if (!res.ok) return null;
        const data = await res.json();
        _handshakeModules = (data.modules as HandshakeModules) ?? null;
        _handshakeEtag = res.headers.get('etag') ?? res.headers.get('ETag') ?? '';

        if (config.debug) {
          const mods = _handshakeModules;
          console.log(
            `[Sankofa] Handshake OK — analytics:${mods?.analytics?.enabled} replay:${mods?.replay?.enabled} deploy:${mods?.deploy?.enabled} catch:${mods?.catch?.enabled} switch:${mods?.switch?.enabled} config:${mods?.config?.enabled} (installed: ${installed})`,
          );
        }

        // Traffic Cop — route each enabled module flag to its registered
        // handler. Flags for missing modules get a dev warning + prod no-op.
        await routeHandshake(_handshakeModules);

        return _handshakeModules;
      } catch (err) {
        if (config.debug) {
          console.warn('[Sankofa] Handshake failed:', err);
        }
        return null;
      }
    })();
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
    SankofaNativeModule.screen(name, properties);
  },

  /**
   * Track a custom event with optional properties.
   * The SDK automatically attaches the current screen name as `$screen_name`.
   *
   * @param event - Event name (e.g. 'pay_clicked', 'item_added').
   * @param properties - Optional key-value metadata for the event.
   */
  track(event: string, properties: Record<string, unknown> = {}): void {
    SankofaNativeModule.track(event, properties);
  },

  /**
   * Identify a logged-in user. Merges anonymous history into the user profile.
   *
   * @param userId - Your app's unique user identifier.
   */
  identify(userId: string): void {
    SankofaNativeModule.identify(userId);
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
  },

  /**
   * Force an immediate upload of all queued events.
   */
  flush(): void {
    SankofaNativeModule.flush();
  },
};
