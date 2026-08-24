# GoLive WebRTC playback-capture patch

This patch adds a late-bound Android `MediaProjection` input to WebRTC M124's
Java audio device module. It changes only `JavaAudioDeviceModule` and
`WebRtcAudioRecord`; the native WebRTC libraries remain byte-identical to
`org.jitsi:webrtc:124.0.0`.

The sources are based on Jitsi WebRTC tag `v124.0.0`, commit
`13f5eaef79cacf4b9426166d452c139da1c1594c`.

Run `./build-aar.sh` to regenerate
`../maven/com/golive/webrtc/webrtc-android/124.0.0-golive/webrtc-android-124.0.0-golive.aar`.
The checked-in artifact SHA-256 is:

```text
4f255ec4d7f4cb3099860858d8e905477ad998505bd8c0594a104db6f0c304ea
```

The build downloads and verifies the exact upstream AAR and AndroidX
annotations jar, compiles the two patched Java files with Java 17, and replaces
their class entries in `libs/libwebrtc.jar`.
