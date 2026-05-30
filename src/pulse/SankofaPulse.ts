import { AppState, type NativeEventSubscription } from 'react-native';
import { evaluate } from './targeting';
import { PulseClient } from './PulseClient';
import { PulseStorage } from './PulseStorage';
import { getCurrentScreen, onScreenChange } from '../core/screenTracker';

/** Default dismiss cooldown when the server omits one — 7 days, matching
 *  the dashboard default and the web/iOS SDKs. */
const DEFAULT_COOLDOWN_SECONDS = 7 * 24 * 60 * 60;
import {
  deriveIntegrationLevel,
  type ModuleIntegrationStatus,
} from '../core/integration';
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

export interface PulseConstructorOptions {
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

  // ── Auto-show pump state ──────────────────────────────────────
  private autoShowEnabled = true;
  private autoShownThisSession = new Set<string>();
  private autoShowStarted = false;
  private appStateSub: NativeEventSubscription | null = null;
  private screenUnsub: (() => void) | null = null;

  constructor(options: PulseConstructorOptions = {}) {
    this.opts = options;
    this.startAutoShowTriggers();
  }

  /**
   * Opt out of (or back into) automatic survey presentation. Mirrors the
   * web `pulsePlugin({ autoShow: false })` switch and iOS
   * `SankofaPulse.shared.autoShowEnabled`. Set before the first foreground.
   */
  setAutoShowEnabled(enabled: boolean): void {
    this.autoShowEnabled = enabled;
  }

  /** Detach the auto-show triggers (AppState + screen-change). */
  stopAutoShow(): void {
    this.appStateSub?.remove();
    this.appStateSub = null;
    this.screenUnsub?.();
    this.screenUnsub = null;
    this.autoShowStarted = false;
  }

  /**
   * Self-audit the host's Pulse integration. Pulse defers most wiring
   * to show() time, so the audit mostly checks "can we even reach the
   * server when asked?" and "is a modal host mounted to render?"
   */
  async checkIntegration(): Promise<ModuleIntegrationStatus> {
    const missing: string[] = [];
    const warnings: string[] = [];

    const endpoint = this.opts.endpoint ?? this.resolveEndpoint();
    const apiKey = this.opts.apiKey ?? this.resolveApiKey();

    if (!endpoint) {
      missing.push(
        'Pulse cannot resolve an endpoint — call Sankofa.initialize() before constructing SankofaPulse, or pass it in PulseConstructorOptions.',
      );
    }
    if (!apiKey) {
      missing.push(
        'Pulse cannot resolve an API key — call Sankofa.initialize() before constructing SankofaPulse, or pass it in PulseConstructorOptions.',
      );
    }
    if (this.modalListeners.size === 0) {
      warnings.push(
        'No <SurveyModalHost /> is mounted yet — show() will queue a bundle, but nothing will render until the host mounts a listener via onBundleChange().',
      );
    }

    return {
      module: 'pulse',
      level: deriveIntegrationLevel(missing),
      missing,
      warnings,
    };
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
      options.respondent?.external_id ?? (await this.getRespondentId());
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
    // Stamp the dismiss so the auto-show pump respects the cooldown.
    void this.stampDismiss(surveyId);
    this.emit({ event: 'survey_dismissed', survey_id: surveyId, reason });
  }

  async submit(payload: {
    surveyId: string;
    respondent?: { user_id?: string; external_id?: string; email?: string };
    answers: Record<string, unknown>;
    context?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const client = this.makeClient();
    // Fill the respondent's external_id from the stable id when the caller
    // (e.g. SurveyModalHost) doesn't supply one — keeps submit/sampling/
    // cooldown all keyed to the same respondent.
    const externalId =
      payload.respondent?.external_id ?? (await this.getRespondentId());
    const result = await client.submit({
      survey_id: payload.surveyId,
      respondent: { ...payload.respondent, external_id: externalId },
      answers: payload.answers,
      context: this.enrichContext(payload.context),
      screen: getCurrentScreen(),
    });
    // A completed survey should also respect the cooldown (don't re-show
    // a survey the respondent just finished).
    void this.stampDismiss(payload.surveyId);
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
    await client.savePartial({
      ...payload,
      context: this.enrichContext(payload.context),
    });
    this.emit({ event: 'survey_partial_saved', survey_id: payload.surveyId });
  }

  /**
   * Auto-attach `replay_session_id` to outgoing context when the
   * native bridge exposes it AND replay is actively recording.
   * Host-supplied context wins on collision so callers can override.
   *
   * Lazy-required to avoid a circular import — the Sankofa root
   * imports the Pulse module to surface it on the public API.
   */
  private enrichContext(
    context?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const SankofaNativeModule = require('../SankofaModule').default;
      const fn = (SankofaNativeModule as any).getReplaySessionId;
      if (typeof fn !== 'function') return context;
      const sid = fn();
      if (typeof sid !== 'string' || sid.length === 0) return context;
      return {
        replay_session_id: sid,
        ...(context ?? {}),
      };
    } catch {
      return context;
    }
  }

  /**
   * List every published survey the API key's project owns AND
   * whose targeting rules pass for the current respondent. Server
   * returns the lightweight summary + targeting rules; the SDK
   * runs the local eligibility evaluator (mirrors server-side Go
   * evaluator byte-for-byte) so sampling + frequency-cap math
   * agrees across client + server.
   */
  async getActiveMatchingSurveys(
    options: PulseShowOptions = {},
  ): Promise<Survey[]> {
    const client = this.makeClient();
    const summaries = await client.listSurveys();
    // Sampling key must be the stable anonymous/distinct id (matching web).
    // Do NOT fall back to user_id — mixing it in would bucket the same
    // person differently pre/post-login for the same survey.
    const externalId =
      options.respondent?.external_id ?? (await this.getRespondentId());
    const out: Survey[] = [];
    for (const s of summaries) {
      const decision = evaluate(
        s.targeting_rules,
        this.buildContext(s.id, externalId, options),
      );
      if (!decision.eligible) continue;
      out.push({
        id: s.id,
        name: s.name,
        description: s.description ?? '',
        kind: s.kind,
        status: s.status,
        slug: s.slug,
      } as Survey);
    }
    return out;
  }

  /** Read-only access for the modal renderer. */
  getCurrentBundle(): SurveyBundle | null {
    return this.currentBundle;
  }

  // ── Internals ────────────────────────────────────────────────

  private emit(payload: PulseEventPayload): void {
    // Auto-emit into the host's analytics queue with a "$pulse."
    // prefix so survey lifecycle shows up in the same dashboard /
    // warehouse as every other event the host tracks. Listeners
    // registered through on(...) still fire as well — that path is
    // for in-process integrations (Slack pings, conditional UI),
    // not for analytics. Lazy-required to avoid a circular import
    // (Sankofa root imports the pulse module).
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const { Sankofa } = require('../index');
      const props: Record<string, unknown> = { survey_id: payload.survey_id };
      if (payload.response_id) props.response_id = payload.response_id;
      if (payload.reason) props.reason = payload.reason;
      Sankofa.track(`$pulse.${payload.event}`, props);
    } catch {
      // Sankofa root not loaded yet (test harness / bare import) —
      // analytics emit is best-effort.
    }

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

  private cachedRespondentId = '';
  private respondentIdPromise: Promise<string> | null = null;
  private static readonly RESPONDENT_ID_KEY = 'sankofa.pulse.respondent_id';

  /**
   * Resolve a STABLE respondent id for sampling / frequency-cap /
   * dismiss-cooldown keys. The previous implementation returned a fresh
   * `rn_${random}` on every call, which broke deterministic sampling
   * (server-in / client-out A/B splits) and made cooldowns never match.
   *
   * Priority: the analytics distinct id (owned by the core, stable
   * across launches) → a previously persisted random → a freshly minted
   * random persisted write-once. Memoised so concurrent callers share
   * one resolution and the id never changes mid-process.
   */
  private getRespondentId(): Promise<string> {
    if (this.cachedRespondentId) return Promise.resolve(this.cachedRespondentId);
    if (this.respondentIdPromise) return this.respondentIdPromise;
    this.respondentIdPromise = (async () => {
      // 1. Prefer the analytics distinct id (same source web uses as anonymousId).
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const SankofaNativeModule = require('../SankofaModule').default;
        const fn = (SankofaNativeModule as any).getDistinctId;
        if (typeof fn === 'function') {
          const id = await fn();
          if (id) {
            this.cachedRespondentId = String(id);
            return this.cachedRespondentId;
          }
        }
      } catch {
        // bridge unavailable — fall through
      }
      // 2. Reuse a previously persisted id (stable across launches).
      try {
        const stored = await PulseStorage.getItem(SankofaPulse.RESPONDENT_ID_KEY);
        if (stored) {
          this.cachedRespondentId = stored;
          return stored;
        }
      } catch {
        // storage unavailable — fall through
      }
      // 3. Mint once and persist write-once.
      const minted = `rn_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      this.cachedRespondentId = minted;
      void PulseStorage.setItem(SankofaPulse.RESPONDENT_ID_KEY, minted);
      return minted;
    })();
    return this.respondentIdPromise;
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

  // ── Auto-show pump ───────────────────────────────────────────
  //
  // Mirrors the web plugin's pump and the iOS implementation: on
  // boot / foreground / navigation, pick the first eligible survey
  // flagged auto_show that isn't inside its dismiss cooldown, wait
  // display_delay_ms, then present it via show() (which the declarative
  // <SurveyModalHost /> renders through onBundleChange).

  private startAutoShowTriggers(): void {
    if (this.autoShowStarted) return;
    this.autoShowStarted = true;
    try {
      this.appStateSub = AppState.addEventListener('change', (next) => {
        if (next === 'active') void this.maybeAutoShow();
      });
    } catch {
      // AppState unavailable (test/SSR) — triggers degrade gracefully.
    }
    try {
      this.screenUnsub = onScreenChange(() => void this.maybeAutoShow());
    } catch {
      // ignore
    }
    // Initial tick once the host has had a chance to mount the modal host.
    setTimeout(() => void this.maybeAutoShow(), 0);
  }

  /**
   * Re-evaluate auto-show. No-op while a survey is already presented,
   * disabled, or nothing is eligible. Safe to call repeatedly.
   */
  async maybeAutoShow(options: PulseShowOptions = {}): Promise<void> {
    if (!this.autoShowEnabled || this.currentBundle) return;
    let summaries;
    try {
      summaries = await this.makeClient().listSurveys();
    } catch {
      return;
    }
    if (!summaries.length) return;
    const respondentId =
      options.respondent?.external_id ?? (await this.getRespondentId());
    for (const s of summaries) {
      if (this.autoShownThisSession.has(s.id)) continue;
      if (s.auto_show === false) continue;
      const decision = evaluate(
        s.targeting_rules,
        this.buildContext(s.id, respondentId, options),
      );
      if (!decision.eligible) continue;
      const cooldownMs =
        (s.display_cooldown_seconds ?? DEFAULT_COOLDOWN_SECONDS) * 1000;
      if (await this.isRecentlyDismissed(s.id, respondentId, cooldownMs)) {
        continue;
      }
      // Win the candidate; guard against the pump firing twice quickly.
      if (this.currentBundle) return;
      this.autoShownThisSession.add(s.id);
      const delayMs = s.display_delay_ms ?? 0;
      const present = () => {
        if (!this.currentBundle && this.autoShowEnabled) {
          void this.show(s.id, options);
        }
      };
      if (delayMs > 0) {
        setTimeout(present, delayMs);
      } else {
        present();
      }
      return; // one survey at a time
    }
  }

  // ── Dismiss cooldown (mirrors web `sankofa.pulse.dismissed.*`) ──

  private dismissKey(surveyId: string, respondentId: string): string {
    return `sankofa.pulse.dismissed.${respondentId}.${surveyId}`;
  }

  private async isRecentlyDismissed(
    surveyId: string,
    respondentId: string,
    cooldownMs: number,
  ): Promise<boolean> {
    if (cooldownMs <= 0) return false;
    try {
      const raw = await PulseStorage.getItem(
        this.dismissKey(surveyId, respondentId),
      );
      if (!raw) return false;
      const ts = Number(raw);
      if (!Number.isFinite(ts)) return false;
      return Date.now() - ts < cooldownMs;
    } catch {
      return false;
    }
  }

  /** Stamp a dismiss/complete so the pump honours the per-survey cooldown. */
  private async stampDismiss(surveyId: string): Promise<void> {
    try {
      const respondentId = await this.getRespondentId();
      await PulseStorage.setItem(
        this.dismissKey(surveyId, respondentId),
        String(Date.now()),
      );
    } catch {
      // best-effort — worst case the survey re-shows on next trigger
    }
  }
}

// Convenience type re-export so a host can `import type { TargetingRule }`
// without reaching into the subpath.
export type { TargetingRule };
