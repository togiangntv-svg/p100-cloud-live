import { createLocalM7PurposeAuthority, readM7Purpose, reduceM7RecordPurpose, observeM7Purpose } from '../m7/outcome';
import type { M7PurposeReceipt } from '../m7/outcome';

export const TRAINER_M7_CYCLE_REQUEST_LIMIT = 64;

export type TrainerM7CycleCommand =
  | 'USER_SUBMITTED_OUTCOME'
  | 'USER_ALLOWED_NEXT_CYCLE'
  | 'USER_REVOKED_NEXT_CYCLE'
  | 'TRUSTED_REVOKED_OUTCOME';

export type TrainerM7CycleRequest = Readonly<{
  type: TrainerM7CycleCommand;
  request_id: string;
}>;

export type TrainerM7CycleCommandResult =
  | Readonly<{
    state: 'GRANTED';
    command: Extract<TrainerM7CycleCommand, 'USER_SUBMITTED_OUTCOME' | 'USER_ALLOWED_NEXT_CYCLE'>;
    request_id: string;
    receipt: M7PurposeReceipt;
  }>
  | Readonly<{
    state: 'REVOKED';
    command: Extract<TrainerM7CycleCommand, 'USER_REVOKED_NEXT_CYCLE' | 'TRUSTED_REVOKED_OUTCOME'>;
    request_id: string;
  }>
  | Readonly<{
    state: 'DENIED';
    command: TrainerM7CycleCommand;
    request_id: string;
    reason: 'INVALID_REQUEST' | 'REQUEST_CONFLICT' | 'LEDGER_FULL' | 'RETIRED';
  }>;

export type TrainerM7CycleAuthoritySnapshot = Readonly<{
  state: 'ACTIVE' | 'RETIRED';
  request_count: number;
  record_outcome_receipt: M7PurposeReceipt | undefined;
  use_next_cycle_receipt: M7PurposeReceipt | undefined;
}>;

const requestPattern = /^[A-Za-z0-9_.-]{1,96}$/;

/**
 * Cycle-scoped product facade for M7 purpose authority.
 *
 * Construction grants nothing. The raw grant control remains private and is
 * reachable only through the explicit semantic commands below. Each instance
 * owns its receipts and bounded idempotency ledger independently, so a later
 * cycle cannot invalidate an earlier cycle's retained authority.
 */
export function createTrainerM7CycleAuthority() {
  const authority = createLocalM7PurposeAuthority();
  const ledger = new Map<string, Readonly<{
    command: TrainerM7CycleCommand;
    result: TrainerM7CycleCommandResult;
    expected?: M7PurposeReceipt;
  }>>();
  let recordOutcomeReceipt: M7PurposeReceipt | undefined;
  let useNextCycleReceipt: M7PurposeReceipt | undefined;
  let retired = false;

  const denied = (command: TrainerM7CycleCommand, requestId: string,
    reason: Extract<TrainerM7CycleCommandResult, { state: 'DENIED' }>['reason']) => Object.freeze({
      state: 'DENIED' as const,
      command,
      request_id: requestId,
      reason,
    });

  // Reserve before raw grant can synchronously call observers. Reduction closes
  // a matching in-flight acquisition; its unwind cannot publish into a successor.
  const pending = new Map<string, TrainerM7CycleCommand>();
  let recordAcquisition: object | undefined;
  let nextAcquisition: object | undefined;
  const refreshReceipts = () => {
    if (readM7Purpose(authority.access, recordOutcomeReceipt, 'RECORD_OUTCOME') === undefined) recordOutcomeReceipt = undefined;
    if (readM7Purpose(authority.access, useNextCycleReceipt, 'USE_NEXT_CYCLE') === undefined) useNextCycleReceipt = undefined;
  };
  observeM7Purpose(authority.access, refreshReceipts);
  const execute = (command: TrainerM7CycleCommand, requestId: unknown,
    operation: (requestId: string) => TrainerM7CycleCommandResult,
    reducing = false, expected?: M7PurposeReceipt): TrainerM7CycleCommandResult => {
    if (typeof requestId !== 'string' || !requestPattern.test(requestId)) return denied(command, '', 'INVALID_REQUEST');
    if (retired) return denied(command, requestId, 'RETIRED');
    const prior = ledger.get(requestId);
    if (prior) return prior.command === command && (!expected || !('expected' in prior) || prior.expected === expected)
      ? prior.result : denied(command, requestId, 'REQUEST_CONFLICT');
    if (pending.has(requestId)) return denied(command, requestId, 'REQUEST_CONFLICT');
    if (!reducing && ledger.size + pending.size >= TRAINER_M7_CYCLE_REQUEST_LIMIT) return denied(command, requestId, 'LEDGER_FULL');
    // A capacity-full reduction performs no extra bookkeeping.
    const reserve = ledger.size + pending.size < TRAINER_M7_CYCLE_REQUEST_LIMIT;
    if (reserve) pending.set(requestId, command);
    try {
      const result = operation(requestId);
      if (retired) return denied(command, requestId, 'RETIRED');
      if (reserve) ledger.set(requestId, Object.freeze({ command, result, expected }));
      return result;
    } finally { pending.delete(requestId); }
  };
  const acquire = (purpose: 'RECORD_OUTCOME' | 'USE_NEXT_CYCLE', requestId: string): TrainerM7CycleCommandResult => {
    refreshReceipts();
    const command = purpose === 'RECORD_OUTCOME' ? 'USER_SUBMITTED_OUTCOME' : 'USER_ALLOWED_NEXT_CYCLE';
    let receipt = purpose === 'RECORD_OUTCOME' ? recordOutcomeReceipt : useNextCycleReceipt;
    if (receipt) return Object.freeze({ state: 'GRANTED', command, request_id: requestId, receipt });
    if (purpose === 'RECORD_OUTCOME' ? recordAcquisition : nextAcquisition) return denied(command, requestId, 'REQUEST_CONFLICT');
    const acquisition = Object.freeze({});
    if (purpose === 'RECORD_OUTCOME') recordAcquisition = acquisition; else nextAcquisition = acquisition;
    receipt = authority.control.grant(purpose);
    const matching = (purpose === 'RECORD_OUTCOME' ? recordAcquisition : nextAcquisition) === acquisition;
    const valid = !retired && matching && readM7Purpose(authority.access, receipt, purpose) !== undefined;
    if (matching) {
      if (purpose === 'RECORD_OUTCOME') recordAcquisition = undefined; else nextAcquisition = undefined;
    }
    if (!valid) {
      if (readM7Purpose(authority.access, receipt, purpose) !== undefined) {
        if (purpose === 'RECORD_OUTCOME') reduceM7RecordPurpose(authority.access, receipt);
        else authority.control.revoke(purpose);
      }
      return denied(command, requestId, retired ? 'RETIRED' : 'REQUEST_CONFLICT');
    }
    if (purpose === 'RECORD_OUTCOME') recordOutcomeReceipt = receipt; else useNextCycleReceipt = receipt;
    return Object.freeze({ state: 'GRANTED', command, request_id: requestId, receipt });
  };

  return Object.freeze({
    access: authority.access,
    bindRecordingScope: authority.control.bindRecordingScope,
    getSnapshot: (): TrainerM7CycleAuthoritySnapshot => {
      refreshReceipts();
      return Object.freeze({ state: retired ? 'RETIRED' : 'ACTIVE', request_count: ledger.size + pending.size,
        record_outcome_receipt: recordOutcomeReceipt, use_next_cycle_receipt: useNextCycleReceipt });
    },
    submitOutcome: (event: Readonly<{ type: 'USER_SUBMITTED_OUTCOME'; request_id: string }>) =>
      execute('USER_SUBMITTED_OUTCOME', event?.type === 'USER_SUBMITTED_OUTCOME' ? event.request_id : undefined,
        id => acquire('RECORD_OUTCOME', id)),
    allowNextCycle: (event: Readonly<{ type: 'USER_ALLOWED_NEXT_CYCLE'; request_id: string }>) =>
      execute('USER_ALLOWED_NEXT_CYCLE', event?.type === 'USER_ALLOWED_NEXT_CYCLE' ? event.request_id : undefined,
        id => acquire('USE_NEXT_CYCLE', id)),
    revokeNextCycle: (event: Readonly<{ type: 'USER_REVOKED_NEXT_CYCLE'; request_id: string }>) =>
      execute('USER_REVOKED_NEXT_CYCLE', event?.type === 'USER_REVOKED_NEXT_CYCLE' ? event.request_id : undefined, id => {
        nextAcquisition = undefined; useNextCycleReceipt = undefined;
        authority.control.revoke('USE_NEXT_CYCLE');
        return Object.freeze({ state: 'REVOKED' as const, command: 'USER_REVOKED_NEXT_CYCLE' as const, request_id: id });
      }, true),
    revokeRecordOutcome: (event: Readonly<{ type: 'TRUSTED_REVOKED_OUTCOME'; request_id: string;
      expected_receipt?: M7PurposeReceipt }>) =>
      execute('TRUSTED_REVOKED_OUTCOME', event?.type === 'TRUSTED_REVOKED_OUTCOME' ? event.request_id : undefined, id => {
        refreshReceipts();
        if (event.expected_receipt && event.expected_receipt !== recordOutcomeReceipt) return denied('TRUSTED_REVOKED_OUTCOME', id, 'REQUEST_CONFLICT');
        const expected = event.expected_receipt ?? recordOutcomeReceipt;
        recordAcquisition = undefined; recordOutcomeReceipt = undefined;
        if (expected) reduceM7RecordPurpose(authority.access, expected);
        else authority.control.revoke('RECORD_OUTCOME');
        return Object.freeze({ state: 'REVOKED' as const, command: 'TRUSTED_REVOKED_OUTCOME' as const, request_id: id });
      }, true, event?.expected_receipt),
    retire: () => {
      if (retired) return;
      retired = true; authority.control.closeRecordingScope();
      recordAcquisition = undefined; nextAcquisition = undefined;
      recordOutcomeReceipt = undefined; useNextCycleReceipt = undefined;
      ledger.clear(); pending.clear();
      authority.control.revoke('USE_NEXT_CYCLE'); authority.control.revoke('RECORD_OUTCOME');
    },
  });
}
