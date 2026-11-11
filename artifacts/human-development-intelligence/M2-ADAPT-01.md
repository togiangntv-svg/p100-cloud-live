# M2-ADAPT-01 — bản vá cục bộ chờ Founder review

Ngày 14/09/2026. Đã triển khai và kiểm tra phần M2 theo chỉ thị cuối của Founder. Chưa đưa bản vá lên Replit/iPhone; chưa nghiệm thu hình ảnh hay chuỗi thao tác native. Không mở phần việc tiếp theo.

## BASELINE USED

- Ứng dụng Replit: `FriendlyPuzzlingDevelopers`, ID `ec87068b-9834-4027-8871-941eb6547441`.
- Checkout thực tế `/home/runner/workspace`, nhánh `main`, sạch trước export.
- HEAD: `ed8167e86d84dbf87bad462e26dfa0d598f306c2`.
- Tag: `checkpoint-founder-approved-screens-1-2-20260913`; subject: `Lock Founder-approved screens one and two`.
- Đã đọc trực tiếp Git qua Shell trong giao diện Replit, tải archive từ đúng commit và đối chiếu SHA-256. Không lấy snapshot lịch sử làm baseline.
- Bản nhập local: `465091a4a78a738e0bf7ee527d68bd88827082b9`. Tất cả 275 Git blobs khớp nguyên byte archive. Git cũ ở đầu mối 100 và 100 HDI không bị sửa.
- Chi tiết: [baseline.json](../../../../Bang-chung/M2-ADAPT-01/baseline.json); [chỉ thị Founder nguyên bản](../../../../Bang-chung/M2-ADAPT-01/FOUNDER_DIRECTIVE.txt).

## ROLLBACK POINT

- Repo local: `Du-an-100/ma-nguon`, nhánh `codex/m2-adapt-01`.
- Tag local `baseline/replit-ed8167e` trỏ commit nhập `465091a4a78a738e0bf7ee527d68bd88827082b9`.
- [Archive gốc](../../../../Luu-tru/Baseline/100-baseline-ed8167e.zip), 23.762.212 byte, SHA-256 `591ff30264c03fba92a595c693f4fbd761d60fe60dc847b40ee8e1b16a12b074`.
- [delivery.json](../../../../Bang-chung/M2-ADAPT-01/delivery.json) ghi commit bản vá và hash patch. Có thể mở baseline ở worktree/thư mục mới để đối chiếu; không reset/clean bản có công việc chưa lưu.

## FILES CHANGED

Đường dẫn bên dưới tính từ thư mục ứng dụng chứa báo cáo này. Chỉ 3 tệp cũ bị sửa; 272 tệp gốc còn lại giữ nguyên byte.

| Tệp | Thay đổi |
|---|---|
| `components/OpeningGoalFlow.tsx` | Nhận gateway tùy chọn; thay copy/notes/input/actions của M2 trong khung hiện có; giữ fallback |
| `i18n.ts` | Đăng ký khóa M2 vào bộ dịch hiện có |
| `package.json` | Thêm lệnh `verify:m2`; không đổi dependency/lockfile |
| `domain/m2.ts` | Hợp đồng context, resolver thuần và bộ chạy action được cung cấp |
| `components/useM2Gateway.ts` | Nối resolver, input, khóa thao tác cũ và callback thực thi |
| `components/m2InputState.ts` | Nháp tạm theo chủ thể, giữ nút khi chạm và hủy cử chỉ qua ranh giới quyền/hồ sơ |
| `i18n-m2.ts` | 17 khóa, bản dịch Việt/Anh |
| `scripts/fixtures/m2.mjs` | Dữ liệu A1/B2/B4 chỉ dùng kiểm thử |
| `scripts/verify-m2.mjs` | 71 kiểm tra ranh giới và các assertion copy/state/i18n |
| `scripts/m2-preview.jsx`, `scripts/m2-preview.html` | Harness riêng dùng component thật; không đăng ký route ứng dụng |
| `M2-ADAPT-01.md` | Bàn giao này |

Ngoài repo: cập nhật mục lục/hướng dẫn ở đầu mối 100, lưu chỉ thị, baseline, log và patch tại `Bang-chung/M2-ADAPT-01`. Tám nguồn sản phẩm không đổi hash.

## ARCHITECTURE IMPLEMENTED

`OpeningGoalFlow → useM2Gateway → resolveM2View(snapshot, copy, availableActions, now)`.

Một frame M2; không tạo màn A1/B2/B4. Resolver chỉ trả view/null theo thứ tự safety/quyền → buổi tập hiện hành đã xác minh → explicit intent → profile/history → fallback. Intent chưa có nơi xử lý trả fallback; không thêm router M3. Resolver không ghi storage, gọi AI/network, điều hướng hoặc thay business state.

A1 cần profile được xác nhận mới, goal biết rõ chưa có và không có task/return context còn mơ hồ. Bốn note đúng câu chữ chỉ điền nháp; không xác nhận mục tiêu, chọn engine hay tạo kế hoạch.

B2 cần session, revision snapshot, bài hiện tại, các set đã xong, bằng chứng đúng chủ thể/còn hiệu lực và callback phù hợp. Pause và end có ID riêng. B4 cần ngữ cảnh quay lại được cung cấp rõ cùng kế hoạch hợp lệ; không có quy tắc bảy ngày hay suy hoạt động/động lực từ vắng app. Thiếu bằng chứng trả fallback; thiếu executor thì không hiện action đó.

Nháp giữ qua cập nhật nền; loại bỏ khi đổi/xóa hồ sơ hoặc qua thay đổi trạng thái quyền. Không dùng draft global cũ cho gateway có chủ thể. Khi đang gõ, ngữ cảnh đã thay đổi làm action đang giữ bị khóa; xóa nháp hoặc hoàn tất cử chỉ cho phép hiển thị ngữ cảnh mới. Nút được giữ trong lúc chạm, kể cả fallback; kiểm lại context/capability/copy trước thực thi. Chuyển hồ sơ hoặc quyền ưu tiên loại bỏ dữ liệu và hủy cử chỉ. Bộ chạy chống lặp/chồng hành động trong một context; executor nghiệp vụ vẫn phải có giao dịch/idempotency của chính nó.

## STATE CONTRACTS FOUND/MISSING

Đã thấy `InteractionState` với goal/action/history/quyền; generic coaching có pause/resume/stop; opening có draft và tín hiệu quay lại; i18n có fallback Anh. Overlay opening/M2 nằm ngoài các provider nghiệp vụ.

Chưa có adapter production chứng minh chủ thể mới, mục tiêu đã/chưa xác nhận, Trainer workout đủ bài/hiệp/đích tiếp tục, hoặc chính sách quay lại đã duyệt. Generic coaching không được dùng giả làm buổi tập Trainer. Không dùng `updatedAt` như thời điểm nghỉ app.

Vì vậy **cả A1/B2/B4 trong lát cắt này được kiểm bằng fixture**. Production không truyền gateway mới nên tiếp tục M2 hiện hành. Không thay root layout chỉ để tạo dữ liệu giả.

## TESTS RUN

Node `v24.19.0`; dependency theo frozen lockfile, không cài thêm thư viện vào manifest. Đã dựng type declaration sẵn có của `lib/api-client-react` trước typecheck; lỗi thiếu dist ban đầu đã giải quyết bằng bước build này.

Từ repo root: `pnpm install --filter '@workspace/human-development-intelligence...' --frozen-lockfile --ignore-scripts`.

Từ thư mục ứng dụng:

```text
pnpm exec tsc --build ../../lib/api-client-react/tsconfig.json
pnpm run verify:m2
pnpm run verify:opening
pnpm run verify:welcome
pnpm run verify:interaction
pnpm run verify:coaching
pnpm run typecheck
node node_modules/expo/bin/cli export:embed --entry-file scripts/m2-preview.jsx --platform web --dev true --bundle-output .m2-preview/bundle.js --assets-dest .m2-preview --max-workers 2
```

Cuối cùng kiểm `git diff --check`, đối chiếu archive/Git blobs, các đoạn M1 đóng băng, toàn bộ tệp gốc và manifest 8 nguồn. Lượt ghi log chạy các entry Node tương đương trực tiếp; [checks.log](../../../../Bang-chung/M2-ADAPT-01/checks.log) ghi câu lệnh và exit code.

## PASS/FAIL RESULTS

| Hạng mục | Kết quả |
|---|---|
| Resolver/action/input lifecycle | PASS: 71 kiểm tra ranh giới + copy/state assertions |
| i18n thực tế | PASS: 17 khóa Việt/Anh; fallback Anh trên 18 locale còn lại |
| Opening, welcome/replay, interaction, coaching | PASS |
| TypeScript toàn ứng dụng | PASS |
| Expo bundle harness web dùng component thật | PASS, chỉ xác nhận bundling |
| Baseline, vùng M1, StyleSheet, nguồn chính | PASS bằng đối chiếu byte/hash |
| Review mã độc lập | Đã sửa finding; không phải bằng chứng native runtime |
| Giao diện/trình tự Pressable trên browser | NOT_RUN: CUA lỗi khởi tạo kernel, reset không khôi phục được |
| Replit runtime mới / iPhone / Founder review | NOT_RUN / PENDING |

Không còn phép kiểm cục bộ đã chạy nào FAIL. Cảnh báo Node về module type và Metro về màu log không gây thất bại; không đổi cấu hình chung để tắt cảnh báo. [validation.json](../../../../Bang-chung/M2-ADAPT-01/validation.json) chứa kết quả máy đọc được.

## UNSUPPORTED DEPENDENCIES

Chưa có adapter dữ liệu production và executor Trainer/return-policy đủ tin cậy. Khi làm adapter trong một phần việc được duyệt, host phải cung cấp revision, chủ thể, quyền/freshness và callback ràng buộc đúng task; không truyền nguyên dữ liệu storage chưa xác thực. Callback phải xử lý transaction/idempotency và từ chối state đã thay đổi ở nơi ghi thực tế.

Nháp mới chỉ sống trong component; chưa thêm lưu bền hay di trú storage. Chỉ có bản dịch M2 mới bằng Việt/Anh; không tuyên bố đã dịch 20 ngôn ngữ. Không thêm provider, auth, sensor, database hoặc navigation framework.

## REGRESSION CHECK

272/275 tệp gốc không đổi. Trong `OpeningGoalFlow`, StyleSheet, phần render M1/settings và khối motion/transition giữ nguyên. Artwork, logo/signature, root layout, navigation, auth/provider, Reduce Motion và cơ chế replay không bị sửa. Test opening/welcome xác nhận các invariant logic cũ; chưa thay nghiệm thu thị giác/chạm trên thiết bị.

Với `m2Gateway` không được truyền, M2 giữ câu chữ/chip/draft storage hiện hành. Gateway có chủ thể dùng nháp tạm riêng và không ghi business state. Tám nguồn chính giữ nguyên SHA-256. Không push, deploy, gửi lệnh cho Replit Agent hoặc gọi provider trả phí.

## RUNTIME HANDOFF REQUIRED FOR REPLIT/IPHONE

Sau Founder review, xác minh lại Replit HEAD và dirty work trước khi nhận patch; nếu khác baseline thì dừng đối chiếu, không chép đè. [Patch và commit giao](../../../../Bang-chung/M2-ADAPT-01/delivery.json) thuộc local, chưa đồng bộ Replit.

Harness web: copy `scripts/m2-preview.html` thành `.m2-preview/index.html` sau lệnh bundle, phục vụ thư mục đó bằng server chỉ nghe `127.0.0.1`. Dùng query `?case=A1`, `?case=B2`, `?case=B4` cho fixture nội bộ; `?baseline=1&opening=1` xem fallback/opening. Các mã ca không được render vào UI. Không dùng fixture làm nguồn production. File build `.m2-preview` chỉ là output cục bộ, không đưa vào app route.

Còn cần kiểm thật trên frame hẹp/keyboard/Reduce Motion: mở lại không tự hoàn tất; draft khi đổi nền; đổi hồ sơ/xóa/quyền; chạm giữa lúc state/capability đổi; pause khác end; lỗi executor; fallback; locale đổi; M1/replay không đổi hình và nhịp. Harness hiện chỉ có build pass, chưa có visual pass. Muốn thử B2/B4 native phải dùng host fixture dành riêng cho kiểm thử, không kích hoạt giả trên bản đang dùng.

Replit còn một file export do lượt này tạo: `/home/runner/workspace/100-baseline-ed8167e.zip`. Chưa dọn được sau khi CUA lỗi; source app không bị thay. Sau khi trình duyệt hoạt động, đối chiếu hash archive rồi chỉ xóa đúng file export này và kiểm lại Git status. Bản archive được giữ trên máy ở Luu-tru/Baseline.

**STOP: chờ Founder review; không triển khai ca khác hoặc M3–M7.**
