import { taskCopy } from '../../i18n-task';
import type { IntentMeaning, LanguageInput } from './contract';
import type { M3LanguageAdapter, M3Operation } from './resolver';
import { resolveDeterministicM3 } from './deterministic-semantics';

const wait = (signal: AbortSignal, delayMs: number) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, delayMs);
  const abort = () => {
    clearTimeout(timer);
    reject(new Error('M3_STUB_ABORTED'));
  };
  signal.addEventListener('abort', abort, { once: true });
});

function fixtureMeaning(input: LanguageInput): IntentMeaning {
  const meaning = resolveDeterministicM3(input);
  if (input.locale === 'vi' || input.locale === 'en') return meaning;
  // The legacy fixture has no general multilingual language model. Localize
  // its presentation only; never invent a new semantic decision.
  const copy = taskCopy(input.locale);
  const safety = meaning.safety_state !== 'CLEAR' || meaning.intent_type === 'SAFETY';
  const stopped = input.asking_stopped || ['STOP_PAUSE', 'REFUSAL'].includes(meaning.intent_type);
  return Object.freeze({
    ...meaning,
    clarification_question: meaning.clarification_question === null ? null : copy.clarification,
    response: meaning.safety_state === 'URGENT' ? copy.urgentSafety
      : safety ? copy.safety : stopped ? copy.stopped
      : meaning.clarification_needed ? copy.clarification
      : ['CORRECTION', 'CHANGE_OF_MIND'].includes(meaning.intent_type) ? copy.corrected : copy.acknowledged,
  });
}

export function createM3StubAdapter(delayMs = 180): M3LanguageAdapter {
  return Object.freeze({
    provenance: 'TEST_FIXTURE',
    processing: 'ON_DEVICE',
    contract: 'M3_GATEWAY_V1',
    async interpret(
      { content, operation }: Readonly<{ content: LanguageInput; operation: M3Operation }>,
      signal: AbortSignal,
    ) {
      if (!operation.isCurrent()) throw new Error('M3_STUB_STALE_SCOPE');
      await wait(signal, delayMs);
      if (signal.aborted || !operation.isCurrent()) throw new Error('M3_STUB_STALE_SCOPE');
      return fixtureMeaning(content);
    },
    async revoke() {
      // RAM-only fixture: the SessionTask store owns revocation state.
    },
  });
}
