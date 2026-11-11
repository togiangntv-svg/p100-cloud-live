const TARGET_NAME = '100';
const BUNDLE_IDENTIFIER = 'com.togiang.hdi100';
const QUOTED_TARGET_NAME = '"100"';
const APPLICATION_PRODUCT_TYPE = 'com.apple.product-type.application';
const UUID = /^[A-F0-9]{24}$/;

function fail(reason) {
  throw new Error(`STOP_TARGET_SELECTION_AMBIGUOUS: ${reason}`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function scalarValue(value) {
  if (typeof value === 'number' && value === 100) return TARGET_NAME;
  if (typeof value !== 'string') return null;
  if (value === TARGET_NAME || value === QUOTED_TARGET_NAME) return TARGET_NAME;
  return null;
}

function unquote(value) {
  if (typeof value !== 'string') return null;
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  return value;
}

function referencedObject(section, id, isa, description) {
  if (!UUID.test(id) || !isRecord(section) || !isRecord(section[id]) || section[id].isa !== isa) {
    fail(`unsupported ${description} reference`);
  }
  return section[id];
}

function selectIosApplicationTarget(project) {
  const objects = project?.hash?.project?.objects;
  const targets = objects?.PBXNativeTarget;
  if (!isRecord(objects) || !isRecord(targets)) fail('unsupported PBXNativeTarget section');

  const matching = [];
  for (const [id, target] of Object.entries(targets)) {
    if (id.endsWith('_comment')) continue;
    if (!UUID.test(id) || !isRecord(target) || target.isa !== 'PBXNativeTarget') {
      fail('unsupported PBXNativeTarget entry');
    }
    if (scalarValue(target.name) === TARGET_NAME) matching.push([id, target]);
  }
  if (matching.length !== 1) fail(`expected one target named ${TARGET_NAME}, found ${matching.length}`);

  const [id, target] = matching[0];
  if (unquote(target.productType) !== APPLICATION_PRODUCT_TYPE) fail('target is not an application');
  if (scalarValue(target.productName) !== TARGET_NAME) fail('productName is not semantic 100');

  const configurationList = referencedObject(
    objects.XCConfigurationList,
    target.buildConfigurationList,
    'XCConfigurationList',
    'build configuration list'
  );
  if (!Array.isArray(configurationList.buildConfigurations) || configurationList.buildConfigurations.length === 0) {
    fail('missing build configurations');
  }
  const seen = new Set();
  for (const reference of configurationList.buildConfigurations) {
    const configurationId = reference?.value;
    if (seen.has(configurationId)) fail('duplicate build configuration reference');
    seen.add(configurationId);
    const configuration = referencedObject(
      objects.XCBuildConfiguration,
      configurationId,
      'XCBuildConfiguration',
      'build configuration'
    );
    if (!isRecord(configuration.buildSettings) ||
        unquote(configuration.buildSettings.PRODUCT_BUNDLE_IDENTIFIER) !== BUNDLE_IDENTIFIER) {
      fail('bundle identifier mismatch or unresolved build setting');
    }
  }
  return { id, target };
}

function normalizeIosNumericTargetStrings(project) {
  const { id, target } = selectIosApplicationTarget(project);
  const changed = target.name !== QUOTED_TARGET_NAME || target.productName !== QUOTED_TARGET_NAME;
  if (changed) {
    target.name = QUOTED_TARGET_NAME;
    target.productName = QUOTED_TARGET_NAME;
  }
  return { changed, targetId: id };
}

function withIosNumericTargetStrings(config) {
  const { withXcodeProject } = require('expo/config-plugins');
  return withXcodeProject(config, (modConfig) => {
    normalizeIosNumericTargetStrings(modConfig.modResults);
    return modConfig;
  });
}

module.exports = withIosNumericTargetStrings;
module.exports.normalizeIosNumericTargetStrings = normalizeIosNumericTargetStrings;
module.exports.selectIosApplicationTarget = selectIosApplicationTarget;
