import type { M4Result } from '../m4/contract';
import type { GoalKind, GoalM5ChoiceReceipt, GoalM5Decision } from '../m5/goal-choice';
import type { SessionTask } from '../session-task/store';

export type GoalM6ActionContext = Readonly<{
  available_time_minutes?: number;
  current_constraints?: 'UNKNOWN' | 'NONE_REPORTED' | 'REPORTED';
}>;

export type GoalM6MissingContext =
  | 'available_time_minutes'
  | 'current_constraints'
  | 'action_adaptation';

type GoalM6Scope = Readonly<{
  session_id: string;
  task_id: string;
  task_revision: number;
}>;

type GoalM6ReceiptIdentity = Readonly<{
  session_id: string;
  task_id: string;
  task_revision: number;
  proposal_kind: 'ADOPT_CURRENT_GOAL';
  goal_kind: GoalKind;
  choice: 'ACCEPTED';
}>;

type GoalM6Base = Readonly<{
  scope: GoalM6Scope;
  source_m5_receipt: GoalM6ReceiptIdentity;
  goal_kind: GoalKind;
  mode: 'SELF';
  execution_state: 'NOT_STARTED';
}>;

export type GoalM6ActionHandoff =
  | Readonly<GoalM6Base & {
      state: 'NEED_CONTEXT';
      missing_context: readonly GoalM6MissingContext[];
    }>
  | Readonly<GoalM6Base & {
      state: 'ACTION_READY';
      action_kind: 'SELF_GUIDED_GOAL_STEP';
      available_time_minutes: number;
      constraint_basis: 'NONE_REPORTED_NOT_CONFIRMED_SAFE';
    }>;

const sameScope = (task: SessionTask, m4: M4Result, receipt: GoalM5ChoiceReceipt): boolean =>
  task.session_id === m4.scope.session_id
  && task.task_id === m4.scope.task_id
  && task.revision === m4.scope.revision
  && task.session_id === receipt.session_id
  && task.task_id === receipt.task_id
  && task.revision === receipt.revision;

const freezeScope = (task: SessionTask): GoalM6Scope => Object.freeze({
  session_id: task.session_id,
  task_id: task.task_id,
  task_revision: task.revision,
});

const freezeReceiptIdentity = (receipt: GoalM5ChoiceReceipt): GoalM6ReceiptIdentity => Object.freeze({
  session_id: receipt.session_id,
  task_id: receipt.task_id,
  task_revision: receipt.revision,
  proposal_kind: receipt.proposal_kind,
  goal_kind: receipt.goal_kind,
  choice: receipt.choice,
});

/**
 * Pure M6-0 bridge. It represents a bounded, non-executed SELF candidate only
 * after the store has re-derived current M4/M5 authority. It never starts,
 * completes or persists an action.
 */
export function resolveGoalM6ActionHandoff(
  task: SessionTask,
  m4: M4Result,
  m5: GoalM5Decision,
  receipt: GoalM5ChoiceReceipt,
  context: GoalM6ActionContext = {},
): GoalM6ActionHandoff | undefined {
  if (!sameScope(task, m4, receipt)
    || task.status !== 'READY'
    || !task.permission_granted
    || !task.interpretation
    || task.interpretation.safety_state !== 'CLEAR'
    || task.m3_context.safety_signal !== 'CLEAR'
    || task.interpretation.clarification_needed
    || task.interpretation.intent_type !== 'GOAL'
    || task.interpretation.suggested_next_role !== 'M4'
    || m4.decision.state !== 'CONTEXT_SUFFICIENT'
    || m4.decision.sufficient_for !== 'NEXT_STEP_CONTRACT_ONLY'
    || m5.state !== 'PROPOSAL'
    || receipt.choice !== 'ACCEPTED'
    || receipt.proposal_kind !== m5.proposal.kind
    || receipt.goal_kind !== m5.proposal.goal_kind
    || receipt.goal_kind !== task.interpretation.task_kind) return undefined;

  const base = {
    scope: freezeScope(task),
    source_m5_receipt: freezeReceiptIdentity(receipt),
    goal_kind: receipt.goal_kind,
    mode: 'SELF' as const,
    execution_state: 'NOT_STARTED' as const,
  };
  const missing: GoalM6MissingContext[] = [];
  if (!Number.isSafeInteger(context.available_time_minutes)
    || Number(context.available_time_minutes) <= 0) missing.push('available_time_minutes');
  if (context.current_constraints === 'REPORTED') {
    missing.push('action_adaptation');
  } else if (context.current_constraints !== 'NONE_REPORTED') {
    missing.push('current_constraints');
  }
  if (missing.length) return Object.freeze({
    ...base,
    state: 'NEED_CONTEXT' as const,
    missing_context: Object.freeze(missing),
  });
  return Object.freeze({
    ...base,
    state: 'ACTION_READY' as const,
    action_kind: 'SELF_GUIDED_GOAL_STEP' as const,
    available_time_minutes: context.available_time_minutes!,
    constraint_basis: 'NONE_REPORTED_NOT_CONFIRMED_SAFE' as const,
  });
}
