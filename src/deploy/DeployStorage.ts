import type { DeployStatus } from './DeployTypes';
import SankofaNativeModule from '../SankofaModule';

const memoryStore = new Map<string, string>();

// Native persistence uses SharedPreferences/UserDefaults. The in-memory
// fallback keeps tests and unsupported native hosts functional.
const Storage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      if (typeof SankofaNativeModule.deployStorageGet === 'function') {
        return await SankofaNativeModule.deployStorageGet(key);
      }
    } catch {}
    return memoryStore.get(key) ?? null;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      if (typeof SankofaNativeModule.deployStorageSet === 'function') {
        await SankofaNativeModule.deployStorageSet(key, value);
        return;
      }
    } catch {}
    memoryStore.set(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      if (typeof SankofaNativeModule.deployStorageRemove === 'function') {
        await SankofaNativeModule.deployStorageRemove(key);
        return;
      }
    } catch {}
    memoryStore.delete(key);
  },
  multiRemove: async (keys: string[]): Promise<void> => {
    try {
      if (typeof SankofaNativeModule.deployStorageMultiRemove === 'function') {
        await SankofaNativeModule.deployStorageMultiRemove(keys);
        return;
      }
    } catch {}
    keys.forEach((k) => memoryStore.delete(k));
  },
};

const KEYS = {
  CURRENT_LABEL: 'sankofa:deploy:current_label',
  PREVIOUS_LABEL: 'sankofa:deploy:previous_label',
  CURRENT_BUNDLE_PATH: 'sankofa:deploy:current_bundle_path',
  PREVIOUS_BUNDLE_PATH: 'sankofa:deploy:previous_bundle_path',
  CRASH_COUNT: 'sankofa:deploy:crash_count',
  LAST_BOOT_TIME: 'sankofa:deploy:last_boot_time',
  BOOT_CONFIRMED: 'sankofa:deploy:boot_confirmed',
  ROLLED_BACK_LABEL: 'sankofa:deploy:rolled_back_label',
  LAST_CHECK_TIME: 'sankofa:deploy:last_check_time',
  PENDING_LABEL: 'sankofa:deploy:pending_label',
  PENDING_BUNDLE_PATH: 'sankofa:deploy:pending_bundle_path',
  DISTINCT_ID: 'sankofa:deploy:distinct_id',
} as const;

/**
 * Manages deploy state in Storage. All auto-rollback state,
 * current/previous bundle metadata, and crash counters live here.
 *
 * The storage is the single source of truth for the rollback state
 * machine. It survives app restarts and works fully offline.
 */
export class DeployStorage {
  async getCurrentLabel(): Promise<string | null> {
    return Storage.getItem(KEYS.CURRENT_LABEL);
  }

  async setCurrentLabel(label: string): Promise<void> {
    await Storage.setItem(KEYS.CURRENT_LABEL, label);
  }

  async getPreviousLabel(): Promise<string | null> {
    return Storage.getItem(KEYS.PREVIOUS_LABEL);
  }

  async setPreviousLabel(label: string): Promise<void> {
    await Storage.setItem(KEYS.PREVIOUS_LABEL, label);
  }

  async getPreviousBundlePath(): Promise<string | null> {
    return Storage.getItem(KEYS.PREVIOUS_BUNDLE_PATH);
  }

  async setPreviousBundlePath(path: string): Promise<void> {
    await Storage.setItem(KEYS.PREVIOUS_BUNDLE_PATH, path);
  }

  async getCurrentBundlePath(): Promise<string | null> {
    return Storage.getItem(KEYS.CURRENT_BUNDLE_PATH);
  }

  async setCurrentBundlePath(path: string | null): Promise<void> {
    if (path === null) {
      await Storage.removeItem(KEYS.CURRENT_BUNDLE_PATH);
    } else {
      await Storage.setItem(KEYS.CURRENT_BUNDLE_PATH, path);
    }
  }

  async getCrashCount(): Promise<number> {
    const val = await Storage.getItem(KEYS.CRASH_COUNT);
    return val ? parseInt(val, 10) : 0;
  }

  async setCrashCount(count: number): Promise<void> {
    await Storage.setItem(KEYS.CRASH_COUNT, count.toString());
  }

  async getLastBootTime(): Promise<number | null> {
    const val = await Storage.getItem(KEYS.LAST_BOOT_TIME);
    return val ? parseInt(val, 10) : null;
  }

  async setLastBootTime(time: number): Promise<void> {
    await Storage.setItem(KEYS.LAST_BOOT_TIME, time.toString());
  }

  async isBootConfirmed(): Promise<boolean> {
    const val = await Storage.getItem(KEYS.BOOT_CONFIRMED);
    return val === 'true';
  }

  async setBootConfirmed(confirmed: boolean): Promise<void> {
    await Storage.setItem(KEYS.BOOT_CONFIRMED, confirmed.toString());
  }

  async getRolledBackLabel(): Promise<string | null> {
    return Storage.getItem(KEYS.ROLLED_BACK_LABEL);
  }

  async setRolledBackLabel(label: string | null): Promise<void> {
    if (label === null) {
      await Storage.removeItem(KEYS.ROLLED_BACK_LABEL);
    } else {
      await Storage.setItem(KEYS.ROLLED_BACK_LABEL, label);
    }
  }

  async getLastCheckTime(): Promise<number | null> {
    const val = await Storage.getItem(KEYS.LAST_CHECK_TIME);
    return val ? parseInt(val, 10) : null;
  }

  async setLastCheckTime(time: number): Promise<void> {
    await Storage.setItem(KEYS.LAST_CHECK_TIME, time.toString());
  }

  async getPendingLabel(): Promise<string | null> {
    return Storage.getItem(KEYS.PENDING_LABEL);
  }

  async setPendingLabel(label: string | null): Promise<void> {
    if (label === null) {
      await Storage.removeItem(KEYS.PENDING_LABEL);
    } else {
      await Storage.setItem(KEYS.PENDING_LABEL, label);
    }
  }

  async getPendingBundlePath(): Promise<string | null> {
    return Storage.getItem(KEYS.PENDING_BUNDLE_PATH);
  }

  async setPendingBundlePath(path: string | null): Promise<void> {
    if (path === null) {
      await Storage.removeItem(KEYS.PENDING_BUNDLE_PATH);
    } else {
      await Storage.setItem(KEYS.PENDING_BUNDLE_PATH, path);
    }
  }

  async getDistinctId(): Promise<string | null> {
    return Storage.getItem(KEYS.DISTINCT_ID);
  }

  async setDistinctId(distinctId: string): Promise<void> {
    await Storage.setItem(KEYS.DISTINCT_ID, distinctId);
  }

  async getStatus(): Promise<DeployStatus> {
    const [
      currentLabel,
      pendingLabel,
      lastCheckTime,
      crashCount,
      rolledBackLabel,
    ] = await Promise.all([
      this.getCurrentLabel(),
      this.getPendingLabel(),
      this.getLastCheckTime(),
      this.getCrashCount(),
      this.getRolledBackLabel(),
    ]);

    return {
      currentLabel,
      pendingLabel,
      lastCheckTime,
      consecutiveCrashCount: crashCount,
      isRolledBack: rolledBackLabel !== null,
      rolledBackLabel,
    };
  }

  /** Reset all deploy state (used during SDK reset/logout). */
  async clear(): Promise<void> {
    await Storage.multiRemove(Object.values(KEYS));
  }
}
