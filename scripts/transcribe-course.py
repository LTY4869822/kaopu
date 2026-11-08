"""Anonymous, single-part Bilibili audio -> local cached faster-whisper transcript.

Called by local-video-source.mjs with a bounded JSON request on stdin. No browser
cookies, cloud model key, model download or remote speech service is used. The
Node caller owns the isolated temporary directory and removes it on every exit.
"""
from __future__ import annotations

import importlib.metadata
import importlib.util
import json
import logging
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from urllib.parse import urlencode, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_INPUT = 32768
MAX_CHARACTERS = 250000
MAX_CUES = 5000
MODEL_REPOSITORY = "Systran/faster-whisper-base"
MODEL_REPOSITORIES = {
    "large-v3-turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
    "large-v3": "Systran/faster-whisper-large-v3",
    "medium": "Systran/faster-whisper-medium",
    "small": "Systran/faster-whisper-small",
    "base": MODEL_REPOSITORY,
}


def complete_model_cache(directory: Path) -> bool:
    # Without tokenizer.json faster-whisper may try a separate tokenizer lookup.
    return all((directory / name).is_file() for name in ["model.bin", "config.json", "tokenizer.json"])


class PipelineError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def resolve_cached_model(name: str = "auto") -> tuple[str, str]:
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    try:
        from huggingface_hub import snapshot_download
        candidates = list(MODEL_REPOSITORIES.values()) if name == "auto" else [MODEL_REPOSITORIES.get(name, name)]
        if name != "auto" and name not in MODEL_REPOSITORIES and name not in MODEL_REPOSITORIES.values():
            directory = Path(name)
            if directory.is_dir() and complete_model_cache(directory):
                return "operator-local-model", str(directory.resolve())
            raise PipelineError("MODEL_CACHE_MISSING")
        for repository in candidates:
            try:
                model = Path(snapshot_download(repository, local_files_only=True))
                if complete_model_cache(model):
                    return repository, str(model)
            except Exception:
                continue
    except Exception as error:
        raise PipelineError("MODEL_CACHE_MISSING") from error
    raise PipelineError("MODEL_CACHE_MISSING")


def cached_model_path(name: str = "auto") -> str:
    return resolve_cached_model(name)[1]


def build_initial_prompt(title: str = "", scope: str = "") -> str:
    # Context is data for the ASR library, never interpolated into a command line.
    context = re.sub(r"[\x00-\x1f\x7f]", " ", f"{title}。{scope}")
    context = " ".join(context.split())[:500]
    prefix = "大学课程录音：定义、条件、公式、例题、解答。"
    if re.search(r"高等数学|高数|导数|极限|积分|微分|函数|可导|连续", context):
        prefix = "大学高等数学：导数，单侧导数，左导数，右导数，函数，极限，增量，可导，连续，微分，积分。"
    elif re.search(r"线性代数|行列式|矩阵|向量|特征值", context):
        prefix = "大学线性代数：矩阵，行列式，向量，秩，线性方程组，特征值，特征向量，正交。"
    return (prefix + context)[:650]


def check_support() -> dict:
    modules = {name: importlib.util.find_spec(name) is not None for name in ["yt_dlp", "faster_whisper", "av", "imageio_ffmpeg", "huggingface_hub"]}
    model_cached = False
    selected = None
    if modules["huggingface_hub"]:
        try:
            selected = resolve_cached_model(os.environ.get("LOCAL_TRANSCRIPTION_MODEL", "auto"))[0]
            model_cached = True
        except PipelineError:
            pass
    return {"ok": True, "dependencies": modules, "model_cached": model_cached, "model": selected, "downloads_model": False, "subtitle_priority": True}


def validate_request(request: object) -> dict:
    if not isinstance(request, dict):
        raise PipelineError("INVALID_REQUEST")
    bvid, part = request.get("bvid"), request.get("part")
    if not isinstance(bvid, str) or re.fullmatch(r"BV[0-9A-Za-z]{10}", bvid) is None:
        raise PipelineError("INVALID_REQUEST")
    if type(part) is not int or not 1 <= part <= 1000:
        raise PipelineError("INVALID_REQUEST")
    duration = request.get("max_duration_seconds", 7200)
    size = request.get("max_audio_bytes", 96 * 1024 * 1024)
    if type(duration) is not int or not 1 <= duration <= 7200:
        raise PipelineError("INVALID_REQUEST")
    if type(size) is not int or not 1024 <= size <= 160 * 1024 * 1024:
        raise PipelineError("INVALID_REQUEST")
    title, scope = request.get("title", ""), request.get("scope", "")
    if not isinstance(title, str) or not isinstance(scope, str) or len(title) > 300 or len(scope) > 4000:
        raise PipelineError("INVALID_REQUEST")
    model = request.get("model", "auto")
    device = request.get("device", "cpu")
    language = request.get("language", "zh")
    if not isinstance(model, str) or not model.strip() or len(model) > 500 or any(ord(c) < 32 for c in model):
        raise PipelineError("INVALID_REQUEST")
    if device not in ["cpu", "cuda"] or language not in ["auto", "zh", "en"] or type(request.get("prefer_subtitles", True)) is not bool:
        raise PipelineError("INVALID_REQUEST")
    supplied_dir = request.get("work_dir")
    if not isinstance(supplied_dir, str):
        raise PipelineError("INVALID_REQUEST")
    directory = Path(supplied_dir).resolve()
    # The task directory can only be one of the Node wrapper's OS-temp children.
    if directory.parent != Path(tempfile.gettempdir()).resolve() or not directory.name.startswith("shifen-local-video-") or not directory.is_dir():
        raise PipelineError("INVALID_REQUEST")
    return {**request, "work_dir": directory, "max_duration_seconds": duration, "max_audio_bytes": size, "model": model, "device": device, "language": language}


class QuietLogger:
    def debug(self, _message):
        pass

    def warning(self, _message):
        pass

    def error(self, _message):
        pass


def public_json(url: str, hosts: tuple[str, ...], max_bytes: int = 2 * 1024 * 1024) -> dict:
    """Bounded anonymous fetch; never attach browser cookies or follow a new host."""
    def allowed(candidate: str) -> bool:
        parsed = urlparse(candidate)
        host = (parsed.hostname or "").lower()
        return parsed.scheme == "https" and not parsed.username and not parsed.password and parsed.port in [None, 443] and any(host == name or host.endswith("." + name) for name in hosts)
    class LimitedRedirect(HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            if not allowed(newurl):
                raise PipelineError("SUBTITLE_UNAVAILABLE")
            return super().redirect_request(req, fp, code, msg, headers, newurl)
    if not allowed(url):
        raise PipelineError("SUBTITLE_UNAVAILABLE")
    request = Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/"})
    with build_opener(LimitedRedirect()).open(request, timeout=12) as response:
        if int(response.headers.get("Content-Length", "0")) > max_bytes:
            raise PipelineError("SUBTITLE_UNAVAILABLE")
        data = response.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise PipelineError("SUBTITLE_UNAVAILABLE")
    value = json.loads(data.decode("utf-8-sig"))
    if not isinstance(value, dict):
        raise PipelineError("SUBTITLE_UNAVAILABLE")
    return value


def subtitle_body(value: dict, duration: float) -> list[dict]:
    rows = value.get("body")
    if not isinstance(rows, list) or not rows or len(rows) > MAX_CUES:
        raise PipelineError("SUBTITLE_UNAVAILABLE")
    body, previous, characters = [], -1.0, 0
    for row in rows:
        if not isinstance(row, dict):
            raise PipelineError("SUBTITLE_UNAVAILABLE")
        start, end, content = row.get("from"), row.get("to"), row.get("content")
        if type(start) not in [int, float] or type(end) not in [int, float] or not math.isfinite(start) or not math.isfinite(end) or start < previous or start < 0 or end < start or end > duration + 5 or not isinstance(content, str) or not content.strip() or len(content) > 6000:
            raise PipelineError("SUBTITLE_UNAVAILABLE")
        characters += len(content)
        if characters > MAX_CHARACTERS:
            raise PipelineError("SUBTITLE_UNAVAILABLE")
        body.append({"from": float(start), "to": float(end), "content": content.strip()})
        previous = start
    return body


def try_public_subtitles(request: dict, fetch_json=public_json) -> dict | None:
    """Prefer actual platform text, not danmaku or generated summaries. Failure falls back to ASR."""
    if not request.get("prefer_subtitles", True):
        return None
    started = time.perf_counter()
    try:
        view = fetch_json("https://api.bilibili.com/x/web-interface/view?" + urlencode({"bvid": request["bvid"]}), ("api.bilibili.com",))
        data = view.get("data") if view.get("code") == 0 else None
        pages = data.get("pages") if isinstance(data, dict) else None
        if not isinstance(pages, list) or len(pages) < request["part"]:
            return None
        page = pages[request["part"] - 1]
        duration, cid = page.get("duration"), page.get("cid")
        if type(duration) not in [int, float] or not math.isfinite(duration) or not 0 < duration <= request["max_duration_seconds"] or type(cid) is not int:
            return None
        player = fetch_json("https://api.bilibili.com/x/player/wbi/v2?" + urlencode({"bvid": request["bvid"], "cid": cid}), ("api.bilibili.com",))
        player_data = player.get("data") if player.get("code") == 0 else None
        if not isinstance(player_data, dict) or player_data.get("need_login_subtitle"):
            return None
        available = player_data.get("subtitle", {}).get("subtitles", [])
        if not isinstance(available, list):
            return None
        choices = [item for item in available if isinstance(item, dict) and isinstance(item.get("subtitle_url"), str) and item["subtitle_url"] and isinstance(item.get("lan"), str)]
        choices.sort(key=lambda item: (0 if item["lan"].lower().startswith("zh") else 1 if "zh" in item["lan"].lower() else 2, item["lan"].lower().startswith("ai")))
        for item in choices[:4]:
            try:
                url = "https:" + item["subtitle_url"] if item["subtitle_url"].startswith("//") else item["subtitle_url"]
                body = subtitle_body(fetch_json(url, ("hdslb.com", "bilibili.com")), duration)
                return {"ok": True, "body": body, "warnings": ["已优先导入平台字幕；平台自动字幕也可能误识，公式与未念出的板书仍需核对。"], "provenance": {
                    "source_kind": "platform-subtitles", "language": item["lan"], "model": None,
                    "source_duration_seconds": duration, "audio_duration_seconds": duration,
                    "source_title": f"{data.get('title', '')} · {page.get('part', '')}"[:300],
                    "part": request["part"], "url": f"https://www.bilibili.com/video/{request['bvid']}/?p={request['part']}",
                    "processed_entire_source": True, "processed_entire_selected_audio": False,
                    "has_visual_evidence": False, "browser_cookies_read": False, "login_used": False,
                    "subtitle_seconds": round(time.perf_counter() - started, 2), "review_ranges": [],
                }}
            except Exception:
                continue
    except Exception:
        return None
    return None


def download_audio(request: dict) -> tuple[Path, dict]:
    try:
        from yt_dlp import YoutubeDL
        import imageio_ffmpeg
    except ImportError as error:
        raise PipelineError("DEPENDENCIES_MISSING") from error
    url = f"https://www.bilibili.com/video/{request['bvid']}/?p={request['part']}"
    options = {
        "format": "bestaudio", "outtmpl": str(request["work_dir"] / "course-audio.%(ext)s"),
        "noplaylist": True, "cookiefile": None, "cookiesfrombrowser": None,
        "cachedir": False, "quiet": True, "noprogress": True, "logger": QuietLogger(),
        "socket_timeout": 15, "retries": 1, "fragment_retries": 1,
        "skip_unavailable_fragments": False, "concurrent_fragment_downloads": 1,
        "max_filesize": request["max_audio_bytes"],
        "ffmpeg_location": imageio_ffmpeg.get_ffmpeg_exe(),
        "writeinfojson": False, "writesubtitles": False, "writeautomaticsub": False,
        "geo_bypass": False,
    }
    started = time.perf_counter()
    try:
        with YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=False)
            if not isinstance(info, dict) or info.get("_type") in ["playlist", "multi_video"]:
                raise PipelineError("PART_UNAVAILABLE")
            if info.get("availability") in ["premium_only", "subscriber_only", "needs_auth", "private"]:
                raise PipelineError("ACCESS_UNAVAILABLE")
            duration = info.get("duration")
            if type(duration) not in [int, float] or not math.isfinite(duration) or duration <= 0:
                raise PipelineError("DURATION_UNAVAILABLE")
            if duration > min(7200, request["max_duration_seconds"]):
                raise PipelineError("DURATION_LIMIT")
            if info.get("filesize", 0) and info["filesize"] > request["max_audio_bytes"]:
                raise PipelineError("SIZE_LIMIT")
            media_url = urlparse(info.get("url") or "")
            hostname = (media_url.hostname or "").lower()
            allowed = ["bilivideo.com", "bilivideo.cn", "hdslb.com", "akamaized.net"]
            if media_url.scheme != "https" or not any(hostname == domain or hostname.endswith("." + domain) for domain in allowed):
                raise PipelineError("MEDIA_HOST_UNSUPPORTED")
            if info.get("vcodec") not in [None, "none"]:
                raise PipelineError("AUDIO_UNAVAILABLE")
            downloader.process_info(info)
            audio = Path(downloader.prepare_filename(info)).resolve()
            if audio.parent != request["work_dir"] or not audio.is_file():
                raise PipelineError("AUDIO_UNAVAILABLE")
            if audio.stat().st_size > request["max_audio_bytes"]:
                raise PipelineError("SIZE_LIMIT")
    except PipelineError:
        raise
    except Exception as error:
        raise PipelineError("ACCESS_UNAVAILABLE") from error
    return audio, {"download_seconds": round(time.perf_counter() - started, 2), "source_duration_seconds": float(duration), "source_title": str(info.get("title") or "")[:300], "part": request["part"], "url": url}


def transcribe_audio(audio: Path | str, title: str = "", scope: str = "", model_name: str = "auto", device: str = "cpu", language: str = "zh", max_duration_seconds: int = 7200) -> dict:
    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        raise PipelineError("DEPENDENCIES_MISSING") from error
    model_repository, model_path = resolve_cached_model(model_name)
    started = time.perf_counter()
    try:
        compute_type = "float16" if device == "cuda" else "int8"
        model = WhisperModel(model_path, device=device, compute_type=compute_type, cpu_threads=min(8, os.cpu_count() or 4), num_workers=1, local_files_only=True)
        chunk_length = 15 if model_repository.endswith("-base") else 30
        segments, info = model.transcribe(
            str(audio), language=None if language == "auto" else language, beam_size=5, best_of=1, vad_filter=False,
            word_timestamps=False, initial_prompt=build_initial_prompt(title, scope),
            condition_on_previous_text=False, repetition_penalty=1.1,
            no_repeat_ngram_size=4, compression_ratio_threshold=2.4,
            log_prob_threshold=-1.0, no_speech_threshold=0.6, temperature=0, chunk_length=chunk_length,
        )
        duration = getattr(info, "duration", None)
        if type(duration) not in [int, float] or not math.isfinite(duration) or duration <= 0:
            raise PipelineError("DURATION_UNAVAILABLE")
        if duration > min(7200, max_duration_seconds + 5):
            raise PipelineError("DURATION_LIMIT")
        body, low_confidence, repeated, formula_ranges = [], [], [], []
        total_characters = 0
        for segment in segments:
            content = segment.text.strip()
            if not content:
                continue
            total_characters += len(content)
            if total_characters > MAX_CHARACTERS or len(body) >= MAX_CUES:
                raise PipelineError("TRANSCRIPT_LIMIT")
            cue = {"from": round(segment.start, 3), "to": round(segment.end, 3), "content": content}
            body.append(cue)
            if segment.avg_logprob < -1.0 or segment.no_speech_prob > 0.6 or segment.compression_ratio > 2.4:
                low_confidence.append({"from": cue["from"], "to": cue["to"]})
            if re.search(r"(.{2,8})\1{3,}", content):
                repeated.append({"from": cue["from"], "to": cue["to"]})
            if re.search(r"(?:[A-Za-z][,，、\s]+){2,}|(?:比上|除以|分之|趋于|区零|區零|加[\sA-Za-z]|减[\sA-Za-z]|減[\sA-Za-z])", content):
                formula_ranges.append({"from": cue["from"], "to": cue["to"]})
        if not body:
            raise PipelineError("EMPTY_TRANSCRIPT")
        warnings = ["本地自动语音转写可能错词或漏词，请核对专业术语。", "未识别板书和视频画面；数学公式、图形及原课题干必须回看核对。"]
        if low_confidence:
            warnings.append(f"有 {len(low_confidence)} 段触发语音识别核对阈值，建议回听原课。")
        if repeated:
            warnings.append(f"有 {len(repeated)} 段出现重复文字特征，已保留原始转写，未静默改写。")
        if formula_ranges:
            warnings.append(f"有 {len(formula_ranges)} 段可能包含口述公式，不能仅据语音重建符号，请对照板书。")
        if model_repository.endswith("-base"):
            warnings.append("当前只使用基础语音模型；专业课程建议配置更强的已缓存模型，并结合画面核验。")
        review_ranges = [
            {**span, "reason": reason}
            for reason, spans in [("asr-low-confidence", low_confidence), ("repetition", repeated), ("spoken-formula", formula_ranges)]
            for span in spans
        ]
        return {"ok": True, "body": body, "warnings": warnings, "provenance": {
            "source_kind": "asr", "processed_entire_source": True,
            "engine": "faster-whisper", "engine_version": importlib.metadata.version("faster-whisper"),
            "model": model_repository, "model_downloaded": False, "device": device, "compute_type": compute_type,
            "transcription_seconds": round(time.perf_counter() - started, 2), "audio_duration_seconds": round(duration, 3),
            "processed_entire_selected_audio": True, "has_visual_evidence": False,
            "uses_context_prompt": bool(title or scope), "condition_on_previous_text": False,
            "chunk_length_seconds": chunk_length, "language": info.language,
            "low_confidence_ranges": low_confidence, "repetition_warning_ranges": repeated,
            "spoken_formula_ranges": formula_ranges, "review_ranges": review_ranges,
            "browser_cookies_read": False, "login_used": False,
        }}
    except PipelineError:
        raise
    except Exception as error:
        if device == "cuda" and re.search(r"(?:cublas|cudnn|cuda|driver|dll)", str(error), re.I):
            raise PipelineError("CUDA_UNAVAILABLE") from error
        raise PipelineError("TRANSCRIPTION_FAILED") from error


def main() -> int:
    logging.getLogger("faster_whisper").setLevel(logging.ERROR)
    if sys.argv[1:] == ["--check"]:
        print(json.dumps(check_support(), ensure_ascii=False))
        return 0
    if sys.argv[1:]:
        print(json.dumps({"ok": False, "code": "INVALID_REQUEST"}))
        return 1
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        if len(raw) > MAX_INPUT:
            raise PipelineError("INVALID_REQUEST")
        request = validate_request(json.loads(raw.decode("utf-8")))
        subtitles = try_public_subtitles(request)
        if subtitles:
            print(json.dumps(subtitles, ensure_ascii=False))
            return 0
        # Only the audio fallback needs a cached ASR model. Never download one here.
        if any(importlib.util.find_spec(name) is None for name in ["yt_dlp", "faster_whisper", "av", "imageio_ffmpeg", "huggingface_hub"]):
            raise PipelineError("DEPENDENCIES_MISSING")
        cached_model_path(request["model"])
        audio, download = download_audio(request)
        result = transcribe_audio(audio, request.get("title", ""), request.get("scope", ""), request["model"], request["device"], request["language"], request["max_duration_seconds"])
        result["provenance"].update(download)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except PipelineError as error:
        print(json.dumps({"ok": False, "code": error.code}))
        return 1
    except Exception:
        print(json.dumps({"ok": False, "code": "INVALID_REQUEST"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
