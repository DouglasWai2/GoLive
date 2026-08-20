const { withMainActivity } = require("@expo/config-plugins");

const IMPORT_JAVA = "import com.oney.WebRTCModule.WebRTCModuleOptions;";
const IMPORT_KOTLIN = "import com.oney.WebRTCModule.WebRTCModuleOptions";

const INIT_JAVA =
  "    WebRTCModuleOptions options = WebRTCModuleOptions.getInstance();\n" +
  "    options.enableMediaProjectionService = true;";

const INIT_KOTLIN =
  "    WebRTCModuleOptions.getInstance().enableMediaProjectionService = true";

/*
 * react-native-webrtc ships a built-in foreground service for Android 14
 * (mediaProjection type) screen sharing. It only activates when the option is
 * set in MainActivity.onCreate before the WebRTC module initializes.
 *
 * Expo 57 generates a Kotlin MainActivity, so the plugin must handle both
 * Java and Kotlin syntax.
 */
module.exports = function withWebRTCMediaProjection(config) {
  return withMainActivity(config, (activity) => {
    let contents = activity.modResults.contents;

    if (!contents.includes("WebRTCModuleOptions")) {
      const isKotlin = /\.kt$/.test(activity.modResults.path ?? "");

      if (isKotlin) {
        contents = contents.replace(
          /^package [\w.]+$/m,
          (match) => `${match}\n\n${IMPORT_KOTLIN}`,
        );

        contents = contents.replace(
          /super\.onCreate\(/,
          (match) => `${INIT_KOTLIN}\n        ${match}`,
        );
      } else {
        contents = contents.replace(
          /package [\w.]+;/,
          (match) => `${match}\n\n${IMPORT_JAVA}`,
        );

        contents = contents.replace(
          /super\.onCreate\(/,
          (match) => `${INIT_JAVA}\n        ${match}`,
        );
      }

      activity.modResults.contents = contents;
    }

    return activity;
  });
};