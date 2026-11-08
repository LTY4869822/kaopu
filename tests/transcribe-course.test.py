"""Local speech source contracts; uses no network, CUDA, media or model download."""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("shifen_transcribe", Path(__file__).resolve().parents[1] / "scripts" / "transcribe-course.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fake_audio_downloader(info, directory):
    """A yt-dlp stand-in: metadata and three local bytes, never network/media/ASR."""
    directory = directory.resolve()
    calls = {"extract": [], "process": [], "options": None}
    target = directory / "course-audio.m4a"
    class FakeYoutubeDL:
        def __init__(self, options):
            calls["options"] = options
        def __enter__(self):
            return self
        def __exit__(self, *_args):
            return False
        def extract_info(self, url, *, download):
            calls["extract"].append((url, download))
            return dict(info)
        def process_info(self, value):
            calls["process"].append(dict(value))
            target.write_bytes(b"123")
        def prepare_filename(self, _value):
            return str(target)
    return FakeYoutubeDL, calls, target


class SpeechSourceTests(unittest.TestCase):
    def request(self):
        return {"bvid": "BV1Eb411u7Fw", "part": 20, "max_duration_seconds": 3600}

    def download_fixture(self, directory, duration=3940.692):
        directory = directory.resolve()
        request = {"bvid": "BV1CAxaeHEeH", "part": 3, "max_duration_seconds": 7200,
                   "max_audio_bytes": 1024, "work_dir": directory}
        info = {"id": "fixture-selected-p3", "title": "虚构选定讲次 P3", "duration": duration,
                "url": "https://fixture.bilivideo.com/audio.m4a", "vcodec": "none", "filesize": 3}
        return request, info

    def test_default_request_allows_two_hours_without_starting_a_model(self):
        with tempfile.TemporaryDirectory(prefix="shifen-local-video-") as folder:
            normalized = module.validate_request({"bvid": "BV1CAxaeHEeH", "part": 3, "work_dir": folder})
            self.assertEqual(normalized["max_duration_seconds"], 7200)

    def test_selected_65_minute_part_downloads_with_two_hour_limit_only(self):
        with tempfile.TemporaryDirectory() as folder:
            request, info = self.download_fixture(Path(folder))
            downloader, calls, target = fake_audio_downloader(info, Path(folder))
            with patch.dict(sys.modules, {"yt_dlp": types.SimpleNamespace(YoutubeDL=downloader), "imageio_ffmpeg": types.SimpleNamespace(get_ffmpeg_exe=lambda: "fixture-ffmpeg")}):
                audio, provenance = module.download_audio(request)
            self.assertEqual(audio, target)
            self.assertEqual(provenance["source_duration_seconds"], 3940.692)
            self.assertEqual(provenance["part"], 3)
            self.assertEqual(provenance["url"], "https://www.bilibili.com/video/BV1CAxaeHEeH/?p=3")
            self.assertEqual(calls["extract"], [(provenance["url"], False)])
            self.assertEqual(len(calls["process"]), 1)
            self.assertTrue(calls["options"]["noplaylist"])
            self.assertIsNone(calls["options"]["cookiefile"])
            self.assertIsNone(calls["options"]["cookiesfrombrowser"])

    def test_audio_duration_boundaries_reject_before_download(self):
        for duration, limit, expected in [(7200, 7200, None), (7200.001, 7200, "DURATION_LIMIT"), (3940.692, 3600, "DURATION_LIMIT")]:
            with self.subTest(duration=duration, limit=limit), tempfile.TemporaryDirectory() as folder:
                request, info = self.download_fixture(Path(folder), duration)
                request["max_duration_seconds"] = limit
                downloader, calls, target = fake_audio_downloader(info, Path(folder))
                with patch.dict(sys.modules, {"yt_dlp": types.SimpleNamespace(YoutubeDL=downloader), "imageio_ffmpeg": types.SimpleNamespace(get_ffmpeg_exe=lambda: "fixture-ffmpeg")}):
                    if expected:
                        with self.assertRaises(module.PipelineError) as raised:
                            module.download_audio(request)
                        self.assertEqual(raised.exception.code, expected)
                    else:
                        module.download_audio(request)
                self.assertEqual(len(calls["extract"]), 1)
                self.assertEqual(len(calls["process"]), 0 if expected else 1)
                self.assertEqual(target.exists(), not bool(expected))

    def test_invalid_audio_metadata_duration_is_not_reported_as_over_limit(self):
        missing = object()
        for duration in [missing, None, float("nan"), float("inf"), float("-inf"), True, False, 0, -1, "3941"]:
            with self.subTest(duration=duration), tempfile.TemporaryDirectory() as folder:
                request, info = self.download_fixture(Path(folder), duration)
                if duration is missing:
                    info.pop("duration")
                downloader, calls, target = fake_audio_downloader(info, Path(folder))
                with patch.dict(sys.modules, {"yt_dlp": types.SimpleNamespace(YoutubeDL=downloader), "imageio_ffmpeg": types.SimpleNamespace(get_ffmpeg_exe=lambda: "fixture-ffmpeg")}):
                    with self.assertRaises(module.PipelineError) as raised:
                        module.download_audio(request)
                self.assertEqual(raised.exception.code, "DURATION_UNAVAILABLE")
                self.assertEqual(calls["extract"], [("https://www.bilibili.com/video/BV1CAxaeHEeH/?p=3", False)])
                self.assertEqual(calls["process"], [])
                self.assertFalse(target.exists())

    def test_audio_playlist_metadata_never_falls_back_to_first_part_or_collection(self):
        for kind in ["playlist", "multi_video"]:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as folder:
                request, info = self.download_fixture(Path(folder))
                info.update({"_type": kind, "entries": [{"id": "p1", "duration": 60}]})
                downloader, calls, target = fake_audio_downloader(info, Path(folder))
                with patch.dict(sys.modules, {"yt_dlp": types.SimpleNamespace(YoutubeDL=downloader), "imageio_ffmpeg": types.SimpleNamespace(get_ffmpeg_exe=lambda: "fixture-ffmpeg")}):
                    with self.assertRaises(module.PipelineError) as raised:
                        module.download_audio(request)
                self.assertEqual(raised.exception.code, "PART_UNAVAILABLE")
                self.assertEqual(calls["extract"], [("https://www.bilibili.com/video/BV1CAxaeHEeH/?p=3", False)])
                self.assertEqual(calls["process"], [])
                self.assertFalse(target.exists())

    def test_public_subtitles_prefer_chinese_text_and_do_not_accept_login_required(self):
        calls = []
        def fetch(url, hosts):
            calls.append((url, hosts))
            if "/view?" in url:
                return {"code": 0, "data": {"title": "高数", "pages": [{"cid": i, "duration": 512, "part": f"第{i}讲"} for i in range(1, 21)]}}
            if "/v2?" in url:
                return {"code": 0, "data": {"subtitle": {"subtitles": [
                    {"lan": "en", "subtitle_url": "https://aisubtitle.hdslb.com/en.json"},
                    {"lan": "zh-CN", "subtitle_url": "//aisubtitle.hdslb.com/zh.json"},
                ]}}}
            self.assertTrue(url.endswith("zh.json"))
            return {"body": [{"from": 0, "to": 5, "content": "单侧导数"}]}
        result = module.try_public_subtitles(self.request(), fetch)
        self.assertEqual(result["body"][0]["content"], "单侧导数")
        self.assertEqual(result["provenance"]["source_kind"], "platform-subtitles")
        self.assertFalse(result["provenance"]["processed_entire_selected_audio"])
        self.assertTrue(result["provenance"]["processed_entire_source"])
        self.assertIn("cid=20", calls[1][0])
        def login_required(url, hosts):
            if "/view?" in url:
                return fetch(url, hosts)
            return {"code": 0, "data": {"need_login_subtitle": True, "subtitle": {"subtitles": [{"lan": "zh", "subtitle_url": "https://aisubtitle.hdslb.com/private.json"}]}}}
        self.assertIsNone(module.try_public_subtitles(self.request(), login_required))

    def test_subtitle_endpoints_are_bounded_and_caption_timing_is_validated(self):
        for url in ["http://aisubtitle.hdslb.com/x", "https://evil.test/x", "https://user:password@aisubtitle.hdslb.com/x", "https://127.0.0.1/x", "https://aisubtitle.hdslb.com:444/x"]:
            with self.assertRaises(module.PipelineError):
                module.public_json(url, ("hdslb.com",))
        for row in [
            {"from": True, "to": 2, "content": "坏时间"},
            {"from": float("nan"), "to": 2, "content": "坏时间"},
            {"from": 2, "to": 1, "content": "坏时间"},
            {"from": 0, "to": 20, "content": "超出时长"},
            {"from": 0, "to": 1, "content": "字" * 6001},
        ]:
            with self.assertRaises(module.PipelineError):
                module.subtitle_body({"body": [row]}, 3)

    def test_available_subtitles_do_not_require_or_download_an_asr_model(self):
        result = {"ok": True, "body": [{"from": 0, "to": 3, "content": "平台原文"}]}
        stdin = types.SimpleNamespace(buffer=io.BytesIO(b'{}'))
        output = io.StringIO()
        with patch.object(sys, "argv", ["transcribe-course.py"]), patch.object(sys, "stdin", stdin), patch.object(module, "validate_request", return_value=self.request()), patch.object(module, "try_public_subtitles", return_value=result), patch.object(module, "cached_model_path", side_effect=AssertionError("must not load model")), patch.object(module, "download_audio", side_effect=AssertionError("must not download audio")), contextlib.redirect_stdout(output):
            self.assertEqual(module.main(), 0)
        self.assertEqual(json.loads(output.getvalue()), result)

    def test_cached_model_selection_is_offline_and_prefers_stronger_available_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "model.bin").write_bytes(b"fixture")
            (root / "config.json").write_text("{}", encoding="utf-8")
            (root / "tokenizer.json").write_text("{}", encoding="utf-8")
            calls = []
            def snapshot(repository, *, local_files_only):
                self.assertTrue(local_files_only)
                calls.append(repository)
                if repository.endswith("-small"):
                    return str(root)
                raise FileNotFoundError("not cached")
            with patch.dict(sys.modules, {"huggingface_hub": types.SimpleNamespace(snapshot_download=snapshot)}):
                name, path = module.resolve_cached_model("auto")
                self.assertEqual(name, "Systran/faster-whisper-small")
                self.assertEqual(path, str(root))
                self.assertNotIn("Systran/faster-whisper-base", calls)
                with self.assertRaises(module.PipelineError):
                    module.resolve_cached_model("not-a-configured-model")

    def test_asr_keeps_raw_text_and_returns_review_ranges_instead_of_fixing_formula(self):
        content = "公式是F,F,F,F,F,F；比上H，术语需回听。"
        cue = types.SimpleNamespace(start=1.0, end=3.0, text=content, avg_logprob=-1.2, no_speech_prob=0.1, compression_ratio=2.8)
        options = {}
        class FakeModel:
            def __init__(self, *args, **kwargs):
                pass
            def transcribe(self, *args, **kwargs):
                options.update(kwargs)
                return iter([cue]), types.SimpleNamespace(duration=4, language="zh")
        with patch.dict(sys.modules, {"faster_whisper": types.SimpleNamespace(WhisperModel=FakeModel)}), patch.object(module, "resolve_cached_model", return_value=("Systran/faster-whisper-base", "fixture")), patch.object(module.importlib.metadata, "version", return_value="test"):
            result = module.transcribe_audio("fixture.m4a", "高等数学")
        self.assertEqual(result["body"][0]["content"], content)
        self.assertEqual(options["chunk_length"], 15)
        self.assertEqual(options["temperature"], 0)
        self.assertFalse(options["condition_on_previous_text"])
        self.assertIn("asr-low-confidence", [item["reason"] for item in result["provenance"]["review_ranges"]])
        self.assertIn("spoken-formula", [item["reason"] for item in result["provenance"]["review_ranges"]])


if __name__ == "__main__":
    unittest.main()
