"""Lightweight layout segmentation for photographed homework pages.

This intentionally stays deterministic and dependency-light. It is a routing
aid, not an OCR engine: dark connected rows are grouped into crop regions so
the vision model sees one logical line at a time.
"""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

from PIL import Image, ImageOps


@dataclass(frozen=True)
class LayoutRegion:
    bbox: tuple[int, int, int, int]


def detect_regions(data: bytes, *, min_ink_ratio: float = 0.002) -> list[LayoutRegion]:
    """Return top-to-bottom content bands, ignoring faint ruled-paper lines."""
    try:
        source_context = Image.open(BytesIO(data))
    except Exception:
        return [LayoutRegion((0, 0, 1, 1))]
    with source_context as source:
        image = ImageOps.exif_transpose(source).convert("L")
        width, height = image.size
        # Ink is substantially darker than the page and notebook rules.
        mask = image.point(lambda p: 255 if p < 150 else 0)
        # Ignore the dark table/background visible around a photographed page.
        x0, x1 = max(0, width // 20), min(width, width - width // 20)
        projection = []
        for y in range(height):
            dark = sum(1 for x in range(x0, x1) if mask.getpixel((x, y)))
            projection.append(dark / max(x1 - x0, 1))
        active = [ratio >= min_ink_ratio for ratio in projection]
        bands: list[tuple[int, int]] = []
        start = None
        gap = 0
        for y, is_active in enumerate(active + [False]):
            if is_active and start is None:
                start, gap = y, 0
            elif not is_active and start is not None:
                gap += 1
                if gap > max(8, height // 180):
                    end = y - gap + 1
                    if end - start >= max(8, height // 160):
                        bands.append((start, end))
                    start = None
                    gap = 0
        if not bands:
            return [LayoutRegion((0, 0, width, height))]
        # Merge bands separated by a small gap (subscripts and fraction bars).
        merged: list[tuple[int, int]] = []
        merge_gap = max(18, height // 45)
        for start, end in bands:
            if merged and start - merged[-1][1] <= merge_gap:
                merged[-1] = (merged[-1][0], end)
            else:
                merged.append((start, end))
        pad_y, pad_x = max(12, height // 80), max(16, width // 80)
        regions = []
        for start, end in merged:
            top, bottom = max(0, start - pad_y), min(height, end + pad_y)
            # Crop horizontal whitespace while retaining a little context.
            crop = mask.crop((0, top, width, bottom))
            bbox = crop.getbbox()
            left, right = (bbox[0], bbox[2]) if bbox else (0, width)
            regions.append(LayoutRegion((max(0, left - pad_x), top, min(width, right + pad_x), bottom)))
        return regions
