import { evaluate } from './targeting';
import { PulseClient } from './PulseClient';
import type {
  EligibilityContext,
  PulseEvent,
  PulseEventListener,
  PulseEventPayload,
  PulseShowOptions,
  Survey,
  SurveyBundle,
  TargetingRule,
} from './PulseTypes';

/**
 * Sankofa Pulse — the React Native SDK surface for surveys.
 *
 * Construction is deferred-friendly: instantiate any time after
 * Sankofa.initialize() and the module pulls the shared
 * apiKey/endpoint at first use rather than at construct time. Host
 * apps follow the same pattern they already use for Switch / Catch.
 *
 *   Sankofa.initialize('sk_live_...');
 *   const pulse = new SankofaPulse();
 *   pulse.show('psv_xxx', {
 *     onComplete: (id) => console.log('done', id),
 *   });
 *
 * # Why not the Traffic Cop module hook
 *
 * Pulse doesn't ship handshake config in v1 (the engine's unified
 * handshake doesn't carry pulse data yet — same status as the web
 * SDK). When that lands, SankofaPulse.applyHandshake will wire the
 * cached survey list + eligibility context. For now, the host
 * passes survey IDs to show() directly.
 */

interface PulseConstructorOptions {
  /**
   * Override the API endpoint. Defaults to whatever
   * Sankofa.initialize() received.
   */
  endpoint?: string;
  /**
   * Override the project's API key. Defaults to whatever
   * Sankofa.initialize() received.
   */
  apiKey?: string;
  /**
   * Default user_property bag for eligibility evaluation. Each
   * show() call merges its own context on top.
   */
  defaultUserProperties?: Record<string, unknown>;
  /**
   * Default cohort membership.
   */
  defaultCohorts?: Record<string, boolean>;
  /**
   * Default flag-value map. Hosts using @sankofa/switch can
   * forward their cached values so flag-tied surveys evaluate
   * without a roundtrip.
   */
  defaultFlagValues?: Record<string, unknown>;
}

export class SankofaPulse {
  readonly name = 'pulse' as const;

  private opts: PulseConstructorOptions;
  private listeners: Map<PulseEvent, Set<PulseEventListener>> = new Map();
  private currentBundle: SurveyBundle | null = null;
  private modalListeners: Set<(bundle: SurveyBundle | null) => void> = new Set();

  constructor(options: PulseConstructorOptions = {}) {
    this.opts = options;
  }

  // ── Public API ────────────────────────────────────────────────

  on(event: PulseEvent, listener: PulseEventListener): () => void {
    let bucket = this.listeners.get(event);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(event, bucket);
    }
    bucket.add(listener);
    return () => {
      bucket?.delete(listener);
    };
  }

  /**
   * Subscribe to bundle changes. The host app's <SurveyModalHost />
   * uses this to know when to render the modal.
   */
  onBundleChange(listener: (bundle: SurveyBundle | null) => void): () => void {
    this.modalListeners.add(listener);
    listener(this.currentBundle);
    return () => {
      this.modalListeners.delete(listener);
    };
  }

  async show(surveyId: string, options: PulseShowOptions = {}): Promise<void> {
    if (this.currentBundle) {
      // Already showing one — host can call dismiss() first if it
      // wants to swap.
      return;
    }
    const externalId =
      options.respondent?.external_id ?? this.resolveExternalId();
    if (!externalId) {
      // Without an external_id we can't sample / save partials.
      // Refuse rather than fail silently.
      throw new Error('SankofaPulse.show: missing external_id (call Sankofa.initialize() first)');
    }
    const client = this.makeClient();
    const bundle = await client.loadSurvey(surveyId, externalId);

    if (!options.skipEligibility) {
      const ctx = this.buildContext(surveyId, externalId, options);
      const decision = evaluate(bundle.targeting_rules, ctx);
      if (!decision.eligible) {
        // Host gets nothing; we don't surface a reason via API
        // because surveys that gracefully decline shouldn't show
        // an error toast.
        return;
      }
    }

    this.currentBundle = bundle;
    this.notifyBundleChange();
    this.emit({ event: 'survey_shown', survey_id: surveyId });
  }

  dismiss(reason: 'user' | 'host' = 'host'): void {
    if (!this.currentBundle) return;
    const surveyId = this.currentBundle.survey.id;
    this.currentBundle = null;
    this.notifyBundleChange();
    this.emit({ event: 'survey_dismissed', survey_id: surveyId, reason });
  }

  async submit(payload: {
    surveyId: string;
    respondent: { user_id?: string; external_id: string; email?: string };
    answers: Record<string, unknown>;
    context?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const client = this.makeClient();
    const result = await client.submit({
      survey_id: payload.surveyId,
      respondent: payload.respondent,
      answers: payload.answers,
      context: payload.context,
    });
    this.emit({
      event: 'survey_completed',
      survey_id: payload.surveyId,
      response_id: result.id,
    });
    return result;
  }

  async savePartial(payload: {
    surveyId: string;
    respondent: { external_id: string; user_id?: string; email?: string };
    answers: Record<string, unknown>;
    currentQuestionId?: string;
    context?: Record<string, unknown>;
  }): Promise<void> {
    const client = this.makeClient();
    await client.savePartial(payload);
    this.emit({ event: 'survey_partial_saved', survey_id: payload.surveyId });
  }

  /**
   * Stub for the future "list surveys eligible for this user"
   * endpoint. Returns an empty list until we ship the
   * SDK-readable survey list path.
   */
  async getActiveMatchingSurveys(): Promise<Survey[]> {
    return [];
  }

  /** Read-only access for the modal renderer. */
  getCurrentBundle(): SurveyBundle | null {
    return this.currentBundle;
  }

  // ── Internals ────────────────────────────────────────────────

  private emit(payload: PulseEventPayload): void {
    const bucket = this.listeners.get(payload.event);
    if (!bucket) return;
    for (const listener of bucket) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors so one bad subscriber doesn't
        // disturb the others.
      }
    }
  }

  private notifyBundleChange(): void {
    for (const listener of this.modalListeners) {
      try {
        listener(this.currentBundle);
      } catch {
        // ignored
      }
    }
  }

  private makeClient(): PulseClient {
    return new PulseClient({
      endpoint: this.opts.endpoint ?? this.resolveEndpoint(),
      apiKey: this.opts.apiKey ?? this.resolveApiKey(),
    });
  }

  private resolveEndpoint(): string {
    // Lazy import the parent package so the constructor can run
    // before Sankofa.initialize(). RN bundlers tree-shake this
    // path; circular import is avoided because we read the export
    // function rather than the module's top-level state.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const main = require('../index');
    if (typeof main.getSharedEndpoint === 'function') {
      return main.getSharedEndpoint();
    }
    return 'https://api.sankofa.dev';
  }

  private resolveApiKey(): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const main = require('../index');
    if (typeof main.getSharedApiKey === 'function') {
      return main.getSharedApiKey();
    }
    return '';
  }

  private resolveExternalId(): string {
    // The native module owns the anonymous distinct_id (RN's
    // analog of the web SDK's anonymousId). Without a public
    // getter we surface a host-overridable path: callers pass
    // respondent.external_id explicitly when they need
    // determinism. Best-effort fallback to a synthesized hosted-
    // page id otherwise.
    return `rn_${Math.random().toString(36).slice(2)}`;
  }

  private buildContext(
    surveyId: string,
    externalId: string,
    options: PulseShowOptions,
  ): EligibilityContext {
    const ctx = options.context ?? {};
    return {
      surveyId,
      respondentExternalId: externalId,
      pageUrl: typeof ctx.page_url === 'string' ? ctx.page_url : '',
      userProperties: {
        ...(this.opts.defaultUserProperties ?? {}),
        ...((ctx.userProperties as Record<string, unknown>) ?? {}),
      },
      cohorts: {
        ...(this.opts.defaultCohorts ?? {}),
        ...((ctx.cohorts as Record<string, boolean>) ?? {}),
      },
      flagValues: {
        ...(this.opts.defaultFlagValues ?? {}),
        ...((ctx.flagValues as Record<string, unknown>) ?? {}),
      },
      recentEvents: (ctx.recentEvents as Record<string, number>) ?? {},
      priorResponseCount:
        (ctx.priorResponseCount as Record<string, number>) ?? {},
    };
  }
}

// Convenience type re-export so a host can `import type { TargetingRule }`
// without reaching into the subpath.
export type { TargetingRule };
