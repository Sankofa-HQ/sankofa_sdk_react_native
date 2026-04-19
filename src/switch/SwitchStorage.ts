import SankofaNativeModule from '../SankofaModule';

/**
 * Tiny key-value storage wrapper for the Switch module. Uses the same
 * native bridge as SankofaDeploy (UserDefaults on iOS, SharedPreferences
 * on Android) so we don't require `@react-native-async-storage/async-storage`
 * as a dependency — the native bridge is always present.
 *
 * In-memory fallback keeps tests and unsupported hosts functional; the
 * value just doesn't survive app restart when the native bridge is
 * absent. Switch keys are namespaced with a `switch:` prefix so they
 * coexist cleanly with Deploy's keys in the same KV store.
 */
const memoryStore = new Map<string, string>();

const KEY_PREFIX = 'switch:';

export const SwitchStorage = {
  getItem: async (key: string): Promise<string | null> => {
    const prefixed = KEY_PREFIX + key;
    try {
      if (typeof SankofaNativeModule.deployStorageGet === 'function') {
        return await SankofaNativeModule.deployStorageGet(prefixed);
      }
    } catch {
      /* native bridge unavailable — fall through to memory */
    }
    return memoryStore.get(prefixed) ?? null;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    const prefixed = KEY_PREFIX + key;
    try {
      if (typeof SankofaNativeModule.deployStorageSet === 'function') {
        await SankofaNativeModule.deployStorageSet(prefixed, value);
        return;
      }
    } catch {
      /* fall through */
    }
    memoryStore.set(prefixed, value);
  },
  removeItem: async (key: string): Promise<void> => {
    const prefixed = KEY_PREFIX + key;
    try {
      if (typeof SankofaNativeModule.deployStorageRemove === 'function') {
        await SankofaNativeModule.deployStorageRemove(prefixed);
        return;
      }
    } catch {
      /* fall through */
    }
    memoryStore.delete(prefixed);
  },
};
