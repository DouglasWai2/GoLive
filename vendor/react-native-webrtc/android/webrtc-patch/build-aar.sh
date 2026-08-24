#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
ANDROID_JAR="${ANDROID_JAR:-$ANDROID_HOME/platforms/android-36/android.jar}"
OUTPUT="$SCRIPT_DIR/../maven/com/golive/webrtc/webrtc-android/124.0.0-golive/webrtc-android-124.0.0-golive.aar"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

BASE_AAR="$WORK/webrtc-124.0.0.aar"
ANNOTATIONS_JAR="$WORK/annotation-jvm-1.8.1.jar"

curl --fail --location --silent --show-error \
  "https://repo1.maven.org/maven2/org/jitsi/webrtc/124.0.0/webrtc-124.0.0.aar" \
  --output "$BASE_AAR"
curl --fail --location --silent --show-error \
  "https://dl.google.com/dl/android/maven2/androidx/annotation/annotation-jvm/1.8.1/annotation-jvm-1.8.1.jar" \
  --output "$ANNOTATIONS_JAR"

printf '%s  %s\n' \
  "653b0bf8a88f932c4e6f9f48066e6f482ff287e7a8c50be3d8dd9691e8d00743" \
  "$BASE_AAR" | sha256sum --check --status
printf '%s  %s\n' \
  "9aab326d9492800991854360ac248f493ce7f7c3183519309b78ace9e240f6f6" \
  "$ANNOTATIONS_JAR" | sha256sum --check --status

mkdir -p "$WORK/classes" "$WORK/aar/libs" "$(dirname "$OUTPUT")"
unzip -p "$BASE_AAR" libs/libwebrtc.jar > "$WORK/libwebrtc-stock.jar"
cp "$WORK/libwebrtc-stock.jar" "$WORK/libwebrtc-patched.jar"

javac \
  --release 17 \
  -g \
  -classpath "$ANDROID_JAR:$ANNOTATIONS_JAR:$WORK/libwebrtc-stock.jar" \
  -d "$WORK/classes" \
  "$SCRIPT_DIR/src/org/webrtc/audio/JavaAudioDeviceModule.java" \
  "$SCRIPT_DIR/src/org/webrtc/audio/WebRtcAudioRecord.java"

zip -q -d "$WORK/libwebrtc-patched.jar" \
  'org/webrtc/audio/JavaAudioDeviceModule*.class' \
  'org/webrtc/audio/WebRtcAudioRecord*.class'
jar \
  --update \
  --file "$WORK/libwebrtc-patched.jar" \
  --date=1981-01-01T01:01:00Z \
  -C "$WORK/classes" \
  org/webrtc/audio

cp "$WORK/libwebrtc-patched.jar" "$WORK/aar/libs/libwebrtc.jar"
touch -d '1980-02-01 00:00:00 UTC' "$WORK/aar/libs/libwebrtc.jar"
cp "$BASE_AAR" "$OUTPUT"
(
  cd "$WORK/aar"
  TZ=UTC zip -q "$OUTPUT" libs/libwebrtc.jar
)

unzip -tq "$OUTPUT"
sha256sum "$OUTPUT"
