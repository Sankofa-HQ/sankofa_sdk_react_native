/**
 * Wire types for Sankofa Pulse on React Native. These mirror
 * server/engine/ee/pulse/ exactly — same shape the web SDK uses,
 * because the server is the single source of truth and any drift
 * here ships real bugs (the QuestionKind enum mismatch in the
 * dashboard cost us a week, see api.ts header for that history).
 *
 * Why duplicated rather than imported from @sankofa/pulse: the
 * web SDK is a separate npm package (workspace package on the web
 * side); the RN SDK has its own published package + node_modules
 * tree. A future @sankofa/survey-core extraction would fold both,
 * but until then duplication is the simpler ergonomic.
 */

// ── Core entities ──────────────────────────────────────────────────

export type SurveyKind = 'nps' | 'csat' | 'custom' | 'service_desk';
export type SurveyStatus = 'draft' | 'published' | 'closed';

export interface Survey {
  id: string;
  organization_id: string;
  project_id: string;
  name: string;
  description?: string;
  kind: SurveyKind;
  status: SurveyStatus;
  slug?: string;
  published_at?: string | null;
  closed_at?: string | null;
  archived_at?: string | null;
}

export type QuestionKind =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'rating'
  | 'nps'
  | 'single'
  | 'multi'
  | 'boolean'
  | 'slider'
  | 'date'
  | 'statement'
  | 'ranking'
  | 'matrix'
  | 'consent'
  | 'image_choice';

export interface QuestionOption {
  key: string;
  label: string;
  image_url?: string;
}

export interface QuestionValidation {
  min?: number;
  max?: number;
  step?: number;
  min_date?: string;
  max_date?: string;
  rows?: QuestionOption[];
  columns?: QuestionOption[];
}

export interface SurveyQuestion {
  id: string;
  survey_id: string;
  kind: QuestionKind;
  prompt: string;
  helptext?: string;
  required: boolean;
  order_index: number;
  options?: QuestionOption[] | null;
  validation?: QuestionValidation | null;
}

// ── Targeting ──────────────────────────────────────────────────────

export type RuleKind =
  | 'url'
  | 'screen'
  | 'event'
  | 'user_property'
  | 'cohort'
  | 'sampling'
  | 'frequency_cap'
  | 'feature_flag';

export type MatchOp =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'prefix'
  | 'regex'
  | 'in'
  | 'not_in'
  | 'exists'
  | 'not_exists'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte';

export type FrequencyScope = 'per_user';

export interface TargetingRule {
  kind: RuleKind;
  url_match?: MatchOp;
  url_value?: string;
  /** screen — same comparator set as url, OR-matched against the
   *  native screen / route name. screen_names is the target set. */
  screen_match?: MatchOp;
  screen_names?: string[];
  event_name?: string;
  event_min_count?: number;
  event_window_days?: number;
  property_key?: string;
  property_op?: MatchOp;
  property_value?: unknown;
  cohort_id?: string;
  sampling_rate?: number;
  frequency_scope?: FrequencyScope;
  frequency_max?: number;
  frequency_window_days?: number;
  flag_key?: string;
  flag_value?: unknown;
}

export interface EligibilityContext {
  surveyId: string;
  respondentExternalId: string;
  /**
   * RN apps don't have a "page URL" the way web does; if the host
   * cares about KindURL rules they pass the current screen name
   * here. Most surveys won't reference URL rules on mobile.
   */
  pageUrl?: string;
  /**
   * Native screen / route name the SDK is on. Sourced from the most
   * recent Sankofa.screen() / useSankofaScreen() call. Empty before
   * the first screen event fires — KindScreen rules will not match
   * until then.
   */
  screenName?: string;
  recentEvents?: Record<string, number>;
  userProperties?: Record<string, unknown>;
  cohorts?: Record<string, boolean>;
  flagValues?: Record<string, unknown>;
  priorResponseCount?: Record<string, number>;
}

export interface Decision {
  eligible: boolean;
  reason?: string;
}

// ── Branching ──────────────────────────────────────────────────────

export type BranchingActionKind = 'skip_to' | 'end_survey';
export const BRANCHING_END_OF_SURVEY = '__end__';

export type CondKind = 'answer';
export type CondOp =
  | 'equals'
  | 'not_equals'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'contains'
  | 'not_contains'
  | 'in'
  | 'not_in'
  | 'answered'
  | 'not_answered';

export interface BranchingCondition {
  kind: CondKind;
  question_id: string;
  op: CondOp;
  value?: unknown;
}

export interface BranchingRule {
  from_question_id: string;
  condition: BranchingCondition;
  action: BranchingActionKind;
  to_question_id?: string;
}

export type AnswerState = Record<string, unknown>;

export interface Outcome {
  next_question_id: string;
  reason?: string;
}

// ── Theme ──────────────────────────────────────────────────────────

export interface SurveyTheme {
  id?: string;
  survey_id?: string;
  primary_color?: string;
  background_color?: string;
  foreground_color?: string;
  muted_color?: string;
  border_color?: string;
  font_family?: string;
  logo_url?: string;
  dark_mode?: 'auto' | 'light' | 'dark';
  custom_css?: string;
}

// ── Bundle + submit ────────────────────────────────────────────────

/**
 * Per-locale string overrides keyed by the same path convention
 * the server + web SDK use:
 *
 *   "survey.name"
 *   "question.<question_id>.prompt"
 *   "question.<question_id>.option.<option_key>.label"
 *
 * Missing keys fall back to source. Renderer applies before the
 * first paint so respondents see the localized copy without a
 * paint-then-replace flicker.
 */
export type TranslationStrings = Record<string, string>;

export interface SurveyBundle {
  survey: Survey;
  questions: SurveyQuestion[];
  targeting_rules: TargetingRule[];
  branching_rules: BranchingRule[];
  theme?: SurveyTheme | null;
  /** Locale → keyed string map. */
  translations?: Record<string, TranslationStrings>;
  partial?: {
    answers: AnswerState;
    current_question_id?: string;
  };
}

export interface SubmitPayload {
  survey_id: string;
  respondent: {
    user_id?: string;
    external_id?: string;
    email?: string;
  };
  context?: Record<string, unknown>;
  /**
   * Active screen / route at submission time. First-class field —
   * the server stores it as a dedicated indexed column for
   * cross-product correlation with Heatmap / Catch / Replay.
   */
  screen?: string;
  submitted_at?: string;
  answers: AnswerState;
}

// ── Public API surface ─────────────────────────────────────────────

export interface PulseShowOptions {
  context?: Record<string, unknown>;
  respondent?: {
    user_id?: string;
    external_id?: string;
    email?: string;
  };
  skipEligibility?: boolean;
}

export type PulseEvent =
  | 'survey_shown'
  | 'survey_dismissed'
  | 'survey_completed'
  | 'survey_partial_saved';

export interface PulseEventPayload {
  event: PulseEvent;
  survey_id: string;
  response_id?: string;
  reason?: string;
}

export type PulseEventListener = (payload: PulseEventPayload) => void;
