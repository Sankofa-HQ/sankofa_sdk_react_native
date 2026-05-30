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

type ScreenChangeListener = (screen: string | undefined) => void;
const _screenListeners = new Set<ScreenChangeListener>();

/** Replace the active screen name. Empty / undefined clears it. */
export function setCurrentScreen(name: string | undefined): void {
  const next = name && name.length > 0 ? name : undefined;
  if (next === _currentScreen) return;
  _currentScreen = next;
  // Notify subscribers (e.g. the Pulse auto-show pump re-evaluates on
  // navigation — the RN analogue of the web pump's SPA-nav trigger).
  for (const l of _screenListeners) {
    try {
      l(next);
    } catch {
      // a bad subscriber must not break screen tracking
    }
  }
}

/** Read the active screen name. Returns undefined if never set. */
export function getCurrentScreen(): string | undefined {
  return _currentScreen;
}

/** Subscribe to screen changes. Returns an unsubscribe function. */
export function onScreenChange(listener: ScreenChangeListener): () => void {
  _screenListeners.add(listener);
  return () => {
    _screenListeners.delete(listener);
  };
}
