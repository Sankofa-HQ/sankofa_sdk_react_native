import { requireNativeModule } from 'expo-modules-core';

/**
 * Init config the native bridge expects.  This mirrors the resolved
 * shape passed from {@link Sankofa.initialize} after JS-side defaults
 * are applied — every field is required at the bridge boundary so
 * the native side never has to second-guess defaults.
 */
export interface NativeInitConfig {
  endpoint: string;
  debug: boolean;
  trackLifecycleEvents: boolean;
  recordSessions: boolean;
  maskAllInputs: boolean;
  captureScale?: number; // replay capture resolution (native defaults to 0.35)
  flushIntervalSeconds: number;
  batchSize: number;
  // ── Catch (rolled-up native auto-start) ──
  // When true, the native bridge auto-starts its own SankofaCatch
  // (Java/Kotlin or Swift) so native crashes — JVM uncaught exceptions
  // and ANRs on Android, NSException + POSIX signals on iOS — flow
  // into the same dashboard issue stream as the JS-side errors.  This
  // is the single switch that closes the "native crashes under React
  // Native don't bridge to JS Catch" gap.
  enableCatch: boolean;
  catchEnvironment: string;
  catchRelease?: string;
  catchAppVersion?: string;
}

/**
 * Device info returned by the bridge for Deploy targeting rules.
 */
export interface NativeDeviceInfo {
  osVersion: string;
  deviceModel: string;
  /** BCP-47 language tag, e.g. "en-US". */
  locale: string;
}

/**
 * Raw integration audit data returned by the native bridge.
 *
 * Returned by `deployCheckIntegration()`. The JS layer in
 * `SankofaDeploy.checkIntegration()` maps this to a structured
 * `ModuleIntegrationStatus` with human-readable `missing[]` /
 * `warnings[]` strings.
 *
 * Fields are `null` when the platform doesn't have that concept
 * (e.g. iOS has no INTERNET permission; Android doesn't surface the
 * AppDelegate class name).
 */
export interface DeployIntegrationAuditRaw {
  /** `true` once SankofaDeployBundleProvider has been called at least
   *  once (proves MainApplication/AppDelegate patch is live). */
  bundleLoaderWired: boolean;
  /** Android: declared in manifest AND granted at runtime. iOS: null. */
  internetPermission: boolean | null;
  /** Android: host's Application class name. iOS: null. */
  applicationClass: string | null;
  /** Android: host's ReactNativeHost subclass name. iOS: null. */
  reactNativeHostClass?: string | null;
  /** iOS: host's UIApplicationDelegate class name. Android: null. */
  appDelegateClass?: string | null;
  /** SharedPreferences (Android) / UserDefaults (iOS) round-trip works. */
  storageOk: boolean;
  /** 'android' or 'ios'. */
  platform: 'android' | 'ios';
}

/**
 * Typed surface of the native Sankofa Expo Module.
 *
 * Both the iOS Swift module ([sankofa_sdk_react_native/ios/SankofaModule.swift])
 * and the Android Kotlin module ([sankofa_sdk_react_native/android/src/main/java/dev/sankofa/rn/SankofaModule.kt])
 * register every method below under the same name — keep all three in
 * sync when adding a new bridge function.
 *
 * Core analytics methods (`initialize`, `screen`, `track`, `identify`,
 * `setPerson`, `reset`, `flush`) are required because every JS call
 * site assumes they exist.  Deploy / handshake helpers are typed as
 * optional because:
 *   1. Older binary builds may predate them, and the JS layer guards
 *      every Deploy call with `typeof bridge.foo === 'function'`.
 *   2. Some functions (`getDistinctId`, `getAnonymousId`) are
 *      best-effort identity forwarding for the handshake — when the
 *      native bridge wasn't built with the Analytics module linked,
 *      they're simply absent and the JS layer falls back to anonymous.
 *
 * Optional Deploy methods are typed as `unknown`-returning at the
 * declaration level and then refined at call sites with the exact
 * shape — we don't want a binary mismatch (e.g. an older bridge
 * returning `undefined` instead of a string) to slip through as a
 * silent type lie.
 */
export interface SankofaBridge {
  // ── Core analytics ────────────────────────────────────────────────
  initialize(apiKey: string, config: NativeInitConfig): void;
  screen(name: string, properties: Record<string, unknown>): void;
  track(event: string, properties: Record<string, unknown>): void;
  identify(userId: string): void;
  setPerson(traits: Record<string, unknown>): void;
  reset(): void;
  flush(): void;

  // ── Replay session id (read by Pulse, Catch) ─────────────────────
  /** Returns the active replay session id, or empty string when none. */
  getReplaySessionId?: () => string;

  // ── Identity forwarding (best-effort for handshake targeting) ────
  /** Returns the current distinct id (identified user > anonymous). */
  getDistinctId?: () => Promise<string | null>;
  /** Returns the device-scoped anonymous id, stable across launches. */
  getAnonymousId?: () => Promise<string | null>;

  // ── Deploy (OTA bundle download + apply) ─────────────────────────
  deployDownloadBundle?: (
    url: string,
    expectedSha256: string,
    label: string,
  ) => Promise<string>;
  deployGetBundlePath?: () => string | null;
  deploySetBundlePath?: (path: string) => void;
  deployClearBundle?: () => void;
  deployReload?: () => void;
  deployGetAppVersion?: () => string;
  deployGetDistinctId?: () => string | null;
  deployGetDeviceInfo?: () => NativeDeviceInfo;
  deployStorageGet?: (key: string) => string | null;
  deployStorageSet?: (key: string, value: string) => void;
  deployStorageRemove?: (key: string) => void;
  deployStorageMultiRemove?: (keys: string[]) => void;

  /**
   * Self-audit the host's Deploy wiring. Returns raw probe data;
   * `SankofaDeploy.checkIntegration()` maps it to a structured
   * `ModuleIntegrationStatus` with human-readable messages.
   *
   * Optional because older native binaries may predate this method —
   * the JS layer treats absence as "audit unsupported" rather than
   * "audit failed."
   */
  deployCheckIntegration?: () => Promise<DeployIntegrationAuditRaw> | DeployIntegrationAuditRaw;
}

/**
 * Low-level reference to the native Sankofa module.
 *
 * Prefer using the public {@link Sankofa} object or the
 * {@link useSankofaScreen} / {@link useSankofaNavigationTracking}
 * hooks from the package root — they provide ergonomic JS APIs over
 * this raw bridge.
 */
const SankofaNativeModule = requireNativeModule('Sankofa') as SankofaBridge;

export default SankofaNativeModule;
