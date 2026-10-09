# Voice input

Tap the microphone in the composer, speak, then tap Finish. Relay records audio with the browser's MediaRecorder, transcribes it, cleans filler/repetitions/punctuation, and inserts an editable draft. It never submits that draft to an agent. Typing during transcription is preserved. Cancel discards the recording; Retry reuses it without recording again.

This is one user action with two local model stages, not a claim that a single speech model does both jobs. Fred uses Gary's existing Qwen3-ASR 1.7B service (8710) and already-loaded `qwen38-flash-next-strata` behind llama-swap (9069). No new model downloads or service changes were required. The installed ASR ignores its `prompt` parameter, so cleanup is an explicit second request.

Add an optional `voice` object to the gateway configuration, then restart only Relay:

```json
{
  "voice": {
    "transcriptionUrl": "http://GARY_TAILNET_IP:8710/v1/audio/transcriptions",
    "model": "qwen3-asr-1.7b",
    "cleanup": {
      "endpoint": "http://GARY_TAILNET_IP:9069/v1/chat/completions",
      "model": "qwen38-flash-next-strata"
    }
  }
}
```

URLs are operator-controlled; users cannot choose upstream URLs. If upstream authentication is needed, set `authorizationEnv` to the name of an environment variable containing its bearer token, on either stage. The client never receives these credentials. Omitting `voice` hides the microphone. Omitting `cleanup` returns the raw transcript.

The authenticated endpoint requires session control permission and same-origin request protection. It accepts at most 10 MB, limits concurrency to two and requests to six/minute, and bounds upstream timeouts. Browser capture stops at three minutes or 9 MB. Audio and transcript are processed in memory, not written to Relay's database or uploads; audit records contain byte count and cleanup success only. Gary's service logging/retention is administered separately. Failed recordings remain in the browser tab for retry and are lost when that tab closes. Cleanup has a three-second budget (optional `cleanup.timeoutMs`, 100–10000 ms). Slow or failed cleanup inserts the original transcript with a notice instead of delaying the draft for 30 seconds. Technical names can be misheard; review before sending. The original transcription is available for comparison.

HTTPS and microphone permission are required. MIME support is feature-detected for WebM/Opus, MP4, and Ogg. Recording stops when the tab is hidden or its session is left. Browser tests use an actual Chromium MediaRecorder with a fake microphone and cover permission refusal, cancellation, retained drafts, retry, and no agent submission. A synthetic speech fixture was also transcribed and cleaned on Gary. Physical Android/iOS microphones, permission prompts, and interruption behavior still require device confirmation.

Live Fred validation (2026-10-09): a real Chromium MediaRecorder with a synthetic WAV microphone, using the authenticated tailnet UI, uploaded to the deployed gateway, transcribed/cleaned on Gary, and inserted the result into the current DSH draft. No chat submission occurred. This verifies the deployed chain, not a physical phone microphone. The synthetic phrase's technical name “Qwen” was recognized as “Quinn”; cleanup deliberately did not guess a correction.
