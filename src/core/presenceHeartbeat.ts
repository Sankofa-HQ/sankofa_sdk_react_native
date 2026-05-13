import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { getCurrentScreen } from './screenTracker';
import SankofaNativeModule from '../SankofaModule';

// ─────────────────────────────────────────────────────────────────────
// Live-presence heartbeat — every ~15s while the app is foregrounded
// the SDK pings `/api/v1/screens/heartbeat` so the dashboard's
// "X live now" badge reflects who's actually on each screen.
//
// Mirrors the web SDK's presence pump: AppState replaces the document
// visibility API. Backgrounded apps stop ticking immediately so we
// don't paint stale "still live" badges for users who minimised the
// app or got a phone call. Resuming foreground sends one immediate
// heartbeat so the badge updates the instant they return.
//
// The heartbeat carries the active screen + distinct_id. The server
// is idempotent (TTL'd cache) — a missed heartbeat just trims the
// user from the live set after the TTL window.
// ─────────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 15_000;

class PresenceHeartbeat {
  private url: string;
  private apiKey: string;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private appStateSub: NativeEventSubscription | null = null;
  private currentAppState: AppStateStatus = 'active';

  constructor(endpoint: string, apiKey: string) {
    // endpoint comes in as `https://api.sankofa.dev` — same shape
    // the native modules use. Normalise the trailing slash to keep
    // the heartbeat URL deterministic across hosts.
    const base = endpoint.replace(/\/+$/, '');
    this.url = `${base}/api/v1/screens/heartbeat`;
    this.apiKey = apiKey;
  }

  start(): void {
    // Prime once so the dashboard sees the user the moment they
    // launch the app, not 15s later.
    void this.beat();

    if (AppState.currentState === 'active') {
      this.scheduleTimer();
    }
    this.currentAppState = AppState.currentState;

    this.appStateSub = AppState.addEventListener('change', (next) => {
      const wasActive = this.currentAppState === 'active';
      const isActive = next === 'active';
      this.currentAppState = next;
      if (!wasActive && isActive) {
        // Resumed foreground — fire immediately, then resume the
        // timer.
        void this.beat();
        this.scheduleTimer();
      } else if (wasActive && !isActive) {
        this.clearTimer();
      }
    });
  }

  stop(): void {
    this.clearTimer();
    if (this.appStateSub) {
      this.appStateSub.remove();
      this.appStateSub = null;
    }
  }

  private scheduleTimer(): void {
    this.clearTimer();
    this.timerId = setInterval(() => void this.beat(), HEARTBEAT_INTERVAL_MS);
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private async beat(): Promise<void> {
    const screen = getCurrentScreen();
    if (!screen) return;

    let distinctId = '';
    let sessionId = '';
    try {
      const maybeGetId = (SankofaNativeModule as any).getDistinctId;
      if (typeof maybeGetId === 'function') {
        const id = await maybeGetId();
        if (id) distinctId = String(id);
      }
      const maybeGetSession = (SankofaNativeModule as any).getSessionId;
      if (typeof maybeGetSession === 'function') {
        const sid = await maybeGetSession();
        if (sid) sessionId = String(sid);
      }
    } catch {
      /* best-effort */
    }
    if (!distinctId) return;

    try {
      await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({
          screen,
          distinct_id: distinctId,
          session_id: sessionId,
        }),
      });
    } catch {
      // Presence is decorative — never throw, never retry.
    }
  }
}

let _instance: PresenceHeartbeat | null = null;

/** Boot the heartbeat. Idempotent — calling twice replaces the prior
 *  instance, so a hot-reload during dev doesn't stack timers. */
export function startPresenceHeartbeat(endpoint: string, apiKey: string): void {
  stopPresenceHeartbeat();
  _instance = new PresenceHeartbeat(endpoint, apiKey);
  _instance.start();
}

/** Stop the heartbeat. Safe to call when nothing is running. */
export function stopPresenceHeartbeat(): void {
  if (_instance) {
    _instance.stop();
    _instance = null;
  }
}
