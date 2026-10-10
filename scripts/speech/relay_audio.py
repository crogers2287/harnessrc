"""Seekable upload decoding for Gary's speech service (Android M4A and browser WebM)."""
import subprocess
import tempfile


def decode_pcm(data: bytes) -> bytes:
    if not data or len(data) > 10 * 1024 * 1024:
        raise ValueError("Recording must be between 1 byte and 10 MB")
    # Android puts the MP4 index at the end. A pipe cannot seek back to audio
    # packets once that index is read; FFmpeg can even return 0 with empty output.
    with tempfile.TemporaryFile() as source:
        source.write(data)
        source.flush()
        result = subprocess.run(
            ["ffmpeg", "-v", "error", "-xerror", "-i", f"/proc/self/fd/{source.fileno()}",
             "-t", "181", "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"],
            pass_fds=(source.fileno(),), capture_output=True, timeout=30,
        )
    if result.returncode or not result.stdout:
        raise ValueError("Recording could not be decoded")
    # Allow encoder padding at the three-minute recording boundary.
    if len(result.stdout) > 180.25 * 16000 * 2:
        raise ValueError("Recording exceeds three minutes")
    return result.stdout
