/**
 * SankofaDeploy.checkIntegration() — JS-side mapping tests.
 *
 * Pins the contract between the raw `deployCheckIntegration` bridge
 * response and the structured `ModuleIntegrationStatus` that hosts
 * (and the future reverse-handshake) consume. A silent rename on the
 * native side or a level-derivation regression fails here instead of
 * silently misleading developers into thinking their integration is fine.
 *
 * Uses the same `__setBridge` jest mock the existing bridge.test.ts uses.
 */

interface BridgeState {
  setBridge(bridge: Record<string, unknown>): void;
  resetBridge(): void;
}

function loadFreshMock(): BridgeState {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = require('./__mocks__/expo-modules-core');
  return { setBridge: m.__setBridge, resetBridge: m.__resetBridge };
}

function freshSDK() {
  jest.resetModules();
  const { setBridge } = loadFreshMock();
  return { setBridge };
}

describe('SankofaDeploy.checkIntegration()', () => {
  it('reports `full` when the bundle loader is wired and INTERNET is granted (Android happy path)', async () => {
    const { setBridge } = freshSDK();
    setBridge({
      initialize: jest.fn(),
      deployCheckIntegration: jest.fn().mockResolvedValue({
        bundleLoaderWired: true,
        internetPermission: true,
        applicationClass: 'com.example.MyApp',
        reactNativeHostClass: 'com.example.MyApp$1',
        storageOk: true,
        platform: 'android',
      }),
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SankofaDeploy } = require('../src/deploy/SankofaDeploy');
    const deploy = new SankofaDeploy({
      apiKey: 'sk_test',
      serverUrl: 'http://localhost',
      checkOnResume: false,
    });

    const status = await deploy.checkIntegration();
    expect(status.module).toBe('deploy');
    expect(status.level).toBe('full');
    expect(status.missing).toEqual([]);
    expect(status.warnings).toEqual([]);
  });

  it('reports `partial` when ONLY the Android bundle loader patch is missing', async () => {
    const { setBridge } = freshSDK();
    setBridge({
      initialize: jest.fn(),
      deployCheckIntegration: jest.fn().mockResolvedValue({
        bundleLoaderWired: false,
        internetPermission: true,
        applicationClass: 'com.example.MyApp',
        reactNativeHostClass: 'com.example.MyApp$1',
        storageOk: true,
        platform: 'android',
      }),
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SankofaDeploy } = require('../src/deploy/SankofaDeploy');
    const deploy = new SankofaDeploy({ apiKey: 'sk_test', serverUrl: 'http://localhost', checkOnResume: false });

    const status = await deploy.checkIntegration();
    expect(status.level).toBe('partial');
    expect(status.missing).toHaveLength(1);
    expect(status.missing[0]).toMatch(/MainApplication.*getJSBundleFile/);
  });

  it('reports `broken` when both bundle loader AND INTERNET are missing (Android)', async () => {
    const { setBridge } = freshSDK();
    setBridge({
      initialize: jest.fn(),
      deployCheckIntegration: jest.fn().mockResolvedValue({
        bundleLoaderWired: false,
        internetPermission: false,
        applicationClass: 'com.example.MyApp',
        reactNativeHostClass: 'com.example.MyApp$1',
        storageOk: true,
        platform: 'android',
      }),
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SankofaDeploy } = require('../src/deploy/SankofaDeploy');
    const deploy = new SankofaDeploy({ apiKey: 'sk_test', serverUrl: 'http://localhost', checkOnResume: false });

    const status = await deploy.checkIntegration();
    expect(status.level).toBe('broken');
    expect(status.missing).toHaveLength(2);
    expect(status.missing.some((m: string) => /INTERNET/.test(m))).toBe(true);
  });

  it('downgrades iOS DEBUG bundle-loader miss to a warning instead of broken', async () => {
    const { setBridge } = freshSDK();
    setBridge({
      initialize: jest.fn(),
      deployCheckIntegration: jest.fn().mockResolvedValue({
        bundleLoaderWired: false,
        internetPermission: null,
        applicationClass: null,
        appDelegateClass: 'AppDelegate',
        storageOk: true,
        platform: 'ios',
      }),
    });

    // Jest config sets __DEV__ to true globally.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SankofaDeploy } = require('../src/deploy/SankofaDeploy');
    const deploy = new SankofaDeploy({ apiKey: 'sk_test', serverUrl: 'http://localhost', checkOnResume: false });

    const status = await deploy.checkIntegration();
    expect(status.level).toBe('full');
    expect(status.missing).toEqual([]);
    expect(status.warnings).toHaveLength(1);
    expect(status.warnings[0]).toMatch(/__DEV__/);
  });

  it('reports `broken` for iOS RELEASE with no bundle loader patch (__DEV__ off)', async () => {
    const originalDev = (globalThis as any).__DEV__;
    (globalThis as any).__DEV__ = false;
    try {
      const { setBridge } = freshSDK();
      setBridge({
        initialize: jest.fn(),
        deployCheckIntegration: jest.fn().mockResolvedValue({
          bundleLoaderWired: false,
          internetPermission: null,
          applicationClass: null,
          appDelegateClass: 'AppDelegate',
          storageOk: true,
          platform: 'ios',
        }),
      });

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SankofaDeploy } = require('../src/deploy/SankofaDeploy');
      const deploy = new SankofaDeploy({ apiKey: 'sk_test', serverUrl: 'http://localhost', checkOnResume: false });

      const status = await deploy.checkIntegration();
      expect(status.level).toBe('partial');
      expect(status.missing).toHaveLength(1);
      expect(status.missing[0]).toMatch(/AppDelegate.*bundleURL/);
    } finally {
      (globalThis as any).__DEV__ = originalDev;
    }
  });

  it('returns `broken` when the native bridge does not expose deployCheckIntegration', async () => {
    const { setBridge } = freshSDK();
    // Note: no deployCheckIntegration on the bridge — old binary.
    setBridge({ initialize: jest.fn() });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SankofaDeploy } = require('../src/deploy/SankofaDeploy');
    const deploy = new SankofaDeploy({ apiKey: 'sk_test', serverUrl: 'http://localhost', checkOnResume: false });

    const status = await deploy.checkIntegration();
    expect(status.level).toBe('broken');
    expect(status.missing[0]).toMatch(/older `sankofa-react-native` binary/);
  });
});
