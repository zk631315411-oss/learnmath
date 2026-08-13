"""Validation and normalization for images sent to multimodal models."""

from __future__ import annotations

import base64
import binascii
import hashlib
from dataclasses import dataclass
from io import BytesIO
import re

from PIL import Image, ImageOps, UnidentifiedImageError


IMAGE_UPLOAD_MAX_BYTES = 15 * 1024 * 1024
IMAGE_MAX_PIXELS = 40_000_000
IMAGE_MAX_WIDTH = 2000
IMAGE_MAX_HEIGHT = 2000
IMAGE_MIN_LONG_EDGE = 800
IMAGE_TARGET_RAW_BYTES = 15 * 1024 * 1024 // 4  # 3.75 MiB
IMAGE_MAX_BASE64_BYTES = 5 * 1024 * 1024

_SUPPORTED_FORMATS = {
    "PNG": "image/png",
    "JPEG": "image/jpeg",
    "WEBP": "image/webp",
}
_DATA_URL_RE = re.compile(
    r"^data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$",
    re.IGNORECASE,
)


class ImageProcessingError(ValueError):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class NormalizedImage:
    data: bytes
    media_type: str
    width: int
    height: int
    sha256: str

    def data_url(self) -> str:
        encoded = base64.b64encode(self.data).decode("ascii")
        if len(encoded) > IMAGE_MAX_BASE64_BYTES:
            raise ImageProcessingError("图片编码后仍超过模型的 5 MiB 限制", 413)
        return f"data:{self.media_type};base64,{encoded}"


def _resized_to_limit(image: Image.Image) -> Image.Image:
    width, height = image.size
    scale = min(1.0, IMAGE_MAX_WIDTH / width, IMAGE_MAX_HEIGHT / height)
    if scale >= 1.0:
        return image.copy()
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return image.resize(size, Image.Resampling.LANCZOS)


def _rgb_on_white(image: Image.Image) -> Image.Image:
    if image.mode in ("RGBA", "LA") or "transparency" in image.info:
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, "white")
        background.alpha_composite(rgba)
        return background.convert("RGB")
    return image.convert("RGB")


def _encode(image: Image.Image, image_format: str, **options) -> bytes:
    output = BytesIO()
    candidate = image
    if image_format == "JPEG":
        candidate = _rgb_on_white(image)
    elif image_format == "PNG" and image.mode not in ("1", "L", "LA", "P", "RGB", "RGBA"):
        candidate = image.convert("RGB")
    candidate.save(output, format=image_format, **options)
    return output.getvalue()


def _encoded_candidates(image: Image.Image, source_format: str):
    if source_format == "PNG":
        yield _encode(image, "PNG", optimize=True), "image/png"
        try:
            yield _encode(image, "WEBP", lossless=True, method=6), "image/webp"
        except (OSError, ValueError):
            pass
        for quality in (92, 85, 80):
            yield _encode(image, "JPEG", quality=quality, optimize=True), "image/jpeg"
        return

    if source_format == "WEBP":
        for quality in (92, 85, 80, 70):
            yield _encode(image, "WEBP", quality=quality, method=6), "image/webp"
        return

    for quality in (92, 85, 80, 70):
        yield _encode(image, "JPEG", quality=quality, optimize=True), "image/jpeg"


def _open_verified(data: bytes) -> tuple[Image.Image, str]:
    try:
        with Image.open(BytesIO(data)) as probe:
            source_format = (probe.format or "").upper()
            if source_format not in _SUPPORTED_FORMATS:
                raise ImageProcessingError("仅支持 PNG、JPEG 和 WebP 图片", 415)
            width, height = probe.size
            if width <= 0 or height <= 0:
                raise ImageProcessingError("图片尺寸无效")
            if width * height > IMAGE_MAX_PIXELS:
                raise ImageProcessingError("图片像素总量超过 4000 万限制", 413)
            probe.verify()

        with Image.open(BytesIO(data)) as source:
            source.load()
            normalized = ImageOps.exif_transpose(source)
            normalized.load()
            return normalized.copy(), source_format
    except ImageProcessingError:
        raise
    except Image.DecompressionBombError as exc:
        raise ImageProcessingError("图片像素总量超过安全限制", 413) from exc
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ImageProcessingError("图片为空、损坏或无法解码") from exc


def normalize_image_bytes(
    data: bytes,
    declared_media_type: str | None = None,
    *,
    enforce_upload_limit: bool = True,
) -> NormalizedImage:
    """Decode, orient, strip metadata, resize and compress an uploaded image."""

    del declared_media_type  # The decoded format is authoritative.
    if not data:
        raise ImageProcessingError("图片文件为空")
    if enforce_upload_limit and len(data) > IMAGE_UPLOAD_MAX_BYTES:
        raise ImageProcessingError("图片文件超过 15 MiB 上传限制", 413)

    image, source_format = _open_verified(data)
    current = _resized_to_limit(image)

    while True:
        for encoded, media_type in _encoded_candidates(current, source_format):
            if len(encoded) <= IMAGE_TARGET_RAW_BYTES:
                width, height = current.size
                return NormalizedImage(
                    data=encoded,
                    media_type=media_type,
                    width=width,
                    height=height,
                    sha256=hashlib.sha256(encoded).hexdigest(),
                )

        width, height = current.size
        long_edge = max(width, height)
        if long_edge <= IMAGE_MIN_LONG_EDGE:
            break
        next_long_edge = max(IMAGE_MIN_LONG_EDGE, int(long_edge * 0.85))
        scale = next_long_edge / long_edge
        next_size = (max(1, round(width * scale)), max(1, round(height * scale)))
        if next_size == current.size:
            break
        current = current.resize(next_size, Image.Resampling.LANCZOS)

    raise ImageProcessingError("图片在保持公式可读性的前提下仍然过大，请缩小范围后重试", 413)


def normalize_model_data_url(image_data_url: str) -> str:
    """Revalidate any image, including server-rendered crops, at the API boundary."""

    match = _DATA_URL_RE.fullmatch((image_data_url or "").strip())
    if not match:
        raise ImageProcessingError("模型图片必须是 PNG、JPEG 或 WebP data URL")
    try:
        raw = base64.b64decode(re.sub(r"\s+", "", match.group(2)), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ImageProcessingError("图片 Base64 数据无效") from exc
    return normalize_image_bytes(
        raw,
        match.group(1).lower(),
        enforce_upload_limit=False,
    ).data_url()
