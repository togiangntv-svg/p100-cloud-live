import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { after, test } from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? specifier + '.ts' : specifier, context);
  },
});

let networkCalls = 0;
globalThis.fetch = () => { networkCalls += 1; throw new Error('NETWORK_FORBIDDEN_IN_PRIVACY_TEST'); };

const [{ PRIVACY_TRANSLATION_KEYS, privacyMessages }, { RELEASE_LOCALES }, { translate },
  { summarizeLocalDeleteResults }, screen] = await Promise.all([
  import('../i18n-privacy.ts'),
  import('../i18n-opening.ts'),
  import('../i18n.ts'),
  import('../domain/privacy-local-delete.ts'),
  readFile(new URL('../app/(tabs)/privacy.tsx', import.meta.url), 'utf8'),
]);

const meaningMarkers = {
  vi: [/thiết bị/u, /máy chủ/u, /AI bên ngoài/u, /cấp quyền/u],
  en: [/device/u, /server/u, /external AI/u, /allow/u],
  'zh-Hans': [/设备/u, /服务器/u, /外部 AI/u, /允许/u],
  es: [/dispositivo/u, /servidor/u, /IA externa/u, /autorizas/u],
  hi: [/डिवाइस/u, /सर्वर/u, /बाहरी AI/u, /अनुमति/u],
  ja: [/端末/u, /サーバー/u, /外部AI/u, /許可/u],
  ko: [/기기/u, /서버/u, /외부 AI/u, /허용/u],
  ru: [/устройств/u, /сервер/u, /внешнему ИИ/u, /разрешения/u],
};
const deletionBoundary = {
  vi: /không xóa tài khoản hoặc dữ liệu máy chủ/u,
  en: /do not delete the account or server data/u,
  'zh-Hans': /不会删除账户或服务器数据/u,
  es: /No eliminan la cuenta ni los datos del servidor/u,
  hi: /खाता या सर्वर डेटा नहीं हटाते/u,
  ja: /アカウントやサーバーのデータは削除されず/u,
  ko: /계정이나 서버 데이터는 삭제하지 않으며/u,
  ru: /не удаляют учётную запись или данные сервера/u,
};

test('all eight release locales have every nonblank Privacy truthfulness key', () => {
  assert.deepEqual(Object.keys(privacyMessages).sort(), [...RELEASE_LOCALES].sort());
  for (const locale of RELEASE_LOCALES) {
    assert.deepEqual(Object.keys(privacyMessages[locale]).sort(), [...PRIVACY_TRANSLATION_KEYS].sort());
    for (const key of PRIVACY_TRANSLATION_KEYS) {
      const copy = privacyMessages[locale][key];
      assert.equal(typeof copy, 'string', `${locale}:${key}`);
      assert.ok(copy.trim(), `${locale}:${key}`);
      assert.equal(translate(locale, key), copy, `${locale}:${key}`);
      if (locale !== 'en') assert.notEqual(copy, privacyMessages.en[key], `${locale}:${key}`);
    }
  }
});

test('each locale distinguishes local device data, server session, and consented external AI', () => {
  for (const locale of RELEASE_LOCALES) {
    const summary = privacyMessages[locale].privacySummaryBody;
    for (const marker of meaningMarkers[locale]) assert.match(summary, marker, `${locale}:summary`);
    assert.notEqual(privacyMessages[locale].privacyLocalDataBody,
      privacyMessages[locale].privacyExternalAiBoundary, `${locale}:distinct boundaries`);
  }
});

test('local delete never promises account/server deletion, recall, or server export', () => {
  for (const locale of RELEASE_LOCALES) {
    const copy = privacyMessages[locale].privacyLocalDeleteBoundary;
    assert.match(copy, deletionBoundary[locale], `${locale}:local-delete boundary`);
    assert.ok(privacyMessages[locale].privacyDeleteLocalDescription.trim(), `${locale}:local description`);
    const allCopy = Object.values(privacyMessages[locale]).join(' ');
    assert.doesNotMatch(allCopy, /\bexport\b|xuất dữ liệu máy chủ|导出|exportar|निर्यात|エクスポート|내보내기|экспорт/iu,
      `${locale}:no server-export claim`);
  }
});

test('Privacy screen uses translated truthfulness keys and has no stale prototype claims', () => {
  for (const key of PRIVACY_TRANSLATION_KEYS) assert.match(screen, new RegExp(`t\\('${key}'\\)`, 'u'));
  assert.doesNotMatch(screen, /Only DEMO_LOCAL|No real-person data|Chỉ dữ liệu DEMO_LOCAL|Không có dữ liệu người thật/u);
  assert.doesNotMatch(screen, /t\('(?:demoPrivacy|demoPrivacyBody|interactionAiOffBody|dataControl|deleteDataBody|deleteDescription)'\)/u);
  assert.doesNotMatch(screen, /title=\{isEn \? 'What 100 is using'|body=\{isEn \? 'Only DEMO_LOCAL'/u);
});

test('locale switching changes presentation only', () => {
  const before = PRIVACY_TRANSLATION_KEYS.map((key) => translate('vi', key));
  const after = PRIVACY_TRANSLATION_KEYS.map((key) => translate('en', key));
  assert.notDeepEqual(after, before);
  assert.deepEqual(PRIVACY_TRANSLATION_KEYS.map((key) => translate('vi', key)), before);
  assert.equal((screen.match(/setLocale\(/gu) ?? []).length, 2);
  assert.match(screen, /onPress=\{\(\) => setLocale\('vi'\)\}/u);
  assert.match(screen, /onPress=\{\(\) => setLocale\('en'\)\}/u);
});

test('existing Identity and local-delete controls remain wired to their original owners', () => {
  assert.match(screen, /useOwnerSessionControl\(\)/u);
  assert.match(screen, /ownerSession\.signIn\(\)/u);
  assert.match(screen, /ownerSession\.logout\(\)/u);
  assert.match(screen, /const forgetMemory = opening\.forgetMemory/u);
  assert.match(screen, /const deleteData = coaching\.deleteData/u);
  assert.match(screen, /const operations = \[resetLocalState, opening\.forgetMemory, coaching\.deleteData, interaction\.deleteData\]/u);
  assert.match(screen, /summarizeLocalDeleteResults\(results\)/u);
  assert.match(screen, /token !== deleteRunRef\.current/u);
  assert.doesNotMatch(screen, /deleteAccount|deleteServer|exportServer|revokeSentContent/u);
});

test('combined delete reports full, failed, and partial outcomes truthfully', () => {
  assert.equal(summarizeLocalDeleteResults([true, true, true, true]), 'confirmed');
  assert.equal(summarizeLocalDeleteResults([false, false, false, false]), 'failed');
  assert.equal(summarizeLocalDeleteResults([true, false, true, false]), 'partial');
});

test('Release-8 copy distinguishes verified owner, legacy quarantine, locked, unreadable and partial delete', () => {
  for (const locale of RELEASE_LOCALES) {
    for (const key of ['privacyOwnerBoundary', 'privacyLegacyBoundary', 'privacyLockedState',
      'privacyUnreadableState', 'privacyDeleteConfirmed', 'privacyDeleteFailed', 'privacyDeletePartial']) {
      assert.ok(privacyMessages[locale][key].trim(), `${locale}:${key}`);
    }
  }
});

after(() => assert.equal(networkCalls, 0, 'No provider or real network calls'));
