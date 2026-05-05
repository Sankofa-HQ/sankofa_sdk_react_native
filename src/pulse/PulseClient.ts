/**
 * REST client for /api/pulse/* — RN port of @sankofa/pulse client.ts.
 * Uses the runtime's global fetch (RN ships fetch out of the box).
 */

import { PulseStorage } from './PulseStorage';
import type {
  AnswerState,
  SubmitPayload,
  Survey,
  SurveyBundle,
  TargetingRule,
} from './PulseTypes';

/** Compact projection returned by GET /api/pulse/surveys. */
export type PulseSurveySummary = Pick<
  Survey,
  'id' | 'name' | 'description' | 'kind' | 'status'
> & {
  slug?: string;
  targeting_rules: TargetingRule[];
  /** Display behaviour fields — populated when the engine is recent
   *  enough to ship them. Older engines return undefined; callers
   *  treat that as the SDK defaults (auto_show: true, 7-day cooldown,
   *  no delay) so the fallback path stays sane. */
  auto_show?: boolean;
  display_cooldown_seconds?: number;
  display_delay_ms?: number;
};

const SURVEYS_CACHE_PREFIX = 'surveys.';
const DEFAULT_LIST_TTL_MS = 5 * 60 * 1000;

interface CachedSurveysList {
  etag: string;
  fetchedAt: number;
  surveys: PulseSurveySummary[];
}

async function readSurveysCache(
  key: string,
): Promise<CachedSurveysList | null> {
  try {
    const raw = await PulseStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSurveysList;
    if (
      !parsed ||
      typeof parsed.fetchedAt !== 'number' ||
      !Array.isArray(parsed.surveys)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeSurveysCache(
  key: string,
  value: CachedSurveysList,
): Promise<void> {
  try {
    await PulseStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* swallow — fall back to per-call fetch */
  }
}

export interface PulseClientOptions {
  endpoint: string;
  apiKey: string;
}

export class PulseClient {
  private endpoint: string;
  private apiKey: string;

  constructor(opts: PulseClientOptions) {
    this.endpoint = trimSlash(opts.endpoint);
    this.apiKey = opts.apiKey;
  }

  /**
   * Single round-trip bundle fetch — matches the server's
   * /api/pulse/surveys/:id endpoint that returns survey +
   * questions + targeting + branching + theme + optional partial.
   */
  async loadSurvey(surveyId: string, externalId: string): Promise<SurveyBundle> {
    const path =
      `/api/pulse/surveys/${encodeURIComponent(surveyId)}` +
      (externalId ? `?external_id=${encodeURIComponent(externalId)}` : '');
    const bundle = await this.fetchJson<SurveyBundle>(path);
    return {
      survey: bundle.survey,
      questions: bundle.questions ?? [],
      targeting_rules: bundle.targeting_rules ?? [],
      branching_rules: bundle.branching_rules ?? [],
      theme: bundle.theme ?? null,
      partial: bundle.partial
        ? {
            answers: bundle.partial.answers ?? {},
            current_question_id: bundle.partial.current_question_id,
          }
        : undefined,
    };
  }

  async savePartial(payload: {
    surveyId: string;
    respondent: { user_id?: string; external_id: string; email?: string };
    context?: Record<string, unknown>;
    answers: AnswerState;
    currentQuestionId?: string;
  }): Promise<void> {
    await this.fetchJson('/api/pulse/partial', {
      method: 'POST',
      body: JSON.stringify({
        survey_id: payload.surveyId,
        respondent: payload.respondent,
        context: payload.context,
        answers: payload.answers,
        current_question_id: payload.currentQuestionId,
      }),
    });
  }

  async submit(payload: SubmitPayload): Promise<{ id: string; score?: number }> {
    return this.fetchJson<{ id: string; score?: number }>('/api/pulse/responses', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Discover every published survey the API key's project owns.
   * Cached in PulseStorage with ETag + TTL — reads after the first
   * fetch are instant, and revalidations short-circuit to a 304 +
   * empty body when the server hasn't published any changes. Same
   * server-load posture as the Web SDK: one full fetch per device
   * per few minutes; 304s the rest.
   *
   * Returns [] on 404 (older engines without this endpoint).
   */
  async listSurveys(
    options: { forceRefresh?: boolean; ttlMs?: number } = {},
  ): Promise<PulseSurveySummary[]> {
    const ttlMs = options.ttlMs ?? DEFAULT_LIST_TTL_MS;
    const cacheKey = `${SURVEYS_CACHE_PREFIX}${this.endpoint}|${this.apiKey}`;
    const cached = await readSurveysCache(cacheKey);
    const now = Date.now();
    if (
      !options.forceRefresh &&
      cached &&
      now - cached.fetchedAt < ttlMs
    ) {
      return cached.surveys;
    }

    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
    };
    if (cached?.etag) headers['If-None-Match'] = cached.etag;

    try {
      const res = await fetch(`${this.endpoint}/api/pulse/surveys`, {
        method: 'GET',
        headers,
      });
      if (res.status === 304 && cached) {
        await writeSurveysCache(cacheKey, { ...cached, fetchedAt: now });
        return cached.surveys;
      }
      if (res.status === 404) return [];
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
      }
      const etag = res.headers.get('ETag') ?? '';
      const body = (await res.json()) as { surveys?: PulseSurveySummary[] };
      const surveys: PulseSurveySummary[] = (body.surveys ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        kind: s.kind,
        status: s.status,
        slug: s.slug,
        targeting_rules: s.targeting_rules ?? [],
        auto_show: s.auto_show ?? true,
        display_cooldown_seconds:
          typeof s.display_cooldown_seconds === 'number'
            ? s.display_cooldown_seconds
            : 7 * 24 * 60 * 60,
        display_delay_ms: s.display_delay_ms ?? 0,
      }));
      await writeSurveysCache(cacheKey, { etag, fetchedAt: now, surveys });
      return surveys;
    } catch (err) {
      // Network failed but we have a stale cache — return it rather
      // than blocking the host. Better stale-cached surveys for one
      // tick than a broken modal during a flaky moment.
      if (cached) return cached.surveys;
      throw err;
    }
  }

  async deletePartial(surveyId: string, externalId: string): Promise<void> {
    await this.fetchJson(
      `/api/pulse/partial?survey_id=${encodeURIComponent(surveyId)}&external_id=${encodeURIComponent(externalId)}`,
      { method: 'DELETE' },
    );
  }

  // ── Internals ────────────────────────────────────────────────

  private async fetchJson<T>(
    path: string,
    init: { method?: string; body?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { 'x-api-key': this.apiKey };
    if (init.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${this.endpoint}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body,
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
      return text as unknown as T;
    }
    if (!res.ok) {
      const detail =
        (body as { error?: string; message?: string })?.message ??
        (body as { error?: string })?.error ??
        `HTTP ${res.status}`;
      const err = new Error(String(detail));
      (err as Error & { body?: unknown }).body = body;
      throw err;
    }
    return body as T;
  }
}

function trimSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
