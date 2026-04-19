import type { SankofaModule } from '../core/ModuleRegistry';
import { registerModule, isCoreInitialized } from '../core/ModuleRegistry';
import { SwitchStorage } from './SwitchStorage';
import type {
  FlagChangeListener,
  FlagDecision,
  SankofaSwitchAPI,
  SwitchHandshakeConfig,
} from './SwitchTypes';

const STORAGE_KEY = 'state';
const STALE_MAX_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface PersistedState {
  flags: Record<string, FlagDecision>;
  etag: string;
  savedAt: number;
}

/**
 * Sankofa Switch — feature flags on React Native. Construct once after
 * Sankofa.initialize():
 *
 *   Sankofa.initialize('sk_live_...');
 *   const switches = new SankofaSwitch({ defaults: { new_checkout: {...} } });
 *   // later, from anywhere:
 *   switches.getFlag('new_checkout', false);
 *
 * The instance registers itself with the Traffic Cop so the handshake
 * response's modules.switch payload flows here automatically. Calls
 * made before the handshake completes return the bundled default or
 * the last persisted value from native storage (7-day stale window).
 */
export class SankofaSwitch implements SankofaModule, SankofaSwitchAPI {
  readonly name = 'switch' as const;

  private flags: Record<string, FlagDecision> = {};
  private etag = '';
  private savedAt = 0;
  private defaults: Record<string, FlagDecision>;
  private listeners = new Map<string, Set<FlagChangeListener>>();
  private hydrated = false;

  constructor(options: { defaults?: Record<string, FlagDecision> } = {}) {
    this.defaults = options.defaults ?? {};
    registerModule(this);
    if (!isCoreInitialized()) {
      // Register anyway — the constructor warning in ModuleRegistry
      // will remind the dev to call Sankofa.initialize() first.
    }
    // Fire-and-forget hydrate from native storage. getFlag() called
    // before hydration completes returns the defaults — acceptable
    // because the first few synchronous frames of app launch are the
    // rare window where cache isn't available.
    void this.hydrate();
  }

  // ── SankofaModule (Traffic Cop hook) ────────────────────────────

  async applyHandshake(config: unknown): Promise<void> {
    const cfg = config as SwitchHandshakeConfig | undefined;
    if (!cfg || cfg.enabled === false) return;
    const incoming = cfg.flags ?? {};
    const { changed, removed } = this.diff(incoming);
    this.flags = { ...incoming };
    this.etag = cfg.etag ?? '';
    this.savedAt = Date.now();
    await this.persist();
    this.fire(changed, removed);
  }

  // ── Public API ──────────────────────────────────────────────────

  getFlag(key: string, defaultValue = false): boolean {
    return this.resolve(key)?.value ?? defaultValue;
  }

  getVariant(key: string, defaultValue = ''): string {
    return this.resolve(key)?.variant ?? defaultValue;
  }

  getDecision(key: string): FlagDecision | null {
    return this.resolve(key);
  }

  getAllKeys(): string[] {
    return [...new Set([...Object.keys(this.flags), ...Object.keys(this.defaults)])];
  }

  onChange(key: string, listener: FlagChangeListener): () => void {
    let bucket = this.listeners.get(key);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(key, bucket);
    }
    bucket.add(listener);
    return () => {
      const b = this.listeners.get(key);
      if (!b) return;
      b.delete(listener);
      if (b.size === 0) this.listeners.delete(key);
    };
  }

  /** Current composite etag — used by the core to send If-None-Match on refresh. */
  getEtag(): string {
    return this.etag;
  }

  // ── Internals ───────────────────────────────────────────────────

  private resolve(key: string): FlagDecision | null {
    return this.flags[key] ?? this.defaults[key] ?? null;
  }

  private async hydrate(): Promise<void> {
    try {
      const raw = await SwitchStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedState;
      if (!parsed || typeof parsed !== 'object') return;
      if (parsed.savedAt && Date.now() - parsed.savedAt > STALE_MAX_MS) return;
      this.flags = parsed.flags || {};
      this.etag = parsed.etag || '';
      this.savedAt = parsed.savedAt || 0;
      // Fire listeners attached before hydration completed — they
      // registered with an empty set, so every key looks "new" to them.
      this.fire(new Set(Object.keys(this.flags)), new Set());
    } catch {
      /* corrupt JSON — ignore, next apply() will overwrite */
    } finally {
      this.hydrated = true;
    }
  }

  private async persist(): Promise<void> {
    try {
      const payload: PersistedState = {
        flags: this.flags,
        etag: this.etag,
        savedAt: this.savedAt,
      };
      await SwitchStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* best-effort; in-memory state stays correct */
    }
  }

  private diff(incoming: Record<string, FlagDecision>): {
    changed: Set<string>;
    removed: Set<string>;
  } {
    const changed = new Set<string>();
    const removed = new Set<string>();
    for (const key of Object.keys(this.flags)) {
      if (!(key in incoming)) removed.add(key);
    }
    for (const [key, decision] of Object.entries(incoming)) {
      if (!decisionEquals(this.flags[key], decision)) changed.add(key);
    }
    return { changed, removed };
  }

  private fire(changed: Set<string>, removed: Set<string>): void {
    for (const key of changed) {
      const bucket = this.listeners.get(key);
      if (!bucket) continue;
      const decision = this.flags[key] ?? null;
      for (const listener of bucket) {
        try {
          listener(decision);
        } catch (err) {
          if (__DEV__) console.warn(`[Sankofa] switch onChange for "${key}" threw`, err);
        }
      }
    }
    for (const key of removed) {
      const bucket = this.listeners.get(key);
      if (!bucket) continue;
      for (const listener of bucket) {
        try {
          listener(null);
        } catch (err) {
          if (__DEV__) console.warn(`[Sankofa] switch onChange (remove) for "${key}" threw`, err);
        }
      }
    }
  }
}

function decisionEquals(a: FlagDecision | undefined, b: FlagDecision): boolean {
  if (!a) return false;
  return (
    a.value === b.value &&
    a.variant === b.variant &&
    a.reason === b.reason &&
    a.version === b.version
  );
}
