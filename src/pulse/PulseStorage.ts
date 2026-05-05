import SankofaNativeModule from '../SankofaModule';

/**
 * Persistent key-value storage for the Pulse module. Uses the
 * shared native bridge (UserDefaults on iOS, SharedPreferences on
 * Android) — same pattern as Switch / Deploy — so we don't take a
 * hard dependency on `@react-native-async-storage/async-storage`.
 *
 * Falls back to an in-memory Map when the native bridge isn't
 * present (tests, unusual hosts). The cached survey list is the
 * fallback's only consumer; missing it just means the SDK fetches
 * fresh on every cold start, which still behaves correctly — it
 * just doesn't deliver the steady-state server-load relief.
 *
 * Keys are prefixed with `pulse:` so they coexist with the other
 * modules' keys in the same KV store.
 */
const memoryStore = new Map<string, string>();

const KEY_PREFIX = 'pulse:';

export const PulseStorage = {
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
