const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaults = getDefaultConfig(__dirname);

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // Gradle/CMake output contains tens of thousands of files that JavaScript never imports. Keeping them out of
    // Metro's file crawl makes start-up (and "Failed to start watch mode" on slow PCs) much better.
    blockList: [
      ...[].concat(defaults.resolver.blockList ?? []),
      /[\\/]android[\\/](app[\\/])?build[\\/].*/,
      /[\\/]android[\\/]\.gradle[\\/].*/,
      /[\\/]\.cxx[\\/].*/,
      /[\\/]node_modules[\\/].*[\\/]android[\\/]build[\\/].*/,
      /[\\/]node_modules[\\/].*[\\/]android[\\/]\.cxx[\\/].*/,
    ],
  },
};

module.exports = mergeConfig(defaults, config);
