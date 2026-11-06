#!/usr/bin/env python3
"""Regenerates the WebP variants in src/assets/img from the originals in public/.
Run manually after replacing a source image: python scripts/optimize-images.py (needs Pillow).
The originals stay in public/ because old links, OG tags and JSON-LD may point at them.
Files imported from src/ get hashed names, which the host serves with immutable caching."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src/assets/img"
# source, widths, WebP quality
JOBS = [
    # Heroes crop to the section height (object-cover), so phones need the full width too.
    ("hero-home1.png", [1408], 80), ("hero-home3.png", [1408], 80),
    ("hero-home4.png", [1408], 80), ("hero-home5.png", [1408], 80),
    ("about.png", [828, 1408], 75), ("blog.png", [828, 1080], 75), ("protfolio.png", [640, 828, 1043], 78),
    ("home-service.jpg", [828, 1600], 72), ("woman-enjoying-vr-headset.jpg", [828, 1600, 1920], 72),
    ("robo.jpg", [828, 1600], 75), ("zyllo-logo.png", [240, 320, 480, 960], 88), ("zyllo-icon.png", [128, 256], 88),
]
for name, widths, quality in JOBS:
    src = Image.open(ROOT / "public" / name)
    src = src.convert("RGBA" if src.mode in ("RGBA", "P", "LA") else "RGB")
    for w in widths:
        h = round(src.height * w / src.width)
        img = src if w == src.width else src.resize((w, h), Image.LANCZOS)
        path = OUT / f"{Path(name).stem}-{w}.webp"
        img.save(path, "WEBP", quality=quality, method=6)
        print(f"{path.name:44} {path.stat().st_size // 1024:6} KB")

# Favicon: the source is 2816x1536, so the aspect ratio is kept to render as it does today.
fav = Image.open(ROOT / "public/Zyllo_Tech_Favicon_512x512.png").convert("RGBA")
for name, size in (("zyllo-favicon.png", (176, 96)), ("zyllo-apple-touch-icon.png", (352, 192))):
    icon = fav.resize(size, Image.LANCZOS).quantize(256, method=Image.FASTOCTREE)
    icon.save(ROOT / "public" / name, "PNG", optimize=True)
    print(name, (ROOT / "public" / name).stat().st_size // 1024, "KB")
