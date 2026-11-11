# Interaction owner isolation — IDENTITY-03C-LOCAL-ISOLATION-03A

Status: IMPLEMENTED_LOCAL / UNCOMMITTED_FOR_FOUNDER_REVIEW.
Scope: InteractionContext persistence and async lifecycle only.

## Baseline and rollback

- HEAD: a892d4d0f05e374eb4eca78c49f83252bb4be381
- Tag: checkpoint-local-isolation-foundation-20260914
- Branch: codex/m2-adapt-01; working tree was clean.
- InteractionContext.tsx before edit, SHA-256:
  A2C5EF8265783B25C502B955D1B9C8FFE31B307ADA75EAC37CE9340EAE0CC3FD
- Rollback, only after review: restore that one tracked file from the checkpoint
  and remove only this slice's three new files (store.ts, this README, verification script).
  Do not reset the repository or remove other work. No rollback was executed.

## Implementation and integration contract

InteractionContext uses the actual lifecycle in store.ts via useSyncExternalStore.
The store is separate from React so race tests exercise production lifecycle code
without mocking a second implementation or installing a renderer.

A future trusted session coordinator must supply ownerSession = { access, lease }
to InteractionProvider, using the sealed boundary's real lease. It must invalidate
the old boundary generation before switching owners and provide the new lease.
The store never accepts subject/profile strings as authentication. It does not
run a verifier or construct a production session.

The current app/_layout.tsx supplies no lease and remains unchanged. Therefore
Interaction remains LOCKED with hydrated=false, no personal content, no storage
access and no AI calls. TodayScreen currently gates NaturalInteractionExperience
on interaction.hydrated, so that surface is unavailable until trusted integration
is reviewed and implemented. This is an intentional fail-closed consequence,
not proof that the current app has a working authenticated Interaction flow.
No fake/default owner is supplied to bypass it.

Only READY plus a valid lease starts Interaction hydration. Boundary HYDRATING
does not authorize this consumer to hydrate. A store captures owner, generation,
lease and a local lifecycle epoch. Boundary notifications synchronously replace
its private snapshot with empty state. getSnapshot also checks expiry in case
timers were suspended. stop/start retires callbacks; changing the provider lease
creates a fresh store. Old action closures fail closed.

## Storage and asynchronous safety

- Only sealed readUserState/writeUserState/removeUserState APIs are used.
- Keys: interaction and interaction-deleted-at in the captured owner's namespace.
- Adapter envelope validation is followed by existing domain payload validation.
- Unreadable content is preserved, private state stays empty, writes/AI are locked.
- Pending request, request sequence and gateway availability are session-only and
  are not restored as active work. Existing history/consent stays owner-specific.
- All AI completion, error, consent, busy/finally and persistence callbacks check
  the captured lifecycle. RequestId/sequence domain reducers remain unchanged.
- AbortSignal is passed through the existing client; guards still reject stale
  results even if cancellation is ignored. Abort is not a server-side rollback.
- New messages, goal/correction/consent changes use the existing domain reducers.
  Canceled/stale/rejected AI completions return false so old callers cannot clear
  a later session's UI draft.
- Deletion retires the local content epoch immediately, cancels pending work,
  then queues the owner marker before removing that owner's Interaction data.
  It does not invalidate authentication or clear the entire owner namespace.
  Already-issued writes precede deletion in the sealed queue; old callbacks
  cannot recreate content afterward. A new edit has a timestamp newer than the
  marker even within the same clock tick. Failed deletion stays empty/locked.
- No personal payload or authentication material is logged.

Legacy @100-human-development-interaction and its -deleted-at key remain
UNOWNED. This slice does not read, import, assign, rewrite or delete them.
Locale stays device-wide. Real beta legacy cleanup needs separate review.

## Verification

From artifacts/human-development-intelligence:
- node --experimental-strip-types scripts/verify-interaction-owner.mjs — 33/33 PASS.
- node --experimental-strip-types scripts/verify-local-isolation.mjs — 33/33 PASS.
- Existing verify-interaction, verify-m2 (71 checks), verify-a1-evidence (21),
  verify-opening, verify-welcome, verify-coaching scripts — PASS.
- App TypeScript --noEmit --incremental false — PASS.
- git diff --check — PASS.

The new tests use only in-memory fake authority/storage/clock/API and controlled
promises. They exercise A/B storage and RAM, delayed hydration, AI success/error/
finally, pilot/status callbacks, consent, same-subject new generation, expiry,
fake leases, corrupt envelopes/payload/marker, legacy exclusion, deletion races,
write failures, requestId/sequence guards, synchronous invalidation and restart.
An existing Node module-type warning is informational; package.json was not changed.

## Preserved scope and limits

The sealed foundation, all domain reducers, M1/M2, IDENTITY-02, other contexts,
navigation, QueryClient, EAS/iOS identity and package/lockfiles are unchanged.
A1 production remains unsupported; passing its evidence audit does not enable it.

This is local Interaction isolation, not completed application-wide isolation.
Other contexts and UI-local drafts were not migrated. No React mounted-render,
browser or iPhone visual test was run; synchronous store invalidation and React's
external-store subscription are implemented, but zero visual flash on a native
device is not claimed as verified.

Existing AsyncStorage is not encrypted. This slice inherits the foundation's
process-local queue/quarantine and cannot promise crash-safe logout or erase
objects already retained by outside consumers. Production server authentication,
credential-to-owner binding, revocation, restart recovery and native transport
cancellation still require their own approved integration and runtime checks.

No dependencies, auth, database, Apple/EAS resources, builds or deployment.
No commit or tag. Next action: Founder review this patch, including the currently
locked Interaction surface. Do not migrate another context automatically.
