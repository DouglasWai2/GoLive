const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const mobileRoot = __dirname;
const androidRoot = path.join(mobileRoot, "android");
const gradlew = path.join(
  androidRoot,
  process.platform === "win32" ? "gradlew.bat" : "gradlew",
);

const build = spawnSync(gradlew, [":app:assembleRelease"], {
  cwd: androidRoot,
  env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "production" },
  stdio: "inherit",
});

if (build.error) {
  throw build.error;
}

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const outputDirectory = path.join(
  androidRoot,
  "app",
  "build",
  "outputs",
  "apk",
  "release",
);
const metadata = JSON.parse(
  fs.readFileSync(path.join(outputDirectory, "output-metadata.json"), "utf8"),
);

if (metadata.elements.length !== 1) {
  throw new Error(`Expected one release APK, found ${metadata.elements.length}`);
}

const output = metadata.elements[0];
const source = path.join(outputDirectory, output.outputFile);
const appConfig = JSON.parse(
  fs.readFileSync(path.join(mobileRoot, "app.json"), "utf8"),
);
const appName = appConfig.expo.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
const releaseDirectory = path.join(mobileRoot, "release");
const destination = path.join(
  releaseDirectory,
  `${appName}-${output.versionName}.apk`,
);

fs.mkdirSync(releaseDirectory, { recursive: true });
fs.copyFileSync(source, destination);

console.log(`\nRelease APK: ${destination}`);
