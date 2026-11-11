import { randomUuid as platformRandomUuid } from '../../lib/correlation/random-uuid';

export const SESSION_CORRELATION_MAX_LENGTH = 46;
export const TASK_CORRELATION_MAX_LENGTH = 68;
export const INTERPRET_REQUEST_MAX_LENGTH = 95;
export const REVOKE_REQUEST_MAX_LENGTH = 92;
export const TASK_CONTEXT_MAX_LENGTH = 79;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SESSION_ID = /^s-[0-9a-f]{32}-[1-9a-z][0-9a-z]*$/u;

export type SessionIdFactory = () => string;

const validInitialSerial = (value: number) => Number.isSafeInteger(value) && value >= 0;

/**
 * Creates an allocator for trusted composition/tests. Production uses the
 * single module-scoped instance below, so store/runtime recreation cannot
 * reset or recycle its allocation serial.
 */
export function createSessionCorrelationAllocator(options: Readonly<{
  randomUuid?: SessionIdFactory;
  initialSerial?: number;
}> = {}) {
  const randomUuid = options.randomUuid ?? platformRandomUuid;
  let serial = options.initialSerial ?? 0;
  if (!validInitialSerial(serial)) throw Error('SESSION_CORRELATION_SERIAL_INVALID');

  return Object.freeze({
    allocate(): string {
      const raw = randomUuid();
      if (typeof raw !== 'string' || !UUID_V4.test(raw)) {
        throw Error('SESSION_CORRELATION_UUID_INVALID');
      }
      if (serial >= Number.MAX_SAFE_INTEGER) {
        throw Error('SESSION_CORRELATION_SERIAL_EXHAUSTED');
      }
      const nextSerial = serial + 1;
      const id = `s-${raw.toLowerCase().replaceAll('-', '')}-${nextSerial.toString(36)}`;
      if (!isSessionCorrelationId(id)) throw Error('SESSION_CORRELATION_ID_INVALID');
      serial = nextSerial;
      return id;
    },
  });
}

export function isSessionCorrelationId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= SESSION_CORRELATION_MAX_LENGTH
    && SESSION_ID.test(value);
}

const positiveSerial = (value: number) => Number.isSafeInteger(value) && value > 0;
const bounded = (value: string, maximum: number, code: string): string => {
  if (!value || value.length > maximum) throw Error(code);
  return value;
};

export function createTaskCorrelationId(sessionId: string, serial: number): string {
  if (!isSessionCorrelationId(sessionId) || !positiveSerial(serial)) {
    throw Error('TASK_CORRELATION_INPUT_INVALID');
  }
  return bounded(`${sessionId}/task-${serial}`, TASK_CORRELATION_MAX_LENGTH, 'TASK_CORRELATION_ID_TOO_LONG');
}

export function createInterpretRequestId(taskId: string, serial: number): string {
  if (!taskId || taskId.length > TASK_CORRELATION_MAX_LENGTH || !positiveSerial(serial)) {
    throw Error('INTERPRET_CORRELATION_INPUT_INVALID');
  }
  return bounded(`${taskId}/operation-${serial}`, INTERPRET_REQUEST_MAX_LENGTH,
    'INTERPRET_CORRELATION_ID_TOO_LONG');
}

export function createRevokeRequestId(taskId: string, serial: number): string {
  if (!taskId || taskId.length > TASK_CORRELATION_MAX_LENGTH || !positiveSerial(serial)) {
    throw Error('REVOKE_CORRELATION_INPUT_INVALID');
  }
  return bounded(`${taskId}/revoke-${serial}`, REVOKE_REQUEST_MAX_LENGTH, 'REVOKE_CORRELATION_ID_TOO_LONG');
}

export function createTaskContextId(taskId: string, revision: number): string {
  if (!taskId || taskId.length > TASK_CORRELATION_MAX_LENGTH || !positiveSerial(revision)) {
    throw Error('TASK_CONTEXT_CORRELATION_INPUT_INVALID');
  }
  return bounded(`${taskId}@${revision}`, TASK_CONTEXT_MAX_LENGTH, 'TASK_CONTEXT_CORRELATION_ID_TOO_LONG');
}

const canonicalAllocator = createSessionCorrelationAllocator();

/** Canonical process/module-lifetime production allocation seam. */
export const allocateSessionCorrelationId: SessionIdFactory = () => canonicalAllocator.allocate();
