# M4 — Minimum sufficient context / Vertical Slice 01

Scope: deterministic contract and SessionTask seam only. Live M4, device/user
acceptance, Meal Vision and M5/M6 are NOT_RUN. No UI is wired by this change.

## Authority and base

Founder instruction: M4 Vertical Slice 01, 2026-09-16. The seven M4 laws and
user state != user intent apply. This implements the approved narrow slice,
not a new product canon. Source alignment: 7M v0.3 sections 6.3–7.4;
MASTER minimum-context/revocation rules; Trainer v0.2 Context + Memory.
The four approved coordination directions are preserved:
sufficient -> CONTEXT_SUFFICIENT; missing important context -> CONTEXT_REQUIRED
or PERMISSION_REQUIRED; no further asking -> CONTEXT_DECLINED or defer;
beyond scope -> PROFESSIONAL_HANDOFF_NEEDED or existing M3 safety/STOP path.

Base/rollback: 3447dba9a60acd482abe4a05e6ce1b05def92072.
Branch: codex/m4-vslice-01. The old P3.2 checkout is not part of this change.

## Current integration and limitations

The existing store owns SessionTask, revisions, M3 permission and interpretation
in RAM. M3 diagnostics/completion guards, wire/schema/instructions, Identity,
Foundation and existing M2 UI remain unchanged.
No task-bound image representation currently exists in this store.
M4 accepts only a short-lived host projection of image availability, permission
and scope; it does not add an image/context store, profile or persistence.

Use `store.assessM4(currentTaskRef, context, optionalRequirement)`.
It applies the existing TaskRef/session/view/task-revision guard, reads the current
task, and returns a fresh result without mutation, notification or an M3 call.
Edit, cancellation, M3 revocation, session stop and stale refs cannot revive a
previous sufficient result. Image permission is supplied fresh on every call.
Results must be reassessed before a later action; sufficiency is not an
execution permit or an authentication/ownership proof.

A production image/permission adapter is NOT implemented or authorized here.
Matching IDs are RAM correlation only; arbitrary client IDs or an `allowed`
field must never be accepted by a server as ownership or permission evidence.
Existing M3 text consent does not grant image use or external image processing.
The host must obtain purpose-scoped image permission from its actual authority;
this slice tests that contract with synthetic fixtures only.

The only requirement is `meal_image`. Default normalized M3 label:
`meal_image_assessment`. M3 currently leaves `task_kind` a free machine label;
no claim is made that live M3 always emits this label. The optional requirement
maps an already-understood label to this same one item. Unmapped labels defer;
there is no phrase matching or heuristic repair of intent.
No current image freshness/TTL system exists here. A stale task scope or an
image marked unusable is rejected; M4 invents no expiry duration.

## Outcomes

- CONTEXT_REQUIRED: missing only meal_image, no profile questions.
- CONTEXT_SUFFICIENT: valid current image reference; NEXT_STEP_CONTRACT_ONLY.
  No pixels read and no meal/nutrition analysis claimed.
- PERMISSION_REQUIRED: image exists but permission is denied, unknown,
  wrong-purpose or its revision no longer matches. This is not absent data.
- CONTEXT_DECLINED: explicit refusal of the required image item only; do not ask
  again. TEXT_DESCRIPTION_OPTION preserves an
  optional support path. No text collection, advice or M5 implementation.
- PROFESSIONAL_HANDOFF_NEEDED: propagates an explicit, task-scoped upstream
  `professional_required` boundary. M4 does not infer a diagnosis, choose a
  professional, or turn every missing image into an escalation. No live host
  currently supplies this new projection.
- NEED_CLARIFICATION: returns responsibility to M3 for its existing question.
  Only when asking has not stopped; M3's wire suggestion is not changed.
- DEFERRED: stale/not-ready/unsupported task, M3 safety/STOP boundary, stale
  context, unusable image or invalid context. No context question or action.
  Existing M3_BOUNDARY also respects stopped questions when intent remains
  ambiguous or the required image is absent. It does not mark intent understood.

Boundary precedence: current live TaskRef -> task/M3 readiness -> existing
M3 safety/refusal/STOP -> unresolved M3 intent -> supported task requirement ->
context scope -> explicit professional boundary -> explicit image-item refusal ->
availability -> current image permission -> usability.

Asking stopped controls questions only. Unresolved intent defers at M3_BOUNDARY
without recreating a question. An absent required image also defers at that
boundary instead of asking or inventing refusal. A present image still undergoes
all scope/revision/permission/usability checks and is reused if valid.
Refusing an unrelated question is not refusal of this image item. The explicit
image declined variant is a separate host signal. No new states or M3 semantics
were introduced by this correction.

Only opaque synthetic/host image IDs cross this contract, never bytes, base64,
file paths or URLs. Profile data and M3's unrelated context are not consulted.
The caller must keep a scoped decline for subsequent assessments; M4 intentionally
does not retain it or create a second store.

## Verification (offline)

Node 24.19.0 was already installed. No dependencies were installed.
From repository root:

```text
node artifacts/human-development-intelligence/scripts/verify-m4.mjs unit
node artifacts/human-development-intelligence/scripts/verify-m4.mjs integration
node artifacts/human-development-intelligence/scripts/verify-m3-intent.mjs
node <existing-typescript>/lib/tsc.js --project artifacts/human-development-intelligence/scripts/tsconfig.m4.json
```

Small-fix results: M4 unit 25/25 (original coverage plus cross-matrix A-I);
M4 + SessionTask/canonical-M3 integration 7/7, including actual M3 stop
normalization; targeted strict typecheck PASS. Existing M3 intent regression
12/12 is prior evidence from 913c767, not rerun: M3 and the SessionTask seam
are unchanged by this correction. Typecheck uses the already installed TypeScript
5.9.3 compiler, read-only from the old checkout's dependency directory.
The typecheck uses real generated API schema types from this canonical repo;
no type stand-ins, skipped library checks or changed product compiler settings.
The test-only Node resolver supports the repo's extensionless TS imports.
Node emits a MODULE_TYPELESS_PACKAGE_JSON performance warning; it is not a
test failure. No package module setting was changed to silence it.

Not run: full app typecheck/build, native/web/live runtime, provider/gateway
network tests, full repo suite, product acceptance. Tests use no image files,
persistent context, network/provider, production authority or real user data.

## Handoff and rollback

A separate ZIP contains the exact commit patch, changed-file snapshot/manifest,
required source/type prerequisites, test evidence, provenance and SHA256SUMS.
The package is not sent to Replit automatically. It must be applied to the exact
base (or reviewed against any newer Replit changes) and verified there; Replit
must not rebuild this slice from a prose prompt.

Small-fix rollback/reference: 913c7675cc82fdf33e4f328d8c061bb69d8c5423.
Full-slice rollback: canonical base 3447dba9a60acd482abe4a05e6ce1b05def92072.
Use a reviewed revert if needed; preserve both existing commits.
The previous 913c767 package is SUPERSEDED; use the newly verified package.
Do not reset the old P3.2 repo or rewrite shared history.
No following M5/Meal Vision/deployment step is authorized.
