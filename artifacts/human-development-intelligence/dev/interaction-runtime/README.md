# Runtime lease bridge — IDENTITY-03C-RUNTIME-LEASE-BRIDGE-01

Status: LOCAL_TEST_BRIDGE / UNCOMMITTED_FOR_FOUNDER_REVIEW.
This is a synthetic test harness, NOT authentication or a product login flow.

## Baseline / rollback

HEAD ff512acb8aba2bbc8eb0a2551651f37f71b4cbe2, tag
checkpoint-interaction-owner-isolation-20260914, branch codex/m2-adapt-01.
Working tree was clean. No existing tracked file was edited.
Rollback consists only of removing this slice's new files after review;
do not reset the repository or clear browser/device storage.

## Architecture and production boundary

This directory is a standalone Expo project using the already-installed parent
dependencies. Its package.json declares only entry metadata, no dependencies.
The product entry, navigation, Metro config, app.json and all sealed modules stay
unchanged. Product code imports no bridge or harness.

gate.ts checks the actual runtime __DEV__ === true AND
EXPO_PUBLIC_LOCAL_ISOLATION_TEST === 'enabled'. No caller can pass a boolean to
override that check. The bridge verifier repeats it when issuing a lease, and
selection checks it again after verification. Missing/wrong flag or release
runtime produces no lease. The harness renders only a LOCKED notice when disabled.
The fake API also checks the gate; it cannot fall back to a real provider.

bridge.ts permits only labels A and B, mapped to:
- A: test-subject-a + test-profile-a
- B: test-subject-b + test-profile-b

Other values, including arbitrary owner objects, fail closed and invalidate the
previous session. These are explicitly synthetic identities. Never enter or
seed real personal data into this harness.

Each selection invalidates the preceding generation before verification and
issues a fresh lease from the sealed boundary. A lease expires after 15 minutes.
The bridge persists nothing: no selected login, lease, auth token or authority.
On reload it starts LOCKED. Generation numbers are local to a boundary instance;
they can restart at zero, but an old lease is not valid in the new instance.

Interaction data persists through the real AsyncStorage-backed sealed adapter
in the two synthetic owner namespaces. Subject/Profile envelope metadata is
ownership metadata, not stored login proof. Global legacy keys and locale are
never touched by the bridge.

## Actual Interaction integration and fake transport

Harness.tsx mounts the unmodified InteractionProvider and calls useInteraction.
Only the isolated harness Metro resolver maps that provider's API client import
to fake-api.ts. It does not modify the provider or monkey-patch global fetch.
The normal product Metro configuration does not contain this mapping.

The fake API never imports the live client, calls fetch, loads credentials or
connects to a provider. Gateway/pilot are local stubs; respond creates controlled
promises. Its queue retains only request IDs and completion callbacks, not the
message/history body. It intentionally ignores AbortSignal so a late completion
exercises the sealed generation guard rather than depending on cancellation.

Use the SUCCESS/ERROR buttons to complete the oldest request. The pending count
is harness diagnostics across test owners; it is not private Interaction state.
No personal payload logging was added. Controls write fixed SYNTHETIC strings
rather than accepting free-text personal data.

## Run after Founder approval, with existing dependencies only

From artifacts/human-development-intelligence on Windows PowerShell:

```powershell
$env:CI='1'
$env:EXPO_NO_TYPESCRIPT_SETUP='1'
$env:EXPO_PUBLIC_LOCAL_ISOLATION_TEST='enabled'
node node_modules/expo/bin/cli start dev/interaction-runtime --port 8088 --offline
```

Open http://localhost:8088 manually. --offline is the CLI's host mode; do not
combine it with --localhost. These environment values are for the harness
process only. Do not put them into production .env or EAS profiles.

For a later separately authorized controlled Replit web test, start this
standalone project instead of the product app. From the same app directory:

```sh
CI=1 EXPO_NO_TYPESCRIPT_SETUP=1 EXPO_PUBLIC_LOCAL_ISOLATION_TEST=enabled node node_modules/expo/bin/cli start dev/interaction-runtime --port 8081 --offline
```

Expose only that chosen dev port through the existing preview mechanism and
open its web preview. Replit port/network suitability must be verified there;
no Replit configuration, sync, deployment or server was changed in this task.
Do not install packages, connect an EAS project or run a native build for this
harness. If the existing dependencies are missing, stop and report.

Without the explicit flag the test remains LOCKED. In a release bundle
__DEV__ is false, so setting the flag still cannot issue authority.

## Controlled acceptance sequence

1. Start A. Wait for hydrated=true; write a synthetic local message and capture
   the current callback.
2. Invalidate: LOCKED, hydrated=false and empty content. Start B: initially no A
   messages or consent. Write B's synthetic message. Invoke captured callback:
   accepted=false.
3. Start A again: generation differs and only A's persisted content returns.
4. Grant fake AI consent; start delayed fake AI as A. Start B, grant consent,
   start B's delayed request. Complete oldest SUCCESS. Only the queue count
   changes; B messages/consent/busy stay unchanged. Complete B to verify a
   current result is accepted.
5. Repeat with oldest ERROR: B consent stays granted and busy stays true while
   B's own request is pending.
6. Reload: LOCKED with no lease or selected owner. Manually select A or B again
   to hydrate only its own persisted synthetic data.

To reset test content, use the owner-specific delete button for each synthetic
owner. Never clear all AsyncStorage or import/delete the legacy global keys.

## Verified locally — 14/09/2026

- Runtime bridge deterministic tests: 18/18 PASS.
- Sealed Interaction tests: 33/33 PASS; local isolation foundation: 33/33 PASS.
- App TypeScript noEmit; M2 (71), A1 evidence audit (21), interaction, opening,
  welcome and coaching regressions: PASS.
- git diff --check: PASS; no tracked product changes.
- Standalone Expo web mounted the ACTUAL InteractionContext successfully.
  Observed A generation 2 -> LOCKED 3 -> B 5 -> A 7, with distinct owner content;
  captured A callback rejected in B. Both delayed A SUCCESS and ERROR left busy
  B's messages and consent unchanged. Completing B accepted its own response.
  Reload showed LOCKED, generation 0, empty Interaction and no pending fake API.
- Local Metro process and temporary browser tab stopped after verification.
  Only synthetic browser data and ignored Expo cache were produced.

Automated tests use simulated development/release globals, not a signed release
build. No iPhone/Expo Go native test, Replit runtime test or visual frame-by-frame
no-flash measurement was performed. Existing Node module-type and React Native
web deprecation warnings are informational; no dependency changes were made.

## Limits / next action

READY_FOR_CONTROLLED_REPLIT_RUNTIME means the separate harness is prepared and
local web behavior was verified; it is not Replit acceptance or permission to sync.
Production Interaction remains LOCKED without real session authority. This does
not enable A1, authenticate a person, migrate other contexts, encrypt AsyncStorage,
or provide whole-app logout/isolation. A mutable source tree cannot defend against
someone intentionally rewriting its guards; the supported unmodified release
path fails closed and product code does not include the bridge.

Founder review next. Leave uncommitted. Do not sync, deploy or start another slice.
