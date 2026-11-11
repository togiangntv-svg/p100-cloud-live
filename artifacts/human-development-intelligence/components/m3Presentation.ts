import type { LanguageInput } from '../domain/m3/contract';
import type { SessionTask } from '../domain/session-task/store';
import { m2Messages, type M2TranslationKey } from '../i18n-m2';
import { taskCopy } from '../i18n-task';

export type M3LifecycleNoticeKey = Extract<
  M2TranslationKey,
  'm2Acknowledged' | 'm2PermissionNeeded' | 'm2PermissionGranted' | 'm2PermissionRevoked' | 'm2Cancelled'
>;

export function presentM3LifecycleNotice(
  key: M3LifecycleNoticeKey | null,
  locale: LanguageInput['locale'],
): string {
  return key ? m2Messages[locale][key] : '';
}

/**
 * Re-presents structured task meaning without translating provider-authored
 * prose. Task provenance remains in m3_context.locale; locale only owns copy.
 */
export function presentM3SemanticState(
  task: SessionTask,
  locale: LanguageInput['locale'],
): string {
  const meaning = task.interpretation;
  if (!meaning) return '';
  const copy = taskCopy(locale);
  if (meaning.safety_state === 'URGENT' || task.m3_context.safety_signal === 'URGENT') return copy.urgentSafety;
  if (meaning.safety_state !== 'CLEAR' || task.m3_context.safety_signal !== 'CLEAR'
    || meaning.intent_type === 'SAFETY') return copy.safety;
  if (task.m3_context.asking_stopped || meaning.suggested_next_role === 'STOP'
    || ['STOP_PAUSE', 'REFUSAL'].includes(meaning.intent_type)) return copy.stopped;
  if (meaning.intent_type === 'OUT_OF_SCOPE') return copy.professional;
  if (meaning.clarification_needed) return copy.clarification;
  if (meaning.intent_type === 'CORRECTION' || meaning.intent_type === 'CHANGE_OF_MIND'
    || meaning.context_effect === 'ADJUST_CURRENT') return copy.corrected;
  return copy.acknowledged;
}

export function isSameM3Submission(
  task: SessionTask | undefined,
  sourceInput: string,
  locale: LanguageInput['locale'],
): boolean {
  return Boolean(task
    && task.source_input === sourceInput
    && task.m3_context.locale === locale
    && !['CANCELLED', 'FAILED'].includes(task.status));
}
