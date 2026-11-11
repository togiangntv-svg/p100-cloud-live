import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  normalizeIosNumericTargetStrings,
  selectIosApplicationTarget,
} = require('../plugins/withIosNumericTargetStrings');
const withIosNumericTargetStrings = require('../plugins/withIosNumericTargetStrings');
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appTargetId = 'A'.repeat(24);
const configurationListId = 'B'.repeat(24);
const debugId = 'C'.repeat(24);
const releaseId = 'D'.repeat(24);

function fixture(name = 100, productName = 100, bundle = 'com.togiang.hdi100') {
  return {
    hash: {
      project: {
        archiveVersion: 1,
        classes: {},
        objectVersion: 56,
        objects: {
          PBXNativeTarget: {
            [appTargetId]: {
              isa: 'PBXNativeTarget',
              buildConfigurationList: configurationListId,
              name,
              productName,
              productReference: 'E'.repeat(24),
              productType: 'com.apple.product-type.application',
            },
            [`${appTargetId}_comment`]: '100',
          },
          XCConfigurationList: {
            [configurationListId]: {
              isa: 'XCConfigurationList',
              buildConfigurations: [{ value: debugId }, { value: releaseId }],
              defaultConfigurationName: 'Release',
            },
          },
          XCBuildConfiguration: {
            [debugId]: {
              isa: 'XCBuildConfiguration',
              buildSettings: { PRODUCT_BUNDLE_IDENTIFIER: bundle },
              name: 'Debug',
            },
            [releaseId]: {
              isa: 'XCBuildConfiguration',
              buildSettings: { PRODUCT_BUNDLE_IDENTIFIER: bundle },
              name: 'Release',
            },
          },
        },
        rootObject: 'F'.repeat(24),
      },
    },
  };
}

function expectStop(project, reason) {
  const before = structuredClone(project.hash);
  assert.throws(() => normalizeIosNumericTargetStrings(project), new RegExp(reason));
  assert.deepEqual(project.hash, before, 'failure must not mutate the project');
}

test('numeric input becomes the exact quoted writer representation without graph drift', () => {
  const project = fixture();
  const before = structuredClone(project.hash);
  assert.deepEqual(normalizeIosNumericTargetStrings(project), { changed: true, targetId: appTargetId });
  assert.equal(project.hash.project.objects.PBXNativeTarget[appTargetId].name, '"100"');
  assert.equal(project.hash.project.objects.PBXNativeTarget[appTargetId].productName, '"100"');
  before.project.objects.PBXNativeTarget[appTargetId].name = '"100"';
  before.project.objects.PBXNativeTarget[appTargetId].productName = '"100"';
  assert.deepEqual(project.hash, before, 'only two scalar fields may change');
  assert.equal(selectIosApplicationTarget(project).id, appTargetId);
});

test('already quoted values are unchanged; a second normalization is idempotent', () => {
  const project = fixture('"100"', '"100"');
  const before = structuredClone(project.hash);
  assert.equal(normalizeIosNumericTargetStrings(project).changed, false);
  assert.deepEqual(project.hash, before);
  assert.equal(normalizeIosNumericTargetStrings(project).changed, false);
});

test('bare string input is quoted exactly once, not double quoted', () => {
  const project = fixture('100', '100');
  assert.equal(normalizeIosNumericTargetStrings(project).changed, true);
  assert.equal(project.hash.project.objects.PBXNativeTarget[appTargetId].name, '"100"');
  assert.equal(normalizeIosNumericTargetStrings(project).changed, false);
  expectStop(fixture('""100""', 100), 'expected one target');
});

test('wrong name, wrong product name, or absent matching target fails before write', () => {
  expectStop(fixture('HDI100'), 'expected one target');
  expectStop(fixture(100, 'HDI100'), 'productName');
  const project = fixture();
  project.hash.project.objects.PBXNativeTarget = {};
  expectStop(project, 'expected one target');
});

test('wrong bundle in any build configuration fails before write', () => {
  expectStop(fixture(100, 100, 'com.example.wrong'), 'bundle identifier');
  const project = fixture();
  project.hash.project.objects.XCBuildConfiguration[releaseId].buildSettings.PRODUCT_BUNDLE_IDENTIFIER = 'com.example.wrong';
  expectStop(project, 'bundle identifier');
});

test('duplicate target name fails before write', () => {
  const project = fixture();
  project.hash.project.objects.PBXNativeTarget['1'.repeat(24)] = {
    ...structuredClone(project.hash.project.objects.PBXNativeTarget[appTargetId]),
  };
  expectStop(project, 'found 2');
});

test('unsupported configuration schema fails before write', () => {
  const project = fixture();
  delete project.hash.project.objects.XCConfigurationList;
  expectStop(project, 'unsupported build configuration list');
  const project2 = fixture();
  project2.hash.project.objects.XCConfigurationList[configurationListId].buildConfigurations = null;
  expectStop(project2, 'missing build configurations');
});

test('non-iOS runner exits successfully without an ios directory', () => {
  const result = spawnSync(process.execPath, [path.join(appRoot, 'scripts/ensure-ios-numeric-target.cjs')], {
    cwd: appRoot,
    env: { ...process.env, EAS_BUILD_PLATFORM: 'android' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

let lockedModules;
try {
  const expoConfigRequire = createRequire(require.resolve('expo/config-plugins'));
  const configPluginsPath = expoConfigRequire.resolve('@expo/config-plugins');
  const xcodeRequire = createRequire(configPluginsPath);
  lockedModules = {
    configPlugins: require('expo/config-plugins'),
    configPluginsPackage: expoConfigRequire('@expo/config-plugins/package.json'),
    xcode: xcodeRequire('xcode'),
    xcodePackage: xcodeRequire('xcode/package.json'),
    parser: xcodeRequire('xcode/lib/parser/pbxproj'),
  };
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

test('locked xcode writer/parser and unmodified Expo lookup agree on a synthetic project', {
  skip: lockedModules ? false : 'locked local dependency graph unavailable',
}, () => {
  const { configPlugins, configPluginsPackage, xcode, xcodePackage, parser } = lockedModules;
  assert.equal(configPluginsPackage.version, '57.0.9');
  assert.equal(xcodePackage.version, '3.0.1');

  const project = xcode.project('synthetic.pbxproj');
  project.hash = fixture().hash;
  const before = xcode.project('synthetic-before.pbxproj');
  before.hash = parser.parse(project.writeSync());
  assert.equal(typeof before.hash.project.objects.PBXNativeTarget[appTargetId].name, 'number');

  normalizeIosNumericTargetStrings(project);
  const serialized = project.writeSync();
  assert.match(serialized, /name = "100";/);
  assert.match(serialized, /productName = "100";/);
  const reparsed = xcode.project('synthetic-after.pbxproj');
  reparsed.hash = parser.parse(serialized);
  const target = reparsed.hash.project.objects.PBXNativeTarget[appTargetId];
  assert.equal(typeof target.name, 'string');
  assert.equal(typeof target.productName, 'string');
  assert.equal(target.name, '"100"');
  assert.equal(target.productName, '"100"');
  assert.equal(configPlugins.IOSConfig.Target.findNativeTargetByName(reparsed, '100')[0], appTargetId);
  assert.equal(normalizeIosNumericTargetStrings(reparsed).changed, false);
});

test('registered withXcodeProject mod invokes the shared transform in memory', {
  skip: lockedModules ? false : 'Expo config plugins unavailable',
}, async () => {
  const config = withIosNumericTargetStrings({});
  assert.equal(typeof config.mods.ios.xcodeproj, 'function');
  const project = fixture();
  const result = await config.mods.ios.xcodeproj({ modResults: project, modRequest: {} });
  assert.equal(result.modResults.hash.project.objects.PBXNativeTarget[appTargetId].name, '"100"');
  assert.equal(result.modResults.hash.project.objects.PBXNativeTarget[appTargetId].productName, '"100"');
});
