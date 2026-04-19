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
