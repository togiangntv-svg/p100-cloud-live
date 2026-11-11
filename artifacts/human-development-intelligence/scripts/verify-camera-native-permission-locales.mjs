import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { IOSConfig } = require('expo/config-plugins');
const expoConfigPluginPath = require.resolve('expo/config-plugins');
const { getResolvedLocalesAsync } = require(require.resolve(
  '@expo/config-plugins/build/utils/locales',
  { paths: [dirname(expoConfigPluginPath)] },
));
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const app = JSON.parse(await read('../app.json'));
const packageJson = JSON.parse(await read('../package.json'));
const pickerSource = await read('../components/cameraC0Picker.ts');

// iOS resolves Localizable.strings from its OS/per-app locale rules. The
// JavaScript locale selector remains responsible only for app-owned copy.
const releaseLocales = ['vi', 'en', 'zh-Hans', 'es', 'hi', 'ja', 'ko', 'ru'];
const requiredKeys = ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription'];

assert.deepEqual(
  Object.keys(IOSConfig.Locales.getLocales(app.expo)).sort(),
  [...releaseLocales].sort(),
  'Expo must receive exactly the eight native release locale resources',
);
const { localizableStringsIOS } = await getResolvedLocalesAsync(
  fileURLToPath(new URL('../', import.meta.url)),
  app.expo.locales,
  'ios',
);
assert.deepEqual(Object.keys(localizableStringsIOS).sort(), [...releaseLocales].sort(),
  'Expo must generate Localizable.strings for every release locale');

for (const locale of releaseLocales) {
  const path = app.expo.locales[locale];
  assert.equal(typeof path, 'string');
  const resource = JSON.parse(await read('../' + path.replace(/^\.\//u, '')));
  const strings = resource.ios?.['Localizable.strings'];
  assert.equal(typeof strings, 'object', locale + ' must use Expo iOS Localizable.strings');
  assert.deepEqual(localizableStringsIOS[locale], strings,
    locale + ' generated Localizable.strings must match its native resource');
  for (const key of requiredKeys) {
    assert.equal(typeof strings[key], 'string', locale + ' missing ' + key);
    assert.ok(strings[key].trim().length > 20, locale + ' must have non-empty privacy copy');
    assert.doesNotMatch(strings[key], /analysis|upload|background/iu,
      locale + ' must not claim unavailable camera behavior');
  }
}

const pickerPlugin = app.expo.plugins.find(value => Array.isArray(value)
  && value[0] === 'expo-image-picker');
assert.ok(pickerPlugin, 'existing expo-image-picker plugin must remain configured');
assert.equal(pickerPlugin[1].microphonePermission, false);
assert.equal(pickerPlugin[1].cameraPermission,
  'Allow 100 to use the camera only when you choose to take a photo for the current request.');
assert.equal(pickerPlugin[1].photosPermission,
  'Allow 100 to access a photo only when you choose one for the current request.');
assert.equal(packageJson.dependencies?.['expo-image-picker']
  ?? packageJson.devDependencies?.['expo-image-picker'], '~57.0.16');
assert.doesNotMatch(pickerSource, /requestMediaLibraryPermissionsAsync/u);

console.log('Camera C0 native permission locales: 8/8 PASS; microphone disabled; no broad library permission; provider/network calls = 0.');
