import type { OwnerSessionBinding } from '../identity/owner-session-coordinator';
import type { M7ActiveOutcome, M7PurposeReceipt } from './outcome';

export type M7NextCycleFragment = Readonly<{
  state: 'AVAILABLE' | 'SAFETY_HOLD' | 'URGENT_HELP';
  episode_ref: Readonly<{
    episode_key: string;
    action_id: string;
    action_version: number;
    proposal_revision: number;
    source_revision: number;
    outcome_revision: number;
  }>;
  provenance: Readonly<{
    source: 'USER_REPORT';
    epistemic_role: 'PERSONAL_OBSERVATION_PR0';
    recorded_at: number;
    occurred_at?: number;
    purpose_revision: number;
  }>;
  reported_constraint?: Readonly<{
    kind: 'PRIOR_EPISODE_TIME_CONSTRAINT' | 'PRIOR_EPISODE_OTHER_CONSTRAINT';
    scope: 'ONE_PRIOR_EPISODE';
  }>;
  requires_reconfirmation: readonly ('CURRENT_TIME_AVAILABLE' | 'CURRENT_CONSTRAINTS' | 'SAFETY_REASSESSMENT' | 'HUMAN_CHOICE')[];
}>;

export type M7NextCycleContextItem = Readonly<{
  id: string;
  kind: 'prior_episode:m7_outcome' | 'prior_episode:safety_reassessment';
  text: 'PRIOR_EPISODE_OUTCOME_REPORTED' | 'PRIOR_EPISODE_TIME_CONSTRAINT'
    | 'PRIOR_EPISODE_OTHER_CONSTRAINT' | 'PRIOR_EPISODE_SAFETY_REASSESSMENT_REQUIRED'
    | 'PRIOR_EPISODE_URGENT_HELP_REASSESSMENT_REQUIRED';
  state: M7NextCycleFragment['state'];
  episode_ref: M7NextCycleFragment['episode_ref'];
  provenance: M7NextCycleFragment['provenance'];
  reported_constraint?: M7NextCycleFragment['reported_constraint'];
  requires_reconfirmation: M7NextCycleFragment['requires_reconfirmation'];
}>;

declare const consumerBrand: unique symbol;
export type M7NextCycleConsumerAccess = Readonly<{ [consumerBrand]: true }>;
const consumers = new WeakMap<object, Readonly<{
  binding: OwnerSessionBinding;
  read: () => M7NextCycleFragment | undefined;
  basis?: () => string;
  observe?: (listener: () => void) => () => void;
}>>();

/** Trusted RAM-only composition seam. The source is re-read on every use so
 * correction, retraction, purpose revoke and owner/lease loss fail closed.
 * Route JSON cannot manufacture a valid consumer access object.
 */
export function createM7NextCycleConsumer(
  binding: OwnerSessionBinding,
  readCurrentFragment: () => M7NextCycleFragment | undefined,
  dependency?: Readonly<{ basis: () => string; observe: (listener: () => void) => () => void }>,
): M7NextCycleConsumerAccess {
  const access = Object.freeze(Object.create(null)) as M7NextCycleConsumerAccess;
  consumers.set(access, Object.freeze({ binding: Object.freeze({ ...binding }), read: readCurrentFragment,
    basis: dependency?.basis, observe: dependency?.observe }));
  return access;
}

/** Private technical dependency stamp; it carries no outcome facts or health text. */
export function readM7NextCycleBasis(access: M7NextCycleConsumerAccess | undefined,
  binding: OwnerSessionBinding | undefined): string | undefined {
  const consumer = access ? consumers.get(access) : undefined;
  if (!consumer?.basis || !binding || consumer.binding.access !== binding.access
    || consumer.binding.lease !== binding.lease) return undefined;
  try {
    binding.access.requireLease(binding.lease);
    return binding.access.getSnapshot().phase === 'READY' ? consumer.basis() : undefined;
  } catch { return undefined; }
}

export function observeM7NextCycleBasis(access: M7NextCycleConsumerAccess | undefined,
  binding: OwnerSessionBinding | undefined, listener: () => void): () => void {
  const consumer = access ? consumers.get(access) : undefined;
  return consumer?.observe && binding && consumer.binding.access === binding.access
    && consumer.binding.lease === binding.lease ? consumer.observe(listener) : () => {};
}

export function readM7NextCycleContext(
  access: M7NextCycleConsumerAccess | undefined,
  binding: OwnerSessionBinding | undefined,
): M7NextCycleContextItem | undefined {
  const consumer = access ? consumers.get(access) : undefined;
  if (!consumer || !binding || consumer.binding.access !== binding.access
    || consumer.binding.lease !== binding.lease) return undefined;
  let fragment: M7NextCycleFragment | undefined;
  try {
    binding.access.requireLease(binding.lease);
    if (binding.access.getSnapshot().phase !== 'READY') return undefined;
    fragment = consumer.read();
  } catch { return undefined; }
  if (!fragment) return undefined;
  const safety = fragment.state !== 'AVAILABLE';
  const text = fragment.state === 'URGENT_HELP' ? 'PRIOR_EPISODE_URGENT_HELP_REASSESSMENT_REQUIRED'
    : fragment.state === 'SAFETY_HOLD' ? 'PRIOR_EPISODE_SAFETY_REASSESSMENT_REQUIRED'
      : fragment.reported_constraint?.kind === 'PRIOR_EPISODE_TIME_CONSTRAINT'
        ? 'PRIOR_EPISODE_TIME_CONSTRAINT'
        : fragment.reported_constraint?.kind === 'PRIOR_EPISODE_OTHER_CONSTRAINT'
          ? 'PRIOR_EPISODE_OTHER_CONSTRAINT' : 'PRIOR_EPISODE_OUTCOME_REPORTED';
  return Object.freeze({
    id: `m7-prior:${fragment.episode_ref.episode_key}:${fragment.episode_ref.outcome_revision}:${fragment.provenance.purpose_revision}`,
    kind: safety ? 'prior_episode:safety_reassessment' : 'prior_episode:m7_outcome',
    text,
    state: fragment.state,
    episode_ref: fragment.episode_ref,
    provenance: fragment.provenance,
    ...(!safety && fragment.reported_constraint ? { reported_constraint: fragment.reported_constraint } : {}),
    requires_reconfirmation: fragment.requires_reconfirmation,
  });
}

export function deriveM7NextCycleFragment(
  record: M7ActiveOutcome,
  purpose: M7PurposeReceipt,
): M7NextCycleFragment {
  const safetyState = record.outcome.safety_disposition === 'URGENT_HELP' ? 'URGENT_HELP'
    : record.outcome.safety_disposition === 'REASSESS' ? 'SAFETY_HOLD' : 'AVAILABLE';
  const priorConstraint = safetyState !== 'AVAILABLE' ? undefined
    : record.outcome.constraint === 'TIME_CONSTRAINT'
      ? Object.freeze({ kind: 'PRIOR_EPISODE_TIME_CONSTRAINT' as const, scope: 'ONE_PRIOR_EPISODE' as const })
      : record.outcome.constraint === 'OTHER_CONSTRAINT'
        ? Object.freeze({ kind: 'PRIOR_EPISODE_OTHER_CONSTRAINT' as const, scope: 'ONE_PRIOR_EPISODE' as const })
        : undefined;
  const reconfirm = safetyState !== 'AVAILABLE'
    ? ['SAFETY_REASSESSMENT', 'HUMAN_CHOICE'] as const
    : priorConstraint?.kind === 'PRIOR_EPISODE_TIME_CONSTRAINT'
      ? ['CURRENT_TIME_AVAILABLE', 'HUMAN_CHOICE'] as const
      : priorConstraint
        ? ['CURRENT_CONSTRAINTS', 'HUMAN_CHOICE'] as const
        : ['HUMAN_CHOICE'] as const;
  return Object.freeze({
    state: safetyState,
    episode_ref: Object.freeze({ episode_key: record.episode.episode_key,
      action_id: record.episode.action_id, action_version: record.episode.action_version,
      proposal_revision: record.episode.proposal_revision, source_revision: record.episode.source_revision,
      outcome_revision: record.revision }),
    provenance: Object.freeze({ source: record.evidence.source,
      epistemic_role: record.evidence.epistemic_role, recorded_at: record.evidence.recorded_at,
      ...(record.evidence.occurred_at === undefined ? {} : { occurred_at: record.evidence.occurred_at }),
      purpose_revision: purpose.revision }),
    ...(priorConstraint ? { reported_constraint: priorConstraint } : {}),
    requires_reconfirmation: Object.freeze([...reconfirm]),
  });
}

/** Prior context never supplies a duration. Only an independently confirmed current-cycle fact can. */
export function resolveConfirmedWalkMinutes(
  _fragment: M7NextCycleFragment | undefined,
  current: Readonly<{ available_minutes?: number; confirmed_current?: boolean }>,
): number | undefined {
  return current.confirmed_current && Number.isSafeInteger(current.available_minutes)
    && Number(current.available_minutes) > 0 ? Number(current.available_minutes) : undefined;
}
