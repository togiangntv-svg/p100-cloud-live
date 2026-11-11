const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const appRoot = path.resolve(__dirname, '../..');
const workspaceRoot = path.resolve(appRoot, '../..');
const config = getDefaultConfig(__dirname);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.join(appRoot, 'node_modules'),
  path.join(workspaceRoot, 'node_modules'),
];
const provider = path.join(appRoot, 'context/InteractionContext.tsx');
const fakeClient = path.join(__dirname, 'fake-api.ts');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@workspace/api-client-react' && path.resolve(context.originModulePath) === provider) {
    return { type: 'sourceFile', filePath: fakeClient };
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
