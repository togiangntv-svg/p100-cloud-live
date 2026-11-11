import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, ScrollView, Text, View } from 'react-native';
import { InteractionProvider, useInteraction } from '../../context/InteractionContext';
import { createRuntimeLeaseBridge } from './bridge';
import { delayedApi } from './fake-api';
import { isRuntimeTestEnabled } from './gate';

type Bridge = ReturnType<typeof createRuntimeLeaseBridge>;
type SavedAction = { current: (() => boolean) | undefined };

function InteractionProbe({ label, saved }: { label?: string; saved: SavedAction }) {
  const interaction = useInteraction();
  const [result, setResult] = useState('No action');
  const count = useSyncExternalStore(delayedApi.subscribe, delayedApi.getSnapshot);
  const ready = interaction.hydrated && interaction.persistenceStatus !== 'error';
  return <View style={{ gap: 10 }}>
    <Text testID="interaction-status">{JSON.stringify({
      hydrated: interaction.hydrated, persistence: interaction.persistenceStatus,
      consent: interaction.state.aiConsent, busy: interaction.aiBusy,
    })}</Text>
    <Text testID="interaction-content">{JSON.stringify(interaction.state.messages.map(m => m.text))}</Text>
    <Button title="Write synthetic local message" disabled={!ready || interaction.aiBusy}
      onPress={() => { void interaction.addUserMessage('SYNTHETIC ' + label + ' local message', 'vi'); }} />
    <Button title="Grant fake AI consent" disabled={!ready || interaction.aiBusy}
      onPress={() => { void interaction.enableAiPilot('vi'); }} />
    <Button title="Start delayed fake AI" disabled={!ready || interaction.aiBusy}
      onPress={() => { void interaction.addUserMessage('SYNTHETIC ' + label + ' delayed request', 'vi'); }} />
    <Text>Pending fake responses: {count}</Text>
    <Button title="Complete oldest SUCCESS" disabled={count === 0} onPress={() => delayedApi.settle('success')} />
    <Button title="Complete oldest ERROR" disabled={count === 0} onPress={() => delayedApi.settle('error')} />
    <Button title="Capture current callback" disabled={!ready}
      onPress={() => { saved.current = () => interaction.saveCorrection('SYNTHETIC old callback'); setResult('Captured'); }} />
    <Button title="Invoke captured callback" onPress={() => setResult('Old callback accepted: ' + String(saved.current?.() ?? false))} />
    <Text testID="callback-result">{result}</Text>
    <Button title="Delete this synthetic owner's Interaction" disabled={!ready}
      onPress={() => { void interaction.deleteData(); }} />
  </View>;
}
function EnabledHarness({ bridge }: { bridge: Bridge }) {
  const session = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
  const saved = useRef<(() => boolean) | undefined>(undefined);
  return <ScrollView contentContainerStyle={{ padding: 24, gap: 12 }}>
    <Text style={{ fontSize: 22 }}>SYNTHETIC TEST ONLY — not login</Text>
    <Text>No real personal data. Fake AI only. Product screens are not mounted.</Text>
    <Text testID="session-status">{session.phase} / {session.label ?? '-'} / generation {session.generation}</Text>
    <Button title="Start A (new generation)" onPress={() => { void bridge.select('A'); }} />
    <Button title="Invalidate current generation" onPress={bridge.invalidate} />
    <Button title="Start B (new generation)" onPress={() => { void bridge.select('B'); }} />
    <InteractionProvider ownerSession={session.binding}>
      <InteractionProbe key={session.generation} label={session.label} saved={saved} />
    </InteractionProvider>
  </ScrollView>;
}
export default function Harness() {
  const [bridge] = useState(createRuntimeLeaseBridge);
  useEffect(() => () => { bridge.invalidate(); delayedApi.discard(); }, [bridge]);
  if (!isRuntimeTestEnabled()) return <View style={{ padding: 24 }}>
    <Text>LOCKED — development runtime AND explicit test enablement required.</Text>
  </View>;
  return <EnabledHarness bridge={bridge} />;
}
