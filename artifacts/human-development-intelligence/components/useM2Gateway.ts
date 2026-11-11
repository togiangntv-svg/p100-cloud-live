import {getWearableOwnerSession} from '@/domain/wearable/contract';
import {createCoachPresenceFlow,coachTaskDomains,type CoachSource} from './coach-presence-flow';
import { createLocalVerificationAdapter, isLocalVerificationAdapter } from '@/domain/m3/local-verification-adapter';
import { readLocalVerificationBinding } from '@/lib/identity/local-verification';
import { readAuthoritativeKnownNone, retireAuthoritativeM2Baseline, getUnifiedOwnerFacts, subscribeUnifiedOwnerFacts, projectUnifiedOwnerM2 } from '@/domain/m2/factual-snapshot';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  availableM2Actions, createM2ActionRunner, isM2NoteCurrent, resolveM2View,
  type M2Gateway, type M2Note, type M2Snapshot,
} from '@/domain/m2';
import { getM2Copy, type M2TranslationKey } from '@/i18n-m2';
import type { LanguageInput } from '@/domain/m3/contract';
import type { OwnerAccess, OwnerSnapshot, SessionLease } from '@/domain/local-owner/boundary';
import type { IdentityRequestAuthorization } from '@/domain/identity/client-session';
import {
  createM2Input, editM2Input, isM2PressCurrent, pressM2Input, presentM2Input, releaseM2Input, syncM2Input,
  type M2Press,
} from './m2InputState';
import { type SessionTask, type SessionTaskStore, type TaskRef } from '@/domain/session-task/store';
import { createM3GatewayAdapter } from '@/domain/m3/gateway-adapter';
import { resolveM3HostPermission } from '@/domain/m3/host-permission';
import { resolveM3RuntimeMode, selectM3RuntimeAdapter } from '@/domain/m3/runtime-mode';
import {
  presentM4StubDecision, projectM4StubContext,
  type M4StubFixture,
} from '@/domain/m4/ui-stub';
import {
  M5_MEAL_IMAGE_CAPABILITY_UNAVAILABLE,
  presentMealImageM5Decision,
} from '@/domain/m5/meal-image-decision';
import { presentGoalM5Choice } from '@/domain/m5/goal-choice';
import {
  createCameraC0Controller, createCameraCandidateStore,
  type CameraRequestCurrent, type CameraTaskScope,
} from '@/domain/camera/candidate';
import { createCameraM4ContextStore, mayOfferCameraForM4 } from '@/domain/camera/m4-context';
import { cameraC2Copy, taskCopy } from '@/i18n-task';
import { expoCameraC0Picker } from './cameraC0Picker';
import { createCameraLocalPreviewHandle } from './CameraLocalPreview.tsx';
import { createCameraC2RuntimeController, type CameraC2Live } from '@/lib/camera/c2-runtime';
import { createExpoCacheCleanup } from '@/lib/camera/expo-cache-cleanup';
import { createM3HostLifetime, type M3HostMode } from './m3-host-lifetime';
import type { M7RecordActivation } from './m7-record-activation';
import {
  isSameM3Submission, presentM3LifecycleNotice, presentM3SemanticState,
  type M3LifecycleNoticeKey,
} from './m3Presentation';
import type { TrainerJourneyPresentation } from '@/context/TrainerRuntimeContext';
import {
  createW01ProductController, createW01ProductionBinding, type W01ProductBinding,
} from './w01-product-controller';

const M3_RUNTIME_MODE = resolveM3RuntimeMode(process.env.EXPO_PUBLIC_M3_RUNTIME_MODE);
const subscribeWithoutOwner = () => () => {};
const readWithoutOwner = (): OwnerSnapshot | null => null;
const W01_PRODUCT_OPERATIONS = ['accept', 'start', 'cancel', 'stop'] as const;

function supportsW01ProductionOperation(
  selfWalk: SessionTaskStore['selfWalk'],
  operation: 'accept' | 'start' | 'cancel' | 'stop',
) {
  return typeof selfWalk[operation] === 'function';
}
function supportsW01ProductionBinding(selfWalk: SessionTaskStore['selfWalk']) {
  return typeof selfWalk.reportContext === 'function' && typeof selfWalk.propose === 'function'
    && W01_PRODUCT_OPERATIONS.every((operation) => supportsW01ProductionOperation(selfWalk, operation));
}

function presentM3TaskNotice(
  task: SessionTask,
  store: SessionTaskStore,
  m4StubFixture: M4StubFixture | undefined,
  locale: LanguageInput['locale'],
): string {
  const interpretation = task.interpretation;
  if (!interpretation) return '';
  let nextNotice = presentM3SemanticState(task, locale);
  const ref = store.reference(task.task_id);
  if (ref && m4StubFixture) {
    const context = projectM4StubContext({
      session_id: ref.session_id,
      task_id: ref.task_id,
      revision: ref.revision,
    }, m4StubFixture);
    const m4Result = store.assessM4(ref, context);
    const m5Notice = presentMealImageM5Decision(
      store.assessM5(ref, m4Result, M5_MEAL_IMAGE_CAPABILITY_UNAVAILABLE),
      locale,
      'EXPLAINED',
    );
    const m4Notice = presentM4StubDecision(m4Result.decision, locale);
    // M5 owns the next decision copy when it has one; M4 remains the fallback
    // for permission, clarification and other context-only outcomes.
    if (m5Notice || m4Notice) nextNotice = m5Notice || m4Notice!;
  }
  return nextNotice.slice(0, 320);
}

export function useM2Gateway(
  gateway: M2Gateway | undefined,
  locale: LanguageInput['locale'],
  t: (key: M2TranslationKey) => string,
  ownerSession?: Readonly<{
    access: OwnerAccess;
    lease: SessionLease;
    authorization?: IdentityRequestAuthorization;
  }>,
  trainerJourney?: TrainerJourneyPresentation,
  hostMode: M3HostMode = 'BLOCKED',
  m7RecordActivation?: M7RecordActivation,
) {
  const canonicalFacts=useSyncExternalStore(fn=>subscribeUnifiedOwnerFacts(ownerSession?.access,fn),()=>getUnifiedOwnerFacts(ownerSession?.access,ownerSession?.lease),()=>getUnifiedOwnerFacts());
  const [, setW01Revision] = useState(0);
  const w01Live = useRef<W01ProductBinding | undefined>(undefined);
  const w01Retained = useRef<W01ProductBinding | undefined>(undefined);
  const [w01Controller] = useState(() => createW01ProductController({
    onChange: () => setW01Revision((value) => value + 1),
  }));
  const copy = getM2Copy(t);
  const subjectId = gateway?.snapshot.subject.id ?? '';
  const invalidated = gateway?.snapshot.subject.loading === 'deleted'
    || (gateway !== undefined && gateway.snapshot.permission.status !== 'allowed');
  const [input, setInput] = useState(() => createM2Input(subjectId, invalidated));
  const gesture = useRef<M2Press | null>(null);
  const currentInput = syncM2Input(input, subjectId, invalidated);
  // Guarded state adjustment retires the previous owner's data before rendering.
  if (currentInput !== input) {
    if (gesture.current) gesture.current.cancelled = true;
    setInput(currentInput);
  }
  const [notice, setNotice] = useState({ token: '', text: '' });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef<object | null>(null);
  const runner = useRef(createM2ActionRunner());
  const latest = useRef({
    gateway, t, m3AuthorityKey: '', m3AuthorityCurrent: false,
    m3ChoiceAuthorityKey: '', m3ChoiceAuthorityCurrent: false,
    m3TaskPermissionGranted: false,
    ownerAccess: ownerSession?.access, ownerLease: ownerSession?.lease,
    slotIdentity: undefined as object | undefined,
  });
  const cameraStore = useRef(createCameraCandidateStore()).current;
  const cameraController = useRef(createCameraC0Controller(cameraStore, expoCameraC0Picker)).current;
  const cameraC1Store = useRef(createCameraM4ContextStore()).current;
  const [, refreshCameraC1] = useState(0);
  const [, refreshCameraC2] = useState(0);
  const [, refreshCameraCleanup] = useState(0);
  const cameraPreparation = useRef<Readonly<{
    binding: CameraTaskScope;
    c2Token: unknown;
    promise: Promise<boolean>;
  }> | undefined>(undefined);
  const cameraCleanupEpoch = useRef(0);
  const cameraCleanupWarning = useRef<Readonly<{
    epoch: number;
    binding: CameraTaskScope;
    status: 'PENDING' | 'FAILED' | 'UNCONFIRMED';
  }> | undefined>(undefined);
  const cameraC2Mounted = useRef(true);
  const c2Live = useRef<(() => CameraC2Live | undefined) | null>(null);
  const [cameraC2] = useState(() => createCameraC2RuntimeController({
    getLive: () => c2Live.current?.(),
    cleanup: createExpoCacheCleanup(),
    onChange: () => {
      Promise.resolve().then(() => {
        if (cameraC2Mounted.current) refreshCameraC2((value) => value + 1);
      });
    },
  }));
  const [m3Lifetime] = useState(() => createM3HostLifetime(() => {
    cameraC2.retire();
    cameraStore.retire();
    cameraC1Store.retire();
  }));
  const m3Projection = useSyncExternalStore(
    m3Lifetime.subscribe, m3Lifetime.getSnapshot, m3Lifetime.getSnapshot,
  );
  const m3Slot = m3Projection.slot;
  const m3Store = m3Slot?.store;
  const wearableSession=getWearableOwnerSession(ownerSession);
  useEffect(()=>wearableSession?.bindTaskStore(m3Store),[wearableSession,m3Store]);
  const m3Adapter = m3Slot?.adapter;
  const m3Permission = resolveM3HostPermission(m3Adapter, gateway?.m3Access);
  const localBinding = M3_RUNTIME_MODE === 'local-verification' ? readLocalVerificationBinding(ownerSession) : undefined;
  const localAccess = useRef(gateway?.m3Access); localAccess.current = gateway?.m3Access;
  const adapterKey = M3_RUNTIME_MODE === 'local-verification' ? localBinding?.identity
    : M3_RUNTIME_MODE === 'live' ? 'PRODUCTION'
    : M3_RUNTIME_MODE === 'fixture' ? gateway?.m3StubAdapter : undefined;
  useLayoutEffect(() => {
    m3Lifetime.activate(hostMode, ownerSession, adapterKey, (isSessionCurrent) => (
      (M3_RUNTIME_MODE === 'local-verification'
        ? ownerSession && localBinding ? createLocalVerificationAdapter(ownerSession,
          () => localAccess.current?.status === 'allowed') : undefined
        : selectM3RuntimeAdapter(M3_RUNTIME_MODE, 'live', () => ownerSession?.authorization
        ? createM3GatewayAdapter({
          authorization: ownerSession.authorization,
          isSessionCurrent,
          provenance: 'PRODUCTION',
        })
        : undefined) ?? (M3_RUNTIME_MODE === 'fixture' ? gateway?.m3StubAdapter : undefined))
    ), m7RecordActivation);
    return () => m3Lifetime.deactivate();
  }, [m3Lifetime, hostMode, ownerSession?.access, ownerSession?.lease,
    ownerSession?.authorization, adapterKey, m7RecordActivation]);
  useEffect(() => {
    cameraC2Mounted.current = true;
    return () => { cameraC2Mounted.current = false; };
  }, []);
  const cameraSnapshot = useSyncExternalStore(
    cameraStore.subscribe, cameraStore.getSnapshot, cameraStore.getSnapshot,
  );
  const ownerSnapshot = useSyncExternalStore(
    ownerSession?.access.subscribe ?? subscribeWithoutOwner,
    ownerSession?.access.getSnapshot ?? readWithoutOwner,
    ownerSession?.access.getSnapshot ?? readWithoutOwner,
  );
  let ownerAuthorityCurrent = ownerSession === undefined;
  let ownerAuthorityKey = 'unbound';
  if (ownerSession) {
    try {
      const scope = ownerSession.access.requireLease(ownerSession.lease);
      ownerAuthorityCurrent = ownerSnapshot?.phase === 'READY'
        && ownerSnapshot.generation === scope.generation
        && ownerSnapshot.owner.subjectId === scope.owner.subjectId
        && ownerSnapshot.owner.profileId === scope.owner.profileId
        && (!subjectId || subjectId === scope.owner.subjectId);
      ownerAuthorityKey = [
        ownerAuthorityCurrent ? 'ready' : 'invalid',
        scope.owner.subjectId,
        scope.owner.profileId,
        scope.generation,
        scope.validUntil,
      ].join(':');
    } catch {
      ownerAuthorityKey = `invalid:${ownerSnapshot?.generation ?? -1}`;
    }
  }
  const subjectAuthorityReady = gateway?.snapshot.subject.loading === undefined
    || gateway.snapshot.subject.loading === 'ready';
  const m3AuthorityKey = [
    subjectId,
    gateway?.snapshot.subject.loading ?? 'unmanaged',
    gateway?.snapshot.permission.status ?? 'unmanaged',
    gateway?.snapshot.permission.revision ?? 'unmanaged',
    ownerAuthorityKey,
  ].join('\u0000');
  const m3AuthorityRef = useRef<string | null>(null);
  const m3OwnerAccessRef = useRef<OwnerAccess | undefined>(undefined);
  const m3OwnerLeaseRef = useRef<SessionLease | undefined>(undefined);
  const m3ChoiceAuthorityKey = m3Permission.mode === 'live'
    ? `${gateway?.m3Access?.status ?? 'unknown'}:${gateway?.m3Access?.revision ?? 0}`
    : `${m3Permission.mode}:${m3Permission.taskPermissionGranted ? 'granted' : 'denied'}`;
  const m3ChoiceAuthorityRef = useRef<string | null>(null);
  const m3Snapshot = m3Projection.task;
  const m3AuthorityCurrent = Boolean(m3Slot && m3Lifetime.currentSlot() === m3Slot
    && ownerAuthorityCurrent && subjectAuthorityReady && !invalidated
    && m3AuthorityRef.current === m3AuthorityKey
    && m3OwnerAccessRef.current === ownerSession?.access
    && m3OwnerLeaseRef.current === ownerSession?.lease);
  const m3ChoiceAuthorityCurrent = m3ChoiceAuthorityRef.current === m3ChoiceAuthorityKey;
  latest.current = {
    gateway, t, m3AuthorityKey, m3AuthorityCurrent,
    m3ChoiceAuthorityKey, m3ChoiceAuthorityCurrent,
    m3TaskPermissionGranted: m3Permission.taskPermissionGranted,
    ownerAccess: ownerSession?.access, ownerLease: ownerSession?.lease,
    slotIdentity: m3Slot?.identity,
  };
  const [m3NoticeKey, setM3NoticeKey] = useState<M3LifecycleNoticeKey | null>(null);
  const trainerView = trainerJourney?.view.state === 'CURRENT'
    && trainerJourney.view.simulation ? trainerJourney.view : undefined;
  useLayoutEffect(() => {
    m3AuthorityRef.current = m3AuthorityKey;
    m3OwnerAccessRef.current = ownerSession?.access;
    m3OwnerLeaseRef.current = ownerSession?.lease;
    return () => {
      m3AuthorityRef.current = null;
      m3OwnerAccessRef.current = undefined;
      m3OwnerLeaseRef.current = undefined;
      cameraC2.retire();
      cameraStore.retire();
      cameraC1Store.retire();
    };
  }, [
    cameraStore, cameraC1Store, cameraC2, invalidated, m3AuthorityKey, ownerAuthorityCurrent, ownerSession?.access,
    ownerSession?.lease, subjectAuthorityReady,
  ]);
  useEffect(() => {
    const changed = m3ChoiceAuthorityRef.current !== null
      && m3ChoiceAuthorityRef.current !== m3ChoiceAuthorityKey;
    m3ChoiceAuthorityRef.current = m3ChoiceAuthorityKey;
    if (changed) {
      const ref = m3Store?.reference();
      if (ref) m3Store?.retireM5GoalChoice(ref);
    }
  }, [m3ChoiceAuthorityKey, m3Store]);
  const changeText = (value: string) => {
    if (!inputScopeCurrent()) return;
    setInput(editM2Input(releaseM2Input(currentInput), value, view, locale));
    setNotice({ token: '', text: '' });
    setM3NoticeKey(null);
  };
  const submit = (visibleText?: string) => {
    // The default Welcome host owns its text in GoalDraft rather than the
    // optional adaptive M2 input. Submit the value actually rendered by M2.
    const value = (visibleText ?? currentInput.text).trim();
    if (!value || busyRef.current || !inputScopeCurrent()) return;
    if (trainerView && trainerJourney) {
      setM3NoticeKey(null);
      trainerJourney.commands.submitGoal(trainerView.token, {
        text: value,
        locale,
        permission_granted: m3Permission.taskPermissionGranted,
        permission_revision: m3Permission.permissionRevision,
      });
      return;
    }
    if (!m3Store || !m3AuthorityCurrent || m3Lifetime.currentSlot() !== m3Slot) return;
    const existing = m3Store.getSnapshot().active_task_id
      ? m3Store.getSnapshot().tasks.find((task) => task.task_id === m3Store.getSnapshot().active_task_id)
      : undefined;
    if (isSameM3Submission(existing, value, locale)) {
      setM3NoticeKey(null);
      return;
    }
    setM3NoticeKey(null);
    const latestView = readLatest().view;
    const currentQuestion = view && latestView?.token === view.token
      ? view.question.trim()
      : (!gateway ? t('m2Question') : '');
    cameraC2.retire();
    cameraStore.retire();
    cameraC1Store.retire();
    m3Store.submit(value, {
      locale,
      permission_granted: m3Permission.taskPermissionGranted,
      permission_revision: m3Permission.permissionRevision,
      recent_relevant_turns: currentQuestion
        ? [{ role: 'assistant', text: currentQuestion }]
        : [],
    });
    if (!m3Adapter) {
      setM3NoticeKey('m2Acknowledged');
      return;
    }
    if (m3Permission.showExternalPermissionNotice) {
      setM3NoticeKey('m2PermissionNeeded');
    }
  };
  const activeTask = m3AuthorityCurrent && m3Snapshot.active_task_id
    ? m3Snapshot.tasks.find((task) => task.task_id === m3Snapshot.active_task_id)
    : undefined;
  const effectiveLocale = locale;
  const activeTaskRef = activeTask ? m3Store?.reference(activeTask.task_id) : undefined;
  const cameraSafetyCurrent = m3Projection.safety.state === 'OPEN'
    && m3Projection.availability === 'AVAILABLE';
  const cameraEligible = Boolean(m3AuthorityCurrent && m3Permission.taskPermissionGranted
    && cameraSafetyCurrent
    && activeTaskRef && activeTask?.interpretation?.intent_type === 'CURRENT_TASK'
    && activeTask.interpretation.task_kind === 'meal_image_assessment'
    && ['READY', 'AWAITING_INPUT'].includes(activeTask.status));
  const cameraScope: CameraTaskScope | undefined = cameraEligible && activeTaskRef
    ? Object.freeze({
      session_id: activeTaskRef.session_id,
      task_id: activeTaskRef.task_id,
      revision: activeTaskRef.revision,
    }) : undefined;
  const cameraBindingKey = cameraScope
    ? [m3Slot?.id, cameraScope.session_id, cameraScope.task_id, cameraScope.revision,
      m3Projection.safety.revision, m3Projection.availability,
      m3AuthorityKey, m3ChoiceAuthorityKey].join('\u0000')
    : ['none', m3Slot?.id, m3Projection.safety.revision, m3Projection.availability].join('\u0000');
  useLayoutEffect(() => {
    cameraC2.retire();
    cameraStore.retire();
    cameraC1Store.retire();
    if (cameraScope) {
      cameraStore.bind(cameraScope);
      cameraC1Store.bind(cameraScope);
    }
  }, [cameraBindingKey, cameraStore, cameraC1Store, cameraC2]);
  const cameraBound = Boolean(cameraScope && cameraSnapshot.scope
    && cameraSnapshot.scope.session_id === cameraScope.session_id
    && cameraSnapshot.scope.task_id === cameraScope.task_id
    && cameraSnapshot.scope.revision === cameraScope.revision);
  const issuedCameraBinding = cameraSnapshot.scope;
  const issuedCameraSafetyRevision = m3Projection.safety.revision;
  const currentCamera = () => {
    const authority = latest.current;
    if (!cameraScope || !m3Store || m3Lifetime.currentSlot() !== m3Slot
      || !authority.m3AuthorityCurrent || !authority.m3ChoiceAuthorityCurrent
      || !authority.m3TaskPermissionGranted || authority.m3AuthorityKey !== m3AuthorityKey
      || authority.m3ChoiceAuthorityKey !== m3ChoiceAuthorityKey) return undefined;
    const currentSafety = m3Store.getTrainerSafetySnapshot();
    if (currentSafety.state !== 'OPEN' || currentSafety.revision !== issuedCameraSafetyRevision
      || m3Store.getTrainerActionAvailability() !== 'AVAILABLE') return undefined;
    if (ownerSession) {
      try {
        const owner = ownerSession.access.requireLease(ownerSession.lease);
        const current = ownerSession.access.getSnapshot();
        if (current?.phase !== 'READY' || current.generation !== owner.generation
          || current.owner.subjectId !== owner.owner.subjectId
          || current.owner.profileId !== owner.owner.profileId
          || (subjectId && subjectId !== owner.owner.subjectId)) return undefined;
      } catch { return undefined; }
    }
    const snapshot = m3Store.getSnapshot();
    const task = snapshot.tasks.find((item) => item.task_id === snapshot.active_task_id);
    const ref = task ? m3Store.reference(task.task_id) : undefined;
    const candidate = cameraStore.getSnapshot();
    if (!task || !ref || !task.permission_granted || task.status === 'CANCELLED'
      || task.interpretation?.intent_type !== 'CURRENT_TASK'
      || task.interpretation.task_kind !== 'meal_image_assessment'
      || !['READY', 'AWAITING_INPUT'].includes(task.status)
      || ref.session_id !== cameraScope.session_id || ref.task_id !== cameraScope.task_id
      || ref.revision !== cameraScope.revision
      || !issuedCameraBinding || candidate.scope !== issuedCameraBinding
      || candidate.scope?.session_id !== cameraScope.session_id
      || candidate.scope.task_id !== cameraScope.task_id
      || candidate.scope.revision !== cameraScope.revision) return undefined;
    return { scope: issuedCameraBinding, task, ref, candidate };
  };
  const currentCameraAcquisition = (binding?: CameraTaskScope) => {
    const current = currentCamera();
    if (!current || (binding && current.scope !== binding) || current.candidate.receipt) return undefined;
    const projection = cameraC1Store.project(current.scope);
    const assessment = cameraC1Store.assess(current.task, projection);
    if (projection.image.state !== 'absent'
      || !mayOfferCameraForM4(current.scope, assessment)) return undefined;
    return current;
  };
  const runLocalPicker = async (
    current: NonNullable<ReturnType<typeof currentCameraAcquisition>>,
    pick: (scope: CameraTaskScope, validate: CameraRequestCurrent) => Promise<boolean>,
  ) => {
    return pick(current.scope, () => Boolean(currentCameraAcquisition(current.scope)));
  };
  const cameraAcquisition = currentCameraAcquisition();
  const cameraProjection = cameraBound && cameraScope && cameraSnapshot.receipt
    ? cameraC1Store.project(cameraScope) : undefined;
  const cameraM4 = activeTask && cameraProjection
    ? cameraC1Store.assess(activeTask, cameraProjection) : undefined;
  c2Live.current = () => {
    const current = currentCamera();
    if (!ownerSession || !m3Slot || !current?.candidate.receipt) return undefined;
    const c1 = cameraC1Store.getSnapshot();
    if (!c1 || c1.candidate_id !== current.candidate.receipt.candidate_id) return undefined;
    const projection = cameraC1Store.project(current.scope);
    const assessment = cameraC1Store.assess(current.task, projection);
    if (assessment.decision.state !== 'CONTEXT_SUFFICIENT') return undefined;
    return {
      actionSource: m3Slot.actionSource,
      safety_revision: issuedCameraSafetyRevision,
      owner: { access: ownerSession.access, lease: ownerSession.lease, subject_id: subjectId },
      accepted: current.candidate.receipt,
      c1,
      projection,
      m4_sufficient: true,
    };
  };
  const cameraM5 = cameraM4?.decision.state === 'CONTEXT_SUFFICIENT'
    && m3Store && activeTaskRef && cameraProjection
    ? m3Store.assessM5(activeTaskRef, m3Store.assessM4(activeTaskRef, cameraProjection),
      M5_MEAL_IMAGE_CAPABILITY_UNAVAILABLE)
    : undefined;
  const cameraCopy = taskCopy(locale);
  const cameraC1 = cameraProjection && cameraSnapshot.receipt
    && (cameraProjection.image.state === 'present' || cameraProjection.image.state === 'declined')
    ? Object.freeze({
      state: cameraProjection.image.state === 'declined'
        || cameraProjection.permission.status === 'denied' ? 'LOCAL_DECLINED' as const
        : cameraProjection.permission.status === 'allowed' ? 'LOCAL_ALLOWED' as const
          : 'NEEDS_LOCAL_PERMISSION' as const,
      prompt: cameraCopy.cameraC1Ask,
      allow: cameraCopy.cameraC1Allow,
      decline: cameraCopy.cameraC1Decline,
      allowed: cameraCopy.cameraC1Allowed,
      stopped: cameraCopy.cameraC1Stopped,
      revoke: cameraCopy.cameraC1Revoke,
      external_boundary: cameraCopy.cameraC1ExternalBoundary,
    }) : undefined;
  const cameraC0Visible = Boolean(cameraBound && cameraScope && (
    cameraAcquisition || cameraSnapshot.candidate || cameraSnapshot.receipt
    || cameraSnapshot.issue || cameraStore.isBusy()
  ));
  const cameraC0 = cameraC0Visible ? Object.freeze({
    phase: cameraSnapshot.phase,
    issue: cameraSnapshot.issue,
    candidate: cameraSnapshot.candidate ? Object.freeze({
      source: cameraSnapshot.candidate.source,
      previewHandle: createCameraLocalPreviewHandle(
        cameraStore, cameraSnapshot.candidate.candidate_id,
      ),
    }) : undefined,
    accepted: Boolean(cameraSnapshot.receipt),
    acquisitionAllowed: Boolean(cameraAcquisition) && !cameraStore.isBusy(),
    replacementAllowed: Boolean(cameraSnapshot.candidate && !cameraSnapshot.receipt
      && cameraAcquisition) && !cameraStore.isBusy(),
    busy: cameraStore.isBusy(),
    entry: cameraCopy.cameraEntry,
    take_photo: cameraCopy.cameraTake,
    choose_photo: cameraCopy.cameraChoose,
    preview: cameraCopy.cameraPreview,
    retake: cameraCopy.cameraRetake,
    choose_again: cameraCopy.cameraChooseAgain,
    cancel: cameraCopy.cameraCancel,
    use_photo: cameraCopy.cameraUse,
    selected: cameraCopy.cameraSelected,
    message: cameraSnapshot.issue === 'PERMISSION_DENIED'
      ? cameraCopy.cameraPermissionDenied
      : cameraSnapshot.issue === 'UNAVAILABLE'
        ? cameraCopy.cameraUnavailable
        : cameraSnapshot.receipt
          ? cameraCopy.cameraSelectedNotice
          : cameraSnapshot.candidate ? cameraCopy.cameraPreview : '',
  }) : undefined;
  const goalM4 = m3Store && activeTaskRef ? m3Store.assessM4GoalReadiness(activeTaskRef) : undefined;
  const goalM5 = m3Store && activeTaskRef && goalM4 ? m3Store.assessM5Goal(activeTaskRef, goalM4) : undefined;
  const goalReceipt = m3Store && activeTaskRef
    ? m3Store.getM5GoalChoiceReceipt(activeTaskRef)
    : undefined;
  const m5GoalChoice = m3ChoiceAuthorityCurrent
    && m3Permission.taskPermissionGranted && goalM5?.state === 'PROPOSAL'
    ? Object.freeze({
      ...presentGoalM5Choice(locale),
      accepted: Boolean(goalReceipt),
    })
    : undefined;
  const trainerM5GoalChoice = trainerView?.goal
    ? Object.freeze({
      ...presentGoalM5Choice(locale),
      accepted: trainerView.goal.state === 'ACCEPTED',
    }) : undefined;
  const lifecycleNoticeOwnsPresentation = m3NoticeKey
    && (m3NoticeKey !== 'm2PermissionGranted' || !activeTask?.interpretation);
  const m3Notice = trainerView?.task?.notice || (lifecycleNoticeOwnsPresentation
    ? presentM3LifecycleNotice(m3NoticeKey, locale)
    : activeTask?.interpretation && m3Store
      ? cameraM4
        ? cameraM4.decision.state === 'CONTEXT_SUFFICIENT'
          && cameraM5?.state === 'UNSUPPORTED'
          ? cameraCopy.cameraC1ReadyNoAnalysis
          : presentM4StubDecision(cameraM4.decision, locale)
            ?? presentM3TaskNotice(activeTask, m3Store, gateway?.m4StubFixture, locale)
        : presentM3TaskNotice(activeTask, m3Store, gateway?.m4StubFixture, locale)
      : '');
  const setM3Access = async (allowed: boolean) => {
    if (!allowed) { cameraC2.retire(); cameraStore.retire(); cameraC1Store.retire(); }
    if ((m3Permission.mode === 'live' || isLocalVerificationAdapter(m3Adapter)) && m3Store) {
      const ref = m3Store.reference();
      if (ref) {
        if (allowed) m3Store.setM3Permission(ref, true);
        else await m3Store.revoke(ref);
      }
    }
    gateway?.setM3Access?.(allowed);
    if (m3Permission.mode === 'live') {
      setM3NoticeKey(allowed ? 'm2PermissionGranted' : 'm2PermissionRevoked');
    }
  };
  const issuedAuthorityKey = m3AuthorityKey;
  const issuedSlotIdentity = m3Slot?.identity;
  const issuedOwnerAccess = ownerSession?.access;
  const issuedOwnerLease = ownerSession?.lease;
  const issuedActiveTaskRef = activeTaskRef;
  const presentedM3Tasks = m3Store && m3AuthorityCurrent
    ? m3Snapshot.tasks.filter((task) => task.status !== 'CANCELLED') : [];
  const issuedSwitchTargets = new Map<string, TaskRef>();
  if (!trainerView) {
    for (const task of presentedM3Tasks) {
      const ref = m3Store?.reference(task.task_id);
      if (ref) issuedSwitchTargets.set(task.task_id, ref);
    }
  }
  const issuedHostCurrent = () => {
    const authority = latest.current;
    if (!m3Store || !issuedSlotIdentity || m3Lifetime.currentSlot()?.identity !== issuedSlotIdentity
      || !authority.m3AuthorityCurrent || authority.slotIdentity !== issuedSlotIdentity
      || authority.m3AuthorityKey !== issuedAuthorityKey
      || authority.ownerAccess !== issuedOwnerAccess
      || authority.ownerLease !== issuedOwnerLease) return false;
    if (!issuedOwnerAccess || !issuedOwnerLease) {
      return issuedOwnerAccess === undefined && issuedOwnerLease === undefined;
    }
    try {
      const scope = issuedOwnerAccess.requireLease(issuedOwnerLease);
      const snapshot = issuedOwnerAccess.getSnapshot();
      return snapshot?.phase === 'READY' && snapshot.generation === scope.generation
        && snapshot.owner.subjectId === scope.owner.subjectId
        && snapshot.owner.profileId === scope.owner.profileId
        && (!subjectId || subjectId === scope.owner.subjectId);
    } catch { return false; }
  };
  const sameTaskRef = (a?: TaskRef, b?: TaskRef) => Boolean(a && b
    && a.session_id === b.session_id && a.task_id === b.task_id
    && a.revision === b.revision && a.view_revision === b.view_revision);
  const choiceCurrent = () => issuedHostCurrent() && latest.current.m3ChoiceAuthorityCurrent
    && latest.current.m3TaskPermissionGranted
    && latest.current.m3ChoiceAuthorityKey === m3ChoiceAuthorityKey;
  const w01Current = () => choiceCurrent() && activeTaskRef
    && m3Store?.getSnapshot().active_task_id === activeTaskRef.task_id
    && sameTaskRef(m3Store?.reference(activeTaskRef.task_id), activeTaskRef);
  if (goalReceipt?.goal_kind === 'general_health' && hostMode === 'OWNED'
    && activeTaskRef && m3Store && supportsW01ProductionBinding(m3Store.selfWalk)) {
    const ref = activeTaskRef;
    const store = m3Store;
    const binding = createW01ProductionBinding({
      identity: {
        ownerAccess: ownerSession?.access,
        ownerLease: ownerSession?.lease,
        store,
        ref,
      },
      current: () => Boolean(w01Current()),
      selfWalk: store.selfWalk,
    });
    w01Live.current = binding;
    w01Retained.current = binding;
  } else {
    const retained = w01Retained.current;
    const retainedSnapshot = retained?.port.snapshot();
    w01Live.current = retainedSnapshot && 'start' in retainedSnapshot
      && ['STARTED', 'INVALIDATED'].includes(retainedSnapshot.state) ? retained : undefined;
  }
  w01Controller.bind(w01Live.current);
  const w01 = w01Live.current ? Object.freeze({ presentation: w01Controller.presentation() }) : undefined;
  // Identity-only epoch: never put receipts, typed text or capability graphs in tokens.
  const projectionLifetime = useRef({ slot: issuedSlotIdentity, access: issuedOwnerAccess,
    lease: issuedOwnerLease, authority: issuedAuthorityKey, epoch: 0 });
  const priorLifetime = projectionLifetime.current;
  if (priorLifetime.slot !== issuedSlotIdentity || priorLifetime.access !== issuedOwnerAccess
    || priorLifetime.lease !== issuedOwnerLease || priorLifetime.authority !== issuedAuthorityKey) {
    projectionLifetime.current = { slot: issuedSlotIdentity, access: issuedOwnerAccess,
      lease: issuedOwnerLease, authority: issuedAuthorityKey, epoch: priorLifetime.epoch + 1 };
    // Retire only this private scope's UI ownership, not the external operation.
    // Its captured runner may settle later without touching the successor.
    busyRef.current = null;
    runner.current = createM2ActionRunner();
    if (busy) setBusy(false);
  }
  const inputLifetime = projectionLifetime.current;
  const inputScopeCurrent = () => projectionLifetime.current === inputLifetime
    && latest.current.gateway?.snapshot.subject.loading !== 'deleted'
    && (!m3Store || (issuedHostCurrent()
      && (issuedActiveTaskRef ? m3Store.getSnapshot().active_task_id === issuedActiveTaskRef.task_id
        && sameTaskRef(m3Store.reference(issuedActiveTaskRef.task_id), issuedActiveTaskRef)
        : m3Store.getSnapshot().active_task_id === null)));
  const projectCurrent = (): M2Snapshot | undefined => {
    const base = latest.current.gateway?.snapshot;
    if (!base) return undefined;
    if(hostMode==='OWNED'){const canonical=projectUnifiedOwnerM2(base,ownerSession?.access,ownerSession?.lease);if(canonical)return canonical.snapshot;}
    // S8 consumer: root remains unknown until an admitted history reader exists.
    // Independent workout/returning facts still keep their existing resolver guards.
    if (hostMode !== 'OWNED') {
      retireAuthoritativeM2Baseline(base);
      return { ...base, goal: 'unknown',
        activeTask: base.activeTask.kind === 'reported_action' ? { kind: 'unknown' } : base.activeTask };
    }
    const unknown = (): M2Snapshot => { retireAuthoritativeM2Baseline(base);
      return { ...base, goal: 'unknown', activeTask: { kind: 'unknown' } }; };
    if (!issuedOwnerAccess || !issuedOwnerLease || !choiceCurrent()
      || m3Slot?.mode !== 'OWNED' || !m3Store) return unknown();
    const before = m3Store.getSnapshot();
    const selected = before.tasks.find((task) => task.task_id === before.active_task_id);
    const ref = selected ? m3Store.reference(selected.task_id) : undefined;
    const receipt = ref ? m3Store.getM5GoalChoiceReceipt(ref) : undefined;
    const episode = ref && typeof m3Store.selfWalk.getCurrentEpisode === 'function'
      ? m3Store.selfWalk.getCurrentEpisode(ref) : undefined;
    if (!choiceCurrent() || m3Store.getSnapshot() !== before
      || (ref && !sameTaskRef(m3Store.reference(selected!.task_id), ref))) return unknown();
    const result: M2Snapshot = { ...base,
      revision: `${base.revision}|u1:${inputLifetime.epoch}:${m3Slot.id}:${before.revision}`,
      // No known-NONE issuer exists in this owned task host. Absence is not NEW.
      goal: receipt ? 'confirmed' : 'unknown' };
    const knownNone = readAuthoritativeKnownNone(base, issuedOwnerAccess, issuedOwnerLease,
      inputLifetime, { session_id: before.session_id, revision: before.revision,
        tasksEmpty: before.tasks.length === 0 && before.active_task_id === null
          && !selected && !receipt && !episode }, Date.now());
    if (!choiceCurrent() || m3Store.getSnapshot() !== before) return unknown();
    if (knownNone) {
      result.subject = { ...base.subject, profile: 'new' };
      result.goal = 'none'; result.activeTask = { kind: 'none' }; result.returning = { kind: 'none' };
      result.revision += '|known-none:' + knownNone.basisRevision;
    }
    if (episode && ref) {
      const action = episode.action;
      // Stop reduces authority; only an explicit canonical End may present End.
      const phase = action.state === 'STARTED' && !episode.end ? 'started'
        : action.state === 'STOPPED' && episode.end?.kind === 'USER_REPORTED_END' ? 'ended_by_user'
        : undefined;
      result.activeTask = phase ? { kind: 'reported_action', id: action.action_id,
        subjectId: base.subject.id, phase,
        episode: [inputLifetime.epoch, m3Slot.id, ref.session_id, ref.task_id, ref.revision,
          ref.view_revision, action.proposal_revision, action.context_revision, action.source.revision].join(':') }
        : { kind: 'unknown' };
    } else if (base.activeTask.kind === 'reported_action') result.activeTask = { kind: 'unknown' };
    else if (selected && base.activeTask.kind !== 'workout') result.activeTask = { kind: 'other' };
    return result;
  };
  // One reader for raw render and every use-time consumer, initialized after host guards.
  const readLatest = () => {
    const { gateway: live, t: translate } = latest.current;
    const executors = live?.executors ?? {};
    return { view: resolveM2View(projectCurrent(), getM2Copy(translate),
      availableM2Actions(executors), Date.now()), executors };
  };
  const proposed = readLatest().view;
  const view = presentM2Input(currentInput, proposed, locale);
  const stale = view?.token !== proposed?.token;
  const m7Record = hostMode === 'OWNED' && m3AuthorityCurrent
    && issuedHostCurrent() && m3Slot?.record
    ? Object.freeze({ presentation: m3Slot.record.presentation() }) : undefined;
  const sameCameraScope = (left?: CameraTaskScope, right?: CameraTaskScope) => Boolean(left && right
    && left.session_id === right.session_id && left.task_id === right.task_id
    && left.revision === right.revision);
  const cleanupLifetimeCurrent = (binding: CameraTaskScope) => currentCamera()?.scope === binding;
  const publishCleanupWarning = (
    binding: CameraTaskScope,
    status: 'PENDING' | 'FAILED' | 'UNCONFIRMED',
  ) => {
    const epoch = ++cameraCleanupEpoch.current;
    cameraCleanupWarning.current = Object.freeze({ epoch, binding, status });
    refreshCameraCleanup((value) => value + 1);
    return epoch;
  };
  const settleCameraCleanup = (
    binding: CameraTaskScope,
    preparation?: Promise<boolean>,
  ) => {
    const cleanup = cameraC2.cleanupStatus();
    const epoch = publishCleanupWarning(binding,
      cleanup.failed ? 'FAILED' : cleanup.pending ? 'PENDING' : 'UNCONFIRMED');
    void (async () => {
      try { await preparation; } catch { /* fail closed through cleanupStatus */ }
      const confirmed = await cameraC2.settleCleanup();
      const warning = cameraCleanupWarning.current;
      if (!warning || warning.epoch !== epoch || warning.binding !== binding
        || !cleanupLifetimeCurrent(binding)) return;
      cameraCleanupWarning.current = confirmed
        ? undefined
        : Object.freeze({ epoch, binding, status: 'FAILED' as const });
      refreshCameraCleanup((value) => value + 1);
    })();
  };
  const cleanupRelevant = (binding: CameraTaskScope, c2Token: unknown) => {
    const preparation = cameraPreparation.current;
    return cameraC2.currentReceipt() || (preparation?.binding === binding
      && (preparation.c2Token === c2Token || cameraC2.view().external_consent === 'ON'));
  };
  const retireCameraC2WithWarning = () => {
    const current = currentCamera();
    const view = cameraC2.view();
    const preparation = current && cameraPreparation.current?.binding === current.scope
      ? cameraPreparation.current.promise : undefined;
    const relevant = Boolean(current && cleanupRelevant(current.scope, view.view_token));
    cameraC2.retire();
    if (current && relevant) settleCameraCleanup(current.scope, preparation);
  };
  const captureCameraCleanup = () => {
    const bound = cameraStore.getSnapshot().scope;
    if (!cameraScope || !sameCameraScope(bound, cameraScope)) return undefined;
    const c1 = cameraC1Store.getSnapshot();
    const c1Ref = c1 && sameCameraScope(c1, bound) ? c1 : undefined;
    const c1Declined = !c1 && cameraC1Store.project(bound!).image.state === 'declined';
    // view() may verify C2, so it is read only after captured host authority passes.
    const c2View = cameraC2.view();
    return { scope: bound!, c1Ref, c1Declined, c2Token: c2View.view_token };
  };
  const retireCapturedCamera = (prior: NonNullable<ReturnType<typeof captureCameraCleanup>>) => {
    // A synchronous task observer may already have bound the same stores to a new scope.
    if (sameCameraScope(cameraStore.getSnapshot().scope, prior.scope)) {
      const liveC2 = cameraC2.view();
      if (sameCameraScope(cameraStore.getSnapshot().scope, prior.scope)
        && liveC2.view_token === prior.c2Token && liveC2.state !== 'UNAVAILABLE') cameraC2.retire();
    }
    if (sameCameraScope(cameraStore.getSnapshot().scope, prior.scope)) cameraStore.retire();
    const liveC1 = cameraC1Store.getSnapshot();
    if (prior.c1Ref && liveC1 && sameCameraScope(liveC1, prior.scope)
      && liveC1.context_id === prior.c1Ref.context_id
      && liveC1.candidate_id === prior.c1Ref.candidate_id
      && liveC1.permission_revision === prior.c1Ref.permission_revision) cameraC1Store.retire();
    else if (prior.c1Declined && !liveC1
      && cameraC1Store.project(prior.scope).image.state === 'declined') cameraC1Store.retire();
    // With no C1 context or decline, its private binding is not observable;
    // never retire it speculatively across a possible rebind.
  };
  const cleanupWarning = cameraCleanupWarning.current;
  const cameraCleanup = cleanupWarning && cleanupLifetimeCurrent(cleanupWarning.binding)
    ? Object.freeze({ status: cleanupWarning.status, copy: cameraC2Copy(locale).cleanup })
    : undefined;
  const cameraC2View = cameraC2.view();

  const coachRead = useRef<() => CoachSource | undefined>(() => undefined);
  const [coachFlow] = useState(() => createCoachPresenceFlow({
    current: () => coachRead.current(), picker: expoCameraC0Picker,
    preview: createCameraLocalPreviewHandle,
  }));
  coachRead.current = () => {
    const authority = latest.current;
    if (hostMode !== 'OWNED' || trainerView || !ownerSession?.authorization || !m3Store || !m3Slot
      || m3Lifetime.currentSlot() !== m3Slot || !authority.m3AuthorityCurrent
      || !authority.m3ChoiceAuthorityCurrent || !authority.m3TaskPermissionGranted
      || authority.ownerAccess !== ownerSession.access || authority.ownerLease !== ownerSession.lease) return undefined;
    try {
      const lease = ownerSession.access.requireLease(ownerSession.lease), owner = ownerSession.access.getSnapshot();
      if (owner.phase !== 'READY' || lease.generation !== owner.generation) return undefined;
      const current = m3Store.getSnapshot(), task = current.tasks.find(x => x.task_id === current.active_task_id);
      const safety = m3Store.getTrainerSafetySnapshot();
      const domain = task?.interpretation?.task_kind ? coachTaskDomains[task.interpretation.task_kind] : undefined;
      if (!task || !domain || task.status !== 'READY' || !task.permission_granted
        || task.interpretation?.intent_type !== 'CURRENT_TASK' || task.interpretation.safety_state !== 'CLEAR'
        || task.interpretation.suggested_next_role !== 'M4' || safety.state !== 'OPEN'
        || m3Store.getTrainerActionAvailability() !== 'AVAILABLE') return undefined;
      return {
        key: [m3Slot.id, authority.m3AuthorityKey, authority.m3ChoiceAuthorityKey, current.revision,
          task.session_id, task.task_id, task.revision, safety.revision, domain, lease.generation].join('\u0000'),
        domain, access: ownerSession.access, lease: ownerSession.lease, authorization: ownerSession.authorization,
        sessionId: task.session_id, taskId: task.task_id, revision: task.revision, taskKind: task.interpretation.task_kind!,
      };
    } catch { return undefined; }
  };
  const coachKey = coachRead.current()?.key;
  useLayoutEffect(() => {
    coachFlow.bind();
    const taskOff = m3Store?.subscribe(() => coachFlow.bind());
    const ownerOff = ownerSession?.access.subscribe(() => coachFlow.bind());
    return () => { taskOff?.(); ownerOff?.(); };
  }, [coachFlow, m3Store, ownerSession?.access, ownerSession?.lease, coachKey]);
  useEffect(() => () => coachFlow.dispose(), [coachFlow]);
  const coachSnapshot = useSyncExternalStore(coachFlow.subscribe, coachFlow.getSnapshot, coachFlow.getSnapshot);
  const coachPresence = coachKey && coachSnapshot.sourceKey === coachKey
    ? Object.freeze({ flow: coachFlow, model: coachSnapshot }) : undefined;

  return {
    ownerFactsState:canonicalFacts.state,
    coachPresence,
    hasM3Activity: Boolean(trainerView?.task || presentedM3Tasks.length),
    managed: gateway !== undefined,
    view,
    context: stale ? null : view?.context,
    text: currentInput.text,
    disabled: stale || (busy && busyRef.current !== null),
    notice: !stale && view && notice.token === view.token ? notice.text : '',
    m3Notice,
    effectiveLocale,
    m3Mode: m3Permission.mode,
    m3Access: gateway?.m3Access,
    m3Tasks: trainerView?.task ? [{ id: 'trainer-current', label: trainerView.task.label, active: true }]
      : presentedM3Tasks.map((task) => ({
      id: task.task_id,
      label: task.source_input,
      active: task.task_id === m3Snapshot.active_task_id,
    })),
    adaptiveHandoff: !trainerView && activeTask?.interpretation?.task_kind === 'meal_image_assessment'
      && ['READY', 'AWAITING_INPUT'].includes(activeTask.status),
    cameraC0,
    cameraC1,
    cameraCleanup,
    cameraC2: cameraC2View.state !== 'UNAVAILABLE'
      ? Object.freeze({ ...cameraC2View, copy: cameraC2Copy(locale) }) : undefined,
    allowExternalProcessingAndPrepare: (viewToken: unknown) => {
      const current = currentCamera();
      const before = cameraC2.view();
      const promise = cameraC2.allowExternalProcessingAndPrepare(viewToken);
      if (current && before.view_token === viewToken) {
        cameraPreparation.current = Object.freeze({
          binding: current.scope,
          c2Token: cameraC2.view().view_token,
          promise,
        });
      }
      return promise;
    },
    declineExternalProcessing: (viewToken: unknown) =>
      cameraC2.declineExternalProcessing(viewToken),
    revokeExternalProcessing: (viewToken: unknown) => {
      const current = currentCamera();
      const preparation = current && cameraPreparation.current?.binding === current.scope
        ? cameraPreparation.current.promise : undefined;
      const result = cameraC2.revokeExternalProcessing(viewToken);
      if (result && current) settleCameraCleanup(current.scope, preparation);
      return result;
    },
    retryLocalPreparation: (viewToken: unknown) =>
      cameraC2.retryLocalPreparation(viewToken),
    retireCameraC2: retireCameraC2WithWarning,
    takeCameraPhoto: () => {
      const current = currentCameraAcquisition();
      if (!current || cameraStore.isBusy()) return Promise.resolve(false);
      cameraC2.retire();
      cameraC1Store.retire();
      cameraC1Store.bind(current.scope);
      return runLocalPicker(current, cameraController.takePhoto);
    },
    chooseCameraPhoto: () => {
      const current = currentCameraAcquisition();
      if (!current || cameraStore.isBusy()) return Promise.resolve(false);
      cameraC2.retire();
      cameraC1Store.retire();
      cameraC1Store.bind(current.scope);
      return runLocalPicker(current, cameraController.choosePhoto);
    },
    useCameraPhoto: () => {
      const current = currentCamera();
      if (!current?.candidate.candidate || current.candidate.receipt) return false;
      cameraC2.retire();
      const receipt = cameraStore.accept(current.scope, current.candidate.candidate.candidate_id);
      if (!receipt) return false;
      const live = currentCamera();
      if (!live || live.scope !== current.scope || live.candidate.receipt !== receipt) return false;
      if (!cameraC1Store.consume(receipt)) {
        cameraStore.cancelFlow(current.scope);
        cameraC1Store.retire();
        return false;
      }
      refreshCameraC1((revision) => revision + 1);
      return true;
    },
    cancelCameraPhoto: () => {
      const current = currentCamera();
      if (!current) return false;
      const accepted = Boolean(current.candidate.receipt);
      retireCameraC2WithWarning();
      if (accepted && !cameraC1Store.decline(current.scope)) return false;
      if (!cameraStore.cancelFlow(current.scope)) return false;
      if (!accepted) {
        cameraC1Store.retire();
        cameraC1Store.bind(current.scope);
      }
      refreshCameraC1((revision) => revision + 1);
      return true;
    },
    allowCameraPhotoForTask: () => {
      const current = currentCamera();
      const ref = cameraC1Store.getSnapshot();
      const projection = current && cameraC1Store.project(current.scope);
      if (!current?.candidate.receipt || !ref || !projection
        || ref.candidate_id !== current.candidate.receipt.candidate_id
        || projection.image.state !== 'present' || projection.permission.status !== 'unknown'
        || !cameraC1Store.allow(ref)) return false;
      refreshCameraC1((revision) => revision + 1);
      return true;
    },
    declineCameraPhotoForTask: () => {
      const current = currentCamera();
      const projection = current && cameraC1Store.project(current.scope);
      if (!current?.candidate.receipt || !projection
        || projection.image.state !== 'present' || projection.permission.status !== 'unknown') return false;
      retireCameraC2WithWarning();
      if (!cameraC1Store.decline(current.scope)) return false;
      refreshCameraC1((revision) => revision + 1);
      return true;
    },
    revokeCameraPhotoForTask: () => {
      const current = currentCamera();
      const ref = cameraC1Store.getSnapshot();
      const projection = current && cameraC1Store.project(current.scope);
      if (!current?.candidate.receipt || !ref || !projection
        || ref.candidate_id !== current.candidate.receipt.candidate_id
        || projection.image.state !== 'present' || projection.permission.status !== 'allowed') return false;
      retireCameraC2WithWarning();
      if (!cameraC1Store.revoke(ref)) return false;
      refreshCameraC1((revision) => revision + 1);
      return true;
    },
    m5GoalChoice: trainerM5GoalChoice ?? m5GoalChoice,
    w01,
    m7Record,
    acceptM5GoalChoice: () => {
      if (trainerView && trainerJourney) {
        return trainerJourney.commands.acceptGoal(trainerView.token);
      }
      const authority = latest.current;
      if (!inputScopeCurrent() || !issuedHostCurrent() || !authority.m3AuthorityCurrent || !authority.m3ChoiceAuthorityCurrent
        || !authority.m3TaskPermissionGranted
        || authority.m3AuthorityKey !== m3AuthorityRef.current
        || authority.m3ChoiceAuthorityKey !== m3ChoiceAuthorityRef.current
        || !m3Store || !activeTaskRef || !goalM5) return false;
      const accepted = m3Store.acceptM5Goal(activeTaskRef, goalM5);
      // Acceptance publishes a new view revision. Reacquire; never reuse the old ref.
      const freshRef = m3Store.reference(activeTaskRef.task_id);
      return Boolean(accepted && choiceCurrent() && freshRef
        && m3Store.getSnapshot().active_task_id === activeTaskRef.task_id
        && m3Store.getM5GoalChoiceReceipt(freshRef) === accepted);
    },
    setM3Access,
    editM3Task: (value: string) => {
      if (trainerView && trainerJourney) {
        return trainerJourney.commands.editGoal(trainerView.token, value);
      }
      if (!m3Store || !issuedHostCurrent() || !issuedActiveTaskRef) return false;
      const nextText = value.trim();
      const currentTask = m3Store.getSnapshot().tasks.find((task) => task.task_id === issuedActiveTaskRef.task_id);
      if (!nextText || !currentTask || currentTask.status === 'CANCELLED'
        || currentTask.source_input === nextText) return false;
      const oldCamera = captureCameraCleanup();
      const edited = m3Store.edit(issuedActiveTaskRef, nextText);
      if (edited) {
        if (oldCamera) retireCapturedCamera(oldCamera);
        const current = m3Store.getSnapshot();
        const resultCurrent = issuedHostCurrent()
          && current.active_task_id === issuedActiveTaskRef.task_id
          && current.tasks.some((task) => task.task_id === issuedActiveTaskRef.task_id
            && task.source_input === nextText);
        if (resultCurrent) {
          setM3NoticeKey(null);
        }
        return resultCurrent;
      }
      return false;
    },
    cancelM3Task: () => {
      if (trainerView && trainerJourney) {
        return trainerJourney.commands.cancelGoal(trainerView.token);
      }
      if (!m3Store || !issuedHostCurrent() || !issuedActiveTaskRef) return false;
      const oldCamera = captureCameraCleanup();
      if (!m3Store.cancel(issuedActiveTaskRef)) return false;
      if (oldCamera) retireCapturedCamera(oldCamera);
      const resultCurrent = issuedHostCurrent() && m3Store.getSnapshot().active_task_id === null;
      if (resultCurrent) {
        setM3NoticeKey('m2Cancelled');
      }
      return resultCurrent;
    },
    switchM3Task: (taskId: string) => {
      if (trainerView) return false;
      if (!m3Store || !issuedHostCurrent()) return false;
      const targetRef = issuedSwitchTargets.get(taskId);
      const snapshot = m3Store.getSnapshot();
      if (!targetRef || (m3Snapshot.active_task_id !== null && !issuedActiveTaskRef)
        || snapshot.active_task_id === taskId) return false;
      const task = snapshot.tasks.find((item) => item.task_id === targetRef.task_id);
      if (!task || task.status === 'CANCELLED') return false;
      const oldCamera = captureCameraCleanup();
      if (!m3Store.switchTask(targetRef)) return false;
      if (oldCamera) retireCapturedCamera(oldCamera);
      const current = m3Store.getSnapshot();
      const currentTarget = current.tasks.find((item) => item.task_id === taskId);
      return issuedHostCurrent() && current.active_task_id === taskId
        && currentTarget && currentTarget.status !== 'CANCELLED'
        ? currentTarget.source_input : false;
    },
    activeM3Task: trainerView?.task ? { id: 'trainer-current' }
      : activeTask && activeTask.status !== 'CANCELLED' ? {
      id: activeTask.task_id,
    } : undefined,
    submit,
    changeText,
    beginPress: (id: string) => {
      if (!inputScopeCurrent()) return;
      gesture.current = { id, token: view?.token ?? null, cancelled: false };
      setInput(pressM2Input(currentInput, view));
    },
    endPress: () => { if (inputScopeCurrent()) setInput(releaseM2Input); },
    acceptPress: (id: string) => {
      if (!inputScopeCurrent()) return false;
      const accepted = isM2PressCurrent(gesture.current, view, readLatest().view, id);
      gesture.current = null;
      setInput(releaseM2Input);
      return accepted;
    },
    choose: async (note: M2Note) => {
      if (!view || !inputScopeCurrent()) return;
      if (!isM2NoteCurrent(view, readLatest().view, note)) return;
      if (!note.action) {
        setInput(editM2Input(releaseM2Input(currentInput), note.label, view, locale));
        setNotice({ token: '', text: '' });
        return; // expression only; no M3, goal writer, or network
      }
      if (busyRef.current) return;
      const operation = {};
      const operationRunner = runner.current;
      busyRef.current = operation;
      setBusy(true);
      try {
        const result = await operationRunner(view, note, readLatest);
        if (projectionLifetime.current !== inputLifetime || busyRef.current !== operation) return;
        if (result === 'failed' && inputScopeCurrent() && readLatest().view?.token === view.token) {
          setNotice({ token: view.token, text: copy?.failed ?? '' });
        }
      } finally {
        if (projectionLifetime.current === inputLifetime && busyRef.current === operation) {
          busyRef.current = null;
          setBusy(false);
        }
      }
    },
  };
}

// Re-export the existing bounded runtime; construction alone performs no image/provider I/O.
export { createCoachPresenceC2Runtime } from '@/lib/camera/c2-runtime';
export type { CoachPresenceLive } from '@/lib/camera/c2-runtime';
