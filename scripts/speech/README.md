# Gary speech upload decoder

`relay_audio.py` fixes long Android M4A uploads to Gary's existing Qwen ASR service. MP4 files with a trailing index require seeking. The previous `ffmpeg -i pipe:0` returned exit code zero and empty PCM for a reproduced 40-second clip, producing an empty successful transcription. This is independent of the model and client timeout.

The decoder uses an anonymous seekable temporary file, deletes it automatically, limits uploads to 10 MB / three minutes, imposes a 30-second decode timeout, and rejects empty or failed decoding. It supports the same browser WebM path. It requires Linux `/proc`, Python 3 and FFmpeg.

Run regression checks:

```sh
python3 scripts/speech/test_relay_audio.py
```

On Gary, install this module next to `/mnt/models-ssd/speech/app/asr_server.py`. Its `ffmpeg_decode` implementation is:

```python
def ffmpeg_decode(data: bytes) -> np.ndarray:
    from relay_audio import decode_pcm
    try:
        pcm = decode_pcm(data)
    except (ValueError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(400, "Recording could not be decoded or exceeds the supported limit") from exc
    return np.frombuffer(pcm, "<i2").astype(np.float32) / 32768.0
```

Back up the existing server before modifying that function; leave the model and streaming WebSocket implementation unchanged. Restart `speech-asr.service` under the user account and wait for `/ready` before testing. A restart briefly interrupts speech requests. No Relay APK or web update is needed for this server fix.
