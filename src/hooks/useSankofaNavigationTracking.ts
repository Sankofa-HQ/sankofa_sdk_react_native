import { useEffect, useRef } from 'react';
import SankofaNativeModule from '../SankofaModule';
import { setCurrentScreen } from '../core/screenTracker';
import { emitScreenSeen } from '../core/screenSeen';

/**
 * Structural shape of a `@react-navigation/native` container ref.
 *
 * Typed structurally so this package never takes a runtime dependency
 * on `@react-navigation/native` — apps that don't use it (custom
 * Navigator 2.0 setups, no nav library at all) keep the hook out of
 * their bundle, and apps that do use it can pass
 * `useNavigationContainerRef()` directly with no cast.
 */
export interface SankofaNavigationContainerRef {
  /**
   * Returns the currently focused route, or undefined when the
   * container hasn't fully mounted yet.  React Navigation's typed
   * shape returns `{ name: string }` once mounted; we widen `name`
   * to optional to match the pre-mount transient state.
   */
  getCurrentRoute(): { name?: string } | undefined;

  /**
   * Subscribe to navigation state changes.  React Navigation calls
   * this listener after every push / pop / replace / reset.  We only
   * use the `'state'` event — that's the canonical "user moved to a
   * different screen" signal.
   */
  addListener(
    type: 'state',
    listener: () => void,
  ): () => void;
}

/**
 * `useSankofaNavigationTracking` — automatically tag screens for
 * heatmaps + replay using your `@react-navigation/native` container.
 *
 * Drop this hook into your app root once and every screen change
 * propagates to the native Sankofa SDK as a `screen(routeName)` call,
 * removing the need for per-screen `useSankofaScreen('Name')`.
 *
 * @example
 * ```tsx
 * import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
 * import { useSankofaNavigationTracking } from 'sankofa-react-native';
 *
 * export default function App() {
 *   const navRef = useNavigationContainerRef();
 *   useSankofaNavigationTracking(navRef);
 *
 *   return (
 *     <NavigationContainer ref={navRef}>
 *       <RootStack />
 *     </NavigationContainer>
 *   );
 * }
 * ```
 *
 * For `useRef`-style refs (the older pattern), pass `ref.current`:
 *
 * ```tsx
 * const navRef = useRef<NavigationContainerRef<ParamList> | null>(null);
 * useSankofaNavigationTracking(navRef.current);
 * ```
 *
 * The hook is a no-op when `ref` is null/undefined — safe to call
 * before the container mounts.  Once a non-null ref arrives, it
 * subscribes and tags the initial route immediately.
 *
 * Internally we dedupe by route name so re-render churn or
 * params-only state changes don't fire redundant native bridge
 * calls.  The native side already de-dupes idempotent
 * `screen(sameName)` calls cheaply, but trimming on the JS side keeps
 * the bridge log clean during development.
 */
export function useSankofaNavigationTracking(
  ref: SankofaNavigationContainerRef | null | undefined,
): void {
  const lastTaggedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ref) return;

    const tagIfChanged = () => {
      let name: string | undefined;
      try {
        name = ref.getCurrentRoute()?.name;
      } catch {
        // Defensive: ref methods can throw before the container
        // finishes mounting on older react-navigation versions.
        // Skip silently — the next state change will retry.
        return;
      }
      if (!name) return;
      if (name === lastTaggedRef.current) return;
      lastTaggedRef.current = name;
      setCurrentScreen(name);
      SankofaNativeModule.screen(name, {});
      void emitScreenSeen(name, { $auto_detected: true });
    };

    // Tag the initial route synchronously.  React Navigation fires
    // the first 'state' event AFTER mount, so without this the very
    // first screen wouldn't be tagged until the user navigates away.
    tagIfChanged();

    const unsubscribe = ref.addListener('state', tagIfChanged);
    return () => {
      unsubscribe();
    };
  }, [ref]);
}
