/**
 * # Integration health reporter
 *
 * Companion to the GET /api/v1/handshake call. After each module's
 * `checkIntegration()` audit resolves, this fires a fire-and-forget
 * POST to `/api/v1/handshake/integrations` with the result so the
 * dashboard can show a per-app "Integration Health" panel.
 *
 * Why a separate POST instead of piggybacking the handshake:
 *   - The handshake is GET-with-query-params (cacheable, ETag-friendly).
 *   - Integration statuses carry arrays of human-readable strings that
 *     don't fit cleanly in a URL.
 *   - Audits are async (Deploy waits ~1.5s for the bridge to attach the
 *     bundle provider) — bundling them into the handshake would delay
 *     module activation. Reporting separately keeps the hot path lean.
 *
 * Failure mode: every error is swallowed. The audit result also lives
 * in `_lastDeployIntegrationStatus` (and equivalents for future
 * modules), so the next launch re-runs the audit and tries again.
 */
import { Platform } from 'react-native';

import type { ModuleIntegrationStatus } from './integration';

/** Hardcoded so the server can correlate report shape changes with SDK versions. */
const SDK_VERSION = '0.1.0';

export interface IntegrationReportMeta {
  /** Host app version. Falls through to "unknown" server-side when empty. */
  appVersion: string | undefined;
  /** Compile-time toggle for verbose logging. Off in release builds. */
  debug?: boolean;
}

/**
 * POST a batch of module integration statuses. Returns the parsed
 * `{ stored }` count on success, or null on any error (swallowed).
 */
export async function reportIntegrationStatuses(
  apiKey: string,
  endpoint: string,
  statuses: ModuleIntegrationStatus[],
  meta: IntegrationReportMeta,
): Promise<number | null> {
  if (!apiKey || !endpoint) return null;
  if (!statuses || statuses.length === 0) return null;

  const url = `${endpoint.replace(/\/$/, '')}/api/v1/handshake/integrations`;

  const body = {
    sdk: 'react-native',
    sdk_version: SDK_VERSION,
    platform: Platform.OS, // 'ios' | 'android' | 'web'
    app_version: meta.appVersion ?? '',
    integrations: statuses.map((s) => ({
      module: s.module,
      level: s.level,
      missing: s.missing ?? [],
      warnings: s.warnings ?? [],
    })),
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (meta.debug) {
        console.warn(
          `[Sankofa] Integration report rejected (${res.status})`,
        );
      }
      return null;
    }
    const json = (await res.json()) as { stored?: number } | null;
    if (meta.debug) {
      console.log(
        `[Sankofa] Integration report OK — stored ${json?.stored ?? 0} module status(es)`,
      );
    }
    return json?.stored ?? 0;
  } catch (err) {
    if (meta.debug) {
      console.warn('[Sankofa] Integration report failed:', err);
    }
    return null;
  }
}
