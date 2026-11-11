# IDENTITY-03C-LOCAL-ISOLATION-03B — Development owner isolation

Status: DEVELOPMENT_ISOLATION_PASS within the deterministic store scope; UNCOMMITTED, Founder review pending. Recorded 2026-09-14. This is an implementation handoff, not new product canon or permission for the next migration.

## 1. BASELINE / ROLLBACK

Repository: `C:/Users/Administrator/Documents/ChatGPT/100/Du-an-100/ma-nguon`.
Branch: `codex/m2-adapt-01`; clean before editing.
HEAD / rollback: `1f85276823e9c984419c3fa1e4ae069cb940fbdc`.
Tag: `checkpoint-runtime-lease-test-bridge-20260914`, verified equal to HEAD.
Pre-edit raw SHA-256 of `DevelopmentContext.tsx`: `b51ec802e936998a7969a42f7371ff0f8aeb5842593f0fe81108219705fa5913`.
All 312 tracked file hashes and Git refs were recorded before editing. Only this existing tracked file changes; all 311 others remain byte-identical. Four-file patch remains unstaged/uncommitted; no new commit/tag/remote and no history operation.
Rollback, if later authorized: restore only this provider from the checkpoint and remove only the three additions in section 10 after checking for later edits. No rollback was executed. No Replit documentation merge.

## 2. DEVELOPMENT MIGRATION IMPLEMENTED

`DevelopmentContext` now consumes `createDevelopmentStore` through `useSyncExternalStore`. Public context methods/types remain compatible. The exact `AppState` consists of mode/relevance, calendar connection/revocation, correction, tradeoff, load/action/outcome, review note, episode/learning/claim/dependent-claim state and session validation flags/log. Reducer, decision-bundle builder, domain serialization/hydration and DEMO_LOCAL provenance remain unchanged in `domain/gate7.ts`.
MASTER DO-01/02/06/07/09 and the matching ARCHIVE lock scope support changing storage implementation while retaining ownership, provenance, revocation, correction and learning semantics. No locked-canon conflict found.

## 3. OWNER / GENERATION INTEGRATION

Optional `ownerSession` is only an injection point for a trusted coordinator's boundary access plus opaque issued lease. No owner is invented or derived from local IDs. A store is scoped to one access/lease pair. Every read/action/write/reset requires READY, current verified Subject/Profile scope and current generation; local content epoch additionally retires pre-reset work.
Boundary subscription retires public RAM synchronously; external snapshots are rechecked before React commits. Missing authority and LOCKED/VERIFYING/HYDRATING expose only static fail-closed defaults, no prior private Development content. Snapshot state, nested validation log and decision bundle are frozen copies.

## 4. STORAGE MIGRATION

Conceptual Development data uses the sealed allowlisted key `state`. The adapter alone constructs `@100/v2/subject/<subjectId>/profile/<profileId>/state`. No new `development` key is introduced because it is not in the sealed allowlist.
The outer envelope preserves owner/schema; its value is the unchanged Gate 7 serialized string. Provider passes the same AsyncStorage object used by Interaction so sealed queue/quarantine coordination remains shared. No direct backend access, arbitrary prefix construction, global fallback or automatic save on hydration.

## 5. HYDRATION SAFETY

Capture READY lease/scope/epoch, read only that slot, revalidate after await, then publish through `applyIfCurrent`. Late hydration is discarded after owner/generation/reset/unmount retirement. Invalid envelope owner/schema, invalid JSON, wrong non-null payload type and invalid domain schema fail closed. Unreadable data is preserved, normal writes remain locked; only an explicit permitted reset may remove it.
The sealed adapter returns `null` both for an absent key and for an envelope with `value:null`. Both mean no saved domain state to this consumer. That inherited ambiguity cannot be distinguished here without reopening the sealed contract; it does not import another owner's content. No claim of distinguishing every possible corrupt payload is made.

## 6. WRITE SAFETY

Each action captures its run; reducer output is frozen and immediately serialized/enqueued with that run's lease before observers are notified. Nested actions/resets therefore preserve write order. The sealed adapter captures the owner prefix and rechecks the lease around queued/backend work. Its stale-write cleanup affects only the captured key before releasing that namespace's queue.
Post-await status changes also require the captured run and latest persistence revision. Stale A results cannot update B RAM/status. Write errors suppress recommendations, expose only fixed sanitized messages and lock further writes. No retry, global cleanup, backend-error/personal-payload logging or AI/network call is introduced.

## 7. RESET / DELETE SAFETY

Reset immediately increments the local epoch, clears private RAM and locks actions; it queues only `removeUserState(capturedLease, 'state')` behind earlier writes, then rechecks the run before exposing initial state. Old callbacks cannot recreate state. It never clears owner namespaces, other Context keys/markers or another owner; it is not logout/account deletion.
An in-flight native removal may finish for captured A after invalidation; result is rejected, never applied to B. A failed removal is not reported as success. Existing sealed I/O quarantine can block even reset; this task does not recover by clearing unrelated keys.

## 8. LEGACY DATA STATUS

`@100-human-development-state` remains LEGACY / UNOWNED. Development never reads, imports, assigns, writes, deletes or migrates it. Tests seed a sentinel and prove it remains byte-identical. No real app storage was accessed in this task. Welcome's existing separate legacy read is unchanged and outside scope.

## 9. TEST RESULTS

Node v24.19.0, existing installed toolchain; no package installation. All final runs exited 0:

| Verification | Result |
|---|---|
| `node --experimental-strip-types ./scripts/verify-development-owner.mjs` | 38/38 PASS |
| `node --experimental-strip-types ./scripts/verify-local-isolation.mjs` | 33/33 PASS |
| `node --experimental-strip-types ./scripts/verify-interaction-owner.mjs` | 33/33 PASS |
| `node --experimental-strip-types ./scripts/verify-runtime-lease-bridge.mjs` | 18/18 PASS |
| `node --experimental-strip-types ./scripts/verify-m2.mjs` | 71 boundary checks + copy/state assertions PASS |
| `node --experimental-strip-types ./scripts/verify-a1-evidence.mjs` | 21 checks PASS; production A1 remains NOT_SUPPORTED |
| Existing `verify-opening.mjs`, `verify-welcome.mjs`, `verify-interaction.mjs`, `verify-coaching.mjs` with Node type stripping | PASS |
| Existing `verify-gate7.mjs` + unchanged `domain/gate7.ts` | 17/17 acceptance and 17/17 fault detection PASS_CANDIDATE |
| `node ./node_modules/typescript/bin/tsc -p tsconfig.json --noEmit --incremental false` | PASS |
| `git diff --check` and added-file whitespace check | PASS |

Commands are relative to the app directory. Gate 7's existing script writes verification artifacts: exact hash-verified copies of that script/domain ran in an isolated Temp mirror so tracked historical reports were not rewritten. Other listed scripts ran in the actual checkout. An initial new fixture expected unknown authority to resolve; corrected it to assert the sealed `AUTHORITY_UNAVAILABLE` rejection. No product fix was required by tests.

Coverage includes all requested A/B/generation/hydration/write/reset cases, same-Subject different Profile, corruption preservation, failures/quarantine, observer reentrancy, stale callback retention, suspended expiry, stop/start simulation, immutable snapshots and every public reducer action compared with the unchanged engine/decision/serialized output. Runtime bridge regression proves its existing Interaction scope, not a new Development bridge. No mounted React/native/browser test was performed for Development.

Expected existing warnings: Node MODULE_TYPELESS_PACKAGE_JSON and Git LF-to-CRLF normalization notice. No configuration was changed to suppress them.

## 10. FILES CHANGED

Exactly four files under `artifacts/human-development-intelligence`:

| File | Status / purpose |
|---|---|
| `context/DevelopmentContext.tsx` | Modified; provider binding, tested store, synchronous external snapshots |
| `context/development-owner/store.ts` | Added; Development ownership/persistence/lifecycle only |
| `scripts/verify-development-owner.mjs` | Added; deterministic actual-store tests |
| `context/development-owner/README.md` | Added; this handoff |

Outside the product repo: append this task's concise entry to `C:/Users/Administrator/Documents/ChatGPT/100/BAN-GIAO-100.md`; keep precheck/postcheck hashes, directive and test logs at `C:/Users/Administrator/Documents/ChatGPT/100/Bang-chung/IDENTITY-03C-LOCAL-ISOLATION-03B`. Those are evidence, not product inputs.

## 11. DEPENDENCIES CHANGED

None. Package manifests, lockfiles, Expo/EAS/iOS configuration unchanged. No new runtime library/service or background operation.

## 12. INTERACTION ISOLATION INTEGRITY

Interaction provider/store, sealed local-owner foundation and runtime bridge remain byte-identical to baseline; 33/33, 33/33 and 18/18 respective regression tests PASS. Development reset does not touch Interaction payload or deletion marker. Sealed IDENTITY-02 and iOS identity also remain byte-identical; no database/Apple/EAS operation.

## 13. M1/M2 INTEGRITY

M1/M2 source and navigation unchanged; opening/welcome and M2 deterministic regressions PASS. Existing A1 audit remains PASS for its not-ready finding; no A1 activation. No visual/device acceptance or current Replit runtime certification is claimed.

## 14. OTHER CONTEXTS INTEGRITY

Opening, Coaching, Welcome, OpeningGoalFlow, QueryClient and navigation remain unchanged by full tracked-file hash comparison. No auth/session/invite/credential binding or logout implementation.

## 15. SECURITY REVIEW

Independent read-only reviewer found no blocking race or public API/business-parity defect. Test outcomes were produced by the root writer, not inferred from review. No fake production authority, cross-owner fallback, secret access, migrations, database records or deployment. This proves the scoped lifecycle boundary, not encryption or full-account isolation.

## 16. LIMITATIONS

- Current navigation supplies no Development owner lease. Development now remains LOCKED (`hydrated=false`), with actions/reset disabled until future trusted session integration. This affects its existing consumer controls; no production unlock was fabricated.
- Understand keeps its own component-local correction draft. Retained consumer snapshots/drafts are not erased by this store; a later authorized owner-aware UI lifecycle/remount must address them. No all-UI no-flash claim.
- Welcome still reads the global legacy key for launch decisions. Privacy's aggregate reset still includes other unchanged Contexts. Neither whole-app legacy isolation nor whole privacy-reset isolation is certified here.
- No mounted React or native smoke. Stop/start tests simulate store lifecycle, not full React Strict Mode. Existing runtime test bridge remains Interaction-only.
- Sealed nullable-read ambiguity and quarantine recovery constraints remain as described in sections 5/7. No offline/production identity or persistence encryption guarantee was added.

## 17. NEXT ENGINEERING TASK

Founder reviews this four-file patch and its LOCKED integration consequence. STOP. Do not commit, seal, migrate another Context, wire production auth or sync Replit without a subsequent directive.

## 18. VERDICT

A. DEVELOPMENT_ISOLATION_PASS — deterministic scope only; patch UNCOMMITTED, Founder review pending.
