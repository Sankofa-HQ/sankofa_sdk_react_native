/**
 * Sankofa Pulse — React Native module index.
 *
 * Public surface: the SankofaPulse class, the SurveyModal
 * component, plus all the wire types so a host app can build
 * its own renderer if the bundled one doesn't fit.
 */

export { SankofaPulse } from './SankofaPulse';
export { SurveyModal } from './SurveyModal';
export { PulseClient } from './PulseClient';
export { SurveyState } from './PulseState';
export type { StateSnapshot } from './PulseState';
export { evaluate as evaluateTargeting, stableHash } from './targeting';
export { resolveNext, evaluateCondition } from './branching';
export { Translator, buildTranslator, resolveLocale } from './i18n';
export { BRANCHING_END_OF_SURVEY } from './PulseTypes';

export type {
  Survey,
  SurveyKind,
  SurveyStatus,
  SurveyQuestion,
  QuestionKind,
  QuestionOption,
  QuestionValidation,
  TargetingRule,
  RuleKind,
  MatchOp,
  FrequencyScope,
  EligibilityContext,
  Decision,
  BranchingRule,
  BranchingActionKind,
  BranchingCondition,
  CondKind,
  CondOp,
  AnswerState,
  Outcome,
  SurveyBundle,
  SurveyTheme,
  TranslationStrings,
  SubmitPayload,
  PulseShowOptions,
  PulseEvent,
  PulseEventListener,
  PulseEventPayload,
} from './PulseTypes';

export type { SurveyModalProps } from './SurveyModal';
