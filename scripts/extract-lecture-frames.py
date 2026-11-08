"""Create timestamped lecture evidence frames; never calls a cloud model.

stdin is bounded JSON from lesson-vision.mjs. Local video paths are supplied only
by the server. Public BV parts use anonymous yt-dlp; cookies and auth are unused.
Sampling is explicitly incomplete: a frame is an observation point, not proof
that the intervening video, every formula or every board state was observed.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import time
from urllib.parse import urlparse

MAX_INPUT = 32768


class CaptureError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def valid_media_host(url):
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and not parsed.username and not parsed.password and any(
        host == suffix or host.endswith("." + suffix)
        for suffix in ["bilivideo.com", "bilivideo.cn", "hdslb.com", "akamaized.net"]
    )


def validate_request(value):
    if not isinstance(value, dict):
        raise CaptureError("INVALID_REQUEST")
    work = value.get("output_dir")
    if not isinstance(work, str) or not Path(work).is_absolute():
        raise CaptureError("INVALID_REQUEST")
    output = Path(work).resolve()
    if not output.is_dir() or not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", output.name):
        raise CaptureError("INVALID_REQUEST")
    for name, lower, upper in [("max_duration_seconds", 1, 7200), ("max_video_bytes", 1024, 384 * 1024 * 1024), ("max_frames", 2, 120)]:
        if type(value.get(name)) is not int or not lower <= value[name] <= upper:
            raise CaptureError("INVALID_REQUEST")
    interval = value.get("sample_interval_seconds")
    if type(interval) not in [int, float] or not math.isfinite(interval) or not 1 <= interval <= 60:
        raise CaptureError("INVALID_REQUEST")
    window = value.get("capture_range")
    if window is not None:
        if not isinstance(window, dict) or any(type(window.get(key)) not in [int, float] or not math.isfinite(window[key]) for key in ["start", "end"]):
            raise CaptureError("INVALID_REQUEST")
        if not 0 <= window["start"] < window["end"] <= value["max_duration_seconds"] or not 1 <= window["end"] - window["start"] <= 120:
            raise CaptureError("INVALID_REQUEST")
    local = value.get("video_path")
    if local:
        if not isinstance(local, str) or not Path(local).is_absolute():
            raise CaptureError("INVALID_REQUEST")
        supplied_source = Path(local)
        source = supplied_source.resolve()
        if supplied_source.is_symlink() or not source.is_file() or source.stat().st_size > value["max_video_bytes"]:
            raise CaptureError("VIDEO_LIMIT")
    else:
        if not isinstance(value.get("bvid"), str) or not re.fullmatch(r"BV[0-9A-Za-z]{10}", value["bvid"]):
            raise CaptureError("INVALID_REQUEST")
        if type(value.get("part")) is not int or not 1 <= value["part"] <= 1000:
            raise CaptureError("INVALID_REQUEST")
    return {**value, "output_dir": output}


class QuietLogger:
    def debug(self, _message): pass
    def warning(self, _message): pass
    def error(self, _message): pass


def download_video(request):
    try:
        from yt_dlp import YoutubeDL
    except ImportError as error:
        raise CaptureError("DEPENDENCIES_MISSING") from error
    options = {
        "format": "bestvideo[height<=1080][vcodec!=none]/best[height<=1080]",
        "outtmpl": str(request["output_dir"] / "capture-source.%(ext)s"),
        "noplaylist": True, "cookiefile": None, "cookiesfrombrowser": None,
        "cachedir": False, "quiet": True, "noprogress": True, "logger": QuietLogger(),
        "socket_timeout": 15, "retries": 1, "fragment_retries": 1,
        "skip_unavailable_fragments": False, "concurrent_fragment_downloads": 1,
        "max_filesize": request["max_video_bytes"], "geo_bypass": False,
        "writeinfojson": False, "writesubtitles": False, "writeautomaticsub": False,
    }
    url = f"https://www.bilibili.com/video/{request['bvid']}/?p={request['part']}"
    try:
        with YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=False)
            if not isinstance(info, dict) or info.get("_type") in ["playlist", "multi_video"]:
                raise CaptureError("PART_UNAVAILABLE")
            if info.get("availability") in ["premium_only", "subscriber_only", "needs_auth", "private"]:
                raise CaptureError("ACCESS_UNAVAILABLE")
            duration = info.get("duration")
            if type(duration) not in [int, float] or not math.isfinite(duration) or duration <= 0:
                raise CaptureError("DURATION_UNAVAILABLE")
            if duration > min(7200, request["max_duration_seconds"]):
                raise CaptureError("DURATION_LIMIT")
            if info.get("filesize", 0) and info["filesize"] > request["max_video_bytes"]:
                raise CaptureError("VIDEO_LIMIT")
            if info.get("vcodec") == "none" or not valid_media_host(info.get("url") or ""):
                raise CaptureError("ACCESS_UNAVAILABLE")
            def limit_progress(status):
                if status.get("downloaded_bytes", 0) > request["max_video_bytes"]:
                    raise CaptureError("VIDEO_LIMIT")
            downloader.add_progress_hook(limit_progress)
            downloader.process_info(info)
            source = Path(downloader.prepare_filename(info)).resolve()
            if source.parent != request["output_dir"] or not source.is_file():
                raise CaptureError("ACCESS_UNAVAILABLE")
            if source.stat().st_size > request["max_video_bytes"]:
                raise CaptureError("VIDEO_LIMIT")
            return source, {"source_title": str(info.get("title") or "")[:300], "url": url, "part": request["part"]}
    except CaptureError:
        raise
    except Exception as error:
        raise CaptureError("ACCESS_UNAVAILABLE") from error


def choose_frames(candidates, limit):
    """Temporal coverage + readable stable frames following changes, with bounded visual deduplication.

    Motion is a candidate signal, not an image-quality score. Keep the original
    ends, and let the subsequent vision review decide pedagogical completeness.
    """
    if len(candidates) <= limit:
        return list(range(len(candidates)))
    # Long lectures need an actual temporal floor before change-only choices.
    # Short explicit budgets retain the existing balance for targeted captures.
    anchors = max(2, math.ceil(limit * (0.75 if limit >= 24 else 0.5)))
    def quality(index):
        candidate = candidates[index]
        sharpness = candidate.get("sharpnessScore", 0.5)
        stability = 1 - min(1.0, candidate["changeScore"] * 10)
        return 0.55 * sharpness + 0.45 * stability

    selected = {0, len(candidates) - 1}
    radius = min(3, max(1, len(candidates) // (anchors * 4)))
    for anchor in (round(index * (len(candidates) - 1) / (anchors - 1)) for index in range(1, anchors - 1)):
        window = range(max(1, anchor - radius), min(len(candidates) - 1, anchor + radius + 1))
        selected.add(max(window, key=lambda index: quality(index) - 0.12 * abs(index - anchor) / radius))
    changes = sorted(range(len(candidates)), key=lambda index: candidates[index]["changeScore"], reverse=True)

    # Erasing a full board is also a large change. Save its last readable state,
    # rather than spending the remaining budget on the blank frame afterwards.
    erasures = [index for index in range(1,len(candidates))
                if candidates[index-1].get("contentScore",0) > 0.08
                and candidates[index].get("contentScore",0) < candidates[index-1]["contentScore"] * 0.6]
    erasures.sort(key=lambda index:candidates[index-1]["contentScore"]-candidates[index]["contentScore"],reverse=True)
    for index in erasures:
        if len(selected) >= min(limit,anchors+max(1,limit//8)):
            break
        before = range(max(0,index-3),index)
        selected.add(max(before,key=lambda i:quality(i)+candidates[i].get("contentScore",0)))

    def duplicate(index):
        fingerprint = candidates[index].get("visualHash")
        return fingerprint is not None and any(
            candidates[chosen].get("visualHash") is not None
            and (int(fingerprint, 16) ^ int(candidates[chosen]["visualHash"], 16)).bit_count() <= 3
            for chosen in selected
        )

    for index in changes:
        if len(selected) >= limit:
            break
        # Board writing and cuts often create the biggest change. Prefer the
        # sharp, settled frame just after it instead of the transitional frame.
        window = range(index, min(len(candidates), index + 4))
        preferred = max(window, key=quality)
        if not duplicate(preferred):
            selected.add(preferred)
    # Retain useful temporal coverage even for a mostly static lecture.
    for index in sorted(range(len(candidates)), key=quality, reverse=True):
        if len(selected) >= limit:
            break
        selected.add(index)
    return sorted(selected)


def extract_frames(source, request):
    try:
        import av
        import numpy as np
        from PIL import Image
    except ImportError as error:
        raise CaptureError("DEPENDENCIES_MISSING") from error
    candidates = []
    candidate_bytes = 0
    try:
        with av.open(str(source)) as container:
            if not container.streams.video:
                raise CaptureError("NO_VIDEO")
            stream = container.streams.video[0]
            try:
                duration = float(stream.duration * stream.time_base) if stream.duration else float(container.duration or 0) / av.time_base
            except (TypeError, ValueError, OverflowError) as error:
                raise CaptureError("DURATION_UNAVAILABLE") from error
            start_offset = float(stream.start_time * stream.time_base) if stream.start_time is not None else 0.0
            if type(duration) not in [int, float] or not math.isfinite(duration) or duration <= 0:
                raise CaptureError("DURATION_UNAVAILABLE")
            if duration > min(7200, request["max_duration_seconds"] + 1):
                raise CaptureError("DURATION_LIMIT")
            interval = max(float(request["sample_interval_seconds"]), duration / 1200)
            previous = None
            window = request.get("capture_range")
            if window and window["end"] > duration + 0.1:
                raise CaptureError("INVALID_REQUEST")
            start, end = (window["start"], min(window["end"], duration)) if window else (0, duration)
            times = [start + index * interval for index in range(max(1, math.ceil((end - start) / interval))) if start + index * interval < end]
            times.append(max(start, end - 0.1))
            last_time = -1
            for target in times:
                container.seek(int((target + start_offset) / stream.time_base), stream=stream, backward=True)
                chosen = None
                for frame in container.decode(stream):
                    if frame.time is not None and frame.time - start_offset >= target - 0.04:
                        chosen = frame
                        break
                if chosen is None or chosen.time is None:
                    continue
                actual = max(0.0, float(chosen.time) - start_offset)
                if window and actual > end + 0.1:
                    continue
                if actual <= last_time + 0.01:
                    continue
                last_time = actual
                image = chosen.to_image().convert("RGB")
                # 1080p source preserves more board detail; large local files are
                # constrained to 1920px without upscaling a lower-resolution frame.
                image.thumbnail((1920, 1080), Image.Resampling.LANCZOS)
                gray = np.asarray(image.resize((160, 90)).convert("L"), dtype=np.float32)
                score = 1.0 if previous is None else float(np.mean(np.abs(gray - previous)) / 255)
                previous = gray
                detail = np.asarray(image.resize((320, 180)).convert("L"), dtype=np.float32)
                laplacian = detail[:-2, 1:-1] + detail[2:, 1:-1] + detail[1:-1, :-2] + detail[1:-1, 2:] - 4 * detail[1:-1, 1:-1]
                sharpness = min(1.0, float(np.mean(np.abs(laplacian))) / 24)
                board = detail[15:150,20:300]
                content_score = float(np.mean((np.abs(np.diff(board,axis=0))[:,:-1] + np.abs(np.diff(board,axis=1))[:-1,:]) > 20))
                small = np.asarray(image.resize((9, 8)).convert("L"))
                visual_hash = format(int("".join("1" if bit else "0" for bit in (small[:, 1:] > small[:, :-1]).flat), 2), "016x")
                filename = f"candidate-{len(candidates):04d}.jpg"
                image.save(request["output_dir"] / filename, "JPEG", quality=92, optimize=True)
                candidate_bytes += (request["output_dir"] / filename).stat().st_size
                if candidate_bytes > 512 * 1024 * 1024:
                    raise CaptureError("VIDEO_LIMIT")
                candidates.append({"time": round(actual, 3), "fileName": filename, "width": image.width, "height": image.height, "changeScore": round(score, 5), "sharpnessScore": round(sharpness, 5), "contentScore": round(content_score,5), "visualHash": visual_hash})
    except CaptureError:
        raise
    except Exception as error:
        raise CaptureError("CAPTURE_FAILED") from error
    if not candidates:
        raise CaptureError("NO_VIDEO")
    selected = choose_frames(candidates, request["max_frames"])
    output = []
    selected_set = set(selected)
    for index, candidate in enumerate(candidates):
        old = request["output_dir"] / candidate["fileName"]
        if index not in selected_set:
            old.unlink()
            continue
        identity = f"frame-{len(output) + 1:04d}"
        filename = identity + ".jpg"
        old.rename(request["output_dir"] / filename)
        data = (request["output_dir"] / filename).read_bytes()
        reason = "first" if index == 0 else "last" if index == len(candidates) - 1 else "change" if candidate["changeScore"] >= 0.035 else "interval"
        output.append({**candidate, "id": identity, "fileName": filename, "reason": reason, "sha256": hashlib.sha256(data).hexdigest()})
    return {"ok": True, "durationSeconds": round(duration, 3), "candidateCount": len(candidates), "frames": output}


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        if len(raw) > MAX_INPUT:
            raise CaptureError("INVALID_REQUEST")
        request = validate_request(json.loads(raw.decode("utf-8")))
        started = time.perf_counter()
        owned = not bool(request.get("video_path"))
        source, provenance = (Path(request["video_path"]).resolve(), {"source_kind": "local-file"}) if not owned else download_video(request)
        try:
            result = extract_frames(source, request)
            result["provenance"] = {**provenance, "captureSeconds": round(time.perf_counter() - started, 2), "browser_cookies_read": False, "login_used": False, "recognition_performed": False}
        finally:
            if owned and not request.get("retain_video") and source.parent == request["output_dir"] and source.name.startswith("capture-source."):
                source.unlink(missing_ok=True)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except CaptureError as error:
        print(json.dumps({"ok": False, "code": error.code}))
    except Exception:
        print(json.dumps({"ok": False, "code": "INVALID_REQUEST"}))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
