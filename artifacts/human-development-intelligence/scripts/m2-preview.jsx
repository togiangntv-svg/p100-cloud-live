// Local fixture harness only. No app route imports this file.
import React, { useEffect, useMemo, useState } from 'react';
import { registerRootComponent } from 'expo';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LocalizationProvider } from '../context/LocalizationContext';
import { OpeningGoalFlow } from '../components/OpeningGoalFlow';
import { fixtureA1, fixtureB2, fixtureB4 } from './fixtures/m2.mjs';

const query = new URLSearchParams(window.location.search);
const fixture = { A1: fixtureA1, B2: fixtureB2, B4: fixtureB4 }[query.get('case')] ?? fixtureA1;
function Harness() {
  const [snapshot, setSnapshot] = useState(fixture);
  const [count, setCount] = useState(0);
  const executors = useMemo(() => Object.fromEntries([
    'continue_workout', 'adjust_workout', 'pause_workout', 'end_workout',
    'continue_plan', 'change_context', 'review_week', 'later',
  ].map(action => [action, async () => {
    setCount(value => value + 1);
    document.getElementById('fixture-events').textContent = action;
  }])), []);
  useEffect(() => {
    document.body.dataset.executions = String(count);
    document.body.dataset.completedSets = JSON.stringify(
      snapshot.activeTask.kind === 'workout' ? snapshot.activeTask.completedSetIds : []);
  }, [count, snapshot]);
  useEffect(() => {
    const update = () => setSnapshot(s => ({ ...s, revision: s.revision + '-changed' }));
    const changePerson = () => setSnapshot(s => ({
      ...s, revision: s.revision + '-subject', subject: { ...s.subject, id: 'fixture-other-person' },
    }));
    const revoke = () => setSnapshot(s => ({
      ...s, permission: { status: 'denied', revision: s.permission.revision + '-revoked' },
    }));
    const controls = [
      ['fixture-update', update], ['fixture-person', changePerson], ['fixture-revoke', revoke],
    ];
    for (const [id, fn] of controls) document.getElementById(id).addEventListener('click', fn);
    return () => { for (const [id, fn] of controls) document.getElementById(id).removeEventListener('click', fn); };
  }, []);
  return (
    <SafeAreaProvider>
      <LocalizationProvider>
        <View style={{ flex: 1 }}>
          <OpeningGoalFlow initialPhase={query.get('opening') ? 'opening' : 'goal'}
            reviewing={false} onGoalOpened={() => {}} onClose={() => {}}
            m2Gateway={query.get('baseline') ? undefined : { snapshot, executors }} />
        </View>
      </LocalizationProvider>
    </SafeAreaProvider>
  );
}
registerRootComponent(Harness);
