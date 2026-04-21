/**
 * Global error handlers for React Native. Unlike the browser, RN
 * routes all uncaught JS exceptions through the `ErrorUtils` global
 * — we chain onto its existing handler (usually Expo's / LogBox)
 * rather than replacing it, so redbox / LogBox UX is preserved.
 *
 * Unhandled promise rejections come from RN's bundled
 * `promise/setimmediate/rejection-tracking` module — we enable it
 * explicitly since its default config in RN only logs to console.
 */

type CatchRawFn = (
  err: unknown,
  meta: { type: string; mechanismType: string; handled: boolean },
) => void;

export interface InstallOptions {
  captureRaw: CatchRawFn;
  captureUnhandled?: boolean;
  captureRejections?: boolean;
  debug?: (msg: string, ...rest: unknown[]) => void;
}

export interface InstalledHandlers {
  uninstall(): void;
}

const DEFAULT_CAPTURE_UNHANDLED = true;
const DEFAULT_CAPTURE_REJECTIONS = true;

interface RNErrorUtils {
  setGlobalHandler: (fn: (err: unknown, isFatal?: boolean) => void) => void;
  getGlobalHandler?: () => ((err: unknown, isFatal?: boolean) => void) | undefined;
}

export function installGlobalHandlers(options: InstallOptions): InstalledHandlers {
  const {
    captureRaw,
    captureUnhandled = DEFAULT_CAPTURE_UNHANDLED,
    captureRejections = DEFAULT_CAPTURE_REJECTIONS,
    debug = () => {},
  } = options;

  const uninstallers: Array<() => void> = [];

  if (captureUnhandled) {
    const errorUtils = (globalThis as unknown as { ErrorUtils?: RNErrorUtils }).ErrorUtils;
    if (errorUtils && typeof errorUtils.setGlobalHandler === 'function') {
      const previous = errorUtils.getGlobalHandler?.();
      errorUtils.setGlobalHandler((err, isFatal) => {
        try {
          captureRaw(err, {
            type: 'unhandled_exception',
            mechanismType: 'global_handler',
            handled: false,
          });
        } catch (capErr) {
          debug('catch: ErrorUtils handler threw', capErr);
        }
        // Chain — preserve existing handler (LogBox / Expo / user's).
        try {
          previous?.(err, isFatal);
        } catch {
          /* ignore */
        }
      });
      uninstallers.push(() => {
        if (previous) errorUtils.setGlobalHandler(previous);
      });
    } else {
      debug('catch: ErrorUtils not available — uncaught exceptions will NOT be captured');
    }
  }

  if (captureRejections) {
    // RN ships `promise/setimmediate/rejection-tracking`. Its
    // default mode is warn-only; we enable strict tracking so
    // rejections surface as events. Safe to call multiple times —
    // tracking-polyfill is idempotent.
    try {
      // Use require() here because this module is a RN runtime
      // polyfill, not a bundled ESM export.
      const tracking = require('promise/setimmediate/rejection-tracking');
      tracking.enable({
        allRejections: true,
        onUnhandled: (_id: number, err: unknown) => {
          try {
            captureRaw(err, {
              type: 'unhandled_rejection',
              mechanismType: 'unhandled_rejection',
              handled: false,
            });
          } catch (capErr) {
            debug('catch: rejection handler threw', capErr);
          }
        },
        onHandled: () => {
          /* no-op — rejection eventually had a .catch() */
        },
      });
    } catch (err) {
      debug('catch: rejection-tracking unavailable', err);
    }
  }

  return {
    uninstall: () => {
      for (const u of uninstallers) {
        try {
          u();
        } catch {
          /* ignore */
        }
      }
    },
  };
}
