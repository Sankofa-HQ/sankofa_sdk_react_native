/**
 * Bridge contract test.
 *
 * Pins the JS-side contract for the native Sankofa Expo Module so
 * silent renames or wire-shape drift surface as a test failure
 * instead of a runtime "undefined is not a function" deep in a
 * production app.
 *
 * Why no react-test-renderer here: the hooks under test
 * (`useSankofaScreen`, `useSankofaNavigationTracking`) just delegate
 * to the bridge — driving their effect bodies directly via mocks is
 * faster, less brittle, and avoids dragging in a renderer the
 * production package doesn't ship.
 *
 * `jest.resetModules()` is called at the top of every test so the
 * bridge mock and the SDK module reload together — without that, the
 * `__setBridge` helper imported at file scope would mutate a
 * different copy of the mock than the SDK actually consumes.
 */

interface BridgeState {
  setBridge(bridge: Record<string, unknown>): void;
  resetBridge(): void;
}

function loadFreshMock(): BridgeState {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = require('./__mocks__/expo-modules-core');
  return {
    setBridge: m.__setBridge,
    resetBridge: m.__resetBridge,
  };
}

describe('SankofaNativeModule bridge', () => {
  it('exposes the methods every JS call site assumes exist', () => {
    jest.resetModules();
    const { setBridge } = loadFreshMock();

    const screen = jest.fn();
    const track = jest.fn();
    const initialize = jest.fn();
    const identify = jest.fn();
    const setPerson = jest.fn();
    const reset = jest.fn();
    const flush = jest.fn();
    setBridge({ screen, track, initialize, identify, setPerson, reset, flush });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bridge = require('../src/SankofaModule').default;

    bridge.screen('Home', { foo: 'bar' });
    bridge.track('cta_clicked', { source: 'hero' });
    bridge.initialize('sk_test', { endpoint: 'http://localhost' });
    bridge.identify('user_42');
    bridge.setPerson({ name: 'Doe' });
    bridge.reset();
    bridge.flush();

    expect(screen).toHaveBeenCalledWith('Home', { foo: 'bar' });
    expect(track).toHaveBeenCalledWith('cta_clicked', { source: 'hero' });
    expect(initialize).toHaveBeenCalledWith('sk_test', { endpoint: 'http://localhost' });
    expect(identify).toHaveBeenCalledWith('user_42');
    expect(setPerson).toHaveBeenCalledWith({ name: 'Doe' });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('treats deploy methods as optional so older binaries still load', () => {
    jest.resetModules();
    const { setBridge } = loadFreshMock();

    setBridge({ screen: jest.fn() });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bridge = require('../src/SankofaModule').default;

    expect(bridge.deployGetBundlePath).toBeUndefined();
    expect(bridge.deployStorageGet).toBeUndefined();
    expect(typeof bridge.deployGetBundlePath === 'function').toBe(false);
  });
});

describe('useSankofaScreen', () => {
  it('calls bridge.screen with the screen name on first mount', () => {
    jest.resetModules();
    // Replace `react` with a stub that runs effects synchronously
    // before the SDK module imports it.  Order matters — the SDK's
    // `import { useEffect } from 'react'` resolves to whatever is
    // registered when its module is first required.
    jest.doMock('react', () => ({
      useEffect: (fn: () => void) => fn(),
      useRef: <T,>(initial: T) => ({ current: initial }),
    }));
    const { setBridge } = loadFreshMock();
    const screen = jest.fn();
    setBridge({ screen });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSankofaScreen } = require('../src/hooks/useSankofaScreen');
    useSankofaScreen('Home');

    expect(screen).toHaveBeenCalledWith('Home', {});
    jest.dontMock('react');
  });
});

describe('Sankofa.* static helpers (Phase A — Crashlytics + Sentry merged)', () => {
  beforeEach(() => {
    jest.resetModules();
    // Force a clean SankofaCatch singleton across tests.  The mock
    // bridge gets installed below — we DON'T construct SankofaCatch
    // implicitly through `Sankofa.initialize` here, since that would
    // need a live native bridge.  Instead each test sets the desired
    // start state explicitly.
  });

  it('all helpers degrade to no-op when SankofaCatch is uninitialised', () => {
    jest.resetModules();
    const { setBridge } = loadFreshMock();
    setBridge({
      screen: jest.fn(),
      track: jest.fn(),
      initialize: jest.fn(),
      identify: jest.fn(),
      setPerson: jest.fn(),
      reset: jest.fn(),
      flush: jest.fn(),
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Sankofa, SankofaCatch } = require('../src/index');
    expect(SankofaCatch.instance).toBeNull();

    // Every static helper must be safe to call before init — host
    // code shouldn't have to guard.
    expect(() => Sankofa.captureException(new Error('handled'))).not.toThrow();
    expect(() => Sankofa.captureMessage('hello')).not.toThrow();
    expect(() => Sankofa.log('breadcrumb')).not.toThrow();
    expect(() => Sankofa.setTag('feature', 'billing')).not.toThrow();
    expect(() => Sankofa.setTags({ a: 'b' })).not.toThrow();
    expect(() => Sankofa.setExtra('cart_total', 49)).not.toThrow();
    expect(() => Sankofa.setUser({ id: 'u1' })).not.toThrow();
    expect(() => Sankofa.addBreadcrumb({ type: 'log', message: 'm' })).not.toThrow();

    expect(Sankofa.captureException(new Error('handled'))).toBe('');
    expect(Sankofa.captureMessage('hello')).toBe('');
  });

  it('captureException routes to the active SankofaCatch singleton', () => {
    jest.resetModules();
    const { setBridge } = loadFreshMock();
    setBridge({
      screen: jest.fn(),
      track: jest.fn(),
      initialize: jest.fn(),
      identify: jest.fn(),
      setPerson: jest.fn(),
      reset: jest.fn(),
      flush: jest.fn(),
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Sankofa, SankofaCatch } = require('../src/index');

    // Construct a Catch instance directly — emulates what
    // `Sankofa.initialize({ enableCatch: true })` does at runtime
    // without going through the native bridge.
    const catcher = new SankofaCatch({ environment: 'test' });
    expect(SankofaCatch.instance).toBe(catcher);

    // Spy on the instance method to confirm static -> instance routing.
    const spy = jest.spyOn(catcher, 'captureException').mockReturnValue('evt_42');
    const id = Sankofa.captureException(new Error('handled'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(id).toBe('evt_42');

    catcher.shutdown();
  });

  it('first SankofaCatch construction wins; second construction is a no-op', () => {
    jest.resetModules();
    const { setBridge } = loadFreshMock();
    setBridge({ screen: jest.fn() });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SankofaCatch } = require('../src/index');

    const first = new SankofaCatch({ environment: 'test' });
    expect(SankofaCatch.instance).toBe(first);

    // A second construction (hot-reload race, accidental host
    // duplication) must not shadow the active instance.
    const second = new SankofaCatch({ environment: 'test' });
    expect(SankofaCatch.instance).toBe(first);
    expect(second).not.toBe(first);

    first.shutdown();
  });
});

describe('useSankofaNavigationTracking', () => {
  /**
   * Stub for the `useNavigationContainerRef()` shape — minimal
   * enough that a test can drive route changes by mutating
   * `currentRoute` and calling listeners manually.
   */
  function makeNavRefStub(initialRoute?: string) {
    let currentRoute = initialRoute;
    const listeners = new Set<() => void>();
    return {
      setRoute(name: string | undefined) {
        currentRoute = name;
      },
      fireState() {
        listeners.forEach((l) => l());
      },
      getCurrentRoute: () =>
        currentRoute ? { name: currentRoute } : undefined,
      addListener: (
        type: 'state',
        listener: () => void,
      ) => {
        if (type !== 'state') return () => {};
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
  }

  function setupHookHarness(): {
    runHook: (ref: unknown) => () => void;
    setBridge: (bridge: Record<string, unknown>) => void;
  } {
    jest.resetModules();
    let effectCleanup: () => void = () => {};
    jest.doMock('react', () => ({
      useEffect: (fn: () => void) => {
        const result = fn();
        if (typeof result === 'function') {
          effectCleanup = result as () => void;
        }
      },
      useRef: <T,>(initial: T) => ({ current: initial }),
    }));
    const { setBridge } = loadFreshMock();
    return {
      setBridge,
      runHook: (ref: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useSankofaNavigationTracking } = require('../src/hooks/useSankofaNavigationTracking');
        useSankofaNavigationTracking(ref);
        return effectCleanup;
      },
    };
  }

  afterEach(() => {
    jest.dontMock('react');
  });

  it('tags the initial route synchronously and dedupes redundant state events', () => {
    const harness = setupHookHarness();
    const screen = jest.fn();
    harness.setBridge({ screen });

    const navRef = makeNavRefStub('Home');
    const cleanup = harness.runHook(navRef);

    // 1. Initial route gets tagged synchronously (don't wait for the
    //    first state event, which fires only after a navigation).
    expect(screen).toHaveBeenCalledTimes(1);
    expect(screen).toHaveBeenLastCalledWith('Home', {});

    // 2. A state event for the SAME route must not re-tag.
    navRef.fireState();
    expect(screen).toHaveBeenCalledTimes(1);

    // 3. Navigating to a new route tags exactly once.
    navRef.setRoute('Checkout');
    navRef.fireState();
    expect(screen).toHaveBeenCalledTimes(2);
    expect(screen).toHaveBeenLastCalledWith('Checkout', {});

    // 4. Cleanup unsubscribes — subsequent state events go nowhere.
    cleanup();
    navRef.setRoute('Home');
    navRef.fireState();
    expect(screen).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when the navigation ref is null/undefined', () => {
    const harness = setupHookHarness();
    const screen = jest.fn();
    harness.setBridge({ screen });

    harness.runHook(null);
    harness.runHook(undefined);

    expect(screen).not.toHaveBeenCalled();
  });

  it('survives a getCurrentRoute() that throws before mount', () => {
    const harness = setupHookHarness();
    const screen = jest.fn();
    harness.setBridge({ screen });

    const throwingRef = {
      getCurrentRoute: () => {
        throw new Error('container not mounted');
      },
      addListener: () => () => {},
    };

    expect(() => harness.runHook(throwingRef)).not.toThrow();
    expect(screen).not.toHaveBeenCalled();
  });
});
