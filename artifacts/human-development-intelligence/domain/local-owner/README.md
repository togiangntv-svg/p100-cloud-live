# IDENTITY-03C-LOCAL-ISOLATION-02

Status: foundation implemented and locally checked; UNCOMMITTED / FOUNDER REVIEW.
No production import/instance has been added. Existing contexts still use global legacy
keys. This slice does NOT make the current app safe for real-user beta.

## Baseline / scope

- Branch: codex/m2-adapt-01
- HEAD: ef45dcf65ed91f64d0fd9c8be739df2477b58bed
- Rollback: checkpoint-native-ios-identity-20260914 (unchanged).
- Clean tracked working tree before implementation; all files in this slice are new.
- Authority: Founder directive LOCAL-ISOLATION-02; MASTER remains active, archive history only.
- Preserve identity/permission distinction and revocation of queued work.
- No provider/QueryClient/M1/M2/IDENTITY-02/EAS/iOS config changes.
- No packages, database, network/auth/Apple calls, native build or deployment.

## Ownership and trust

boundary.ts provides createLocalOwnerBoundary(verifier, clock). Construction belongs
to the trusted app composition root. Give consumers only access; keep control and the
verifier private to the future session coordinator. No production verifier is supplied.

OwnerVerifier.verify(signal) takes no owner IDs from UI. Its future implementation MUST
validate the app session with the server and resolve the authorized Subject/Profile
pair. Shape validation of IDs is not authentication. Locally stored IDs, route props,
provider IDs, installation IDs and EAS project identity are not owner authority.

The state machine is LOCKED -> VERIFYING -> HYDRATING -> READY.
A new verify attempt retires the prior generation before contacting the verifier.
Missing/expired/revoked/unknown results and verifier errors leave LOCKED.
invalidateCurrentSession() locks synchronously, advances generation, aborts outstanding
verification and invalidates every prior lease. Same-owner relogin also changes generation.
No state or lease is persisted.

A lease is a frozen opaque object registered in a per-boundary WeakMap. Copying/casting
IDs, cloning a lease, or using another boundary's lease cannot authorize this adapter.
getSnapshot() returns frozen metadata; requireLease() exposes only owner/generation/
validUntil to trusted adapters, never a credential.

This is a correct in-process capability boundary, NOT a sandbox against malicious JS
that controls the composition root or directly calls AsyncStorage. Server authorization
must independently enforce ownership. Test verifier/clock/backend exist only in scripts/fixtures.

## Expiry and publication

Expiry is enforced by an injected timer AND before each protected access, including
after suspended timers resume. Long timer delays are split at the platform timer limit.
The fake clock makes expiry tests deterministic. A future server-revocation signal must
call invalidateCurrentSession(); this module cannot discover remote revocation offline.

HYDRATING permits owner-bound reads; the coordinator calls finishHydration(lease) only
after necessary schema-validated data is loaded. This primitive does not count/validate
all domain hydration tasks for the coordinator. READY is not set on a timeout.

After any await and immediately before touching context/cache/UI, consumers MUST use
access.applyIfCurrent(lease, synchronousCallback). A promise result valid at resolution
does not remain authorized forever. The callback must be synchronous, return undefined
and must not schedule unguarded work. Keep existing requestId/sequence guards too.
Owner metadata is for later provider remount/query-key composition; no providers migrated.

## Storage contract

storage.ts exposes createGuardedUserStorage(access, backend). Backend is a structural
AsyncStorage-compatible subset (getItem/setItem/removeItem/getAllKeys); no real backend
is imported or instantiated here. Pass the same backend object to all adapters so their
per-namespace queues/quarantine share one coordinator.

Namespace:
@100/v2/subject/<subjectId>/profile/<profileId>/<dataKey>

Both IDs must be nonempty safe path segments (ASCII letters/digits/underscore/hyphen,
maximum 128 characters). Backend values use an envelope:
{ schemaVersion: 1, owner: { subjectId, profileId }, value: JSON }

Allowed data keys: state, opening, coaching, interaction, interaction-deleted-at,
opening-goal-draft, opening-goal-flow, welcome. Arbitrary paths and locale are rejected.
Envelope version/owner/JSON are checked on read; the later consumer still validates
its domain payload schema. Absent key returns null. Missing/invalid/stale lease throws.
No global/legacy fallback, no local authority restore, no hidden migration.

Operations:
- readUserState(lease, key)
- writeUserState(lease, key, value)
- removeUserState(lease, key)
- clearOwnerNamespace(lease)

Lease is validated at call/enqueue, execution and delivery. Writes snapshot input before
queuing. All operations are serialized within an owner namespace, across adapters
sharing that backend object. Different owners may proceed independently. Reads capture
the immutable owner key; stale results are discarded before decoding/publication.

Issued native writes cannot be cancelled. A write that completes after invalidation is
reported stale and its captured key is removed BEFORE releasing the namespace barrier.
A new same-owner write waits for this cleanup. Cleanup failure quarantines only the old
namespace. I/O-uncertain writes also quarantine. A verified explicit clear can recover it.
This is privacy-first cache containment; a failed write may lose that key's prior cache.
Removal already in flight is also confined to its captured namespace.

clearOwnerNamespace scans only its exact owner prefix, validates after enumeration and
between removals, and never clears another profile/owner, locale or legacy keys.
Errors expose fixed codes only, not raw payload/owner/token/backend exception messages.
This adapter does not encrypt storage.

Quarantine and queues are process-local. Crash-safe cleanup, persisted logout markers,
secure token deletion and cross-process/multi-runtime writers remain a later reviewed
integration. A backend operation that never settles blocks that namespace; it is not
timed out in a way that would let old native writes race a newer writer. B stays independent.
All writers must use this adapter for the barrier to hold.

The ordinary cleanup API requires a VALID lease. It is not a stale-lease logout bypass.
A later logout coordinator must define explicit restricted cleanup authority/barriers;
this slice supplies only invalidation and containment of already-issued operations.

## Legacy policy

Do not assign any unowned personal/demo blob to the first authenticated user.
Locale may remain device-wide. Actual legacy cleanup/migration requires a later reviewed
slice; none is performed here. Existing global keys remain untouched and inaccessible
to the new adapter.

## Validation and limits

Run from the app directory, with existing Node:
node --experimental-strip-types scripts/verify-local-isolation.mjs

33 deterministic tests PASS, including:
- every allowed key, Subject A/B and same Subject/different Profile isolation;
- LOCKED/VERIFYING/HYDRATING/READY and immutable metadata;
- fake/missing/foreign/old leases, same-owner relogin, stale synchronous publication;
- late verification/read/write, queued write, same-owner write cleanup barrier;
- expiry/revoke, suspended timer, failed authority, old timer after new session;
- malformed owner/schema/JSON, invalid paths, legacy/locale preservation;
- exact-owner remove/clear, multi-adapter serialization, cleanup failure/quarantine;
- restart never restores local authority, redacted errors and test-only fixture separation.

App TypeScript (existing TS 6.0.3, noEmit, incremental false): PASS.
M2: PASS (71 boundary checks plus state/copy assertions).
A1 evidence audit: PASS (21 checks); production activation remains NOT_SUPPORTED.
Opening, welcome, interaction, coaching: PASS.
Node's existing MODULE_TYPELESS_PACKAGE_JSON warning also appears in unchanged suites;
no package.json change was made to silence it.

No native UI/device test, real AsyncStorage timing, production authentication, server
revocation, full logout, QueryClient reset or crash-safe deletion was exercised.
Fake tests prove this foundation, not integrated beta readiness.

Next proposed task: bind existing local contexts/storage and QueryClient to this boundary
in one reviewed migration slice, with unresolved authority remaining LOCKED.
Do not begin that task until Founder review.
