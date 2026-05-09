/**
 * # Traffic Cop — Module Registry
 *
 * The Core SDK needs to know what modules the developer actually installed,
 * not what the server *thinks* is available. Without this, a dashboard
 * toggle could try to activate a module whose code isn't loaded, crashing
 * the app.
 *
 * ## The problem
 * If the server's handshake says `{ catch: { enabled: true } }` but the
 * developer didn't import `SankofaCatch`, naive code would try to call
 * into Catch and hit a ReferenceError in production.
 *
 * ## The solution
 * Every module (Deploy, Catch, and future additions) registers itself
 * with the Core at construction time. When the handshake response
 * arrives, the Core routes each module flag to the corresponding
 * registered handler. Flags for modules that aren't registered are:
 *
 *  - **Dev mode:** logged as a warning so engineers know they forgot to
 *    install or import the module.
 *  - **Production:** silently ignored. The app never crashes from a
 *    dashboard toggle.
 *
 * This file also owns the `installed_modules` list that's reported back
 * to the server in the Reverse Handshake so the dashboard can show
 * "SDK Not Detected" states for modules the app binary doesn't have.
 */

import type { HandshakeModules } from '../index';

/** The canonical module names Sankofa ships. */
export type SankofaModuleName =
  | 'analytics'
  | 'deploy'
  | 'catch'
  | 'switch'
  | 'config';

/**
 * Interface every pluggable module implements. The Core never imports
 * concrete module classes — it only talks to them through this shape,
 * so a module can be entirely absent from the bundle without breaking
 * the Core.
 */
export interface SankofaModule {
  /** Unique name matching the handshake payload key. */
  readonly name: SankofaModuleName;
  /**
   * Called by the Core when the handshake response arrives and the
   * server has enabled this module. The module uses the config to
   * start its work (e.g. Deploy kicks off an update check, Catch
   * starts its crash handler). If the server says `enabled: false`
   * this method is NOT called — the module stays dormant.
   */
  applyHandshake(config: unknown): Promise<void> | void;
}

/** Singleton registry. Populated lazily as modules construct. */
const REGISTERED: Map<SankofaModuleName, SankofaModule> = new Map();

/** Set by `Sankofa.initialize()` so modules that register later can pull config. */
let _coreInitialized = false;

/**
 * Called once by `Sankofa.initialize()` to flip the core-ready flag.
 * Modules constructed before this fires get queued and registered
 * lazily — but in practice developers always call `initialize()`
 * before `new SankofaDeploy()`, so the common path is direct.
 */
export function markCoreInitialized(): void {
  _coreInitialized = true;
}

export function isCoreInitialized(): boolean {
  return _coreInitialized;
}

/**
 * Register a module with the Core. Called from each module's constructor.
 * Idempotent — re-registering the same name overwrites the previous instance.
 */
export function registerModule(mod: SankofaModule): void {
  REGISTERED.set(mod.name, mod);

  if (__DEV__ && !_coreInitialized) {
    console.warn(
      `[Sankofa] ${mod.name} module was created before Sankofa.initialize(). ` +
      `Call Sankofa.initialize() first so the module can read your API key and endpoint.`,
    );
  }
}

/** Unregister a module. Used by tests and shutdown flows. */
export function unregisterModule(name: SankofaModuleName): void {
  REGISTERED.delete(name);
}

/** Returns true when the developer has imported and constructed this module. */
export function hasModule(name: SankofaModuleName): boolean {
  return REGISTERED.has(name);
}

/**
 * Returns the registered module instance for [name], or undefined when
 * no module of that kind is installed.  Lets sibling modules
 * introspect each other at runtime — `SankofaCatch` reads `SankofaSwitch` +
 * `SankofaConfig` here at capture time so the dashboard can show
 * "what flags + config values were live when this error fired" without
 * the host wiring closures by hand.
 */
export function getModule(name: SankofaModuleName): SankofaModule | undefined {
  return REGISTERED.get(name);
}

/**
 * Returns the list of module names the app binary actually ships with.
 * Analytics is always present (it IS the core). Deploy/Catch are
 * reported only if they've been registered.
 *
 * Sent to the server in the Reverse Handshake so the dashboard can
 * show "SDK Not Detected" lock states instead of toggles that do
 * nothing.
 */
export function getInstalledModules(): SankofaModuleName[] {
  const modules: SankofaModuleName[] = ['analytics'];
  for (const name of REGISTERED.keys()) {
    if (name !== 'analytics') modules.push(name);
  }
  return modules;
}

/**
 * The Traffic Cop. Called by the handshake handler when the server
 * response arrives. Routes each enabled module flag to its registered
 * handler; warns (dev) or silently no-ops (production) for flags
 * that reference modules the developer didn't install.
 */
export async function routeHandshake(modules: HandshakeModules | null): Promise<void> {
  if (!modules) return;

  // Deploy
  if (modules.deploy?.enabled) {
    const deploy = REGISTERED.get('deploy');
    if (deploy) {
      await deploy.applyHandshake(modules.deploy);
    } else if (__DEV__) {
      console.warn(
        `[Sankofa] Server enabled "deploy" but SankofaDeploy is not imported. ` +
        `Add \`import { SankofaDeploy } from 'sankofa-react-native'\` and ` +
        `\`new SankofaDeploy()\` after Sankofa.initialize().`,
      );
    }
  }

  // Catch (ships later)
  if (modules.catch?.enabled) {
    const catchMod = REGISTERED.get('catch');
    if (catchMod) {
      await catchMod.applyHandshake(modules.catch);
    } else if (__DEV__) {
      console.warn(
        `[Sankofa] Server enabled "catch" but SankofaCatch is not imported. ` +
        `Install the Catch module to enable crash reporting.`,
      );
    }
  }

  // Switch — feature flags
  if (modules.switch?.enabled) {
    const switchMod = REGISTERED.get('switch');
    if (switchMod) {
      await switchMod.applyHandshake(modules.switch);
    } else if (__DEV__) {
      console.warn(
        `[Sankofa] Server enabled "switch" but SankofaSwitch is not imported. ` +
        `Add \`import { SankofaSwitch } from 'sankofa-react-native'\` and ` +
        `\`new SankofaSwitch()\` after Sankofa.initialize().`,
      );
    }
  }

  // Config — remote config
  if (modules.config?.enabled) {
    const configMod = REGISTERED.get('config');
    if (configMod) {
      await configMod.applyHandshake(modules.config);
    } else if (__DEV__) {
      console.warn(
        `[Sankofa] Server enabled "config" but SankofaConfig is not imported. ` +
        `Add \`import { SankofaConfig } from 'sankofa-react-native'\` and ` +
        `\`new SankofaConfig()\` after Sankofa.initialize().`,
      );
    }
  }

  // Analytics lives in the native layer — the native SDK reads the same
  // handshake independently for session replay / heatmap config. No
  // JS-side routing needed here today.
}
