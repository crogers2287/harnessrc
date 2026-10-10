# Native Android client

This module is Kotlin / Jetpack Compose, not a WebView. Keep Herdr and the gateway authoritative; never add a second harness writer here. Respect server capability flags and distinguish Send/Steer from explicit Queue.

- Preserve Android's real `OnReceiveContentListener` / IME `commitContent` path in `RichComposer`. A browser paste test is not Android keyboard validation.
- Keep drafts and request IDs durable before sending. Do not regenerate IDs on uncertain delivery or retry mutations automatically.
- Dictation always inserts into a draft. Never auto-send a transcription or a shared attachment.
- Never disable TLS validation. Release networking is HTTPS-only and requires gateway authorization. No embedded tokens or pairing secrets.
- Signing files live outside the repository. Use `scripts/build-android.py`; never log signing passwords or commit keystores.
- Run unit tests, lint and APK builds with the checked-in Gradle wrapper. Run instrumentation only on a disposable emulator/test installation: it clears this app's local fixture data. Do not point native fixture tests at real agent sessions.
- Inspect screenshots with both keyboard open and closed. Preserve 48dp controls, system font scaling, dark theme and Android insets. Test native Back, image insertion, recording, interaction responses and uncertain-delivery recovery before claiming those work.
- See `docs/ANDROID.md` for installation and the remaining physical-device checks. Do not describe a native capability as verified by a desktop browser test.

## Cross-client parity

Treat web and Android as first-class clients. For every user-facing change, inspect the corresponding web behavior and follow `../../docs/CLIENT_PARITY.md`. Record platform differences explicitly; shared backend APIs alone do not establish parity.
