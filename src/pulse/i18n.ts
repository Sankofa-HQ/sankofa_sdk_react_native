/**
 * Translation helpers — RN port. Mirrors @sankofa/pulse i18n.ts.
 *
 * RN doesn't expose navigator.language directly; hosts that want
 * a runtime default pass it via SurveyModal's `locale` prop. We
 * fall back to `null` (no translation) when no preferred locale
 * resolves.
 */

import type {
  Survey,
  SurveyBundle,
  SurveyQuestion,
  QuestionOption,
  TranslationStrings,
} from './PulseTypes';

export function resolveLocale(
  bundle: SurveyBundle,
  preferred?: string,
): string | null {
  const translations = bundle.translations;
  if (!translations) return null;
  const candidates = [preferred].filter((c): c is string => Boolean(c));
  for (const candidate of candidates) {
    if (translations[candidate]) return candidate;
    const language = candidate.split('-')[0];
    if (translations[language]) return language;
  }
  return null;
}

export class Translator {
  private strings: TranslationStrings;
  constructor(strings: TranslationStrings) {
    this.strings = strings;
  }
  surveyName(survey: Survey): string {
    return this.strings['survey.name'] ?? survey.name;
  }
  questionPrompt(question: SurveyQuestion): string {
    return this.strings[`question.${question.id}.prompt`] ?? question.prompt;
  }
  questionHelptext(question: SurveyQuestion): string | undefined {
    return (
      this.strings[`question.${question.id}.helptext`] ?? question.helptext
    );
  }
  optionLabel(question: SurveyQuestion, option: QuestionOption): string {
    return (
      this.strings[`question.${question.id}.option.${option.key}.label`] ??
      option.label
    );
  }
}

export function buildTranslator(
  bundle: SurveyBundle,
  preferred?: string,
): Translator | null {
  const locale = resolveLocale(bundle, preferred);
  if (!locale) return null;
  const strings = bundle.translations?.[locale];
  if (!strings) return null;
  return new Translator(strings);
}
