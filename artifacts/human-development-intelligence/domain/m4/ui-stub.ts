import { taskCopy } from '../../i18n-task';
import type { M4ContextInput, M4Decision, M4Scope } from './contract';

export type M4StubFixture = 'absent' | 'valid' | 'permission_denied' | 'declined';
export const M4_MEAL_IMAGE_STUB_INPUT = 'Tôi cần đánh giá bữa ăn bằng hình ảnh.';

export function isM4MealImageStubInput(value: string): boolean {
  return value.trim().normalize('NFC').toLocaleLowerCase('vi')
    === M4_MEAL_IMAGE_STUB_INPUT.normalize('NFC').toLocaleLowerCase('vi');
}

/** Builds a fresh, task-bound host projection. It stores no image or result. */
export function projectM4StubContext(
  scope: M4Scope,
  fixture: M4StubFixture,
): M4ContextInput {
  const image = fixture === 'valid' || fixture === 'permission_denied'
    ? { state: 'present' as const, id: `fixture-meal-image:${scope.task_id}`, usable: true, permission_revision: 1 }
    : fixture === 'declined'
      ? { state: 'declined' as const }
      : { state: 'absent' as const };
  return Object.freeze({
    scope: Object.freeze({ ...scope }),
    image: Object.freeze(image),
    permission: Object.freeze({
      purpose: 'meal_image_assessment' as const,
      status: fixture === 'valid' ? 'allowed' as const
        : fixture === 'permission_denied' ? 'denied' as const : 'unknown' as const,
      revision: 1,
    }),
    boundary: 'within_slice' as const,
  });
}

/** User-facing copy only; technical M4 states never cross into the UI. */
export function presentM4StubDecision(decision: M4Decision, locale: string): string | null {
  const copy = taskCopy(locale);
  switch (decision.state) {
    case 'CONTEXT_REQUIRED': return copy.acknowledged;
    case 'CONTEXT_SUFFICIENT': return copy.imageAvailable;
    case 'PERMISSION_REQUIRED': return copy.imagePermission;
    case 'CONTEXT_DECLINED': return copy.imageDeclined;
    case 'PROFESSIONAL_HANDOFF_NEEDED': return copy.professional;
    default: return null;
  }
}
