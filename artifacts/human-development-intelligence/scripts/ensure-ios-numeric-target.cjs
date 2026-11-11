const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomBytes } = require('node:crypto');

function run() {
  if (process.env.EAS_BUILD_PLATFORM !== 'ios') return;

  const appRoot = path.resolve(__dirname, '..');
  const { IOSConfig } = require('expo/config-plugins');
  const configPluginsRequire = createRequire(require.resolve('expo/config-plugins'));
  const xcodeRequire = createRequire(configPluginsRequire.resolve('@expo/config-plugins'));
  const xcode = xcodeRequire('xcode');
  const {
    normalizeIosNumericTargetStrings,
    selectIosApplicationTarget,
  } = require('../plugins/withIosNumericTargetStrings');

  function verify(project, expectedId) {
    const selected = selectIosApplicationTarget(project);
    if (selected.id !== expectedId ||
        selected.target.name !== '"100"' ||
        selected.target.productName !== '"100"') {
      throw new Error('iOS target identity or serialization changed');
    }
    const [foundId] = IOSConfig.Target.findNativeTargetByName(project, '100');
    if (foundId !== expectedId) throw new Error('Expo resolved an unexpected iOS target');
  }

  const project = IOSConfig.XcodeUtils.getPbxproj(appRoot);
  const { changed, targetId } = normalizeIosNumericTargetStrings(project);
  if (changed) {
    const projectPath = project.filepath;
    const temporaryPath = path.join(
      path.dirname(projectPath),
      `.${path.basename(projectPath)}.numeric-target-${process.pid}-${randomBytes(8).toString('hex')}.tmp`
    );
    try {
      fs.writeFileSync(temporaryPath, project.writeSync(), { flag: 'wx', mode: 0o600 });
      verify(xcode.project(temporaryPath).parseSync(), targetId);
      fs.renameSync(temporaryPath, projectPath);
    } finally {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }
  }

  // This must be a new parse from the saved project, not the modified in-memory object.
  verify(IOSConfig.XcodeUtils.getPbxproj(appRoot), targetId);
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(`iOS numeric target gate failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { run };
