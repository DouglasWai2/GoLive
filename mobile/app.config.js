const app = require("./app.json").expo;
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const derivedIosUrlScheme = googleIosClientId
  ? `com.googleusercontent.apps.${googleIosClientId.replace(/\.apps\.googleusercontent\.com$/, "")}`
  : undefined;
const iosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME ?? derivedIosUrlScheme;

module.exports = {
  ...app,
  plugins: [
    ...app.plugins,
    ...(iosUrlScheme
      ? [["@react-native-google-signin/google-signin", { iosUrlScheme }]]
      : []),
  ],
};
