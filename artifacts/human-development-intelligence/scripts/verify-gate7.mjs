import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runAcceptanceSuite } from '../domain/gate7.ts';

const suite = runAcceptanceSuite();
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(root, 'verification');
await mkdir(outputDir, { recursive: true });

const baselinePassed = suite.results.filter((result) => result.pass).length;
const faultsDetected = suite.faultDetection.filter((result) => result.detected).length;
const status = suite.passCandidate ? 'PASS_CANDIDATE' : 'FAIL';
const timestamp = new Date().toISOString();

const rows = suite.results.map((result) => {
  const fault = suite.faultDetection.find((item) => item.testId === result.id);
  return `| ${result.id} | ${result.blocking ? 'Blocking' : 'Non-blocking'} | ${result.pass ? 'PASS' : 'FAIL'} | ${fault?.detected ? 'PASS' : 'FAIL'} | ${result.detail} |`;
}).join('\n');

const markdown = `# Gate 7 Functional Verification

- Status: **${status}**
- Executed: ${timestamp}
- Acceptance: ${baselinePassed}/${suite.results.length} PASS
- Fault detection: ${faultsDetected}/${suite.faultDetection.length} PASS
- Runtime: shared Gate 7 state engine used by the Expo app

| Test | Class | Acceptance | Fault detection | Evidence |
| --- | --- | --- | --- | --- |
${rows}

## Fixes applied before regression

- Replaced self-asserting fixtures with assertions against the app's shared state engine.
- Removed unconditional Prototype Lab 17/17 PASS rendering.
- Made recommendation, user decision, and user action separate typed objects.
- Made correction rebuild future understanding and recommendation.
- Made Calendar revocation remove Calendar from future Decision Bundles and flag dependent claims for review.
- Enforced the three-episode threshold before creating a versioned learning claim.
- Added shared persistence serialization/hydration with session-only validation logs.

## Retest result

${suite.passCandidate
  ? 'All blocking acceptance checks and all intentional fault-detection checks passed after restoration.'
  : 'At least one blocking acceptance or fault-detection check failed. Gate 7 remains FAIL.'}
`;

await writeFile(join(outputDir, 'gate7-functional-verification.json'), JSON.stringify({ timestamp, status, ...suite }, null, 2));
await writeFile(join(outputDir, 'gate7-functional-verification.md'), markdown);

for (const result of suite.results) {
  const fault = suite.faultDetection.find((item) => item.testId === result.id);
  console.log(`${result.id} ${result.blocking ? 'BLOCKING' : 'NON_BLOCKING'} acceptance=${result.pass ? 'PASS' : 'FAIL'} faultDetection=${fault?.detected ? 'PASS' : 'FAIL'}`);
}
console.log(`Gate7 ${status} acceptance=${baselinePassed}/${suite.results.length} faultDetection=${faultsDetected}/${suite.faultDetection.length}`);
if (!suite.passCandidate) process.exitCode = 1;