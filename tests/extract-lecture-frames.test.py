"""Offline frame-download contracts; no network, decoder, media or model is used."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("shifen_capture", Path(__file__).resolve().parents[1] / "scripts" / "extract-lecture-frames.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fake_video_downloader(info, directory):
    directory = directory.resolve()
    calls = {"extract": [], "process": [], "options": None, "hooks": []}
    target = directory / "capture-source.mp4"
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
        def add_progress_hook(self, hook):
            calls["hooks"].append(hook)
        def process_info(self, value):
            calls["process"].append(dict(value))
            target.write_bytes(b"123")
        def prepare_filename(self, _value):
            return str(target)
    return FakeYoutubeDL, calls, target


class FrameDownloadTests(unittest.TestCase):
    def fixture(self, directory, duration=3940.692):
        directory = directory.resolve()
        request = {"bvid": "BV1CAxaeHEeH", "part": 3, "max_duration_seconds": 7200,
                   "max_video_bytes": 1024, "output_dir": directory}
        info = {"id": "fixture-selected-p3", "title": "虚构选定讲次 P3", "duration": duration,
                "url": "https://fixture.bilivideo.com/video.mp4", "vcodec": "h264", "filesize": 3}
        return request, info

    def test_selected_65_minute_part_downloads_with_two_hour_limit_only(self):
        with tempfile.TemporaryDirectory() as folder:
            request, info = self.fixture(Path(folder))
            downloader, calls, target = fake_video_downloader(info, Path(folder))
            with patch.dict(sys.modules, {"yt_dlp": types.SimpleNamespace(YoutubeDL=downloader)}):
                video, provenance = module.download_video(request)
            self.assertEqual(video, target)
            self.assertEqual(provenance["part"], 3)
            self.assertEqual(provenance["url"], "https://www.bilibili.com/video/BV1CAxaeHEeH/?p=3")
            self.assertEqual(calls["extract"], [(provenance["url"], False)])
            self.assertEqual(len(calls["process"]), 1)
            self.assertTrue(calls["options"]["noplaylist"])
            self.assertIsNone(calls["options"]["cookiefile"])
            self.assertIsNone(calls["options"]["cookiesfrombrowser"])

    def test_video_duration_boundaries_reject_before_download(self):
        for duration, limit, expected in [(7200, 7200, None), (7200.001, 7200, "DURATION_LIMIT"), (3940.692, 3600, "DURATION_LIMIT")]:
            with self.subTest(duration=duration, limit=limit), tempfile.TemporaryDirectory() as folder:
                request, info = self.fixture(Path(folder), duration)
                request["max_duration_seconds"] = limit
                downloader, calls, target = fake_video_downloader(info, Path(folder))
                with patch.dict(sys.modules, {"yt_dlp": types.SimpleNamespace(YoutubeDL=downloader)}):
                    if expected:
                        with self.assertRaises(module.CaptureError) as raised:
                            module.download_video(request)
                        self.assertEqual(raised.exception.code, expected)
                    else:
                        module.download_video(request)
                self.assertEqual(len(calls["extract"]), 1)
                self.assertEqual(len(calls["process"]), 0 if expected else 1)
                self.assertEqual(len(calls["hooks"]), 0 if expected else 1)
                self.assertEqual(target.exists(), not bool(expected))

    def test_invalid_video_metadata_duration_is_not_reported_as_over_limit(self):
        missing = object()
        for duration in [missing, None, float("nan"), float("inf"), float("-inf"), True, False, 0, -1, "3941"]:
            with self.subTest(duration=duration), tempfile.TemporaryDirectory() as folder:
                request, info = self.fixture(Path(folder), duration)
                if duration is missing:
                    info.pop("duration")
                downloader, calls, target = fake_video_downloader(info, Path(folder))
                with patch.dict(sys.modules, {"yt_dlp": types.SimpleNamespace(YoutubeDL=downloader)}):
                    with self.assertRaises(module.CaptureError) as raised:
                        module.download_video(request)
                self.assertEqual(raised.exception.code, "DURATION_UNAVAILABLE")
                self.assertEqual(calls["extract"], [("https://www.bilibili.com/video/BV1CAxaeHEeH/?p=3", False)])
                self.assertEqual(calls["process"], [])
                self.assertEqual(calls["hooks"], [])
                self.assertFalse(target.exists())

    def test_video_playlist_metadata_never_falls_back_to_first_part_or_collection(self):
        for kind in ["playlist", "multi_video"]:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as folder:
                request, info = self.fixture(Path(folder))
                info.update({"_type": kind, "entries": [{"id": "p1", "duration": 60}]})
                downloader, calls, target = fake_video_downloader(info, Path(folder))
                with patch.dict(sys.modules, {"yt_dlp": types.SimpleNamespace(YoutubeDL=downloader)}):
                    with self.assertRaises(module.CaptureError) as raised:
                        module.download_video(request)
                self.assertEqual(raised.exception.code, "PART_UNAVAILABLE")
                self.assertEqual(calls["extract"], [("https://www.bilibili.com/video/BV1CAxaeHEeH/?p=3", False)])
                self.assertEqual(calls["process"], [])
                self.assertFalse(target.exists())


class RangeCaptureTests(unittest.TestCase):
    def test_range_validation_rejects_unbounded_or_coerced_inputs(self):
        with tempfile.TemporaryDirectory(prefix="shifen-range-") as folder:
            base = {"bvid": "BV1Eb411u7Fw", "part": 20, "output_dir": folder,
                    "max_duration_seconds": 7200, "max_video_bytes": 1048576, "max_frames": 12, "sample_interval_seconds": 2}
            for window in [{"start": -1, "end": 20}, {"start": 0, "end": 121}, {"start": True, "end": 10},
                           {"start": 1, "end": 1.1}, {"start": 0, "end": float("inf")}, {}, "0:20"]:
                with self.subTest(window=window), self.assertRaises(module.CaptureError):
                    module.validate_request({**base, "capture_range": window})
            valid = module.validate_request({**base, "capture_range": {"start": 3, "end": 8}})
            self.assertEqual(valid["capture_range"], {"start": 3, "end": 8})

    def test_real_local_video_range_retains_absolute_timestamps_and_tail(self):
        try:
            import av
            import numpy as np
            from PIL import Image
        except ImportError:
            self.skipTest("Optional local frame runtime unavailable")
        with tempfile.TemporaryDirectory(prefix="shifen-range-") as folder:
            directory = Path(folder).resolve()
            source = directory / "fixture.mp4"
            with av.open(str(source), mode="w") as output:
                stream = output.add_stream("mpeg4", rate=10)
                stream.width = 320
                stream.height = 180
                stream.pix_fmt = "yuv420p"
                for index in range(120):
                    array = np.full((180, 320, 3), (index * 2) % 255, dtype=np.uint8)
                    frame = av.VideoFrame.from_image(Image.fromarray(array))
                    for packet in stream.encode(frame):
                        output.mux(packet)
                for packet in stream.encode():
                    output.mux(packet)
            request = {"output_dir": directory, "max_duration_seconds": 7200, "max_frames": 12,
                       "sample_interval_seconds": 2, "capture_range": {"start": 3, "end": 8}}
            result = module.extract_frames(source, request)
            times = [frame["time"] for frame in result["frames"]]
            self.assertGreaterEqual(min(times), 3)
            self.assertLessEqual(max(times), 8.1)
            self.assertGreaterEqual(max(times), 7.9)
            self.assertEqual(len(times), len(set(times)))
            self.assertEqual(result["durationSeconds"], 12)
            self.assertTrue(source.exists())
            self.assertLessEqual(len(times), 12)


if __name__ == "__main__":
    unittest.main()
