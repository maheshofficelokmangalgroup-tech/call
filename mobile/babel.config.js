module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // Must be the last plugin: compiles Reanimated/gesture worklets that run on the UI thread.
  plugins: ['react-native-worklets/plugin'],
};
