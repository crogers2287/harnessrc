# Relay for Android

A native Kotlin / Jetpack Compose client of the existing Relay gateway. This is **not a WebView or installed browser page**. Herdr and the gateway continue to own agent sessions. Android 9+ is required.

## Install

Keep Tailscale connected on the phone. Open Relay web settings → **Download Android APK**, open the download, and allow installation from that source when Android asks. The package is `pro.skinnyc.relay`, separate from the existing PWA. Its default HTTPS gateway is Fred's authenticated Tailscale endpoint; settings can change it to another HTTPS gateway origin.

The initial build uses tailnet authentication. Pairing outside the tailnet is not implemented in this client; unauthenticated requests fail closed. No pairing keys or service credentials are embedded in the APK. Android TLS certificate checks stay enabled. Cleartext is disabled in release builds. Debug tests alone allow localhost HTTP.

## Native interaction

- Native session drawer with edge swipe, search, harness filtering, saved sessions, profile/model/CWD, long-press rename/pin/archive, and confirmed turn interruption where supported.
- Native Android text editor receives clipboard and keyboard images through AndroidX `OnReceiveContentListener`. Plain text retains normal selection, IME composition, and paste behavior. Image URIs are copied while holding their temporary permission lease, bounded to 20 MB, then uploaded through the authenticated gateway. Up to 10 attachments. File/photo picker, camera intent, and Android Share → Relay are supported; sharing requires confirmation of the destination session and never sends automatically.
- Send/Steer is the default when supported. Queue remains an explicit alternative. All native actions obey gateway capability flags. Each message request gets a durable idempotency key before transmission. Ambiguous delivery is preserved and only manually retried with the same key. Closing or disconnecting the app does not stop the agent.
- Stable event IDs, live WebSocket updates, history pagination, completed-message replacement of deltas, selectable Markdown, expandable tool activity, image previews, pinch zoom, and Save through Android's document picker. Native gateway-published media stays behind session authorization.
- Structured DSH and Codex question groups, multiple choices, free text and approvals respond to their exact native interaction. Expired/uncertain interactions cannot be submitted. Model and permission changes use gateway APIs and explicit permission-change confirmation.
- Session creation uses the gateway launch catalog, including DSH agent presets, model selection, custom models where enabled, and Fred folder browsing.
- Native microphone recording (AAC/MP4, up to 180 seconds) shows a live input meter, stop and cancel. The gateway uses Gary's existing speech service and cleanup service; cleaned text is appended to the current draft and never submitted automatically. Failure retains the recording for explicit retry until cancel/session change; successful recordings are deleted. Leaving the app stops microphone capture. Original transcription is available for review.
- System theme, 48dp targets, native keyboard insets, hidden header while typing, font scaling, and first Back opening the session drawer. No web history trick is involved.

## Build

Requires JDK 21, Android SDK platform 36, build tools, and accepted SDK licenses:

```sh
apps/android/gradlew -p apps/android testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest
python3 scripts/build-android.py --publish ~/.local/state/relay
```

`local.properties` can supply `sdk.dir`; it is ignored by Git. The Gradle wrapper is checked in. Versions are pinned to the locally validated toolchain. Dependencies are AndroidX/Compose (Apache-2.0), OkHttp (Apache-2.0), Coil (Apache-2.0), Markwon/CommonMark (Apache-2.0/BSD-2-Clause), and Kotlin/coroutines (Apache-2.0). No Claude or ChatGPT assets/code were copied.

The release script creates a private signing key once under `~/.local/share/relay/android-signing` with restricted permissions. **Back up that directory securely**: Android requires the same signing key for future app updates. No keys or passwords are committed or embedded in CI. CI produces a debug APK; privately signed release APKs are built on Fred. Increment `versionCode` and `versionName` for subsequent published releases.

The gateway serves operator-published files under `/api/android` (metadata/checksum) and `/api/android/apk` (download), both authenticated. No client-provided filesystem paths are accepted.

## Validation and limits

Unit tests cover event replay, stream completion, native capability gating, question-envelope presentation, and request identity. Android instrumentation tests exercise the actual input connection, rich-content MIME advertisement, keyboard `commitContent`, long-press clipboard paste, native recording into an editable draft, Back navigation, Send/Steer routing, and activity recreation. Speech service output is mocked in deterministic instrumentation tests; live speech service verification is separate.

Run instrumentation on an emulator or test phone after installing both debug APKs:

```sh
adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
adb install -r apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w pro.skinnyc.relay.test/androidx.test.runner.AndroidJUnitRunner
```

The instrumentation APK clears **only this app's local test data**; do not run it on your daily installation. Test content is isolated from real agents.

Still requires a physical-phone pass for the user's keyboard, camera provider, microphone quality, gesture navigation, TalkBack, and OEM battery management. Background push notifications and real-time spoken conversation are not implemented. Dictation is record → transcribe/clean → review; it is not a clone of proprietary voice infrastructure. The web application remains available on Android, iOS and desktop. Advanced web-only features should continue to be used there until explicitly implemented and verified in Android.

### Verified on Fred, 2026-10-09

- Eight native unit tests passed; Android lint has zero errors (17 dependency/modernization warnings).
- Seven Android 15 Google APIs emulator instrumentation tests passed: IME image commit, native long-press paste, AAC recording → cleaned draft, first Back/drawer and Send/Steer routing, recreation/draft retention plus keyboard geometry, exact DSH question response, and uncertain delivery retry with the original request ID.
- 91 gateway tests and two installer browser tests passed; TypeScript checking, ESLint and web build passed.
- A short synthesized speech sample, encoded as AAC/MP4 (the native recording format), was sent through Fred to the real Gary ASR/cleanup services. Result returned in 1.96 seconds with `cleaned: true` and preserved the original question. This measures that sample and current server load, not a latency guarantee.
- The privately signed, shrunk release APK is approximately 2.8 MB and passes `apksigner verify`.

![Native keyboard and composer](screenshots/android-native-keyboard.png)

The screenshot uses isolated fixture conversation content. The Android input test actually advertises `image/*` and accepts `InputConnectionCompat.commitContent`; it is not a desktop paste simulation.
