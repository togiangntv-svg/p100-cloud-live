import type { M4Result, M4Scope } from '../m4/contract';
import type { SessionTask } from '../session-task/store';
import { taskCopy } from '../../i18n-task';

export type GoalKind = 'general_health' | 'body_composition' | 'strength' | 'movement';

export type GoalM5Proposal = Readonly<{
  kind: 'ADOPT_CURRENT_GOAL';
  goal_kind: GoalKind;
  why_code: 'CLEAR_GOAL_READY';
  tradeoff_code: 'REVERSIBLE_USER_CHOICE';
  requires_user_choice: true;
}>;

export type GoalM5ChoiceReceipt = Readonly<{
  session_id: string;
  task_id: string;
  revision: number;
  proposal_kind: GoalM5Proposal['kind'];
  goal_kind: GoalKind;
  choice: 'ACCEPTED';
}>;

export type GoalM5ChoicePresentation = Readonly<{
  acknowledgement: string;
  use_goal: string;
  change_goal: string;
  selected: string;
}>;

export type GoalM5NoActionReason =
  | 'STALE_TASK'
  | 'STALE_CONTEXT'
  | 'CANCELLED'
  | 'TASK_NOT_READY'
  | 'M3_BOUNDARY'
  | 'M4_BLOCKED'
  | 'UNSUPPORTED_TASK';

export type GoalM5Decision =
  | Readonly<{ scope: M4Scope; state: 'PROPOSAL'; proposal: GoalM5Proposal }>
  | Readonly<{
      scope: M4Scope;
      state: 'NO_ACTION';
      reason: GoalM5NoActionReason;
      proposal: null;
    }>;

const GOAL_KINDS = new Set<GoalKind>([
  'general_health', 'body_composition', 'strength', 'movement',
]);

const freezeScope = (scope: M4Scope): M4Scope => Object.freeze({
  session_id: scope.session_id,
  task_id: scope.task_id,
  revision: scope.revision,
});

const sameScope = (task: SessionTask, scope: M4Scope): boolean =>
  task.session_id === scope.session_id
  && task.task_id === scope.task_id
  && task.revision === scope.revision;

export function createGoalM5NoAction(
  scope: M4Scope,
  reason: GoalM5NoActionReason,
): GoalM5Decision {
  return Object.freeze({
    scope: freezeScope(scope), state: 'NO_ACTION' as const, reason, proposal: null,
  });
}

export function presentGoalM5Choice(locale: string): GoalM5ChoicePresentation {
  const copy = taskCopy(locale);
  return Object.freeze({
    acknowledgement: copy.goalUnderstood,
    use_goal: copy.goalUse,
    change_goal: copy.goalChange,
    selected: copy.goalSelected,
  });
}

/**
 * Pure M5 choice proposal. It can neither accept/persist a goal nor execute a
 * downstream action; explicit user choice remains required by the contract.
 */
export function resolveGoalM5Decision(task: SessionTask, m4: M4Result): GoalM5Decision {
  if (!sameScope(task, m4.scope)) return createGoalM5NoAction(m4.scope, 'STALE_CONTEXT');
  if (task.status === 'CANCELLED') return createGoalM5NoAction(m4.scope, 'CANCELLED');
  if (task.status !== 'READY' || !task.permission_granted || !task.interpretation) {
    return createGoalM5NoAction(m4.scope, 'TASK_NOT_READY');
  }
  const meaning = task.interpretation;
  if (task.m3_context.safety_signal !== 'CLEAR' || meaning.safety_state !== 'CLEAR'
    || meaning.clarification_needed || meaning.intent_type === 'AMBIGUOUS'
    || meaning.suggested_next_role === 'STOP'
    || ['STOP_PAUSE', 'REFUSAL', 'SAFETY', 'OUT_OF_SCOPE'].includes(meaning.intent_type)) {
    return createGoalM5NoAction(m4.scope, 'M3_BOUNDARY');
  }
  if (meaning.intent_type !== 'GOAL' || meaning.suggested_next_role !== 'M4'
    || !meaning.task_kind || !GOAL_KINDS.has(meaning.task_kind as GoalKind)) {
    return createGoalM5NoAction(m4.scope, 'UNSUPPORTED_TASK');
  }
  if (m4.decision.state !== 'CONTEXT_SUFFICIENT'
    || m4.decision.sufficient_for !== 'NEXT_STEP_CONTRACT_ONLY') {
    return createGoalM5NoAction(m4.scope, 'M4_BLOCKED');
  }
  const proposal: GoalM5Proposal = Object.freeze({
    kind: 'ADOPT_CURRENT_GOAL',
    goal_kind: meaning.task_kind as GoalKind,
    why_code: 'CLEAR_GOAL_READY',
    tradeoff_code: 'REVERSIBLE_USER_CHOICE',
    requires_user_choice: true,
  });
  return Object.freeze({ scope: freezeScope(m4.scope), state: 'PROPOSAL' as const, proposal });
}
