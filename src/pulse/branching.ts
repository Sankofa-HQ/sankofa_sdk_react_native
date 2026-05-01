/**
 * Branching evaluator — port of @sankofa/pulse branching.ts
 * (which is itself a port of server/engine/ee/pulse/branching/
 * evaluator.go). Pure logic; no DOM / no RN-specific APIs.
 */

import {
  BRANCHING_END_OF_SURVEY,
  type AnswerState,
  type BranchingCondition,
  type BranchingRule,
  type CondOp,
  type Outcome,
} from './PulseTypes';

export function resolveNext(
  rules: BranchingRule[],
  currentQuestionId: string,
  answers: AnswerState,
): Outcome {
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (rule.from_question_id !== currentQuestionId) continue;
    if (!evaluateCondition(rule.condition, answers)) continue;
    switch (rule.action) {
      case 'skip_to':
        return {
          next_question_id: rule.to_question_id ?? '',
          reason: `rule[${i}] skip_to ${rule.to_question_id}`,
        };
      case 'end_survey':
        return {
          next_question_id: BRANCHING_END_OF_SURVEY,
          reason: `rule[${i}] end_survey`,
        };
    }
  }
  return { next_question_id: '', reason: 'fall through (no rule matched)' };
}

export function evaluateCondition(
  cond: BranchingCondition,
  answers: AnswerState,
): boolean {
  switch (cond.kind) {
    case 'answer':
      return evalAnswerCondition(cond, answers);
  }
  return false;
}

function evalAnswerCondition(cond: BranchingCondition, answers: AnswerState): boolean {
  const present = Object.prototype.hasOwnProperty.call(answers, cond.question_id);
  const v = answers[cond.question_id];
  switch (cond.op) {
    case 'answered':
      return present && !isEmptyAnswer(v);
    case 'not_answered':
      return !present || isEmptyAnswer(v);
  }
  if (!present || isEmptyAnswer(v)) return false;
  switch (cond.op) {
    case 'equals':
      return jsonEqual(v, cond.value);
    case 'not_equals':
      return !jsonEqual(v, cond.value);
    case 'contains':
      return jsonContains(v, cond.value);
    case 'not_contains':
      return !jsonContains(v, cond.value);
    case 'in':
      return jsonInArray(v, cond.value);
    case 'not_in':
      return !jsonInArray(v, cond.value);
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte':
      return compareNumeric(v, cond.value, cond.op);
  }
  return false;
}

function isEmptyAnswer(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

function jsonContains(v: unknown, target: unknown): boolean {
  if (Array.isArray(v)) {
    return v.some((item) => jsonEqual(item, target));
  }
  if (typeof v === 'string' && typeof target === 'string') {
    return v.includes(target);
  }
  return false;
}

function jsonInArray(v: unknown, target: unknown): boolean {
  if (!Array.isArray(target)) return false;
  return target.some((item) => jsonEqual(v, item));
}

function compareNumeric(v: unknown, target: unknown, op: CondOp): boolean {
  const left = numericValue(v);
  if (left === null) return false;
  const right = numericValue(target);
  if (right === null) return false;
  switch (op) {
    case 'gt':
      return left > right;
    case 'lt':
      return left < right;
    case 'gte':
      return left >= right;
    case 'lte':
      return left <= right;
  }
  return false;
}

function numericValue(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
