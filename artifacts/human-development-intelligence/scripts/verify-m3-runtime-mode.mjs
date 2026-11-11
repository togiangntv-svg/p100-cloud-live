import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveM3RuntimeMode, selectM3RuntimeAdapter } from '../domain/m3/runtime-mode.ts';
import { resolveM3HostPermission } from '../domain/m3/host-permission.ts';

for (const value of [undefined, '', 'true', 'false', 'LIVE', 'invalid']) {
  assert.equal(resolveM3RuntimeMode(value), 'off');
}
for (const mode of ['off', 'fixture', 'live']) {
  assert.equal(resolveM3RuntimeMode(mode), mode);
}

let fixtureConstructions = 0;
let liveConstructions = 0;
const construct = (mode) => ({
  fixture: selectM3RuntimeAdapter(mode, 'fixture', () => {
    fixtureConstructions += 1;
    return { provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE' };
  }),
  live: selectM3RuntimeAdapter(mode, 'live', () => {
    liveConstructions += 1;
    return { provenance: 'PRODUCTION', processing: 'EXTERNAL' };
  }),
});

for (const raw of [undefined, 'invalid', 'off']) {
  const adapters = construct(resolveM3RuntimeMode(raw));
  assert.equal(adapters.fixture, undefined);
  assert.equal(adapters.live, undefined);
}
assert.deepEqual([fixtureConstructions, liveConstructions], [0, 0]);

const fixture = construct('fixture');
assert.equal(fixture.fixture.provenance, 'TEST_FIXTURE');
assert.equal(fixture.fixture.processing, 'ON_DEVICE');
assert.equal(fixture.live, undefined);
assert.deepEqual([fixtureConstructions, liveConstructions], [1, 0]);

const live = construct('live');
assert.equal(live.fixture, undefined);
assert.equal(live.live.processing, 'EXTERNAL');
assert.deepEqual([fixtureConstructions, liveConstructions], [1, 1]);
assert.deepEqual(resolveM3HostPermission(live.live, { status: 'denied', revision: 1 }), {
  mode: 'live',
  taskPermissionGranted: false,
  permissionRevision: 1,
  showExternalPermissionNotice: true,
});

const root = new URL('../', import.meta.url);
const eas = JSON.parse(await readFile(new URL('eas.json', root), 'utf8'));
assert.equal(eas.build.production.env.EXPO_PUBLIC_M3_RUNTIME_MODE, 'off');
const layout = await readFile(new URL('app/_layout.tsx', root), 'utf8');
const gateway = await readFile(new URL('components/useM2Gateway.ts', root), 'utf8');
const flow = await readFile(new URL('components/OpeningGoalFlow.tsx', root), 'utf8');
assert.match(layout, /selectM3RuntimeAdapter\(M3_RUNTIME_MODE, 'fixture', createM3StubAdapter\)/u);
assert.match(gateway, /selectM3RuntimeAdapter\(M3_RUNTIME_MODE, 'live'/u);
assert.doesNotMatch(`${layout}\n${gateway}`, /EXPO_PUBLIC_AI_M3_ENABLED/u);
assert.match(flow, /m2\.m3Mode !== 'off'/u);

console.log('M3 runtime mode: missing/invalid/off fail closed; adapter constructions 0 PASS');
console.log('M3 runtime mode: fixture is explicit TEST_FIXTURE/ON_DEVICE PASS');
console.log('M3 runtime mode: live is EXTERNAL and denied before explicit access PASS');
console.log('M3 runtime mode: production EAS mode off and off UI hidden PASS');
console.log('M3 runtime mode provider/network calls: 0');
