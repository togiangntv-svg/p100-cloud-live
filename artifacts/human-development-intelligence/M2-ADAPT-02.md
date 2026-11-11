# M2-ADAPT-02 — A1 production evidence audit

Ngày 14/09/2026. Kết luận: **NOT_READY_AND_WHY**. Không có đủ căn cứ production để kích hoạt A1; không thêm adapter giả hoặc thay hành vi ứng dụng. Kết quả này nằm trong nhánh hoàn thành được Founder cho phép ở SCOPE DISCIPLINE của [chỉ thị nguyên bản](../../../../Bang-chung/M2-ADAPT-02/FOUNDER_DIRECTIVE.txt).

## 1. A1 EVIDENCE FOUND

Đã kiểm đúng nhánh `codex/m2-adapt-01`, HEAD `4b1b65e7ddf248e445610dd4cf3e67dec521a182`, working tree sạch trước khi làm. Đây là bản M2-ADAPT-01 mà chỉ thị mới gọi là already-approved, dựa trên Replit `ed8167e86d84dbf87bad462e26dfa0d598f306c2`; không cần mở Replit để lấy một baseline khác.

| Ứng viên production đã đọc | Bằng chứng thực tế | Vì sao chưa chứng minh A1 |
|---|---|---|
| `domain/welcome.ts`, `context/WelcomeContext.tsx` | `shouldShowFirstWelcome` dựa vào vắng key; lỗi đọc hoặc deadline cũng có thể mở welcome; review có runId | Là quyết định trình bày, không phải sự kiện tạo hồ sơ. runId không phải định danh người dùng |
| `domain/opening.ts`, `context/OpeningContext.tsx` | `initialOpeningState.status = new`; storage thiếu/hỏng/sai version và `startDifferentTopic()` có thể trả trạng thái này | “Luồng mới” không có nghĩa người mới với 100 |
| `domain/interaction.ts`, `context/InteractionContext.tsx` | Có trạng thái hydrate empty/ok/deleted/unreadable, tombstone, goal và lịch sử; initial state có goal null | Goal null xuất hiện trước load, khi empty, deleted, unreadable và cả lịch sử hợp lệ chưa có goal. Không có durable subject/profile ID |
| `UserGoal` / `setUserGoal` | Có text/action/authoredBy user và ngày tạo | Chưa có bằng chứng “không có mục tiêu xác nhận” có thẩm quyền gắn với một chủ thể. Giữ nguyên model này, không thêm cờ confirmed |
| `artifacts/api-server/src/routes/ai.ts` | Cookie pilot ký, hạn 30 phút; phục vụ quyền gọi AI và rate limit | Không phải tài khoản/hồ sơ 100 bền vững, không chứng minh lần đầu dùng 100; không được dùng mất cookie/network làm dấu hiệu A1 |
| `artifacts/api-server/src/ai/pilot-store.ts` | Lưu ngân sách/counter AI | Không lưu user/profile; không gọi dịch vụ này để kiểm A1 |
| `lib/db/src/schema/index.ts`, routes server, toàn bộ context/domain frontend | Schema DB chưa có model; routes chỉ health và AI; không thấy profile-created/onboarding-completed có thẩm quyền | Không có nguồn phát sự kiện mới thật để adapter tiêu thụ |
| `app/_layout.tsx` | Một OpeningGoalFlow; không truyền m2Gateway; overlay ngoài provider nghiệp vụ | M2 hiện đang dùng fallback. Di chuyển provider không tạo ra bằng chứng còn thiếu |

Các kiểm tra đã tái hiện được hai trường hợp khác nhau — người mới thật và người cũ mất cache — cho **cùng dữ liệu hydration**. Không có hàm adapter chỉ đọc các trường này nào có thể phân biệt chắc chắn hai trường hợp.

## 2. DECISION / ARCHITECTURE

Giữ nguyên runtime M2-ADAPT-01. Không thêm database, auth, mạng, ID tự tạo khi mở app, cờ first-run hay lời hỏi mới để lấp khoảng thiếu dữ liệu.

Không thêm một adapter luôn trả UNKNOWN: `M2Snapshot` và `resolveM2View(undefined, ...) -> null` đã cung cấp ranh giới/fallback đó. Một interface “profileCreated=true” không có nơi phát được xác thực sẽ chỉ đặt tên lại giả định, chưa tạo được bằng chứng.

Chỉ thêm kiểm thử chứng minh giới hạn của nguồn hiện có và báo cáo hợp đồng còn thiếu. A1 chỉ được nối khi production thật có nguồn phát hợp lệ; lát cắt này không tự tạo quy trình hồ sơ mới, không đồng nhất “mới với 100” và “mới tập luyện”.

## 3. FILES CHANGED

Trong repo ứng dụng chỉ thêm hai tệp:

- `scripts/verify-a1-evidence.mjs`: kiểm hydrator thật, phản ví dụ, ranh giới production bằng AST và contract/input M2 bằng fixture A1.
- `M2-ADAPT-02.md`: báo cáo này.

**Không sửa bất kỳ tệp nào trong 284 tệp đã có ở commit 4b1b65e.** Không sửa package/lockfile, UI, M2 resolver, model goal, storage, navigation hoặc nguồn sản phẩm.

Ngoài repo: chỉ thị/log/kết quả/patch ở `Bang-chung/M2-ADAPT-02`; cập nhật lối đọc README/AGENTS và nhật ký BAN-GIAO ở đầu mối 100. Chi tiết commit và patch nằm trong [delivery.json](../../../../Bang-chung/M2-ADAPT-02/delivery.json).

## 4. HOW A1 IS ACTIVATED

**Hiện chưa kích hoạt A1 trong production.** Không có dữ liệu thật đủ điều kiện; OpeningGoalFlow vẫn không nhận gateway production. Khi không có snapshot tin cậy, resolver trả null và frame dùng fallback M2 đã duyệt.

Ca dương tính chỉ dùng fixture hiện có của M2-ADAPT-01: subject new/ready, goal none, permission allowed, safety clear, không có task/return/intent chưa xử lý. Đã kiểm đúng prompt, placeholder và bốn note. Đây là kiểm hợp đồng, không chứng minh có hồ sơ thật mới được tạo.

## 5. HOW FALSE A1 IS PREVENTED

Không chuyển welcome-visible, opening-new, goal-null, missing cache, lỗi đọc, tombstone, sai version hoặc AI cookie thành `subject.profile = new`. Không tạo ID/profile/receipt trong quá trình hydrate hoặc khi dữ liệu bị xóa. M2 production tiếp tục fallback khi dữ liệu chưa biết, kể cả mạng/auth tạm mất.

Kiểm contract sẵn có từ chối profile existing/unknown, goal confirmed/unknown, trạng thái loading/error/deleted và quyền denied/unknown. Input model của M2-ADAPT-01 loại nháp khi đổi chủ thể; note không có executor và chỉ điền nháp; gõ tự do thay nháp trước đó. Những kết quả này không thay thế kiểm native/đổi hồ sơ thật, vì hiện chưa có profile-switch production.

## 6. TESTS RUN + PASS/FAIL

Node 24.19.0, dependency/lockfile đã có; không cài thêm gói.

```text
node --experimental-strip-types scripts/verify-a1-evidence.mjs
node --experimental-strip-types scripts/verify-m2.mjs
node --experimental-strip-types scripts/verify-opening.mjs
node --experimental-strip-types scripts/verify-welcome.mjs
node --experimental-strip-types scripts/verify-interaction.mjs
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
git diff --check
```

| Yêu cầu kiểm | Kết quả và giới hạn |
|---|---|
| 1. Hồ sơ mới thật, chưa có goal → A1 | Contract fixture PASS; **production NOT_SUPPORTED** vì thiếu nguồn phát hồ sơ mới |
| 2. Người cũ mất cache → không suy A1 | PASS phản ví dụ trên hydrator thật + kiểm frame production không truyền gateway |
| 3. Lỗi đọc → không suy A1 | PASS contract trạng thái error, lỗi parse/migration và kiểm wiring fallback; lỗi I/O thiết bị thật NOT_RUN |
| 4. Chưa load → không A1 | PASS contract loading; runtime mới không được nối |
| 5. Đã có goal → không A1 | PASS contract confirmed; goal hiện có round-trip nguyên dạng |
| 6. Có lịch sử nhưng thiếu goal | PASS: goal null vẫn có thể là lịch sử hợp lệ; bỏ field goal trả unreadable, không phải new |
| 7. Đổi chủ thể không rò nháp | PASS input model A→B→A; production profile switching/native NOT_SUPPORTED/NOT_RUN |
| 8. Note chỉ là draft | PASS metadata không action và input model; không thay business state |
| 9. Free text thay draft từ note | PASS input model |
| 10. M1 giữ nguyên | PASS đối chiếu byte toàn bộ mã cũ và verify-opening/verify-welcome |
| 11. Fallback giữ nguyên | PASS AST wiring, resolver undefined và toàn bộ component/hook/root layout giữ nguyên byte |

Tổng: **21 kiểm chứng A1/evidence + 71 kiểm tra ranh giới M2 PASS**; opening, welcome/replay, interaction và TypeScript PASS. Các assertion copy/state/i18n sẵn có trong verify-m2 cũng PASS. Không sửa hay phát triển B2/B4; chỉ chạy lại bộ regression đã có theo chỉ thị.

[checks.log](../../../../Bang-chung/M2-ADAPT-02/checks.log) ghi lệnh/output/exit code; [validation.json](../../../../Bang-chung/M2-ADAPT-02/validation.json) ghi hash và phạm vi. Kiểm TypeScript không chạy provider. Không chạy lại build/visual native cho bản không đổi runtime. Cảnh báo module-type của Node là cảnh báo cũ, không gây FAIL.

## 7. M1/M2 REGRESSION STATUS

284 tệp tracked của M2-ADAPT-01 khớp từng byte, gồm toàn bộ OpeningGoalFlow, root layout, resolver, input/gesture hooks, artwork, animations, settings, replay, goal model, persistence, auth/provider và navigation. 8/8 nguồn hiện hành khớp SHA-256 manifest.

Hồi quy logic PASS; không có thay đổi runtime để triển khai. Browser/iPhone/chuỗi Pressable thực tế vẫn NOT_RUN; không nâng trạng thái nghiệm thu thiết bị từ kết quả kiểm mã hoặc việc Founder dùng M2-ADAPT-01 làm baseline.

## 8. MISSING DEPENDENCIES

Thiếu ba hợp đồng có nguồn phát thật, không phải thiếu một lời nhắc AI hay một hàm chuyển đổi:

1. **Định danh hồ sơ có vòng đời rõ:** xác định đúng chủ thể đang dùng; tái sử dụng khi phù hợp; phân biệt phục hồi/đổi hồ sơ/xóa/thu hồi; không tái tạo ngầm khi cache mất.
2. **Bằng chứng tạo hồ sơ mới:** do một luồng tạo hồ sơ hợp lệ đã hoàn tất phát ra, gắn subject/revision; phân biệt lần tạo thật với load/migrate/recover. Chưa có luồng này trong mã hiện tại.
3. **Trạng thái mục tiêu có thẩm quyền theo chủ thể:** biết rõ “chưa có mục tiêu xác nhận” trong cùng revision/quyền, không suy từ local goal null. Lát cắt này không sửa confirmed-goal model.

Chưa triển khai các hợp đồng này vì sẽ phải định nghĩa thêm hành vi tạo/khôi phục hồ sơ và quyền của dữ liệu, vượt việc chuyển đổi trạng thái production đang có. Một marker local tự sinh không giải quyết được phản ví dụ người cũ mất cache. Các hợp đồng không mặc định đòi database/mạng mới; cần chốt nguồn phát và nghĩa dữ liệu trước.

## 9. ROLLBACK POINT

- Nhánh vẫn `codex/m2-adapt-01`.
- Mốc trước M2-ADAPT-02: `4b1b65e7ddf248e445610dd4cf3e67dec521a182`, tag `baseline/m2-adapt-02`.
- Mốc nhập Replit và ZIP gốc của M2-ADAPT-01 vẫn giữ nguyên.
- Commit mới chỉ chứa script audit và báo cáo; xem [delivery.json](../../../../Bang-chung/M2-ADAPT-02/delivery.json). Không reset/clean công việc khác để quay lại.

## 10. RECOMMENDATION

**NOT_READY_AND_WHY** — chưa có production-grounded new-profile evidence và trạng thái không có goal gắn đúng chủ thể. Không chuyển bản này cho Replit như một A1 adapter đã hoạt động.

Bước cần Founder review là kết luận thiếu hợp đồng và phạm vi nhỏ nhất để thiết lập nguồn phát hồ sơ đáng tin. Giữ M2-ADAPT-01 và fallback hiện tại. Không mở Replit Agent, không deploy, không làm B2/B4/M3–M7. **STOP.**
