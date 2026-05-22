/**
 * # Module integration self-audit
 *
 * `enableDeploy: true` (or any `enableX` flag) in `Sankofa.initialize`
 * is *intent* — it does NOT guarantee the host actually patched their
 * MainApplication/AppDelegate, granted the right permissions, or
 * wired the bundle loader. Each module that has host-side wiring
 * exposes `checkIntegration()` which probes the runtime state and
 * reports back via [ModuleIntegrationStatus]:
 *
 *  - **full** — everything wired; OTA / module operations will work
 *  - **partial** — module constructed but missing pieces will silently
 *    break some operations (e.g. INTERNET not granted → network calls
 *    fail; AppDelegate not patched → patches install but don't load)
 *  - **broken** — fundamental wiring missing, module is non-functional
 *
 * In `__DEV__` builds, [Sankofa.initialize] runs the audit asynchronously
 * after init completes and prints warnings for anything below `full` so
 * the developer sees the gap during development. Future work: forward
 * the result to the server via the reverse handshake so the dashboard
 * can show "SDK Integration Incomplete" badges.
 *
 * Mirrors [ModuleIntegrationStatus] in
 * `sdks/sankofa_sdk_flutter/lib/src/core/module_registry.dart` —
 * keep them in lockstep.
 */

import type { SankofaModuleName } from './ModuleRegistry';

export type ModuleIntegrationLevel = 'full' | 'partial' | 'broken';

export interface ModuleIntegrationStatus {
  /** Module this status describes (matches the wire name). */
  module: SankofaModuleName;
  level: ModuleIntegrationLevel;
  /** Required pieces that are missing. Each string is human-readable. */
  missing: string[];
  /** Non-blocking concerns (e.g. "DEBUG build, audit ran early"). */
  warnings: string[];
}

export function isFullIntegration(s: ModuleIntegrationStatus): boolean {
  return s.level === 'full';
}

export function isUsableIntegration(s: ModuleIntegrationStatus): boolean {
  return s.level !== 'broken';
}

/** Derive the level from missing-count, matching Flutter's rule. */
export function deriveIntegrationLevel(missing: string[]): ModuleIntegrationLevel {
  if (missing.length === 0) return 'full';
  if (missing.length >= 2) return 'broken';
  return 'partial';
}
