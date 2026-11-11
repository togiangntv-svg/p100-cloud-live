// Explicit test fixtures only. Never import these from app/, context/, or domain/.
export const NOW = Date.UTC(2026, 8, 13, 12);
const evidence = () => ({
  subjectId: 'fixture-person', source: 'fixture', observedAt: NOW - 1000,
  freshness: 'current',
});
export function fixtureA1() {
  return {
    revision: 'fixture-1',
    subject: { id: 'fixture-person', loading: 'ready', profile: 'new' },
    permission: { status: 'allowed', revision: 'permission-1' },
    safety: 'clear', goal: 'none', explicitIntent: false,
    activeTask: { kind: 'none' }, returning: { kind: 'none' },
  };
}
export function fixtureB2() {
  return {
    ...fixtureA1(), goal: 'confirmed',
    subject: { id: 'fixture-person', loading: 'ready', profile: 'existing' },
    activeTask: {
      kind: 'workout', id: 'fixture-session',
      exercise: { id: 'fixture-exercise', label: 'Squat' },
      completedSetIds: ['fixture-set-1', 'fixture-set-2'],
      evidence: evidence(),
    },
  };
}
export function fixtureB4() {
  return {
    ...fixtureA1(), goal: 'confirmed',
    subject: { id: 'fixture-person', loading: 'ready', profile: 'existing' },
    returning: {
      kind: 'after_absence', plan: { id: 'fixture-plan', title: 'Kế hoạch đã lưu' },
      evidence: evidence(),
    },
  };
}
