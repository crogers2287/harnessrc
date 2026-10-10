import subprocess
import tempfile
import unittest
from pathlib import Path
from relay_audio import decode_pcm


class DecodeTest(unittest.TestCase):
    def test_android_m4a_and_webm_long_recordings(self):
        with tempfile.TemporaryDirectory() as directory:
            for extension, codec in [("m4a", "aac"), ("webm", "libopus")]:
                for seconds in [6, 40, 180]:
                    with self.subTest(format=extension, seconds=seconds):
                        audio = Path(directory) / f"clip.{extension}"
                        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi",
                                        "-i", f"sine=frequency=440:duration={seconds}",
                                        "-c:a", codec, str(audio)], check=True)
                        pcm = decode_pcm(audio.read_bytes())
                        self.assertAlmostEqual(len(pcm) / 32000, seconds, delta=0.1)

    def test_invalid_and_empty_are_rejected(self):
        for data in [b"", b"not an audio recording", b"x" * (10 * 1024 * 1024 + 1)]:
            with self.assertRaises(ValueError):
                decode_pcm(data)


if __name__ == "__main__":
    unittest.main()
