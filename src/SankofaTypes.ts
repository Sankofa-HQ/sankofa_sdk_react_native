/**
 * Configuration options for the Sankofa React Native SDK.
 * Mirrors SankofaConfig in the iOS and Android native SDKs.
 */
export interface SankofaInitConfig {
  /**
   * Base URL of your Sankofa engine.
   * @default 'https://api.sankofa.dev'
   */
  endpoint?: string;

  /**
   * Enable verbose SDK logging. Disable in production.
   * @default false
   */
  debug?: boolean;

  /**
   * Automatically track $app_opened, $app_backgrounded, $app_terminated.
   * @default true
   */
  trackLifecycleEvents?: boolean;

  /**
   * Enable session recording. Replay is handled entirely by the native layer.
   * @default true
   */
  recordSessions?: boolean;

  /**
   * Automatically mask all text input fields in session recordings.
   * @default true
   */
  maskAllInputs?: boolean;

  /**
   * Seconds between automatic event flushes while the app is foregrounded.
   * @default 30
   */
  flushIntervalSeconds?: number;

  /**
   * Maximum events to buffer before triggering an early flush.
   * @default 50
   */
  batchSize?: number;

  // ── Catch (Crashlytics + Sentry merged ergonomics) ────────────────
  //
  // When enabled (default), `Sankofa.initialize` auto-constructs the
  // JS `SankofaCatch` singleton AND tells the native bridge to start
  // its own native SankofaCatch — so JVM/NDK + iOS NSException/signal
  // crashes flow into the same dashboard issue stream as JS errors.
  // No more `new SankofaCatch(...)` boilerplate; the static helpers
  // on the `Sankofa` object (`Sankofa.captureException`, `Sankofa.log`,
  // etc.) reach the active singleton from anywhere.

  /**
   * Auto-start error + crash tracking.
   * @default true
   */
  enableCatch?: boolean;

  /**
   * Environment label attached to every Catch event.
   * @default 'live'
   */
  catchEnvironment?: 'live' | 'test';

  /**
   * Release identifier (e.g. `'myapp@1.4.2'`).  Forwarded to both the
   * JS Catch singleton AND the native bridge so JS errors and native
   * crashes share a single release dimension on the dashboard.
   */
  release?: string;

  /**
   * Optional app-version override.  Defaults to whatever the native
   * device-info module reports.
   */
  appVersion?: string;

  /**
   * Synchronous hook fired AFTER an event has been composed but
   * BEFORE the transport sends it. Return the (possibly modified)
   * event to ship it; return `null` to drop it entirely.
   *
   * Use for PII scrubbing, noise filtering (drop framework-level
   * setState warnings), or late tag enrichment. Only applies to the
   * JS-side capture path — native crashes (NSException, JVM uncaught,
   * POSIX signals) bypass this hook because they're composed in
   * native code.
   *
   * Throws are swallowed.
   */
  beforeSend?: import('./catch/CatchTypes').BeforeSendFn;
}

/**
 * @deprecated Renamed to `SankofaInitConfig` in v0.2 to free the
 * `SankofaConfig` name for the new remote-config module class.
 * Kept as a type alias for back-compat; remove in a future major.
 */
export type SankofaConfig = SankofaInitConfig;

/**
 * User identity traits for `Sankofa.setPerson()`.
 */
export interface SankofaPersonTraits {
  name?: string;
  email?: string;
  avatar?: string;
  [key: string]: unknown;
}
