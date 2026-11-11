import React, { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, ScrollView, Text } from 'react-native';
import { DevelopmentProvider, useDevelopment } from '../../context/DevelopmentContext';
import type { DevelopmentContextValue, DevelopmentOwnerBinding } from '../../context/development-owner/store';
import { createRuntimeLeaseBridge } from '../interaction-runtime/bridge';
import { isRuntimeTestEnabled } from '../interaction-runtime/gate';
import { runScenarios, type ProbePort } from './scenarios';

function Probe({ port, generation }: { port: ProbePort; generation: number }) {
  const value = useDevelopment();
  useLayoutEffect(() => {
    port.current = { value, generation };
    return () => { port.current = undefined; };
  }, [port, value, generation]);
  return <Text testID="development-state">{JSON.stringify({ generation, hydrated: value.hydrated,
    status: value.persistenceStatus, note: value.state.reviewNote, correction: value.state.inferenceCorrection,
    recommendation: value.decisionBundle.recommendation?.text ?? null })}</Text>;
}
export default function Harness() {
  const [bridge] = useState(createRuntimeLeaseBridge);
  const session = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
  const [override, setOverride] = useState<{ binding: DevelopmentOwnerBinding }>();
  const port = useRef<{ value: DevelopmentContextValue; generation: number } | undefined>(undefined);
  const [result, setResult] = useState({ status: 'NOT_RUN', checks: [] as string[] });
  const enabled = isRuntimeTestEnabled();
  const run = async () => {
    if (!isRuntimeTestEnabled() || result.status !== 'NOT_RUN') return;
    setResult({ status: 'RUNNING', checks: [] });
    try {
      const checks = await runScenarios(bridge, port, binding => setOverride(binding ? { binding } : undefined));
      setResult({ status: 'PASS', checks });
    } catch (error) {
      // Only locally authored assertion names; never print backend/personal payloads.
      setResult({ status: 'FAIL', checks: [error instanceof Error && error.message.startsWith('CHECK:')
        ? error.message : 'CHECK: runtime scenario failed'] });
    } finally { bridge.invalidate(); setOverride(undefined); }
  };
  return <ScrollView contentContainerStyle={{ padding: 24, gap: 12 }}>
    <Text style={{ fontSize: 22 }}>SYNTHETIC DEVELOPMENT TEST — not login</Text>
    <Text>Actual sealed DevelopmentProvider. Memory-only fake storage. No product screens or live service.</Text>
    <Text testID="gate-status">{enabled ? 'TEST ENABLED' : 'LOCKED — dev runtime AND explicit flag required'}</Text>
    <Text testID="session-status">{session.phase} / {session.label ?? '-'} / generation {session.generation}</Text>
    <Button title="Run mounted Development scenarios" disabled={!enabled || result.status !== 'NOT_RUN'} onPress={() => { void run(); }} />
    <DevelopmentProvider ownerSession={enabled ? override?.binding ?? session.binding : undefined}>
      <Probe port={port} generation={session.generation} />
    </DevelopmentProvider>
    <Text testID="runtime-result">{JSON.stringify(result)}</Text>
  </ScrollView>;
}
