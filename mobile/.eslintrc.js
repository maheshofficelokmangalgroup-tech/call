module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // `void somePromise()` is the intended way to start a fire-and-forget promise (also inside arrow bodies).
    'no-void': 'off',
    // the colour-hash helper uses an unsigned shift on purpose
    'no-bitwise': 'off',
    // dynamic paddings (safe-area insets) are clearer inline
    'react-native/no-inline-styles': 'off',
  },
};
