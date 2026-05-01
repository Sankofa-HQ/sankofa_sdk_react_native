import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { buildTranslator, type Translator } from './i18n';
import { SurveyState, type StateSnapshot } from './PulseState';
import type {
  AnswerState,
  SurveyBundle,
  SurveyQuestion,
  SurveyTheme,
} from './PulseTypes';

/**
 * SurveyModal — React Native renderer mirroring the @sankofa/pulse
 * web SurveyRenderer. Renders one question at a time inside a
 * platform Modal with a simple themed card. 12 of 15 question
 * kinds rendered natively; the remaining (slider, ranking, matrix)
 * fall through to a visible "[Unsupported on RN]" placeholder so
 * operators notice rather than silently skip.
 *
 * # Why a Modal vs an inline view
 *
 * In-app surveys overlay. The Modal handles back-button + system
 * gesture dismissal correctly on Android, and centers nicely on
 * iOS without us reimplementing safe-area + status-bar offsets.
 * Hosts that want inline rendering can build their own wrapper
 * around SurveyRenderer (the inner view) — the Modal is opt-in.
 */

export interface SurveyModalProps {
  visible: boolean;
  bundle: SurveyBundle | null;
  /**
   * BCP-47 locale to render. When matching translation keys exist
   * on the bundle, source strings are replaced before render. Falls
   * back to source on miss. RN doesn't have navigator.language, so
   * the host explicitly passes the user's preferred locale here.
   */
  locale?: string;
  onAnswerChange?: (state: { answers: AnswerState; currentQuestionId: string }) => void;
  onComplete?: (state: { answers: AnswerState }) => Promise<void> | void;
  onDismiss?: (state: { answers: AnswerState; reason: 'user' | 'host' }) => void;
}

export const SurveyModal: React.FC<SurveyModalProps> = ({
  visible,
  bundle,
  locale,
  onAnswerChange,
  onComplete,
  onDismiss,
}) => {
  if (!bundle) return null;
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={() => {
        onDismiss?.({ answers: {}, reason: 'user' });
      }}
    >
      <View style={styles.modalBackdrop}>
        <SurveyRenderer
          bundle={bundle}
          locale={locale}
          onAnswerChange={onAnswerChange}
          onComplete={onComplete}
          onDismiss={(payload) => onDismiss?.(payload)}
        />
      </View>
    </Modal>
  );
};

interface RendererProps {
  bundle: SurveyBundle;
  locale?: string;
  onAnswerChange?: (state: { answers: AnswerState; currentQuestionId: string }) => void;
  onComplete?: (state: { answers: AnswerState }) => Promise<void> | void;
  onDismiss?: (state: { answers: AnswerState; reason: 'user' | 'host' }) => void;
}

const SurveyRenderer: React.FC<RendererProps> = ({
  bundle,
  locale,
  onAnswerChange,
  onComplete,
  onDismiss,
}) => {
  const stateRef = useRef<SurveyState>(
    new SurveyState(
      bundle.questions,
      bundle.branching_rules,
      bundle.partial?.answers ?? {},
      bundle.partial?.current_question_id,
    ),
  );
  const [snap, setSnap] = useState<StateSnapshot>(() =>
    stateRef.current.snapshot(),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const themed = useMemo(() => buildThemedStyles(bundle.theme), [bundle.theme]);
  const translator = useMemo(() => buildTranslator(bundle, locale), [bundle, locale]);

  const setAnswer = (id: string, value: unknown) => {
    stateRef.current.recordAnswer(id, value);
    setSnap(stateRef.current.snapshot());
    onAnswerChange?.({
      answers: stateRef.current.allAnswers(),
      currentQuestionId: id,
    });
  };

  const handleNext = async () => {
    setError(null);
    const q = stateRef.current.currentQuestion();
    if (!q) return;
    const value = stateRef.current.allAnswers()[q.id];
    if (q.required && isEmpty(value)) {
      setError('This question requires an answer.');
      return;
    }
    const next = stateRef.current.advance();
    setSnap(next);
    if (next.done) {
      try {
        setSubmitting(true);
        await onComplete?.({ answers: next.answers });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Submission failed');
      } finally {
        setSubmitting(false);
      }
    }
  };

  const handleBack = () => {
    setError(null);
    const next = stateRef.current.back();
    setSnap(next);
  };

  const handleClose = () => {
    onDismiss?.({
      answers: stateRef.current.allAnswers(),
      reason: 'user',
    });
  };

  return (
    <View style={[styles.card, themed.card]}>
      <View style={[styles.header, themed.header]}>
        {bundle.theme?.logo_url && (
          <Image
            source={{ uri: bundle.theme.logo_url }}
            style={styles.logo}
            resizeMode="contain"
          />
        )}
        <Text style={[styles.title, themed.foreground]}>
          {translator?.surveyName(bundle.survey) ?? bundle.survey.name}
        </Text>
        {snap.index >= 0 && snap.total > 0 && (
          <Text style={[styles.progress, themed.muted]}>
            {' '}
            {snap.index + 1} / {snap.total}
          </Text>
        )}
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={handleClose} accessibilityLabel="Dismiss survey">
          <Text style={[styles.closeText, themed.muted]}>×</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        {snap.done ? (
          <Text style={[styles.thanks, themed.foreground]}>
            Thanks for your feedback!
          </Text>
        ) : snap.question ? (
          <View>
            <Text style={[styles.prompt, themed.foreground]}>
              {translator?.questionPrompt(snap.question) ?? snap.question.prompt}
            </Text>
            {(translator?.questionHelptext(snap.question) ?? snap.question.helptext) ? (
              <Text style={[styles.helptext, themed.muted]}>
                {translator?.questionHelptext(snap.question) ?? snap.question.helptext}
              </Text>
            ) : null}
            <View style={styles.inputWrap}>
              {renderInput(
                snap.question,
                snap.answers[snap.question.id],
                (v) => setAnswer(snap.question!.id, v),
                themed,
                translator,
              )}
            </View>
            {error && (
              <Text style={[styles.error, { color: '#ef4444' }]}>{error}</Text>
            )}
          </View>
        ) : null}
      </ScrollView>

      {!snap.done && (
        <View style={[styles.footer, themed.header]}>
          <TouchableOpacity
            onPress={handleBack}
            disabled={!stateRef.current.canGoBack()}
            style={[
              styles.backBtn,
              !stateRef.current.canGoBack() && { opacity: 0 },
            ]}
          >
            <Text style={[styles.backText, themed.muted]}>← Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleNext}
            disabled={submitting}
            style={[styles.nextBtn, themed.primary]}
          >
            <Text style={[styles.nextText, themed.primaryFg]}>
              {submitting ? 'Submitting…' : isLastQuestion(snap, bundle.questions) ? 'Submit' : 'Next →'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

// ── Per-kind input renderers ───────────────────────────────────────

function renderInput(
  q: SurveyQuestion,
  value: unknown,
  onChange: (v: unknown) => void,
  themed: ThemedStyles,
  translator: Translator | null,
): React.ReactElement {
  switch (q.kind) {
    case 'short_text':
      return <ShortTextInput value={value} onChange={onChange} themed={themed} />;
    case 'long_text':
      return <LongTextInput value={value} onChange={onChange} themed={themed} />;
    case 'number':
      return <NumberInput value={value} onChange={onChange} themed={themed} q={q} />;
    case 'rating':
      return <RatingInput value={value} onChange={onChange} themed={themed} q={q} />;
    case 'nps':
      return <ScaleInput value={value} onChange={onChange} themed={themed} min={0} max={10} />;
    case 'single':
      return <SingleSelect value={value} onChange={onChange} themed={themed} q={q} translator={translator} />;
    case 'multi':
      return <MultiSelect value={value} onChange={onChange} themed={themed} q={q} translator={translator} />;
    case 'boolean':
      return <BooleanInput value={value} onChange={onChange} themed={themed} />;
    case 'date':
      return <DateInput value={value} onChange={onChange} themed={themed} />;
    case 'statement':
      return (
        <Text style={[styles.statement, themed.muted]}>
          {translator?.questionHelptext(q) ?? q.helptext ?? ''}
        </Text>
      );
    case 'consent':
      return <ConsentInput value={value} onChange={onChange} themed={themed} q={q} translator={translator} />;
    case 'image_choice':
      return <ImageChoice value={value} onChange={onChange} themed={themed} q={q} translator={translator} />;
  }
  return (
    <Text style={[styles.helptext, themed.muted]}>
      [Unsupported on RN: {q.kind}]
    </Text>
  );
}

const ShortTextInput: React.FC<{ value: unknown; onChange: (v: unknown) => void; themed: ThemedStyles }> = ({
  value,
  onChange,
  themed,
}) => (
  <TextInput
    style={[styles.input, themed.input]}
    value={typeof value === 'string' ? value : ''}
    onChangeText={onChange}
    maxLength={512}
    placeholderTextColor={themed.muted.color}
  />
);

const LongTextInput: React.FC<{ value: unknown; onChange: (v: unknown) => void; themed: ThemedStyles }> = ({
  value,
  onChange,
  themed,
}) => (
  <TextInput
    style={[styles.textarea, themed.input]}
    value={typeof value === 'string' ? value : ''}
    onChangeText={onChange}
    multiline
    maxLength={8192}
    placeholderTextColor={themed.muted.color}
  />
);

const NumberInput: React.FC<{
  value: unknown;
  onChange: (v: unknown) => void;
  themed: ThemedStyles;
  q: SurveyQuestion;
}> = ({ value, onChange, themed }) => (
  <TextInput
    style={[styles.input, themed.input]}
    value={typeof value === 'number' ? String(value) : ''}
    onChangeText={(t) => {
      const trimmed = t.trim();
      if (trimmed === '') {
        onChange(undefined);
        return;
      }
      const n = Number(trimmed);
      onChange(Number.isFinite(n) ? n : undefined);
    }}
    keyboardType="numeric"
    placeholderTextColor={themed.muted.color}
  />
);

const RatingInput: React.FC<{
  value: unknown;
  onChange: (v: unknown) => void;
  themed: ThemedStyles;
  q: SurveyQuestion;
}> = ({ value, onChange, themed, q }) => {
  const min = q.validation?.min ?? 1;
  const max = q.validation?.max ?? 5;
  return <ScaleInput value={value} onChange={onChange} themed={themed} min={min} max={max} />;
};

const ScaleInput: React.FC<{
  value: unknown;
  onChange: (v: unknown) => void;
  themed: ThemedStyles;
  min: number;
  max: number;
}> = ({ value, onChange, themed, min, max }) => {
  const items: number[] = [];
  for (let n = min; n <= max; n++) items.push(n);
  return (
    <View style={styles.scaleWrap}>
      {items.map((n) => {
        const selected = value === n;
        return (
          <TouchableOpacity
            key={n}
            onPress={() => onChange(n)}
            style={[
              styles.scaleBtn,
              themed.scaleBtn,
              selected ? themed.primary : null,
            ]}
          >
            <Text style={[styles.scaleText, selected ? themed.primaryFg : themed.foreground]}>
              {n}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const SingleSelect: React.FC<{
  value: unknown;
  onChange: (v: unknown) => void;
  themed: ThemedStyles;
  q: SurveyQuestion;
  translator: Translator | null;
}> = ({ value, onChange, themed, q, translator }) => (
  <View style={styles.optionList}>
    {(q.options ?? []).map((opt) => {
      const selected = value === opt.key;
      return (
        <TouchableOpacity
          key={opt.key}
          onPress={() => onChange(opt.key)}
          style={[
            styles.optionBtn,
            themed.optionBtn,
            selected ? themed.optionBtnSelected : null,
          ]}
        >
          <Text style={[styles.optionText, themed.foreground]}>
            {translator?.optionLabel(q, opt) ?? opt.label}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

const MultiSelect: React.FC<{
  value: unknown;
  onChange: (v: unknown) => void;
  themed: ThemedStyles;
  q: SurveyQuestion;
  translator: Translator | null;
}> = ({ value, onChange, themed, q, translator }) => {
  const selected = Array.isArray(value) ? new Set(value as string[]) : new Set<string>();
  return (
    <View style={styles.optionList}>
      {(q.options ?? []).map((opt) => {
        const isOn = selected.has(opt.key);
        return (
          <TouchableOpacity
            key={opt.key}
            onPress={() => {
              const next = new Set(selected);
              if (isOn) next.delete(opt.key);
              else next.add(opt.key);
              onChange([...next]);
            }}
            style={[
              styles.optionBtn,
              themed.optionBtn,
              isOn ? themed.optionBtnSelected : null,
            ]}
          >
            <Text style={[styles.optionText, themed.foreground]}>
              {translator?.optionLabel(q, opt) ?? opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const BooleanInput: React.FC<{
  value: unknown;
  onChange: (v: unknown) => void;
  themed: ThemedStyles;
}> = ({ value, onChange, themed }) => (
  <View style={styles.optionList}>
    {[
      { label: 'Yes', val: true },
      { label: 'No', val: false },
    ].map(({ label, val }) => {
      const selected = value === val;
      return (
        <TouchableOpacity
          key={label}
          onPress={() => onChange(val)}
          style={[
            styles.optionBtn,
            themed.optionBtn,
            selected ? themed.optionBtnSelected : null,
          ]}
        >
          <Text style={[styles.optionText, themed.foreground]}>{label}</Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

const DateInput: React.FC<{
  value: unknown;
  onChange: (v: unknown) => void;
  themed: ThemedStyles;
}> = ({ value, onChange, themed }) => (
  // Real platform date pickers need an external module dep
  // (@react-native-community/datetimepicker). Plain text input
  // covers the wire shape (YYYY-MM-DD) with a forgiving keyboard
  // for v1; full picker lands in a follow-up.
  <TextInput
    style={[styles.input, themed.input]}
    value={typeof value === 'string' ? value : ''}
    onChangeText={onChange}
    placeholder="YYYY-MM-DD"
    placeholderTextColor={themed.muted.color}
    keyboardType="numbers-and-punctuation"
  />
);

const ConsentInput: React.FC<{
  value: unknown;
  onChange: (v: unknown) => void;
  themed: ThemedStyles;
  q: SurveyQuestion;
  translator: Translator | null;
}> = ({ value, onChange, themed, q, translator }) => (
  <View style={styles.consentRow}>
    <Switch
      value={value === true}
      onValueChange={(v) => onChange(v ? true : undefined)}
      trackColor={{ true: themed.primary.backgroundColor as string, false: undefined }}
    />
    <Text style={[styles.consentText, themed.muted]}>
      {translator?.questionHelptext(q) ?? q.helptext ?? 'I agree.'}
    </Text>
  </View>
);

const ImageChoice: React.FC<{
  value: unknown;
  onChange: (v: unknown) => void;
  themed: ThemedStyles;
  q: SurveyQuestion;
  translator: Translator | null;
}> = ({ value, onChange, themed, q, translator }) => (
  <View style={styles.imageGrid}>
    {(q.options ?? []).map((opt) => {
      const selected = value === opt.key;
      const label = translator?.optionLabel(q, opt) ?? opt.label;
      return (
        <TouchableOpacity
          key={opt.key}
          onPress={() => onChange(opt.key)}
          style={[
            styles.imageTile,
            themed.optionBtn,
            selected ? themed.optionBtnSelected : null,
          ]}
        >
          {opt.image_url && (
            <Image source={{ uri: opt.image_url }} style={styles.imageThumb} />
          )}
          <Text
            style={[styles.imageLabel, themed.foreground]}
            numberOfLines={2}
          >
            {label}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

// ── Theme + styles ─────────────────────────────────────────────────

interface ThemedStyles {
  card: StyleProp<ViewStyle>;
  header: StyleProp<ViewStyle>;
  foreground: { color: string };
  muted: { color: string };
  primary: { backgroundColor: string };
  primaryFg: { color: string };
  input: { borderColor: string; color: string };
  scaleBtn: { borderColor: string };
  optionBtn: { borderColor: string };
  optionBtnSelected: { borderColor: string; backgroundColor: string };
}

function buildThemedStyles(theme?: SurveyTheme | null): ThemedStyles {
  // Default palette mirrors the web SDK's CSS variables.
  const bg = theme?.background_color || '#ffffff';
  const fg = theme?.foreground_color || '#18181b';
  const muted = theme?.muted_color || '#71717a';
  const accent = theme?.primary_color || '#f43f5e';
  const border = theme?.border_color || '#e4e4e7';
  return {
    card: { backgroundColor: bg, borderColor: border },
    header: { borderColor: border },
    foreground: { color: fg },
    muted: { color: muted },
    primary: { backgroundColor: accent },
    primaryFg: { color: '#ffffff' },
    input: { borderColor: border, color: fg },
    scaleBtn: { borderColor: border },
    optionBtn: { borderColor: border },
    optionBtnSelected: {
      borderColor: accent,
      backgroundColor: hexWithAlpha(accent, 0.08),
    },
  };
}

function hexWithAlpha(hex: string, alpha: number): string {
  // Quick hex → rgba; falls back to a translucent grey if parsing fails.
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 'rgba(244,63,94,0.08)';
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function isLastQuestion(snap: StateSnapshot, questions: SurveyQuestion[]): boolean {
  if (!snap.question) return false;
  const sorted = [...questions].sort((a, b) => a.order_index - b.order_index);
  return sorted[sorted.length - 1]?.id === snap.question.id;
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  card: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  logo: { width: 18, height: 18, marginRight: 8 },
  title: { fontSize: 13, fontWeight: '600' },
  progress: { fontSize: 11 },
  closeText: { fontSize: 22, paddingHorizontal: 6 },
  body: { padding: 16 },
  prompt: { fontSize: 14, fontWeight: '500', lineHeight: 20 },
  helptext: { fontSize: 12, marginTop: 4 },
  inputWrap: { marginTop: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  textarea: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  statement: {
    paddingVertical: 8,
    fontSize: 13,
    lineHeight: 20,
  },
  scaleWrap: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  scaleBtn: {
    flexGrow: 1,
    minWidth: 36,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 6,
    alignItems: 'center',
  },
  scaleText: { fontSize: 13, fontWeight: '500' },
  optionList: { gap: 6 },
  optionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 6,
  },
  optionText: { fontSize: 13 },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  consentText: { fontSize: 12, flexShrink: 1, lineHeight: 18 },
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  imageTile: {
    width: 120,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
  },
  imageThumb: { width: 100, height: 100, borderRadius: 4 },
  imageLabel: { fontSize: 11, textAlign: 'center', marginTop: 4 },
  thanks: { textAlign: 'center', fontSize: 14, paddingVertical: 24 },
  error: { fontSize: 12, marginTop: 8 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  backBtn: { paddingVertical: 6 },
  backText: { fontSize: 12 },
  nextBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  nextText: { fontSize: 13, fontWeight: '500' },
});
