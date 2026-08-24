# TODO for Google Play Publishing

Use this checklist before publishing GoLive on Google Play.

## 1. Production Identity and Signing

- [ ] Confirm the permanent Android package name. It is currently `com.golive.mobile`.
- [ ] Replace debug release signing in `android/app/build.gradle` with production signing.
- [ ] Use EAS-managed Android credentials or create a private upload keystore.
- [ ] Back up the upload keystore and credentials securely.
- [ ] Never commit keystores, passwords, or service-account credentials.
- [ ] Enroll the app in Google Play App Signing.
- [ ] Ensure every update has a higher `versionCode`.

Package names cannot be changed or reused after the first Play Console upload.

## 2. Production Configuration

- [ ] Configure production `EXPO_PUBLIC_INVITE_URL` and `EXPO_PUBLIC_SIGNALING_URL` values.
- [ ] Require HTTPS and WSS for all production endpoints.
- [ ] Disable `usesCleartextTraffic` if production does not need HTTP.
- [ ] Replace the placeholder `golive.example` app-link host with the real domain.
- [ ] Host the required `assetlinks.json` file if verified Android App Links are used.
- [ ] Confirm production builds do not expose development-client behavior.
- [ ] Test the final signed release build, not only a debug build.

## 3. Permission Audit

Review the final merged release manifest and remove every permission that is not required.

- [ ] Keep the permissions required for internet access, playback capture, and media projection.
- [ ] Confirm whether `CAMERA` is needed; remove it if GoLive remains screen-sharing only.
- [ ] Remove `SYSTEM_ALERT_WINDOW` from production unless a real user-facing feature requires it.
- [ ] Remove `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` if unused.
- [ ] Remove `BLUETOOTH` if unused.
- [ ] Review `VIBRATE`, `WAKE_LOCK`, and `MODIFY_AUDIO_SETTINGS` and retain only justified permissions.
- [ ] Verify the final bundle requests no unexpected permissions in Play Console.

`RECORD_AUDIO` is required by Android for playback capture. User-facing and Play Console text must explain that GoLive captures user-selected device playback during screen sharing, not microphone narration.

## 4. Privacy and Legal

- [ ] Publish a privacy policy at a stable public HTTPS URL.
- [ ] Add an in-app link to the privacy policy.
- [ ] Publish Terms of Use.
- [ ] Require users to accept the Terms of Use before sharing content.
- [ ] Document what signaling data is processed, retained, and deleted.
- [ ] Document handling of display names, room identifiers, invite tokens, IP addresses, and server logs.
- [ ] Explain that WebRTC media is peer-to-peer encrypted and is not stored by GoLive, if this remains accurate after a backend audit.
- [ ] Provide a contact method for privacy and deletion requests.

Do not claim that no data is collected until the mobile app, web app, signaling server, TURN service, hosting provider, and production logs have all been audited.

## 5. User-Generated Content Compliance

Shared screens and audio are user-generated content visible to other users. Google Play's UGC policy generally requires moderation safeguards.

- [ ] Define and prohibit objectionable content and behavior in the Terms of Use.
- [ ] Add in-app reporting for objectionable users or shared content.
- [ ] Add blocking for direct user interactions.
- [ ] Create a documented process for reviewing reports and taking action.
- [ ] Provide a support or abuse-reporting contact.
- [ ] Decide the intended age group and avoid targeting children unless all Families requirements are implemented.
- [ ] Answer the content-rating questionnaire accurately for live user-generated content.

## 6. Data Safety Form

- [ ] Complete a production data-flow audit before answering the form.
- [ ] Declare display names and signaling metadata accurately.
- [ ] Evaluate whether media qualifies for Google's end-to-end encryption or user-initiated sharing exceptions.
- [ ] Include collection performed by third-party SDKs, hosting services, and TURN/signaling infrastructure.
- [ ] Confirm whether all collected data is encrypted in transit.
- [ ] Document whether each data type is required, optional, or processed ephemerally.
- [ ] Keep the Data Safety form synchronized with future app and backend changes.

## 7. Foreground Service Declaration

GoLive uses the `mediaProjection` foreground-service type for user-initiated live screen streaming.

- [ ] Complete the foreground-service declaration under Play Console's App Content section.
- [ ] Explain why projection must start immediately after the user explicitly requests sharing.
- [ ] Explain that interruption stops or disrupts the live screen stream.
- [ ] Record and provide a demonstration video showing:
  - Opening the share settings.
  - Starting screen sharing.
  - Granting Android's projection consent.
  - The active sharing state and foreground notification.
  - Stopping screen sharing.

## 8. Store Listing

- [ ] App name, maximum 30 characters.
- [ ] Short description, maximum 80 characters.
- [ ] Full description, maximum 4,000 characters.
- [ ] 512 x 512 PNG store icon.
- [ ] 1024 x 500 feature graphic.
- [ ] At least two accurate phone screenshots.
- [ ] Prefer at least four 1080p screenshots for better merchandising eligibility.
- [ ] Support email address.
- [ ] Support website.
- [ ] App category and tags.
- [ ] Countries and regions for distribution.
- [ ] Free or paid app decision. A free app cannot later be converted to paid.

## 9. Play Console App Content

- [ ] Privacy policy.
- [ ] Data Safety form.
- [ ] Ads declaration.
- [ ] Target audience and content declaration.
- [ ] Content rating questionnaire.
- [ ] Foreground-service declaration.
- [ ] Reviewer access instructions.
- [ ] Export-law and developer-policy declarations.
- [ ] Confirm whether any additional permission declaration is requested after uploading the bundle.

Reviewer instructions should explain how to create or join a room, invite a second participant, start sharing with device audio, and stop sharing. Provide stable test access where necessary.

## 10. Build the Play Store Bundle

### Recommended: EAS Build

The project is already linked to EAS and the production profile automatically increments versions.

```bash
cd mobile
npx eas login
npx eas build --platform android --profile production
```

Download the resulting signed `.aab` and upload it to Play Console.

### Local Build

Configure a real release upload keystore first. The current Gradle release configuration must not continue using the debug signing key.

```bash
cd mobile/android
NODE_ENV=production ./gradlew bundleRelease
```

Expected output:

```text
mobile/android/app/build/outputs/bundle/release/app-release.aab
```

Google Play expects an Android App Bundle (`.aab`) for a new application, not the sideloading `.apk`.

## 11. Test Before Production

- [ ] Upload the first bundle to Internal Testing.
- [ ] Run the Play pre-launch report and resolve crashes, ANRs, permission issues, and accessibility findings.
- [ ] Test room creation, invite joining, reconnection, leaving, and projection revocation.
- [ ] Test device playback capture with capturable media on physical Android devices.
- [ ] Test applications that opt out of playback capture and DRM-protected content.
- [ ] Confirm microphone audio is not captured.
- [ ] Test API 29, API 34, API 36, and API 28 video-only fallback.
- [ ] Test orientation changes and immediate second sharing after stopping.
- [ ] Test slow, interrupted, IPv4-only, IPv6, mobile-data, and TURN-relayed connections.
- [ ] Verify explicit stop removes the media projection, foreground service, audio recorder, and WebRTC tracks.

Starting August 31, 2026, new apps and updates must target Android 16/API 36. This project currently targets API 36.

## 12. Personal Account Testing Requirement

For personal Play developer accounts created after November 13, 2023:

- [ ] Verify access to a non-rooted physical Android 10+ device with the Play Console mobile app.
- [ ] Run a closed test with at least 12 testers.
- [ ] Keep all 12 testers opted in continuously for at least 14 days.
- [ ] Collect and document meaningful tester feedback.
- [ ] Apply for production access and describe changes made from testing.

## 13. Recommended Publishing Order

1. Confirm the permanent package name and production domains.
2. Implement privacy, Terms of Use, reporting, and blocking requirements.
3. Audit and minimize production permissions.
4. Audit backend and SDK data handling.
5. Configure production signing and Play App Signing.
6. Build the signed `.aab`.
7. Upload to Internal Testing and run the pre-launch report.
8. Complete the store listing and all App Content declarations.
9. Run required closed testing, if applicable.
10. Submit for production review using a staged rollout.

## Official References

- [Get started with Play Console](https://support.google.com/googleplay/android-developer/answer/6112435)
- [Create and set up an app](https://support.google.com/googleplay/android-developer/answer/9859152)
- [Target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878)
- [Personal account testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Device verification requirements](https://support.google.com/googleplay/android-developer/answer/14316361)
- [Prepare an app for review](https://support.google.com/googleplay/android-developer/answer/9859455)
- [Data Safety requirements](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Foreground-service declarations](https://support.google.com/googleplay/android-developer/answer/13392821)
- [User-generated content policy](https://support.google.com/googleplay/android-developer/answer/9876937)
- [Store listing asset requirements](https://support.google.com/googleplay/android-developer/answer/9866151)
