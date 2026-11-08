"""Bounded local Docling adapter. stdout is a single JSON protocol message.

Model installation is explicit (--download-models); request-time conversion is
offline and never silently installs/downloads a model or enables formula VLMs.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.metadata
import inspect
import json
import os
from pathlib import Path
import shutil
import sys
import threading
import time
import zipfile

MAX_INPUT = 20 * 1024 * 1024
MAX_EXPANDED = 60 * 1024 * 1024
MAX_TEXT = 1_000_000
MAX_OUTPUT = 8 * 1024 * 1024
MANIFEST = ".shifen-models.json"

# The fixed RapidOCR wheel ships its default ONNX models. These digests are
# from rapidocr 3.10.0's own default_models.yaml (official model registry).
RAPID_MODELS = {
    "PP-OCRv6_det_small.onnx": ("PP-OCRv6/det", "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f"),
    "PP-OCRv6_rec_small.onnx": ("PP-OCRv6/rec", "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884"),
    "ch_ppocr_mobile_v2.0_cls_mobile.onnx": ("PP-OCRv4/cls", "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c"),
}


def sha256_file(source: Path) -> str:
    digest = hashlib.sha256()
    with source.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pdf_assets_present(directory: Path) -> bool:
    required = [
        "docling-project--docling-layout-heron/config.json",
        "docling-project--docling-layout-heron/preprocessor_config.json",
        "docling-project--docling-layout-heron/model.safetensors",
        "docling-project--docling-models/model_artifacts/tableformer/accurate/tm_config.json",
        "docling-project--docling-models/model_artifacts/tableformer/accurate/tableformer_accurate.safetensors",
    ]
    return all((directory / item).is_file() and (directory / item).stat().st_size > 0 for item in required)


def prepare_rapid_models(directory: Path) -> None:
    import rapidocr
    import requests
    bundled = Path(rapidocr.__file__).parent / "models"
    target = directory / "RapidOcr"
    target.mkdir(parents=True, exist_ok=True)
    for name, (folder, expected) in RAPID_MODELS.items():
        destination = target / name
        if destination.is_file() and sha256_file(destination) == expected:
            continue
        packaged = bundled / name
        if packaged.is_file() and sha256_file(packaged) == expected:
            shutil.copyfile(packaged, destination)
            print(f"Reused verified official RapidOCR wheel model: {name}", file=sys.stderr, flush=True)
            continue
        # Missing wheel assets use the URL from the same official registry,
        # with connection, idle-read, total-file time and size limits.
        url = f"https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/{folder}/{name}"
        partial = destination.with_suffix(".part")
        started = time.monotonic()
        try:
            with requests.get(url, stream=True, timeout=(10, 30)) as response:
                response.raise_for_status()
                size = 0
                with partial.open("wb") as stream:
                    for chunk in response.iter_content(1024 * 1024):
                        size += len(chunk)
                        if size > 64 * 1024 * 1024 or time.monotonic() - started > 120:
                            raise PublicError("MODEL_DOWNLOAD_TIMEOUT")
                        stream.write(chunk)
            if sha256_file(partial) != expected:
                raise PublicError("MODEL_CHECKSUM_MISMATCH")
            partial.replace(destination)
        finally:
            partial.unlink(missing_ok=True)


class PublicError(Exception):
    def __init__(self, code: str):
        self.code = code


def emit(value: dict) -> None:
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > MAX_OUTPUT:
        raise PublicError("LIMIT_EXCEEDED")
    print(encoded, flush=True)


def model_readiness(directory: Path) -> tuple[bool, bool]:
    try:
        manifest = json.loads((directory / MANIFEST).read_text(encoding="utf-8"))
        if manifest.get("docling") != importlib.metadata.version("docling"):
            return False, False
        entries = manifest["files"]
        if not entries or len(entries) > 5000:
            return False, False
        for entry in entries:
            candidate = (directory / entry["path"]).resolve()
            if not candidate.is_relative_to(directory.resolve()) or not candidate.is_file() or candidate.stat().st_size != entry["size"]:
                return False, False
        return manifest.get("pdf") is True, manifest.get("ocr") is True
    except (OSError, KeyError, ValueError, importlib.metadata.PackageNotFoundError):
        return False, False


def probe(directory: Path) -> dict:
    try:
        version = importlib.metadata.version("docling")
        from docling.document_converter import DocumentConverter  # noqa: F401
        pdf_ready, ocr_ready = model_readiness(directory)
        return {"available": True, "version": version, "structuredPdfReady": pdf_ready,
                "ocrReady": ocr_ready, "formula": False}
    except Exception:
        return {"available": False, "ocrReady": False, "formula": False}


def download_models(directory: Path) -> dict:
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    os.environ["HF_HUB_DISABLE_XET"] = "1"
    os.environ["HF_HUB_ETAG_TIMEOUT"] = "15"
    os.environ["HF_HUB_DOWNLOAD_TIMEOUT"] = "120"
    print("Preparing official Docling model downloader.", file=sys.stderr, flush=True)
    from docling.utils.model_downloader import download_models as fetch_models
    print("Preparing official layout, table and OCR weights.", file=sys.stderr, flush=True)
    directory.mkdir(parents=True, exist_ok=True)
    requested = {
        "output_dir": directory, "progress": True, "with_layout": True, "with_tableformer": True,
        "with_rapidocr": False, "with_code_formula": False,
        "with_picture_classifier": False, "with_smolvlm": False,
        "with_granitedocling": False, "with_easyocr": False,
    }
    accepted = inspect.signature(fetch_models).parameters
    if not pdf_assets_present(directory):
        fetch_models(**{key: value for key, value in requested.items() if key in accepted})
    prepare_rapid_models(directory)
    if not pdf_assets_present(directory):
        raise PublicError("MODELS_MISSING")
    files = [{"path": str(item.relative_to(directory)).replace("\\", "/"), "size": item.stat().st_size, "sha256": sha256_file(item)}
             for item in sorted(directory.rglob("*")) if item.is_file() and item.name != MANIFEST and ".cache" not in item.parts and item.suffix not in {".incomplete", ".lock", ".part"}]
    if not files:
        raise PublicError("MODELS_MISSING")
    manifest = {"docling": importlib.metadata.version("docling"), "rapidocr": importlib.metadata.version("rapidocr"),
                "pdf": True, "ocr": True, "files": files}
    (directory / MANIFEST).write_text(json.dumps(manifest), encoding="utf-8")
    return {"downloaded": True, "files": len(files), "bytes": sum(item["size"] for item in files),
            "version": manifest["docling"], "formula": False}


def validate_input(source: Path, kind: str) -> None:
    if kind not in {"pdf", "docx", "pptx"} or not source.is_file():
        raise PublicError("INVALID_INPUT")
    if source.stat().st_size > MAX_INPUT:
        raise PublicError("LIMIT_EXCEEDED")
    if kind == "pdf":
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(source)
        try:
            if len(pdf) > 250 or len(pdf) < 1:
                raise PublicError("LIMIT_EXCEEDED")
        finally:
            pdf.close()
    else:
        with zipfile.ZipFile(source) as archive:
            entries = archive.infolist()
            if len(entries) > 2500 or sum(item.file_size for item in entries) > MAX_EXPANDED:
                raise PublicError("LIMIT_EXCEEDED")
            total = 0
            for item in entries:
                with archive.open(item) as stream:
                    while chunk := stream.read(1024 * 1024):
                        total += len(chunk)
                        if total > MAX_EXPANDED:
                            raise PublicError("LIMIT_EXCEEDED")


def bbox_value(value) -> dict | None:
    if value is None:
        return None
    origin = getattr(value.coord_origin, "value", str(value.coord_origin)).upper()
    return {"l": value.l, "t": value.t, "r": value.r, "b": value.b, "coordOrigin": origin}


def convert(source: Path, kind: str, directory: Path, ocr: str) -> dict:
    validate_input(source, kind)
    # Prevent accidental network calls when this script is used outside Node.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions
    from docling.datamodel.accelerator_options import AcceleratorOptions, AcceleratorDevice
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.backend.pypdfium2_backend import PyPdfiumDocumentBackend
    options = {}
    use_ocr = kind == "pdf" and ocr != "off"
    if kind == "pdf":
        pdf_ready, ocr_ready = model_readiness(directory)
        if not pdf_ready or (use_ocr and not ocr_ready):
            raise PublicError("MODELS_MISSING")
        pipeline = PdfPipelineOptions(
            artifacts_path=directory, do_ocr=use_ocr, do_table_structure=True,
            do_formula_enrichment=False, do_code_enrichment=False,
            do_picture_description=False, do_picture_classification=False,
            enable_remote_services=False,
            accelerator_options=AcceleratorOptions(device=AcceleratorDevice.CPU, num_threads=4),
        )
        pipeline.ocr_options = RapidOcrOptions(backend="onnxruntime", lang=["iso:zh-Hans"])
        # The native docling-parse wheel cannot open its glyph resources from
        # this Windows Unicode workspace path. Docling's official PDFium
        # backend keeps OCR/layout/provenance while avoiding that resource path.
        options[InputFormat.PDF] = PdfFormatOption(pipeline_options=pipeline, backend=PyPdfiumDocumentBackend)
    converter = DocumentConverter(allowed_formats=[{"pdf": InputFormat.PDF, "docx": InputFormat.DOCX, "pptx": InputFormat.PPTX}[kind]], format_options=options)
    result = converter.convert(source, raises_on_error=True, max_file_size=MAX_INPUT, max_num_pages=250)
    document = result.document
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()[:16]
    blocks, chunks, tables = [], [], []
    total_text = 0
    section = 0
    for item, _level in document.iterate_items():
        label = getattr(item.label, "value", str(item.label))
        content = getattr(item, "text", "") or ""
        if label == "table":
            content = item.export_to_markdown(doc=document)
        content = str(content).replace("\x00", "")
        if not content.strip():
            continue
        total_text += len(content)
        if total_text > MAX_TEXT or len(blocks) >= 10000:
            raise PublicError("LIMIT_EXCEEDED")
        ref = item.self_ref
        section += 1
        provenances = list(getattr(item, "prov", []) or []) if kind != "docx" else []
        if not provenances:
            provenances = [None]
        for index, prov in enumerate(provenances):
            block_id = f"docling:{source_hash}:{ref}:{index}"
            block = {"id": block_id, "text": content, "label": label, "sourceRef": ref}
            if kind == "docx":
                block["section"] = section
            elif prov is not None:
                block["page"] = prov.page_no
                block["bbox"] = bbox_value(prov.bbox)
                block["charspan"] = list(prov.charspan)
                start, end = prov.charspan
                if 0 <= start < end <= len(content):
                    block["text"] = content[start:end]
            blocks.append(block)
            # Never invent a PDF/PPTX page for content without provenance.
            if kind != "docx" and "page" not in block:
                continue
            for offset in range(0, len(block["text"]), 1200):
                text = block["text"][offset:offset + 1200]
                chunks.append({"id": hashlib.sha256(f"{block_id}:{offset}".encode()).hexdigest()[:24],
                               "page": section if kind == "docx" else block["page"],
                               "text": text, "blockId": block_id, "sourceRef": ref,
                               **({"section": section} if kind == "docx" else {}),
                               **({"bbox": block["bbox"], "charspan": block["charspan"]} if "bbox" in block else {})})
                if len(chunks) > 5000:
                    raise PublicError("LIMIT_EXCEEDED")
        if label == "table":
            data = item.data
            tables.append({"id": ref, "rows": data.num_rows, "columns": data.num_cols})
    if not chunks:
        raise PublicError("NO_TEXT")
    pages = []
    if kind != "docx":
        for page_no, page in document.pages.items():
            pages.append({"page": int(page_no), "width": page.size.width, "height": page.size.height})
    return {"type": kind.upper(), "locationKind": "section" if kind == "docx" else "page",
            "parser": {"engine": "docling", "version": importlib.metadata.version("docling"), "ocr": use_ocr, "formula": False,
                       **({"backend": "pypdfium2"} if kind == "pdf" else {})},
            "chunks": chunks, "structure": {"blocks": blocks, "pages": pages, "tables": tables}}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--download-models", action="store_true")
    parser.add_argument("--download-timeout", type=int, default=300)
    parser.add_argument("--artifacts-path", type=Path, required=True)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--type", choices=["pdf", "docx", "pptx"])
    parser.add_argument("--ocr", choices=["auto", "off"], default="auto")
    args = parser.parse_args()
    install_timer = None
    if args.download_models:
        protocol_stdout = sys.stdout
        def install_timeout():
            protocol_stdout.write('{"error":{"code":"MODEL_DOWNLOAD_TIMEOUT"}}\n')
            protocol_stdout.flush()
            os._exit(1)
        install_timer = threading.Timer(max(30, min(args.download_timeout, 600)), install_timeout)
        install_timer.daemon = True
        install_timer.start()
    try:
        # Libraries may print startup banners; keep the JSON wire protocol clean.
        with contextlib.redirect_stdout(sys.stderr):
            if args.probe:
                output = probe(args.artifacts_path)
            elif args.download_models:
                output = download_models(args.artifacts_path)
            elif args.input and args.type:
                output = convert(args.input, args.type, args.artifacts_path, args.ocr)
            else:
                raise PublicError("INVALID_INPUT")
        emit(output)
        return 0
    except PublicError as error:
        emit({"error": {"code": error.code}})
        return 1
    except Exception as error:
        # A public adapter must not emit tracebacks, local paths or environment.
        print(f"Docling adapter failed ({type(error).__name__}).", file=sys.stderr)
        emit({"error": {"code": "CONVERSION_FAILED"}})
        return 1
    finally:
        if install_timer is not None:
            install_timer.cancel()


if __name__ == "__main__":
    sys.exit(main())
