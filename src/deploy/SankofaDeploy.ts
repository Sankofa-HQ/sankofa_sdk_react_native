import { AppState, Platform } from 'react-native';
import SankofaNativeModule from '../SankofaModule';
import { DeployStorage } from './DeployStorage';
import { waitForHandshake, getHandshakeModules, getSharedApiKey, getSharedEndpoint } from '../index';
import type {
  DeployConfig,
  UpdateCheckResult,
  DeployStatus,
  DeployEventType,
} from './DeployTypes';

const CRASH_THRESHOLD = 2;
const CRASH_WINDOW_MS = 30_000; // 30 seconds
const HEALTH_CONFIRM_MS = 10_000; // 10 seconds after boot

/**
 * # Sankofa Deploy
 *
 * OTA update module for React Native (Expo + Bare RN).
 *
 * ## Quick Start
 * ```tsx
 * import { SankofaDeploy } from 'sankofa-react-native';
 *
 * const deploy = new SankofaDeploy({
 *   apiKey: 'sk_live_XXXX',
 *   serverUrl: 'https://api.sankofa.dev',
 * });
 *
 * // On app start
 * const update = await deploy.checkForUpdate();
 * if (update.updateAvailable) {
 *   if (update.isMandatory) {
 *     await deploy.downloadAndApply(update);
 *   } else {
 *     await deploy.downloadInBackground(update);
 *   }
 * }
 *
 * // CRITICAL: call after your app renders successfully
 * deploy.notifyAppReady();
 * ```
 */
export class SankofaDeploy {
  private config: Required<DeployConfig>;
  private storage: DeployStorage;
  private healthTimer: ReturnType<typeof setTimeout> | null = null;
  private appStateSubscription: any = null;
  private lastBackgroundTime: number = 0;

  constructor(config: DeployConfig = {}) {
    this.config = {
      apiKey: config.apiKey || getSharedApiKey(),
      serverUrl: config.serverUrl || getSharedEndpoint(),
      checkOnResume: config.checkOnResume ?? true,
      mandatoryInstallMode: config.mandatoryInstallMode || 'immediate',
      minimumBackgroundDuration: config.minimumBackgroundDuration ?? 0,
    };
    this.storage = new DeployStorage();

    // Run the rollback check on construction (should be called early in app lifecycle)
    this._runRollbackCheck();

    // Listen for app state changes (background/foreground)
    if (this.config.checkOnResume) {
      this.appStateSubscription = AppState.addEventListener(
        'change',
        this._handleAppStateChange.bind(this),
      );
    }
  }

  /**
   * Check the server for available updates.
   *
   * This is the single HTTP call the SDK makes on every app launch.
   * Returns immediately with { updateAvailable: false } if no update
   * is available, the device is not in the rollout, or the update is
   * the same one that was rolled back.
   */
  async checkForUpdate(): Promise<UpdateCheckResult> {
    try {
      const currentLabel = await this.storage.getCurrentLabel();
      const rolledBackLabel = await this.storage.getRolledBackLabel();

      // 1. Try the shared handshake first — if Sankofa.initialize()
      //    was called, the handshake is already in flight and we can
      //    read the deploy module config without a second HTTP call.
      let deployData: Record<string, any> | null = null;

      const cached = getHandshakeModules();
      if (cached?.deploy) {
        deployData = cached.deploy as Record<string, any>;
      } else {
        // Wait for the handshake if it's still in flight
        const modules = await waitForHandshake();
        if (modules?.deploy) {
          deployData = modules.deploy as Record<string, any>;
        }
      }

      // 2. Fallback: if handshake didn't include deploy data (e.g.
      //    Sankofa.initialize() wasn't called, or server is old),
      //    call the standalone deploy check endpoint.
      if (!deployData) {
        const params = new URLSearchParams({
          app_version: this._getAppVersion(),
          current_bundle_label: currentLabel || '',
          distinct_id: this._getDistinctId(),
          platform: Platform.OS,
        });

        const res = await fetch(
          `${this.config.serverUrl}/api/deploy/check?${params}`,
          { headers: { 'x-api-key': this.config.apiKey } },
        );

        if (!res.ok) {
          return { updateAvailable: false };
        }
        deployData = await res.json();
      }

      await this.storage.setLastCheckTime(Date.now());

      if (!deployData || !deployData.has_update) {
        return { updateAvailable: false, reason: deployData?.reason };
      }

      // Skip if this is the same bundle we rolled back from
      if (rolledBackLabel && deployData.label === rolledBackLabel) {
        return { updateAvailable: false, reason: 'rolled_back_same_label' };
      }

      return {
        updateAvailable: true,
        downloadUrl: deployData.download_url,
        label: deployData.label,
        sha256: deployData.sha256,
        size: deployData.size,
        isMandatory: deployData.is_mandatory,
        releaseId: deployData.release_id,
      };
    } catch (err) {
      console.warn('[SankofaDeploy] Update check failed:', err);
      return { updateAvailable: false };
    }
  }

  /**
   * Download and apply the update immediately.
   * The app will reload with the new bundle.
   *
   * For mandatory updates, call this directly.
   * For optional updates, consider using downloadInBackground() instead.
   */
  async downloadAndApply(update: UpdateCheckResult): Promise<void> {
    if (!update.updateAvailable || !update.downloadUrl || !update.label) {
      return;
    }

    try {
      this._reportEvent('download_start', update);

      // Save current bundle as previous (for rollback)
      const currentLabel = await this.storage.getCurrentLabel();
      if (currentLabel) {
        await this.storage.setPreviousLabel(currentLabel);
      }

      // Download the bundle
      // In a production implementation, this would use the native
      // bridge to download to the app's file system, verify SHA256,
      // and write to the bundle load path. For now we use a
      // placeholder that the native bridge will implement.
      const success = await this._downloadBundle(update);
      if (!success) {
        this._reportEvent('apply_fail', update);
        return;
      }

      this._reportEvent('download_complete', update);

      // Update state
      await this.storage.setCurrentLabel(update.label);
      await this.storage.setCrashCount(0);
      await this.storage.setBootConfirmed(false);
      await this.storage.setRolledBackLabel(null);

      this._reportEvent('apply_success', update);

      // Reload the app with the new bundle
      // The native bridge handles this — it tells RN to reload from
      // the new bundle path.
      this._reloadApp();
    } catch (err) {
      console.error('[SankofaDeploy] Download/apply failed:', err);
      this._reportEvent('apply_fail', update);
    }
  }

  /**
   * Download the update in the background.
   * The new bundle will be applied on the next app restart.
   */
  async downloadInBackground(update: UpdateCheckResult): Promise<void> {
    if (!update.updateAvailable || !update.downloadUrl || !update.label) {
      return;
    }

    try {
      this._reportEvent('download_start', update);

      const success = await this._downloadBundle(update);
      if (!success) {
        this._reportEvent('apply_fail', update);
        return;
      }

      this._reportEvent('download_complete', update);
      await this.storage.setPendingLabel(update.label);
    } catch (err) {
      console.warn('[SankofaDeploy] Background download failed:', err);
    }
  }

  /**
   * CRITICAL: Call this after your app has loaded and rendered successfully.
   *
   * This confirms the current bundle is healthy and resets the crash
   * counter. Without calling this, two app restarts within 30 seconds
   * will trigger an auto-rollback.
   *
   * If you don't call this manually, a 10-second timer auto-confirms
   * after construction. But explicit is better than implicit.
   */
  notifyAppReady(): void {
    this._confirmHealthy();
  }

  /** Get the current deploy status on this device. */
  async getStatus(): Promise<DeployStatus> {
    return this.storage.getStatus();
  }

  /** Clean up listeners. Call when the app is unmounting. */
  destroy(): void {
    if (this.healthTimer) {
      clearTimeout(this.healthTimer);
      this.healthTimer = null;
    }
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
  }

  // ── Private methods ─────────────────────────────────────────────────

  /**
   * The auto-rollback state machine. Runs on construction (early in
   * the app lifecycle, ideally before heavy rendering).
   *
   * Algorithm:
   * 1. If the previous boot didn't confirm healthy AND it was < 30s
   *    ago, increment crash counter.
   * 2. If crash counter >= 2, ROLLBACK: load previous bundle, reset
   *    counter, skip re-downloading the same broken label.
   * 3. Start a 10-second auto-confirm timer as a safety net.
   */
  private async _runRollbackCheck(): Promise<void> {
    try {
      const bootConfirmed = await this.storage.isBootConfirmed();
      const lastBootTime = await this.storage.getLastBootTime();
      const now = Date.now();

      if (!bootConfirmed && lastBootTime && now - lastBootTime < CRASH_WINDOW_MS) {
        // Previous boot crashed quickly
        const crashCount = (await this.storage.getCrashCount()) + 1;
        await this.storage.setCrashCount(crashCount);

        if (crashCount >= CRASH_THRESHOLD) {
          // ROLLBACK
          const currentLabel = await this.storage.getCurrentLabel();
          const previousLabel = await this.storage.getPreviousLabel();

          console.warn(
            `[SankofaDeploy] Rolling back from ${currentLabel} to ${previousLabel || 'original bundle'} after ${crashCount} consecutive crashes`,
          );

          if (currentLabel) {
            await this.storage.setRolledBackLabel(currentLabel);
          }
          if (previousLabel) {
            await this.storage.setCurrentLabel(previousLabel);
          } else {
            // No previous label = revert to original embedded bundle
            await this.storage.setCurrentLabel('');
          }
          await this.storage.setCrashCount(0);

          // Clear the native-side OTA bundle so the app loads
          // the original embedded bundle on next launch.
          try {
            SankofaNativeModule.deployClearBundle();
          } catch {}


          // Report rollback (fire-and-forget)
          this._reportEvent('rollback', {
            updateAvailable: false,
            label: currentLabel || undefined,
          });

          // Note: we do NOT stop the update check. After rollback,
          // checkForUpdate() will still run but will skip the
          // rolled-back label. If the agency pushes a NEW fix,
          // the device picks it up immediately.
        }
      }

      // Record this boot
      await this.storage.setBootConfirmed(false);
      await this.storage.setLastBootTime(now);

      // Auto-confirm health after 10 seconds (safety net)
      this.healthTimer = setTimeout(() => {
        this._confirmHealthy();
      }, HEALTH_CONFIRM_MS);
    } catch (err) {
      console.warn('[SankofaDeploy] Rollback check failed:', err);
    }
  }

  private async _confirmHealthy(): Promise<void> {
    if (this.healthTimer) {
      clearTimeout(this.healthTimer);
      this.healthTimer = null;
    }
    await this.storage.setBootConfirmed(true);
    await this.storage.setCrashCount(0);
    // Clear the rolled-back label — the app is healthy, future
    // patches with any label are safe to try again.
    await this.storage.setRolledBackLabel(null);
  }

  private _handleAppStateChange(nextState: string): void {
    if (nextState === 'background') {
      this.lastBackgroundTime = Date.now();
    } else if (nextState === 'active' && this.lastBackgroundTime > 0) {
      const backgroundDuration = (Date.now() - this.lastBackgroundTime) / 1000;
      if (backgroundDuration >= this.config.minimumBackgroundDuration) {
        // Re-check for updates after returning from background
        this.checkForUpdate().then((update) => {
          if (update.updateAvailable && update.isMandatory) {
            this.downloadAndApply(update);
          }
        });
      }
    }
  }

  private async _downloadBundle(update: UpdateCheckResult): Promise<boolean> {
    if (!update.downloadUrl || !update.sha256) return false;

    try {
      // Call the native bridge to download, decompress, and SHA256-verify
      const localPath: string = await SankofaNativeModule.deployDownloadBundle(
        update.downloadUrl,
        update.sha256,
      );
      console.log(`[SankofaDeploy] Bundle downloaded to ${localPath}`);
      return true;
    } catch (err: any) {
      console.error(`[SankofaDeploy] Bundle download failed: ${err.message ?? err}`);
      return false;
    }
  }

  private _reloadApp(): void {
    // Call the native bridge to reload the JS bundle from the
    // newly-downloaded OTA path. Uses Expo Updates if available,
    // otherwise falls back to activity recreation (Android) or
    // RCTBridge reload notification (iOS).
    try {
      SankofaNativeModule.deployReload();
    } catch (err) {
      console.error('[SankofaDeploy] Reload failed:', err);
    }
  }

  private _reportEvent(
    eventType: DeployEventType,
    update: Partial<UpdateCheckResult>,
  ): void {
    // Fire-and-forget report to the server
    try {
      fetch(`${this.config.serverUrl}/api/deploy/report`, {
        method: 'POST',
        headers: {
          'x-api-key': this.config.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          events: [
            {
              event_type: eventType,
              release_id: update.releaseId || '',
              distinct_id: this._getDistinctId(),
              app_version: this._getAppVersion(),
              bundle_label: update.label || '',
              platform: Platform.OS,
              os_version: Platform.Version?.toString() || '',
              device_model: '',
            },
          ],
        }),
      }).catch(() => {
        // Silent fail — offline reports are acceptable
      });
    } catch {
      // Never throw from event reporting
    }
  }

  private _getAppVersion(): string {
    // TODO: Read from the native module or app.json.
    // For now, return a placeholder.
    return '1.0.0';
  }

  private _getDistinctId(): string {
    // TODO: Read from Sankofa identity module if available,
    // otherwise generate/persist a device-scoped UUID.
    return 'device_' + Math.random().toString(36).slice(2, 10);
  }
}
