/**
 * Configuration for the Sankofa Deploy module.
 *
 * The deploymentKey is the project's API key (same as the analytics
 * key). The server resolves it to the right project and checks for
 * updates targeting the current binary version + platform.
 */
export interface DeployConfig {
  /** Sankofa API key (sk_live_... or sk_test_...). Falls back to the main Sankofa key if omitted. */
  apiKey?: string;
  /** Sankofa API endpoint. Defaults to the main Sankofa endpoint. */
  serverUrl?: string;
  /** Native binary version override. Defaults to the native app version. */
  appVersion?: string;
  /** Stable rollout identity override. Defaults to Sankofa/native deploy identity. */
  distinctId?: string;
  /** Check for updates when the app resumes from background. Default: true. */
  checkOnResume?: boolean;
  /** How to handle mandatory updates. Default: 'immediate'. */
  mandatoryInstallMode?: 'immediate' | 'on_next_restart';
  /** Minimum seconds the app must be backgrounded before re-checking on resume. Default: 0. */
  minimumBackgroundDuration?: number;
}

/**
 * Result from the server's update check.
 */
export interface UpdateCheckResult {
  updateAvailable: boolean;
  downloadUrl?: string;
  label?: string;
  sha256?: string;
  size?: number;
  isMandatory?: boolean;
  releaseId?: string;
  /**
   * Server instructed the client to apply this update regardless of any
   * client-side safety gates (rolled-back-same-label, etc.). Set when the
   * server is pushing a kill-switch rollback to a device on a disabled
   * release.
   */
  forceApply?: boolean;
  reason?: string; // 'kill_switch_rollback', 'already_on_latest', 'not_in_rollout', etc.
}

/**
 * Current deploy status on the device. Readable via SankofaDeploy.getStatus().
 */
export interface DeployStatus {
  /** Label of the currently running OTA bundle, or null if on the original embedded bundle. */
  currentLabel: string | null;
  /** Label of a bundle that's downloaded but not yet applied (pending next restart). */
  pendingLabel: string | null;
  /** Timestamp (ms) of the last successful update check. */
  lastCheckTime: number | null;
  /** Number of consecutive crashes since the last confirmed-healthy boot. */
  consecutiveCrashCount: number;
  /** True if the SDK has rolled back to a previous bundle after consecutive crashes. */
  isRolledBack: boolean;
  /** Label of the bundle that was rolled back (so the SDK skips re-downloading it). */
  rolledBackLabel: string | null;
}

/**
 * Events the SDK reports to the server for analytics.
 */
export type DeployEventType =
  | 'download_start'
  | 'download_complete'
  | 'apply_success'
  | 'apply_fail'
  | 'rollback'
  | 'crash_on_update';
