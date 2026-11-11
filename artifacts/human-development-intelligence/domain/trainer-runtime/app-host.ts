import type { OwnerSessionBinding } from '../identity/owner-session-coordinator';
import {
  createTrainerTwoCycleRuntime,
  type TrainerTwoCycleAdvanceResult,
  type TrainerTwoCycleSnapshot,
  type TrainerTwoCycleStoreFactory,
} from './two-cycle';
import {
  createTrainerJourneyController,
  type TrainerJourneyController,
  type TrainerJourneyFixture,
} from './journey-controller';

export type TrainerRuntimeControl = Readonly<{
  createNextCycleFromA: () => TrainerTwoCycleAdvanceResult;
}>;

export type TrainerRuntimeAppHost = Readonly<{
  getSnapshot: () => TrainerTwoCycleSnapshot;
  subscribe: (listener: () => void) => () => void;
  setBinding: (binding: OwnerSessionBinding | undefined) => void;
  control: TrainerRuntimeControl;
  journey: TrainerJourneyController;
}>;

/**
 * React-facing adapter for the approved two-cycle domain runtime. The provider
 * owns this adapter; consumers receive only its snapshot and bounded control.
 */
export function createTrainerRuntimeAppHost(options: Readonly<{
  createStore?: TrainerTwoCycleStoreFactory;
  journeyFixture?: TrainerJourneyFixture;
}> = {}): TrainerRuntimeAppHost {
  const runtime = createTrainerTwoCycleRuntime(options);
  const control: TrainerRuntimeControl = Object.freeze({
    createNextCycleFromA: () => runtime.createNextCycle('A'),
  });
  const journey = createTrainerJourneyController({
    getRuntimeSnapshot: runtime.getSnapshot,
    subscribeRuntime: runtime.subscribe,
    createNextCycleFromA: control.createNextCycleFromA,
    fixture: options.journeyFixture,
  });

  return Object.freeze({
    getSnapshot: runtime.getSnapshot,
    subscribe: runtime.subscribe,
    setBinding: runtime.setBinding,
    control,
    journey,
  });
}
