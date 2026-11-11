import type { IntentMeaning, LanguageInput } from './contract';
import { deriveM3TextSafetyFloor } from '../../../../lib/api-zod/src/m3-text-safety-floor';
import { isM4MealImageStubInput } from '../m4/ui-stub';
import { taskCopy } from '../../i18n-task';
import { readCoachRequest } from '../../i18n-coach-presence';

const normalize = (text: string) => text.normalize('NFC').toLocaleLowerCase().trim().replace(/[.!?]+$/u, '').trim();
const stop = /^(thôi|thôi nhé|dừng|dừng lại|tạm dừng|ngừng lại|stop|pause|stop please)$/u;
const refusal = /^(không muốn tiếp tục|tôi không muốn tiếp tục|không,? cảm ơn|no thanks|i don't want to continue)$/u;
const correction = /^(không[, ]|ý (tôi|mình) là|tôi nói|no[, ]|i meant|actually[, ])/u;
const remainingTime = /^(?:tôi chỉ )?còn (\d{1,3}) phút$|^(?:i (?:only )?have )?(\d{1,3}) minutes left$/u;
const suggestionSemantics: Readonly<Record<string, Readonly<{
  taskKind: string;
  viMeaning: string;
  enMeaning: string;
  response: string;
}>>> = Object.freeze({
  'Khỏe hơn': { taskKind: 'general_health', viMeaning: 'Người dùng muốn cải thiện sức khỏe tổng thể.',
    enMeaning: 'The user wants to improve overall health.', response: 'Mình hiểu bạn muốn cơ thể khỏe hơn.' },
  'Gọn đẹp hơn': { taskKind: 'body_composition', viMeaning: 'Người dùng muốn cơ thể gọn và đẹp hơn.',
    enMeaning: 'The user wants a leaner-looking body.', response: 'Mình hiểu bạn muốn cơ thể gọn đẹp hơn.' },
  'Mạnh hơn': { taskKind: 'strength', viMeaning: 'Người dùng muốn cải thiện sức mạnh.',
    enMeaning: 'The user wants to improve strength.', response: 'Mình hiểu bạn muốn cơ thể mạnh hơn.' },
  'Vận động tốt hơn': { taskKind: 'movement', viMeaning: 'Người dùng muốn cải thiện khả năng vận động.',
    enMeaning: 'The user wants to improve movement.', response: 'Mình hiểu bạn muốn cơ thể vận động tốt hơn.' },
  'Feel healthier': { taskKind: 'general_health', viMeaning: 'Người dùng muốn cải thiện sức khỏe tổng thể.',
    enMeaning: 'The user wants to improve overall health.', response: 'I understand you want your body to feel healthier.' },
  'Feel leaner and look better': { taskKind: 'body_composition', viMeaning: 'Người dùng muốn cơ thể gọn và đẹp hơn.',
    enMeaning: 'The user wants a leaner-looking body.', response: 'I understand you want your body to feel leaner and look better.' },
  'Get stronger': { taskKind: 'strength', viMeaning: 'Người dùng muốn cải thiện sức mạnh.',
    enMeaning: 'The user wants to improve strength.', response: 'I understand you want your body to get stronger.' },
  'Move better': { taskKind: 'movement', viMeaning: 'Người dùng muốn cải thiện khả năng vận động.',
    enMeaning: 'The user wants to improve movement.', response: 'I understand you want your body to move better.' },
});

/** Only explicit follow-ups may reuse the focused task. Unrelated submissions
 * remain independent; this classifier never selects a task from history. */
export function m3FollowUpKind(text: string): 'STOP' | 'CORRECTION' | 'CONSTRAINT' | null {
  const value = normalize(text);
  if (stop.test(value) || refusal.test(value)) return 'STOP';
  if (correction.test(value)) return 'CORRECTION';
  if (remainingTime.test(value)) return 'CONSTRAINT';
  return null;
}

/** Bounded on-device semantics, not a claim of general language understanding.
 * Unknown meanings stay uncertain. No action execution or confirmed Goal is
 * created here. Provenance remains TEST_FIXTURE at the adapter boundary. */
export function resolveDeterministicM3(input: LanguageInput): IntentMeaning {
  const value = normalize(input.current_text);
  const vi = input.locale === 'vi';
  const copy = (vietnamese: string, english: string) => vi ? vietnamese : english;
  const reflected = input.current_text.trim().replace(/\s+/gu, ' ');
  const baselineReflection = copy(`Mình hiểu điều bạn đang muốn là: ${reflected}`, `I understand what you want is: ${reflected}`);
  const contexts = input.relevant_context.filter(item => item.kind.startsWith('active_task:'));
  const context = contexts.length === 1 ? contexts[0] : undefined;
  const isCorrection = input.user_correction !== null || correction.test(value);
  const base: IntentMeaning = {
    intent_type: 'AMBIGUOUS', interpreted_meaning: copy('Chưa xác định được yêu cầu.', 'The request is not yet clear.'),
    confidence: 0.4, uncertainty: 'INTENDED_REQUEST_UNCLEAR', missing_context: [],
    clarification_needed: false, clarification_question: null, safety_state: input.safety_signal,
    suggested_next_role: 'STOP', task_kind: null, context_effect: 'NONE', used_context_ids: [],
    response: copy('Mình chưa hiểu rõ yêu cầu của bạn.', 'I am not sure what you mean yet.'),
  };
  const finish = (patch: Partial<IntentMeaning>) => Object.freeze({ ...base, ...patch,
    missing_context: Object.freeze([...(patch.missing_context ?? base.missing_context)]),
    used_context_ids: Object.freeze([...(patch.used_context_ids ?? base.used_context_ids)]),
  });
  const understood = (patch: Partial<IntentMeaning>) => finish({ confidence: 0.85, uncertainty: null, ...patch });
  const clarify = (missing: string, question: string, patch: Partial<IntentMeaning> = {}) => finish({
    missing_context: [missing], clarification_needed: !input.asking_stopped,
    clarification_question: input.asking_stopped ? null : question,
    response: input.asking_stopped ? copy('Mình sẽ không hỏi thêm.', 'I will not ask more questions.') : question,
    ...patch,
  });

  // Stop/refusal never creates another question, goal or executable action.
  if (stop.test(value) || refusal.test(value)) return understood({
    intent_type: refusal.test(value) ? 'REFUSAL' : 'STOP_PAUSE',
    interpreted_meaning: copy('Người dùng muốn dừng việc đang trao đổi.', 'The user wants to stop the current interaction.'),
    context_effect: context ? 'ADJUST_CURRENT' : 'NONE', used_context_ids: context ? [context.id] : [],
    response: copy('Mình dừng ở đây.', 'We can stop here.'),
  });

  // Explicit discomfort retracts a cosmetic interpretation; it is not a diagnosis.
  const discomfort = /bụng (?:đang )?(?:khó chịu|đau)|(?:stomach|abdomen|belly) (?:hurts|discomfort)/u.test(value);
  const textFloor = deriveM3TextSafetyFloor(input.locale, input.current_text);
  const rank = { CLEAR: 0, SENSITIVE: 1, PAIN: 2, URGENT: 3 } as const;
  const safety = ([input.safety_signal, textFloor, discomfort ? 'SENSITIVE' : 'CLEAR'] as const)
    .reduce((highest, next) => rank[next] > rank[highest] ? next : highest);
  if (safety !== 'CLEAR') return understood({
    intent_type: isCorrection ? 'CORRECTION' : 'SAFETY', task_kind: 'physical_discomfort',
    interpreted_meaning: discomfort
      ? copy('Người dùng đang mô tả cảm giác khó chịu ở bụng.', 'The user reports abdominal discomfort.')
      : copy('Người dùng nêu dấu hiệu cần ưu tiên an toàn.', 'The user reports a safety concern.'),
    safety_state: safety,
    context_effect: isCorrection && context ? 'ADJUST_CURRENT' : 'NONE',
    used_context_ids: isCorrection && context ? [context.id] : [],
    suggested_next_role: 'STOP',
    response: safety === 'URGENT' ? taskCopy(input.locale).urgentSafety : discomfort
      ? copy('Mình hiểu là bụng bạn đang khó chịu. Mình chưa thể xác định nguyên nhân.', 'I understand your abdomen feels uncomfortable. I cannot determine the cause.')
      : copy('Mình ưu tiên sự an toàn của bạn. Hãy dừng động tác gây đau; nếu đau nghiêm trọng, hãy tìm hỗ trợ y tế.', 'Your safety comes first. Stop movements that cause pain; seek medical help for severe pain.'),
  });

  // Explicit joking is not promoted to a task. Unknown humor stays ambiguous.
  if (/đùa thôi|nói đùa|just kidding|only joking/u.test(value)) return understood({
    intent_type: 'HUMOR_PRAGMATIC', interpreted_meaning: copy('Người dùng đang nói đùa, chưa yêu cầu hành động.', 'The user is joking, not requesting an action.'),
    response: copy('Mình hiểu bạn đang nói đùa.', 'I understand you are joking.'),
  });

  const time = remainingTime.exec(value);
  if (time) {
    const kind = context?.kind.slice('active_task:'.length);
    if (!kind || ['unknown', 'general_health', 'body_composition'].includes(kind)) return clarify('active_task',
      copy(`${Number(time[1] ?? time[2])} phút này dành cho việc nào?`, 'Which task is this time limit for?'));
    return understood({ intent_type: 'CURRENT_TASK', task_kind: kind, context_effect: 'ADJUST_CURRENT',
      used_context_ids: [context!.id], suggested_next_role: 'M4',
      interpreted_meaning: copy(`Thời gian còn lại cho việc đang làm là ${Number(time[1] ?? time[2])} phút.`,
        `The active task has ${Number(time[1] ?? time[2])} minutes remaining.`),
      response: copy(`Mình hiểu bạn còn ${Number(time[1] ?? time[2])} phút cho việc này.`,
        `I understand you have ${Number(time[1] ?? time[2])} minutes left for this task.`),
    });
  }

  // A correction is reinterpreted from the new text; old task meaning is never
  // appended to it. Unsupported replacements still retire the old interpretation.
  const corrected = isCorrection ? value.replace(/^(?:không[, ]+|no[, ]+|actually[, ]+)?(?:(?:tôi nói|ý tôi là|ý mình là|i meant)\s*)?/u, '') : value;
  const negated = /không (?:muốn|cần|giữ)|don't want|do not want|not (?:keep|preserve)/u.test(corrected);
  const suggestion = suggestionSemantics[reflected];
  if (!isCorrection && suggestion) {
    const englishLabel = ['Feel healthier', 'Feel leaner and look better', 'Get stronger', 'Move better'].includes(reflected);
    return understood({
      intent_type: 'GOAL', task_kind: suggestion.taskKind, suggested_next_role: 'M4',
      interpreted_meaning: copy(suggestion.viMeaning, suggestion.enMeaning),
      response: vi !== englishLabel
        ? suggestion.response
        : copy(`Mình hiểu: ${suggestion.viMeaning}`, `I understand: ${suggestion.enMeaning}`),
    });
  }
  const goal = !negated && /^(?:(?:tôi|mình) (?:muốn|cần) )?(?:khỏe hơn|cải thiện sức khỏe|sức khỏe tốt hơn)$|^(?:i want to )?(?:be healthier|improve my health)$/u.test(corrected);
  const composition = !negated && /^(?:(?:tôi|mình) (?:muốn|cần) )?(?:bụng nhỏ lại|giảm mỡ(?: bụng)?)|^(?:i want to )?reduce belly fat/u.test(corrected)
    && /giữ cơ|giữ lại cơ|preserve muscle|keep muscle/u.test(corrected);
  if (goal || composition) return understood({ intent_type: isCorrection ? 'CORRECTION' : 'GOAL',
    task_kind: composition ? 'body_composition' : 'general_health', suggested_next_role: 'M4',
    context_effect: isCorrection && context ? 'ADJUST_CURRENT' : 'NONE', used_context_ids: isCorrection && context ? [context.id] : [],
    interpreted_meaning: composition
      ? copy('Người dùng muốn giảm mỡ vùng bụng đồng thời giữ cơ.', 'The user wants to reduce abdominal fat while preserving muscle.')
      : copy('Người dùng muốn cải thiện sức khỏe tổng thể.', 'The user wants to improve overall health.'),
    response: composition
      ? copy('Mình hiểu bạn muốn giảm mỡ bụng và giữ cơ.', 'I understand you want to reduce belly fat while preserving muscle.')
      : copy('Mình hiểu bạn muốn cải thiện sức khỏe tổng thể.', 'I understand you want to improve your overall health.'),
  });
  if (!negated && /^(?:tôi|mình) đang tập(?: luyện)?$|^i am working out$/u.test(corrected)) return understood({
    intent_type: isCorrection ? 'CORRECTION' : 'CURRENT_TASK', task_kind: 'workout', suggested_next_role: 'M4',
    interpreted_meaning: copy('Người dùng đang trong một buổi tập.', 'The user is in an active workout.'),
    response: copy('Mình hiểu bạn đang tập luyện.', 'I understand you are working out.'),
  });
  if (!negated && /sắp xếp (?:việc|công việc) hôm nay|lên kế hoạch hôm nay|help me plan today/u.test(corrected)) return understood({
    intent_type: isCorrection ? 'CORRECTION' : 'CURRENT_TASK', task_kind: 'day_planning', suggested_next_role: 'M4',
    interpreted_meaning: copy('Người dùng muốn sắp xếp công việc trong ngày.', 'The user wants help organizing today’s tasks.'),
    response: copy(`Mình hiểu điều bạn đang muốn là: ${reflected}`, `I understand what you want is: ${reflected}`),
  });
  const coachRequest = !isCorrection && !negated ? readCoachRequest(input.locale, input.current_text) : undefined;
  if (coachRequest) return understood({ intent_type:'CURRENT_TASK', task_kind:coachRequest.taskKind,
    suggested_next_role:'M4', interpreted_meaning:coachRequest.meaning, response:coachRequest.response });
  if (!isCorrection && !negated && isM4MealImageStubInput(input.current_text)) return understood({
    intent_type: 'CURRENT_TASK', task_kind: 'meal_image_assessment', suggested_next_role: 'M4',
    interpreted_meaning: copy('Người dùng muốn đánh giá bữa ăn qua hình ảnh.', 'The user wants a meal assessment from an image.'),
    // Preserve the existing Vietnamese meal fixture's effective locale.
    response: 'Mình đã ghi nhận yêu cầu này.',
  });
  return clarify('intended_request', copy('Bạn muốn mình hiểu yêu cầu này như thế nào?', 'What would you like me to understand from this request?'),
    isCorrection ? { intent_type: 'CORRECTION', context_effect: context ? 'ADJUST_CURRENT' : 'NONE',
      used_context_ids: context ? [context.id] : [],
      interpreted_meaning: copy('Cách hiểu trước đã được rút lại; chưa rõ yêu cầu thay thế.', 'The previous interpretation is withdrawn; the replacement request is not yet clear.'),
      // Existing edit acknowledgement remains stable; clarification is explicit
      // in the contract, without claiming to understand an unknown replacement.
      ...(input.user_correction && !input.asking_stopped ? {
        response: baselineReflection,
      } : {}),
    } : {});
}
