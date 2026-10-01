/**
 * @format
 */

import 'react-native-gesture-handler';
import { AppRegistry, LogBox } from 'react-native';
import App from './App';
import { InCallRoot } from './src/InCallRoot';
import { name as appName } from './app.json';

// Reanimated notes (in development only) that the app opts out of the phone's "reduce motion" setting on purpose.
LogBox.ignoreLogs(['[Reanimated] Reduced motion setting']);

AppRegistry.registerComponent(appName, () => App);
// The call screen (InCallActivity) is a second root in the same JavaScript runtime.
AppRegistry.registerComponent('InCallRoot', () => InCallRoot);
