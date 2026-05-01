/**
 * Survey state machine — port of @sankofa/pulse state.ts.
 *
 * Tracks current question, accumulated answers, walks branching
 * resolution on advance(). Identical semantics to the web SDK
 * + Go server's reference impl.
 */

import { resolveNext } from './branching';
import {
  BRANCHING_END_OF_SURVEY,
  type AnswerState,
  type BranchingRule,
  type SurveyQuestion,
} from './PulseTypes';

export interface StateSnapshot {
  question: SurveyQuestion | null;
  index: number;
  total: number;
  visited: SurveyQuestion[];
  answers: AnswerState;
  done: boolean;
}

export class SurveyState {
  private byId: Map<string, SurveyQuestion>;
  private order: SurveyQuestion[];
  private rules: BranchingRule[];
  private visited: SurveyQuestion[] = [];
  private answers: AnswerState = {};
  private done = false;

  constructor(
    questions: SurveyQuestion[],
    rules: BranchingRule[],
    initialAnswers: AnswerState = {},
    resumeQuestionId?: string,
  ) {
    this.order = [...questions].sort((a, b) => a.order_index - b.order_index);
    this.byId = new Map(this.order.map((q) => [q.id, q]));
    this.rules = rules;
    this.answers = { ...initialAnswers };

    if (resumeQuestionId && this.byId.has(resumeQuestionId)) {
      this.visited = [this.byId.get(resumeQuestionId)!];
    } else if (this.order.length > 0) {
      this.visited = [this.order[0]];
    }
  }

  snapshot(): StateSnapshot {
    const current = this.visited[this.visited.length - 1] ?? null;
    return {
      question: this.done ? null : current,
      index: current ? this.order.indexOf(current) : -1,
      total: this.order.length,
      visited: [...this.visited],
      answers: { ...this.answers },
      done: this.done,
    };
  }

  recordAnswer(questionId: string, value: unknown): void {
    if (value === undefined) {
      delete this.answers[questionId];
      return;
    }
    this.answers[questionId] = value;
  }

  advance(): StateSnapshot {
    if (this.done) return this.snapshot();
    const current = this.visited[this.visited.length - 1];
    if (!current) {
      this.done = true;
      return this.snapshot();
    }
    const outcome = resolveNext(this.rules, current.id, this.answers);
    if (outcome.next_question_id === BRANCHING_END_OF_SURVEY) {
      this.done = true;
      return this.snapshot();
    }
    let next: SurveyQuestion | null = null;
    if (outcome.next_question_id) {
      next = this.byId.get(outcome.next_question_id) ?? null;
    } else {
      const idx = this.order.indexOf(current);
      if (idx >= 0 && idx < this.order.length - 1) {
        next = this.order[idx + 1];
      }
    }
    if (!next) {
      this.done = true;
      return this.snapshot();
    }
    this.visited.push(next);
    return this.snapshot();
  }

  back(): StateSnapshot {
    if (this.done) {
      this.done = false;
    }
    if (this.visited.length > 1) {
      this.visited.pop();
    }
    return this.snapshot();
  }

  canGoBack(): boolean {
    return this.visited.length > 1 && !this.done;
  }

  currentQuestion(): SurveyQuestion | null {
    if (this.done) return null;
    return this.visited[this.visited.length - 1] ?? null;
  }

  allAnswers(): AnswerState {
    return { ...this.answers };
  }
}
