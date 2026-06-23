/**
 * Wire shape that mirrors server/engine/ee/configmod/evaluator_batch.go.
 */

export type ConfigType = 'string' | 'int' | 'float' | 'bool' | 'json';

export type ItemReason =
  | 'archived'
  | 'no_rule'
  | 'rule_matched'
  | 'not_in_rollout'
  | 'in_excluded_cohort'
  | 'not_in_target_cohort'
  | 'cohort_lookup_failed'
  | 'country_blocked'
  | 'country_not_in_allow'
  | 'country_unknown'
  | 'app_version_below_min'
  | 'app_version_above_max'
  | 'os_version_below_min'
  | 'os_version_above_max'
  | 'not_in_user_allow_list'
  | (string & {});

export interface ItemDecision<V = unknown> {
  value: V;
  type: ConfigType;
  reason: ItemReason;
  version: number;
}

export interface ConfigHandshakeConfig {
  enabled?: boolean;
  values?: Record<string, ItemDecision>;
  etag?: string;
  reason?: string;
  error?: string;
}

export type ConfigChangeListener = (decision: ItemDecision | null) => void;

export interface SankofaConfigAPI {
  get<V>(key: string, defaultValue: V): V;
  getDecision<V = unknown>(key: string): ItemDecision<V> | null;
  getAllKeys(): string[];
  getAll(): Record<string, unknown>;
  onChange(key: string, listener: ConfigChangeListener): () => void;
  /** The etag of the last applied handshake payload (empty until one lands). */
  getEtag(): string;
}
