/** Derived W01 resource: Founder adopted for LOCAL implementation/fixtures only.
 * No app/UI composition imports this capability. This is not clinical approval,
 * real-user activation, or a caller/model-supplied `approved`/`safe` flag.
 */
export const W01 = Object.freeze({
  id: 'trainer.self.walk-easy.v0_1', version: 1, mode: 'SELF', role: 'Trainer.E2',
  document_id: '100-M6-TRAINER-ACTION-SOURCE', document_version: '0.1',
  sha256: '7dc5475561637918c944d6694a9aab15a6fcb9f6a7d412ed62e4913abf68d45a',
  source_path: 'docs/100-trainer/100_M6_TRAINER_ACTION_SOURCE_v0.1_2026-09-22.md',
  status: 'DERIVED_DOMAIN_RESOURCE_NOT_NEW_CANON',
  adoption: 'LOCAL_IMPLEMENTATION_AND_FIXTURES_ONLY',
  reviewed_by: 'ChatGPT - Phong Tong chi huy 100 (AI)',
  review_method: 'PRIMARY_SOURCE_CLAIM_MAPPING_AND_DESIGN_REVIEW',
  reviewed_scope: 'W01_SOURCE_ADAPTATION_AND_LIMITATIONS_ONLY', reviewed_at: '2026-09-22',
  evidence: Object.freeze({ primary: 'E1', limits: Object.freeze(['E3', 'E4', 'E5']),
    reference_section: '100-M6-TRAINER-ACTION-SOURCE section 13.1' }),
  independent_clinical_review: 'NOT_RUN', real_user_activation: false,
  content: Object.freeze({
    title: 'Đi bộ nhẹ — dự kiến {n} phút.',
    instructions: 'Chọn lối đi trong nhà bằng phẳng, thông thoáng; đi ở nhịp chậm và dễ chịu, không cố đi nhanh. Những bước đầu cứ thong thả, cuối đoạn chậm lại. Có thể dừng bất cứ lúc nào, không phải cố đủ phút.',
    warning: 'Dừng nếu đau, choáng, hụt hơi khác thường hoặc cảm thấy không ổn. Nếu tức/nặng ngực, khó thở nghiêm trọng hoặc ngất, tìm trợ giúp khẩn cấp tại nơi bạn đang ở.',
    why: 'Đây là một bước khởi đầu ngắn trong khoảng thời gian bạn chọn; chưa phải một chương trình vận động đầy đủ.',
  }),
} as const);

declare const resourceBrand: unique symbol;
export type WalkResourceAccess = Readonly<{ [resourceBrand]: true }>;
export type WalkResourceAuthority = 'LOCAL_FIXTURE' | 'PRODUCT_CANDIDATE';
type Entry = { authority: WalkResourceAuthority; withdrawn: boolean; revision: number; listeners: Set<() => void> };
const resources = new WeakMap<object, Entry>();
const entry = (access: unknown) => typeof access === 'object' && access !== null ? resources.get(access) : undefined;

/** Trusted local composition only. Withdrawal authority is never given to UI. */
function createWalkResource(authority: WalkResourceAuthority) {
  const access = Object.freeze(Object.create(null)) as WalkResourceAccess;
  const record: Entry = { authority, withdrawn: false, revision: 1, listeners: new Set() };
  resources.set(access, record);
  return Object.freeze({ access, withdraw: () => {
    if (record.withdrawn) return;
    record.withdrawn = true; record.revision++;
    for (const notify of [...record.listeners]) { try { notify(); } catch { /* fail closed, no payload */ } }
  } });
}
/** Deterministic fixture capability. It can never authorize the product path. */
export const createLocalWalkResource = () => createWalkResource('LOCAL_FIXTURE');

/** Trusted owned-host composition seam. This is candidate authority, not
 * clinical approval or real-user activation of the W01 source itself.
 */
export const createProductCandidateWalkResource = () => createWalkResource('PRODUCT_CANDIDATE');
export function readWalkResource(access: WalkResourceAccess | undefined) {
  const record = entry(access);
  return record && !record.withdrawn
    ? Object.freeze({ ...W01, authority: record.authority, revision: record.revision }) : undefined;
}
export function observeWalkResource(access: WalkResourceAccess | undefined, listener: () => void) {
  const record = entry(access);
  record?.listeners.add(listener);
  return () => { record?.listeners.delete(listener); };
}
