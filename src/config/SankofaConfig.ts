import type { SankofaModule } from '../core/ModuleRegistry';
import { isCoreInitialized, registerModule } from '../core/ModuleRegistry';
import {
  deriveIntegrationLevel,
  type ModuleIntegrationStatus,
} from '../core/integration';
import { coerceConfigValue } from './coerce';
import { ConfigStorage } from './ConfigStorage';
import type {
  ConfigChangeListener,
  ConfigHandshakeConfig,
  ItemDecision,
  SankofaConfigAPI,
} from './ConfigTypes';

const STORAGE_KEY = 'state';
const STALE_MAX_MS = 7 * 24 * 60 * 60 * 1000;

interface PersistedState {
  values: Record<string, ItemDecision>;
  etag: string;
  savedAt: number;
}

/**
 * Sankofa Config — remote config on React Native. Same lifecycle as
 * SankofaSwitch: construct once after Sankofa.initialize(), the
 * Traffic Cop routes handshake payloads here, values are persisted
 * to native storage and hydrated on next boot.
 *
 *   Sankofa.initialize('sk_live_...');
 *   const cfg = new SankofaConfig({ defaults: { maxUploadMb: {...} } });
 *   cfg.get<number>('max_upload_mb', 25);
 */
export class SankofaConfig implements SankofaModule, SankofaConfigAPI {
  readonly name = 'config' as const;

  private values: Record<string, ItemDecision> = {};
  private etag = '';
  private savedAt = 0;
  /** See SankofaSwitch.serverApplied — guards the hydrate/handshake race
   *  so a slow native read never clobbers fresher server config. */
  private serverApplied = false;
  private defaults: Record<string, ItemDecision>;
  private listeners = new Map<string, Set<ConfigChangeListener>>();

  constructor(options: { defaults?: Record<string, ItemDecision> } = {}) {
    this.defaults = options.defaults ?? {};
    registerModule(this);
    void this.hydrate();
  }

  async applyHandshake(config: unknown): Promise<void> {
    const cfg = config as ConfigHandshakeConfig | undefined;
    if (!cfg || cfg.enabled === false) return;
    const incoming = cfg.values ?? {};
    const { changed, removed } = this.diff(incoming);
    this.values = { ...incoming };
    this.etag = cfg.etag ?? '';
    this.savedAt = Date.now();
    this.serverApplied = true;
    await this.persist();
    this.fire(changed, removed);
  }

  /**
   * Self-audit the host's Config integration. Mirrors Switch — checks
   * the cases that silently lose values:
   *   - core not initialised before construction (broken)
   *   - no server values + no defaults (broken — every get() returns inline default)
   *   - handshake hasn't landed yet (warn)
   *   - etag empty (warn — every refresh round-trips)
   */
  async checkIntegration(): Promise<ModuleIntegrationStatus> {
    const missing: string[] = [];
    const warnings: string[] = [];

    if (!isCoreInitialized()) {
      missing.push(
        'Sankofa.initialize() has not run yet — SankofaConfig was constructed before the core. Move new SankofaConfig() after the initialize call.',
      );
    }
    const valueCount = Object.keys(this.values).length;
    const defaultCount = Object.keys(this.defaults).length;
    if (valueCount === 0 && defaultCount === 0) {
      missing.push(
        'No config values from server and no bundled defaults supplied. Every get(key, fallback) will return the inline fallback.',
      );
    } else if (valueCount === 0) {
      warnings.push(
        'No values from server yet — handshake may not have completed, or the project has no config items. Defaults will be used.',
      );
    }
    if (!this.etag) {
      warnings.push(
        'No etag stored — the SDK can not short-circuit subsequent handshakes with If-None-Match.',
      );
    }

    return {
      module: 'config',
      level: deriveIntegrationLevel(missing),
      missing,
      warnings,
    };
  }

  // ── Public API ──────────────────────────────────────────────────

  get<V>(key: string, defaultValue: V): V {
    const decision = this.resolve(key);
    if (!decision) return defaultValue;
    return coerceConfigValue(decision.value, defaultValue);
  }

  getDecision<V = unknown>(key: string): ItemDecision<V> | null {
    return this.resolve(key) as ItemDecision<V> | null;
  }

  getAllKeys(): string[] {
    return [...new Set([...Object.keys(this.values), ...Object.keys(this.defaults)])];
  }

  getAll(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, d] of Object.entries(this.defaults)) out[k] = d.value;
    for (const [k, d] of Object.entries(this.values)) out[k] = d.value;
    return out;
  }

  onChange(key: string, listener: ConfigChangeListener): () => void {
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

  /** Etag the core sends as If-None-Match on the next handshake. */
  getEtag(): string {
    return this.etag;
  }

  // ── Internals ───────────────────────────────────────────────────

  private resolve(key: string): ItemDecision | null {
    return this.values[key] ?? this.defaults[key] ?? null;
  }

  private async hydrate(): Promise<void> {
    try {
      const raw = await ConfigStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedState;
      if (!parsed || typeof parsed !== 'object') return;
      if (parsed.savedAt && Date.now() - parsed.savedAt > STALE_MAX_MS) return;
      // Never clobber fresher server config with the stale persisted snapshot.
      if (this.serverApplied || (parsed.savedAt ?? 0) <= this.savedAt) return;
      this.values = parsed.values || {};
      this.etag = parsed.etag || '';
      this.savedAt = parsed.savedAt || 0;
      this.fire(new Set(Object.keys(this.values)), new Set());
    } catch {
      /* ignore corrupt cache */
    }
  }

  private async persist(): Promise<void> {
    try {
      const payload: PersistedState = {
        values: this.values,
        etag: this.etag,
        savedAt: this.savedAt,
      };
      await ConfigStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* best-effort */
    }
  }

  private diff(incoming: Record<string, ItemDecision>): {
    changed: Set<string>;
    removed: Set<string>;
  } {
    const changed = new Set<string>();
    const removed = new Set<string>();
    for (const key of Object.keys(this.values)) {
      if (!(key in incoming)) removed.add(key);
    }
    for (const [key, decision] of Object.entries(incoming)) {
      if (!decisionEquals(this.values[key], decision)) changed.add(key);
    }
    return { changed, removed };
  }

  private fire(changed: Set<string>, removed: Set<string>): void {
    for (const key of changed) {
      const bucket = this.listeners.get(key);
      if (!bucket) continue;
      const decision = this.values[key] ?? null;
      for (const listener of bucket) {
        try {
          listener(decision);
        } catch (err) {
          if (__DEV__) console.warn(`[Sankofa] config onChange for "${key}" threw`, err);
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
          if (__DEV__) console.warn(`[Sankofa] config onChange (remove) for "${key}" threw`, err);
        }
      }
    }
  }
}

function decisionEquals(a: ItemDecision | undefined, b: ItemDecision): boolean {
  if (!a) return false;
  if (a.version !== b.version || a.reason !== b.reason || a.type !== b.type) return false;
  if (a.value === b.value) return true;
  try {
    return JSON.stringify(a.value) === JSON.stringify(b.value);
  } catch {
    return false;
  }
}
