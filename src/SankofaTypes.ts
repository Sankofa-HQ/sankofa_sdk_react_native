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

  // ── Module enables (Sankofa unified init) ─────────────────────────
  //
  // Boolean flags that auto-construct the corresponding product
  // singletons during `Sankofa.initialize()`. After init, access them
  // via `Sankofa.deploy`, `Sankofa.flags`, `Sankofa.config`,
  // `Sankofa.errors`, `Sankofa.pulse`. Matches the CLI's product flag
  // surface (`sankofa init --deploy --flag --config --catch`).
  //
  // The legacy `new SankofaDeploy(...)`, `new SankofaSwitch(...)`,
  // `new SankofaConfig(...)`, `new SankofaPulse(...)` constructors
  // continue to work for backward compatibility — but new code should
  // prefer the enable flags.

  /**
   * Auto-construct the SankofaDeploy singleton during initialize.
   * Access via `Sankofa.deploy` afterwards.
   * @default false
   */
  enableDeploy?: boolean;

  /** Constructor options forwarded to `new SankofaDeploy(...)` when enableDeploy is true. */
  deployOptions?: import('./deploy/DeployTypes').DeployConfig;

  /**
   * Auto-construct the SankofaSwitch (feature flags) singleton during initialize.
   * Access via `Sankofa.flags` afterwards. ("flags" because `switch` is a reserved word.)
   * @default false
   */
  enableFlags?: boolean;

  /** Constructor options forwarded to `new SankofaSwitch(...)` when enableFlags is true. */
  flagsOptions?: { defaults?: Record<string, import('./switch/SwitchTypes').FlagDecision> };

  /**
   * Auto-construct the SankofaConfig (remote config) singleton during initialize.
   * Access via `Sankofa.config` afterwards.
   * @default false
   */
  enableConfig?: boolean;

  /** Constructor options forwarded to `new SankofaConfig(...)` when enableConfig is true. */
  configOptions?: { defaults?: Record<string, import('./config/ConfigTypes').ItemDecision> };

  /**
   * Auto-construct the SankofaPulse (surveys) singleton during initialize.
   * Access via `Sankofa.pulse` afterwards.
   * @default false
   */
  enablePulse?: boolean;

  /** Constructor options forwarded to `new SankofaPulse(...)` when enablePulse is true. */
  pulseOptions?: import('./pulse/SankofaPulse').PulseConstructorOptions;
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
