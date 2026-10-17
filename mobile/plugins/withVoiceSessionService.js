const fs = require("node:fs/promises");
const path = require("node:path");
const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
  withMainActivity,
} = require("@expo/config-plugins");

const SERVICE_NAME = ".VoiceSessionService";
const PERMISSIONS = [
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
  "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION",
  "android.permission.FOREGROUND_SERVICE_MICROPHONE",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.RECORD_AUDIO",
];

function withVoiceSessionManifest(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest["uses-permission"] ??= [];
    const existingPermissions = new Set(
      manifest["uses-permission"].map((permission) => permission.$?.["android:name"]),
    );
    for (const permission of PERMISSIONS) {
      if (!existingPermissions.has(permission)) {
        manifest["uses-permission"].push({ $: { "android:name": permission } });
      }
    }

    const application = manifest.application?.[0];
    if (!application) throw new Error("GoLive application manifest entry is missing");
    application.service ??= [];
    const current = application.service.find(
      (service) => service.$?.["android:name"] === SERVICE_NAME,
    );
    if (current) {
      current.$["android:exported"] = "false";
      current.$["android:foregroundServiceType"] = "mediaPlayback|microphone";
    } else {
      application.service.push({
        $: {
          "android:name": SERVICE_NAME,
          "android:exported": "false",
          "android:foregroundServiceType": "mediaPlayback|microphone",
        },
      });
    }
    return mod;
  });
}

function withVoiceSessionPackage(config) {
  return withMainApplication(config, (mod) => {
    let contents = mod.modResults.contents;
    if (!contents.includes("VoiceSessionPackage()")) {
      const packageList = /(PackageList\(this\)\.packages\.apply\s*\{)/;
      if (!packageList.test(contents)) {
        throw new Error("Could not register VoiceSessionPackage in generated MainApplication");
      }
      contents = contents.replace(packageList, "$1\n          add(VoiceSessionPackage())");
    }
    mod.modResults.contents = contents;
    return mod;
  });
}

function withVoiceSessionVisibility(config) {
  return withMainActivity(config, (mod) => {
    let contents = mod.modResults.contents;
    const isKotlin = /\.kt$/.test(mod.modResults.path ?? "");
    if (!isKotlin) {
      throw new Error("GoLive VoiceSessionService requires the generated Kotlin MainActivity");
    }
    if (!contents.includes("VoiceSessionVisibility.setActivityResumed(true)")) {
      contents = contents.replace(
        /\n}\s*$/,
        "\n\n  override fun onResume() {\n    super.onResume()\n    VoiceSessionVisibility.setActivityResumed(true)\n  }\n\n  override fun onPause() {\n    VoiceSessionVisibility.setActivityResumed(false)\n    super.onPause()\n  }\n}\n",
      );
    }
    mod.modResults.contents = contents;
    return mod;
  });
}

function withVoiceSessionSources(config) {
  return withDangerousMod(config, ["android", async (mod) => {
    const sourceDirectory = path.join(__dirname, "voice-session-native");
    const packageDirectory = path.join(
      mod.modRequest.platformProjectRoot,
      "app/src/main/java/com/golive/mobile",
    );
    const resourceDirectory = path.join(
      mod.modRequest.platformProjectRoot,
      "app/src/main/res/drawable",
    );
    await fs.mkdir(packageDirectory, { recursive: true });
    await fs.mkdir(resourceDirectory, { recursive: true });
    for (const filename of [
      "VoiceSessionPackage.kt",
      "VoiceSessionVisibility.kt",
      "VoiceSessionActionQueue.kt",
      "VoiceSessionModule.kt",
      "VoiceSessionService.kt",
    ]) {
      await fs.copyFile(path.join(sourceDirectory, filename), path.join(packageDirectory, filename));
    }
    await fs.copyFile(
      path.join(sourceDirectory, "ic_voice_call.xml"),
      path.join(resourceDirectory, "ic_voice_call.xml"),
    );
    return mod;
  }]);
}

module.exports = function withVoiceSessionService(config) {
  config = withVoiceSessionManifest(config);
  config = withVoiceSessionPackage(config);
  config = withVoiceSessionVisibility(config);
  return withVoiceSessionSources(config);
};
