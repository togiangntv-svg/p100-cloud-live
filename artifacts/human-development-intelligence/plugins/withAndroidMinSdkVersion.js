const { AndroidConfig, withGradleProperties } = require('expo/config-plugins');

module.exports = (config) =>
  withGradleProperties(config, (config) => {
    AndroidConfig.BuildProperties.updateAndroidBuildProperty(
      config.modResults,
      'android.minSdkVersion',
      '26'
    );
    return config;
  });
