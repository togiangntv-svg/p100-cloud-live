import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  initialOpeningState,
  OPENING_GOAL_FLOW_VALUE,
  pathsFor,
  serializeOpening,
  hydrateOpening,
  shouldResumeOpeningGoal,
} from '../domain/opening.ts';
import {
  detectLocaleFromTag,
  getLocaleOption,
  isSupportedLocale,
  LOCALE_OPTIONS,
  OPENING_TRANSLATION_KEYS,
  openingMessages,
} from '../i18n-opening.ts';
import { m2Messages } from '../i18n-m2.ts';

const workStuck = pathsFor('work', 'stuck');
const workOverloaded = pathsFor('work', 'overloaded');
const healthReady = pathsFor('health', 'ready');
const healthDepleted = pathsFor('health', 'depleted');
const worryReady = pathsFor('worry', 'ready');

assert.deepEqual(workStuck, ['clarify', 'small_start', 'self']);
assert.deepEqual(workOverloaded, ['reduce', 'protect', 'self']);
assert.deepEqual(healthReady, ['outdoor', 'indoor', 'self']);
assert.deepEqual(healthDepleted, ['rest', 'gentle', 'self']);
assert.deepEqual(worryReady, ['name_worry', 'small_start', 'self']);
assert.notDeepEqual(workStuck, workOverloaded);

const completed = {
  ...initialOpeningState,
  status: 'completed',
  focusArea: 'health',
  need: 'ready',
  path: 'outdoor',
  weatherScenario: 'heavy_rain_run',
  healthDemoHistory: true,
  healthResponse: 'well',
  actionStatus: 'partly',
  usefulness: 'useful',
};
const reopened = hydrateOpening(serializeOpening(completed));
assert.deepEqual(reopened, completed);

const cleared = hydrateOpening(null);
assert.deepEqual(cleared, initialOpeningState);
assert.equal(cleared.focusArea, null);
assert.equal(cleared.path, null);
assert.equal(cleared.actionStatus, 'not_started');

assert.equal(shouldResumeOpeningGoal(OPENING_GOAL_FLOW_VALUE, null), true);
assert.equal(shouldResumeOpeningGoal(null, 'Khỏe hơn'), true);
assert.equal(shouldResumeOpeningGoal(null, '   '), false);

assert.equal(LOCALE_OPTIONS.length, 20);
assert.equal(new Set(LOCALE_OPTIONS.map((option) => option.id)).size, 20);
for (const option of LOCALE_OPTIONS) {
  assert.equal(isSupportedLocale(option.id), true);
  assert.equal(getLocaleOption(option.id).id, option.id);
  for (const key of OPENING_TRANSLATION_KEYS) {
    assert.equal(typeof openingMessages[option.id][key], 'string');
    assert.notEqual(openingMessages[option.id][key].trim(), '');
  }
}
assert.deepEqual(
  LOCALE_OPTIONS.filter((option) => option.direction === 'rtl').map((option) => option.id),
  ['ur', 'ar', 'fa'],
);
assert.equal(isSupportedLocale('not-a-locale'), false);
assert.equal(detectLocaleFromTag('vi-VN'), 'vi');
assert.equal(detectLocaleFromTag('en-IN'), 'en');
assert.equal(detectLocaleFromTag('hi-IN'), 'hi');
assert.equal(detectLocaleFromTag('zh-Hans-SG'), 'zh-Hans');
assert.equal(detectLocaleFromTag('zh-CN'), 'zh-Hans');
assert.equal(detectLocaleFromTag('zh-Hant-TW'), null);
assert.equal(detectLocaleFromTag('zh-TW'), null);
assert.equal(detectLocaleFromTag('ms-MY'), null);
assert.equal(detectLocaleFromTag('unknown-ZZ'), null);

const openingFlowSource = await readFile(
  new URL('../components/OpeningGoalFlow.tsx', import.meta.url),
  'utf8',
);
const exactM2Placeholders = {
  vi: 'Nói với 100 theo cách của bạn…',
  en: 'Tell 100 in your own words…',
  'zh-Hans': '用你自己的话告诉100……',
  es: 'Cuéntaselo a 100 con tus propias palabras…',
  hi: '100 को अपने शब्दों में बताइए…',
  ja: 'あなたの言葉で100に教えてください…',
  ko: '자신의 말로 100에게 알려 주세요…',
  ru: 'Расскажите 100 своими словами…',
};
for (const [locale, placeholder] of Object.entries(exactM2Placeholders)) {
  assert.equal(m2Messages[locale].m2Placeholder, placeholder);
}
assert.match(openingFlowSource, /!inputValue && <View[\s\S]*?pointerEvents="none"[\s\S]*?importantForAccessibility="no-hide-descendants"/u);
const placeholderPresentation = openingFlowSource.match(/testID="opening-goal-placeholder"([\s\S]*?)<\/Text>/u)?.[1];
assert.ok(placeholderPresentation?.includes('{placeholder}'));
assert.doesNotMatch(placeholderPresentation, /numberOfLines|adjustsFontSizeToFit|minimumFontScale/u);
assert.match(openingFlowSource, /placeholderTextColor="transparent"[\s\S]*?accessibilityLabel=\{question\}/u);
assert.match(openingFlowSource, /goalPlaceholder: \{ paddingVertical: 14, fontSize: 17, lineHeight: 24 \}/u);
assert.match(openingFlowSource, /goalInputEmpty: \{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 \}/u);
assert.match(openingFlowSource, /height: inputValue \? Math\.min\([\s\S]*?\) : undefined/u);
const animatedSignatureSource = await readFile(
  new URL('../components/Animated100Signature.tsx', import.meta.url),
  'utf8',
);
const sharedUiSource = await readFile(
  new URL('../components/UI.tsx', import.meta.url),
  'utf8',
);
assert.equal(openingFlowSource.includes('sunriseGlow'), false);
assert.equal(openingFlowSource.includes('sunriseHalo'), false);
assert.equal(openingFlowSource.includes('welcomeGoalSun'), false);
assert.equal(openingFlowSource.includes('ImageBackground'), false);
assert.equal(openingFlowSource.includes("100-v05-sunless-scene-v1.png"), true);
assert.equal(openingFlowSource.includes("100-v05-sunrise-reference-v1.png"), false);
assert.equal(openingFlowSource.includes('const sunCenterX = sceneLeft + sceneWidth * 0.58;'), true);
assert.equal(openingFlowSource.includes('const sunRidgeY = sceneTop + sceneHeight * 0.32;'), true);
assert.equal(openingFlowSource.includes('duration: reduceMotion ? 260 : 2400'), true);
assert.equal(openingFlowSource.includes('Animated.delay(reduceMotion ? 0 : 200)'), true);
assert.equal(openingFlowSource.includes('const animation = Animated.loop(Animated.sequence(['), true);
assert.equal(openingFlowSource.includes('testID="opening-tap-hint"'), false);
assert.equal(openingFlowSource.includes('outputRange: [compactLayout ? 38 : 64, 0]'), true);
assert.equal(openingFlowSource.includes('opacity: isOtherFocused ? 0.64 : 1'), true);
assert.equal(openingFlowSource.includes('disabled={phase !== \'goal\'}'), true);
assert.equal(openingFlowSource.includes("phase === 'goal' ? goalPanelReveal : 0"), true);
assert.equal(openingFlowSource.includes('if (transitionStartedRef.current) return;'), true);
assert.equal(
  openingFlowSource.includes('Animated.delay(reduceMotion ? 60 : 130)'),
  true,
);
assert.equal(animatedSignatureSource.includes('const REST_DURATION_MS = 10000;'), true);
assert.equal(animatedSignatureSource.includes('requestAnimationFrame(step)'), true);
assert.equal(animatedSignatureSource.includes('if (reduceMotion || !appActive)'), true);
assert.equal(sharedUiSource.includes('return <Animated100Signature'), true);

console.log('Opening verification: PASS');
console.log('eight exact M2 placeholders and natural-height, non-clipping presentation: PASS (source-level)');
console.log('new → focus/need → support branches → action/result persistence: PASS');
console.log('health/weather branches remain illustrative state only: PASS');
console.log('canonical goal-resume signal and local draft persistence: PASS');
console.log('20 opening/target locales, native labels, and RTL metadata: PASS');
console.log('device language-tag mapping and unsupported fallback rules: PASS');
console.log('v05 sunless runtime plate, one-sun coordinates, and scene-beat guards: PASS');
