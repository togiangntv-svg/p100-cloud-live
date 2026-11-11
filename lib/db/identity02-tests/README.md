# IDENTITY-02 — registry core và kiểm thử PostgreSQL cô lập

Phạm vi: server-only Subject/Profile registry, không route/API/UI, không auth provider, không nối A1 hoặc M2. Module chưa được import vào app/runtime hiện hành. Các tệp schema không được export vào Drizzle schema index và không được chạy bằng drizzle-kit push.

## Ranh giới authority

createInternalControlAuthority là ranh giới nội bộ dành cho adapter server đáng tin cậy/test. Chỉ adapter đã xác minh quyền kiểm soát mới được gọi issueForVerifiedControl. Capability được giữ trong WeakMap của issuer, không serialize thành token. Object có subjectId/deviceId/installId hoặc context từ issuer khác bị từ chối.

Đây chưa phải đăng nhập hoặc xác thực người dùng beta. Không expose issuer hoặc nhận controlRef từ HTTP/UI làm bằng chứng quyền truy cập. control_ref là tham chiếu kiểm soát bền vững, không là device/session/installation ID. Future credential bindings có thể trỏ tới Subject hiện có; không phải thay ID người hoặc Profile.

createPostgresIdentityRegistry nhận một pool tương thích pg và authority; không import pool có side effect của lib/db/src/index.ts. Adapter hiện chỉ chấp nhận schema identity02_test_v01. Không có default schema, không có path public hoặc fallback storage.

## Bốn bảng

- identity02_test_v01.identity02_subjects: subjectId, control_ref unique, profileId bắt buộc, ACTIVE, createdAt, revision.
- identity02_test_v01.identity02_profiles: profileId, subjectId unique, ACTIVE/INACTIVE, createdAt, revision.
- identity02_test_v01.identity02_goal_states: profileId PK/FK, state, revision, updatedAt.
- identity02_test_v01.identity02_creations: SHA-256 request key PK, subject/profile pair FK, receipt version, recordedAt.

Subject → Profile có FK deferred ngược lại và Profile → Subject có FK/unique: ở trạng thái committed không thể có Subject thiếu Profile hoặc một Subject có hai Profile. Goal state không có default NONE; thao tác tạo đầu ghi NONE rõ ràng trong transaction. Goal row bị thiếu được đọc thành UNKNOWN với revision/time null, không tự sửa hoặc tái tạo NONE.

Constraints/indexes/row types phát sinh từ các bảng qualified nằm cùng schema của bảng. Chuỗi state/status/hash có giới hạn độ dài; không có demographic, health, goal text, provider hoặc behavioral data.

## Thao tác

- createInitialSubjectProfile(context, {idempotencyKey})
- readCreationReceipt(context, {subjectId, profileId}, idempotencyKey)
- readProfile(context, {subjectId, profileId})
- readConfirmedGoalState(context, {subjectId, profileId})
- updateProfileStatus(context, pair, status, expectedRevision)
- recordConfirmedGoalState(context, pair, state, expectedRevision)

Mọi profile operation gắn đồng thời trusted control + subjectId + profileId trong SQL. Mutations còn kiểm revision; sai owner/pair/stale không trả payload của người khác. Goal-state mutation là assertion rõ ràng của authority nội bộ, chưa nối vào draft hoặc luồng confirm goal của app. DRAFT không thuộc enum và bị từ chối trước SQL.

## Atomicity và retry

Dùng duy nhất một pg client cho BEGIN ISOLATION LEVEL READ COMMITTED → Subject/Profile/goal state/request mapping → COMMIT. Request key global unique và control_ref unique giải quyết cả cùng-key retry và khác-key/cùng-control sau session mới. ID không lấy từ browser cache hoặc thiết bị.

Receipt chỉ rời repository sau COMMIT acknowledgement. COMMIT mất phản hồi trả COMMIT_OUTCOME_UNKNOWN, không tự tạo identity mới hoặc tự retry với key mới. Retry cùng control/key đọc kết quả bền vững. Connection có kết quả commit chưa rõ hoặc rollback thất bại bị loại khỏi pool.

Receipt gồm IDs, receiptVersion/receiptId, registryRevision, createdAt, confirmedGoalState=NONE, scope=INITIAL_CREATION_ONLY và commitStatus=COMMITTED. NONE trong receipt là lịch sử tạo đầu; không chứng minh trạng thái goal hiện tại. Receipt không phải credential/token/session/consent hoặc quyền bật A1.

Các lỗi registry chỉ mang code; không bọc raw driver error/SQL values/connection string vào output.

## Chốt chặn integration

Harness từ chối trước kết nối nếu không có đúng schema flag, acknowledgement development-test-only, NODE_ENV=test, đúng REPL_ID, REPLIT_DEV_DOMAIN, DATABASE_URL hiện có hoặc phát hiện deployment flag.

Sau kết nối, harness kiểm DB heliumdb, PostgreSQL16.10, không replica, schema tồn tại/khác public, USAGE/CREATE, target rỗng và không có event trigger hoạt động. Unset deployment flag một mình không chứng minh development: người chạy còn phải xác minh DATABASE_URL thuộc môi trường development bằng metadata/callback Replit trước khi chạy.

Không đổi search_path (ở bất kỳ scope nào), không tạo schema/DB, không chạy public migration, không drop/truncate/cleanup tự động. Metadata public được hash trước/sau từng nhóm và kiểm identity02 object ngoài schema; thay đổi bất ngờ → FAIL_CLOSED → STOP. Metadata bao gồm namespace, relations, columns/defaults, constraints/indexes, routines/types, triggers/rules/policies/ACLs và sequence definitions; không đọc row cá nhân.

Rerun vào schema có object bị chặn. Nếu test dừng giữa chừng, giữ trạng thái để review; không âm thầm làm rỗng rồi chạy lại.

## Lệnh kiểm local

Tại lib/db, Node24+:

    node --experimental-strip-types --test identity02-tests/unit.mjs

TypeScript:

    node ../../node_modules/typescript/bin/tsc -p tsconfig.identity02.json

Nếu local chỉ có Node types trong pnpm virtual store, truyền --typeRoots tới bộ @types/node thực sự đã cài; không cài hoặc đổi lockfile chỉ để tạo PASS. Lần kiểm local dùng @types+node@25.9.5 và Node24.19.0.

Unit tests dùng client giả để kiểm protocol/guard/fail-closed; không thay bằng chứng PostgreSQL concurrency/rollback.

## Handoff Replit — không copy vào main

Artifact identity02-core-harness.json.gz và bundle-manifest.json nằm trong Bang-chung/IDENTITY-02-RESUME ở đầu mối 100. Container gzip JSON format identity02-exact-utf8-v2 chứa 7 file: core, guard, DDL, integration, child-session, unit và carrier package.json riêng.

1. Ghi Git branch/full HEAD/porcelain và xác nhận development DB.
2. Chỉ chuyển artifact vào một thư mục mới dưới /tmp, ngoài workspace/Git. Kiểm SHA-256 container theo manifest.
3. Giải nén JSON; kiểm path không tuyệt đối/../symlink và chỉ thuộc manifest. Ghi content dưới dạng UTF-8 nguyên bytes rồi kiểm SHA-256 từng file. Không sửa bytes hoặc tự viết test thay thế.
4. Từ thư mục tạm, chạy unit script như trên. Nếu không PASS, dừng.
5. Chạy đúng harness với pg được resolve từ package đã có trong Replit:

    NODE_ENV=test node --experimental-strip-types identity02-tests/integration.mjs --schema=identity02_test_v01 --development-test-only --pg-package-json=/home/runner/workspace/lib/db/package.json

Chỉ NODE_ENV của process test được đặt; không đổi DATABASE_URL, secrets, workflow hoặc port. Không install/build app/commit/restart/deploy.

6. Giữ stdout JSON, full hashes, public before/after metadata digest, object/count summary và Git postcheck. Nếu connector timeout, thu hồi kết quả cũ, không lặp integration.
7. Giữ test schema và dữ liệu synthetic nguyên cho Founder review. Không publish; cleanup schema sẽ được Founder duyệt riêng.

Integration gồm 18 nhóm, bao phủ schema/constraints, first success, cùng-key và khác-key concurrency, precommit/mid-transaction failures, lost acknowledgement recovery, A/B read/write isolation, wrong pairing/context, UNKNOWN/NONE/DRAFT, goal removal giữ identity, missing goal row, tiến trình Node mới, cache/device boundary và orphan checks.

## Giới hạn

Chưa có real auth, API route, A1 eligibility, RLS, production migration hoặc deployment. Cần trusted control adapter thật và đánh giá quyền cấp capability trước khi expose registry. Không coi NONE lịch sử trong receipt là trạng thái goal hiện tại.

Tài liệu kỹ thuật dùng để đối chiếu: [node-postgres transactions](https://node-postgres.com/features/transactions), [PostgreSQL INSERT/ON CONFLICT](https://www.postgresql.org/docs/16/sql-insert.html), [PostgreSQL constraints](https://www.postgresql.org/docs/16/ddl-constraints.html).

