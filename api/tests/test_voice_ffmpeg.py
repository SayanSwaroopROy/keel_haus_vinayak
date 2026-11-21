"""ffmpeg is called with a pinned input format and only the file protocol (security review finding)."""

import importlib
import shutil
import subprocess

import pytest

voice = importlib.import_module("app.ai.voice")  # the package attribute `app.ai.voice` is the singleton
from app.errors import ApiError
from tests.helpers import wav_bytes


def test_command_pins_format_and_blocks_other_protocols(tmp_path):
    cmd = voice.ffmpeg_cmd(tmp_path / "in.wav", tmp_path / "o_%03d.wav", "wav")
    assert cmd[cmd.index("-protocol_whitelist") + 1] == "file"
    assert cmd.index("-f") < cmd.index("-i") and cmd[cmd.index("-f") + 1] == "wav"  # input format before -i
    assert "-nostdin" in cmd and "-vn" in cmd


@pytest.mark.parametrize("suffix", ["", ".txt", ".m3u8", ".concat", ".sdp", ".exe"])
def test_unlisted_suffix_never_reaches_ffmpeg(suffix, monkeypatch):
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: pytest.fail("ffmpeg must not run"))
    with pytest.raises(ApiError) as e:
        voice.split_audio(b"x", suffix)
    assert e.value.status == 415


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
def test_playlist_disguised_as_wav_is_not_followed(tmp_path):
    evil = b"#EXTM3U\n#EXTINF:1,\nfile:///etc/hosts\n"  # a playlist pointing at a local file
    with pytest.raises(ApiError) as e:
        voice.split_audio(evil, ".wav")
    assert e.value.status == 422


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
def test_real_wav_is_still_split():
    parts = voice.split_audio(wav_bytes(seconds=60), ".wav")
    assert len(parts) == 3 and all(m == "audio/wav" for _, m in parts)  # 60 s -> 25 + 25 + 10
