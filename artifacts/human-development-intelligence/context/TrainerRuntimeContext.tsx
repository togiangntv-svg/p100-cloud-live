import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import {
  createTrainerRuntimeAppHost,
  type TrainerRuntimeControl,
} from '@/domain/trainer-runtime/app-host';
import type {
  TrainerJourneyCommands,
  TrainerJourneyController,
  TrainerJourneyView,
} from '@/domain/trainer-runtime/journey-controller';
import { useOwnerSessionBinding } from './OwnerSessionContext';

export type TrainerRuntimeView = Readonly<{
  state: 'UNAVAILABLE' | 'READY';
  current_cycle?: 'A' | 'B';
  has_history?: boolean;
}>;

const TrainerRuntimeContext = createContext<TrainerRuntimeView | undefined>(undefined);
const TrainerRuntimeControlContext = createContext<TrainerRuntimeControl | undefined>(undefined);
const TrainerJourneyContext = createContext<TrainerJourneyController | undefined>(undefined);

/**
 * Mount directly below OwnerSessionProvider. Effect cleanup retires all owned
 * cycles; a Strict Mode setup-cleanup-setup cycle therefore creates a fresh
 * Cycle A instead of reviving retired A/B state.
 */
export function TrainerRuntimeProvider({ children }: { children: React.ReactNode }) {
  const binding = useOwnerSessionBinding();
  const [host] = useState(createTrainerRuntimeAppHost);
  const runtime = useSyncExternalStore(
    host.subscribe,
    host.getSnapshot,
    host.getSnapshot,
  );
  const runtimeView: TrainerRuntimeView = runtime.state === 'READY'
    ? Object.freeze({ state: 'READY', current_cycle: runtime.cycle_b ? 'B' : 'A',
      has_history: Boolean(runtime.cycle_b) })
    : Object.freeze({ state: 'UNAVAILABLE' });

  useEffect(() => {
    host.setBinding(binding);
    return () => host.setBinding(undefined);
  }, [binding?.access, binding?.lease, host]);

  return (
    <TrainerRuntimeContext.Provider value={runtimeView}>
      <TrainerRuntimeControlContext.Provider value={host.control}>
        <TrainerJourneyContext.Provider value={host.journey}>
          {children}
        </TrainerJourneyContext.Provider>
      </TrainerRuntimeControlContext.Provider>
    </TrainerRuntimeContext.Provider>
  );
}

export function useTrainerRuntime(): TrainerRuntimeView {
  const runtime = useContext(TrainerRuntimeContext);
  if (!runtime) throw new Error('TRAINER_RUNTIME_PROVIDER_REQUIRED');
  return runtime;
}

export function useTrainerRuntimeControl(): TrainerRuntimeControl {
  const control = useContext(TrainerRuntimeControlContext);
  if (!control) throw new Error('TRAINER_RUNTIME_PROVIDER_REQUIRED');
  return control;
}

export type TrainerJourneyPresentation = Readonly<{
  view: TrainerJourneyView;
  commands: TrainerJourneyCommands;
}>;

export function useOptionalTrainerJourney(): TrainerJourneyPresentation | undefined {
  const controller = useContext(TrainerJourneyContext);
  const view = useSyncExternalStore(
    controller?.subscribe ?? (() => () => {}),
    controller?.getView ?? (() => undefined),
    controller?.getView ?? (() => undefined),
  );
  return controller && view ? Object.freeze({ view, commands: controller.commands }) : undefined;
}
