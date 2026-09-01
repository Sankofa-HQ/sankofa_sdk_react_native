/**
 * Module-level event counter, shared across every Sankofa product (mirrors
 * `screenTracker`). Pulse eligibility needs to answer "has the user done event
 * X at least N times?" for KindEvent targeting rules, but the RN SDK forwards
 * `track()` straight to native and kept no JS-side tally — so `recentEvents` was
 * always empty and event rules never matched on-device. This is that tally.
 *
 * Writers: `Sankofa.track()` calls `bumpEvent(name)`. Readers: Pulse's
 * `buildContext()` reads `getEventCounts()` into the eligibility context. Counts
 * are per-process (reset on cold start), which matches "recent"/session-scoped
 * event targeting.
 */

const _counts: Record<string, number> = {};

/** Record one occurrence of an event by name. No-op for an empty name. */
export function bumpEvent(name: string): void {
  if (!name) return;
  _counts[name] = (_counts[name] ?? 0) + 1;
}

/** Snapshot of every event count seen this session. */
export function getEventCounts(): Record<string, number> {
  return { ..._counts };
}
