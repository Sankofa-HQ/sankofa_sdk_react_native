/**
 * Wire shape that mirrors server/engine/ee/switchmod/evaluator_batch.go.
 * Kept colocated with the module so a server rename breaks the TS
 * compile — silent drift is the worst failure mode for feature-flag
 * contracts.
 */

export type FlagReason =
  | 'archived'
  | 'halted'
  | 'scheduled'
  | 'no_rule'
  | 'rollout'
  | 'variant_assigned'
  | 'variant_unavailable'
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
  | 'dependency_unmet'
  | 'override_parse_error'
  | (string & {});

export interface FlagDecision {
  value: boolean;
  variant?: string;
  reason: FlagReason;
  version: number;
}

export interface SwitchHandshakeConfig {
  enabled?: boolean;
  flags?: Record<string, FlagDecision>;
  etag?: string;
  reason?: string;
  error?: string;
}

/** Callback fired on handshake-driven flag changes. null = flag removed. */
export type FlagChangeListener = (decision: FlagDecision | null) => void;

/**
 * Public API surface SankofaSwitch exposes to the host app. Declared
 * as an interface so tests can swap the impl and so the class type
 * stays out of host-app imports.
 */
export interface SankofaSwitchAPI {
  getFlag(key: string, defaultValue?: boolean): boolean;
  getVariant(key: string, defaultValue?: string): string;
  getDecision(key: string): FlagDecision | null;
  getAllKeys(): string[];
  onChange(key: string, listener: FlagChangeListener): () => void;
}
