# Gate 7 Functional Verification

- Status: **PASS_CANDIDATE**
- Executed: 2026-09-14T02:42:57.353Z
- Acceptance: 17/17 PASS
- Fault detection: 17/17 PASS
- Runtime: shared Gate 7 state engine used by the Expo app

| Test | Class | Acceptance | Fault detection | Evidence |
| --- | --- | --- | --- | --- |
| R1 | Blocking | PASS | PASS | Goal, self-report và local episode vẫn tạo Decision Bundle. |
| R2 | Blocking | PASS | PASS | Thiếu relevance phải trả Silence, không gửi recommendation. |
| R3 | Blocking | PASS | PASS | Understanding phải là inference có thể contest. |
| R4 | Blocking | PASS | PASS | Correction phải đổi understanding và recommendation được build sau đó. |
| R5 | Blocking | PASS | PASS | Calendar phải biến mất và claim phụ thuộc phải được flag review. |
| R6 | Blocking | PASS | PASS | Lựa chọn recovery của người dùng không bị recommendation ghi đè. |
| R7 | Blocking | PASS | PASS | Reduce Load tạo Silence; Recover phục hồi recommendation. |
| R8 | Blocking | PASS | PASS | Một episode chỉ là tín hiệu, claim vẫn none và version vẫn 0. |
| R9 | Blocking | PASS | PASS | Đủ ba episode mới tạo active claim có version. |
| R10 | Blocking | PASS | PASS | Active claim phải chuyển được sang contested và retracted. |
| A1 | Blocking | PASS | PASS | Ba object có kind và identity riêng. |
| A2 | Blocking | PASS | PASS | Decision giữ cờ unaided checkpoint và user authorship. |
| A3 | Blocking | PASS | PASS | Medical/legal luôn chuyển M8/A6. |
| A4 | Blocking | PASS | PASS | High-stakes route không chẩn đoán và không quyết định thay. |
| A5 | Blocking | PASS | PASS | Core autonomy levels không chứa A4/A5. |
| A6 | Blocking | PASS | PASS | Decision Bundle và recommendation đều có provenance DEMO_LOCAL. |
| A7 | Blocking | PASS | PASS | Correction, revocation, decision và claim status sống qua hydrate; validation log là session-only. |

## Fixes applied before regression

- Replaced self-asserting fixtures with assertions against the app's shared state engine.
- Removed unconditional Prototype Lab 17/17 PASS rendering.
- Made recommendation, user decision, and user action separate typed objects.
- Made correction rebuild future understanding and recommendation.
- Made Calendar revocation remove Calendar from future Decision Bundles and flag dependent claims for review.
- Enforced the three-episode threshold before creating a versioned learning claim.
- Added shared persistence serialization/hydration with session-only validation logs.

## Retest result

All blocking acceptance checks and all intentional fault-detection checks passed after restoration.
