/**
 * Jest manual mock for `expo-modules-core`.
 *
 * The contract tests don't go through the real native bridge — they
 * verify that our JS layer calls the bridge with the right method
 * names and arguments.  `requireNativeModule` returns the in-memory
 * stub defined here, which the tests then inspect via `jest.fn()`
 * spies installed at test setup time.
 *
 * Tests can replace the stub for a specific case via:
 *   `jest.requireMock('expo-modules-core').__setBridge(stub)`
 */

let currentBridge: Record<string, unknown> = {};

export function __setBridge(bridge: Record<string, unknown>): void {
  currentBridge = bridge;
}

export function __resetBridge(): void {
  currentBridge = {};
}

export function requireNativeModule(_name: string): Record<string, unknown> {
  // Return a Proxy so tests can lazily install methods after the
  // SDK module has imported the bridge — the hook test suites set up
  // their spies in `beforeEach`.
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        return currentBridge[prop];
      },
      has(_target, prop: string) {
        return prop in currentBridge;
      },
    },
  );
}
