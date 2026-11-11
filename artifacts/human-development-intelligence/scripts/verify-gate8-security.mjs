import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  buildDecisionBundle,
  classifyHighStakesText,
  failClosedState,
  hydrateState,
  initialState,
  MAX_CORRECTION_LENGTH,
  reduceGate7State,
  serializeState,
} from '../domain/gate7.ts';

const require = createRequire(import.meta.url);
const { getTrustedOrigin, resolveStaticPath, SECURITY_HEADERS } = require('../server/serve.js');

const envelope = (state) => JSON.stringify({ schemaVersion: 1, provenance: 'DEMO_LOCAL', state });
const invalidStates = [
  { ...initialState, todayMode: 'forced' },
  { ...initialState, episodes: -1 },
  { ...initialState, inferenceCorrection: { text: 'object' } },
  { ...initialState, inferenceCorrection: 'x'.repeat(MAX_CORRECTION_LENGTH + 1) },
  { ...initialState, calendarConnected: true, calendarRevokedAt: 1, dependentClaimStatus: 'clear' },
  { ...initialState, unknown: true },
];

for (const state of invalidStates) assert.equal(hydrateState(envelope(state)), failClosedState);
assert.equal(hydrateState('{broken'), failClosedState);
assert.deepEqual(hydrateState(null), initialState);

const revoked = reduceGate7State(initialState, { type: 'REVOKE_CALENDAR', at: 123 });
assert.deepEqual(hydrateState(serializeState(revoked)), { ...revoked, validationRun: false, validationLog: {} });

const medical = reduceGate7State(initialState, { type: 'CORRECT_INFERENCE', value: 'Tôi cần chẩn đoán bệnh và liều thuốc' });
const medicalBundle = buildDecisionBundle(medical);
assert.equal(classifyHighStakesText(medical.inferenceCorrection), 'medical');
assert.equal(medicalBundle.understanding.provenance, 'user_correction');
assert.equal(medicalBundle.recommendation, null);
assert.equal(medicalBundle.silenceReason, 'high_stakes');
assert.equal(reduceGate7State(initialState, { type: 'CORRECT_INFERENCE', value: 'x'.repeat(MAX_CORRECTION_LENGTH + 1) }), initialState);

assert.equal(resolveStaticPath('/../../package.json'), null);
assert.equal(resolveStaticPath('/%2e%2e/%2e%2e/package.json'), null);
assert.equal(resolveStaticPath('/..\\package.json'), null);
assert.ok(resolveStaticPath('/index.html'));
assert.equal(getTrustedOrigin({ headers: { host: 'good.example', 'x-forwarded-proto': 'javascript' } }), null);
assert.equal(getTrustedOrigin({ headers: { host: 'good.example', 'x-forwarded-host': '<script>' } }), null);
assert.equal(getTrustedOrigin({ headers: { host: 'good.example' } }).host, 'good.example');
assert.equal(SECURITY_HEADERS['x-content-type-options'], 'nosniff');

console.log('Gate 8 targeted security regression: PASS');