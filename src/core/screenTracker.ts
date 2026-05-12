/**
 * Module-level current-screen tracker, shared across every Sankofa
 * product (Catch, Pulse, Switch, analytics) so a single source of
 * truth answers "what screen is the user on right now?" without going
 * through the native bridge for every read.
 *
 * Writers — `Sankofa.screen()`, `useSankofaScreen`, and
 * `useSankofaNavigationTracking` — call `setCurrentScreen()`. The
 * native side is also kept in sync (those entry points still call
 * `SankofaNativeModule.screen()`); this JS cache exists so on-device
 * consumers (Catch event composer, Pulse eligibility, lexicon-aware
 * code) can read it synchronously and cheaply.
 *
 * The cache is intentionally module-scoped and not bound to any
 * specific Sankofa instance — the user is on at most one screen at a
 * time across the entire RN app, so a singleton is the right shape.
 */

let _currentScreen: string | undefined;

/** Replace the active screen name. Empty / undefined clears it. */
export function setCurrentScreen(name: string | undefined): void {
  _currentScreen = name && name.length > 0 ? name : undefined;
}

/** Read the active screen name. Returns undefined if never set. */
export function getCurrentScreen(): string | undefined {
  return _currentScreen;
}
