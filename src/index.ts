import SankofaNativeModule from './SankofaModule';
import type { SankofaConfig, SankofaPersonTraits } from './SankofaTypes';

export type { SankofaConfig, SankofaPersonTraits };
export { useSankofaScreen } from './hooks/useSankofaScreen';

// Sankofa Deploy — OTA update module
export { SankofaDeploy } from './deploy/SankofaDeploy';
export type { DeployConfig, UpdateCheckResult, DeployStatus } from './deploy/DeployTypes';

/**
 * Module configuration returned by the unified handshake.
 * Stored globally so SankofaDeploy and other modules can read it
 * without making redundant HTTP calls.
 */
export interface HandshakeModules {
  analytics?: { enabled: boolean; sampling_rate?: number };
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
  };
  replay?: {
    enabled: boolean;
    sample_rate?: number;
    mask_all_inputs?: boolean;
    capture_network?: boolean;
    high_fidelity_triggers?: string[];
    high_fidelity_duration_seconds?: number;
  };
}

/** Cached handshake response. Readable by SankofaDeploy and other modules. */
let _handshakeModules: HandshakeModules | null = null;
let _handshakePromise: Promise<HandshakeModules | null> | null = null;

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
  initialize(apiKey: string, config: SankofaConfig = {}): void {
    const endpoint = config.endpoint ?? 'https://api.sankofa.dev';

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
    _handshakePromise = (async () => {
      try {
        const res = await fetch(`${endpoint}/api/v1/handshake`, {
          headers: { 'x-api-key': apiKey },
        });
        if (!res.ok) return null;
        const data = await res.json();
        _handshakeModules = (data.modules as HandshakeModules) ?? null;

        if (config.debug) {
          const mods = _handshakeModules;
          console.log(
            `[Sankofa] Handshake OK — analytics:${mods?.analytics?.enabled} replay:${mods?.replay?.enabled} deploy:${mods?.deploy?.enabled} catch:${mods?.catch?.enabled}`,
          );
        }

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
