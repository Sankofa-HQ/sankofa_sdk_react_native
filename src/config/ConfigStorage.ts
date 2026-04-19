import SankofaNativeModule from '../SankofaModule';

/**
 * Key-value wrapper for SankofaConfig — same native-bridge reuse
 * pattern as SwitchStorage, different key prefix.
 */
const memoryStore = new Map<string, string>();
const KEY_PREFIX = 'config:';

export const ConfigStorage = {
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
