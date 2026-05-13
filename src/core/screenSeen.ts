// Canonical screen-seen emitter — fire-and-forget POST to
// `/api/v1/screens/seen`. Same role as the web SDK's emitScreenSeen:
// every Sankofa.screen() call (and every navigator-tracked route
// change) hits this so the lexicon + dwell + presence get populated
// regardless of which Sankofa products the host has enabled.
//
// Best-effort by design — failures are silent. The server endpoint is
// idempotent + TTL-based for presence, so a missed call self-heals on
// the next heartbeat / next screen change.

import { getSharedApiKey, getSharedEndpoint } from '../index';
import SankofaNativeModule from '../SankofaModule';

export async function emitScreenSeen(
  screen: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  if (!screen) return;
  const apiKey = getSharedApiKey();
  const endpoint = getSharedEndpoint();
  if (!apiKey || !endpoint) return;

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
    // Best-effort — distinct_id is required server-side, so without
    // it we just skip. The next call (typically <30s later for SPA
    // navigation) will catch up once the bridge is ready.
  }
  if (!distinctId) return;

  const url = `${endpoint.replace(/\/+$/, '')}/api/v1/screens/seen`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        screen,
        distinct_id: distinctId,
        session_id: sessionId,
        ts_ms: Date.now(),
        properties,
      }),
    });
  } catch {
    // Decorative; never throw.
  }
}
