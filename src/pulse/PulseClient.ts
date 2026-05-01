/**
 * REST client for /api/pulse/* — RN port of @sankofa/pulse client.ts.
 * Uses the runtime's global fetch (RN ships fetch out of the box).
 */

import type {
  AnswerState,
  SubmitPayload,
  SurveyBundle,
} from './PulseTypes';

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
