import SankofaNativeModule from '../SankofaModule';

/**
 * Persistent storage for the Catch queue + sticky state. Uses the
 * same native bridge as Switch / Config / Deploy so we don't require
 * `@react-native-async-storage/async-storage` as a dependency.
 *
 * In-memory fallback keeps tests functional. Keys are namespaced with
 * `catch:` so they don't collide.
 */
const memoryStore = new Map<string, string>();
const KEY_PREFIX = 'catch:';

export const CatchStorage = {
  getItem: async (key: string): Promise<string | null> => {
    const prefixed = KEY_PREFIX + key;
    try {
      if (typeof SankofaNativeModule.deployStorageGet === 'function') {
        return await SankofaNativeModule.deployStorageGet(prefixed);
      }
    } catch {
      /* fall through */
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
