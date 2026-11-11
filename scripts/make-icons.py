#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Draw the app icons (original artwork for this project) into app/icons/.

Design: warm coral-to-pink rounded square, a white camera lens ring and a small
four-point sparkle. Same geometry as app/icons/icon.svg. Needs Pillow:

    python3 scripts/make-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "app" / "icons"
SS = 4  # supersampling for anti-aliasing
TOP = (255, 122, 89)  # --accent #ff7a59
BOTTOM = (232, 67, 147)  # #e84393


def gradient(size):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x * 0.35 + y * 0.65) / size
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM))
    return img


def draw(size, *, rounded, scale):
    """scale: content size relative to the canvas (maskable icons need a safe zone)."""
    S = size * SS
    bg = gradient(S).convert("RGBA")
    if rounded:
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=round(S * 0.22), fill=255)
        bg.putalpha(mask)
    d = ImageDraw.Draw(bg)
    c = S / 2
    k = S * scale
    # lens: white ring + inner dot
    r_out, r_in = k * 0.30, k * 0.22
    d.ellipse([c - r_out, c - r_out, c + r_out, c + r_out], fill=(255, 255, 255, 255))
    inner = Image.new("L", (S, S), 0)
    ImageDraw.Draw(inner).ellipse([c - r_in, c - r_in, c + r_in, c + r_in], fill=255)
    bg.paste(gradient(S).convert("RGBA"), (0, 0), inner)
    r_dot = k * 0.09
    d.ellipse([c - r_dot, c - r_dot, c + r_dot, c + r_dot], fill=(255, 255, 255, 235))
    # sparkle at top right
    sx, sy, sr = c + k * 0.30, c - k * 0.30, k * 0.13
    w = sr * 0.28
    d.polygon([(sx, sy - sr), (sx + w, sy - w), (sx + sr, sy), (sx + w, sy + w), (sx, sy + sr), (sx - w, sy + w), (sx - sr, sy), (sx - w, sy - w)], fill=(255, 255, 255, 255))
    return bg.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    draw(192, rounded=True, scale=1.0).save(OUT / "icon-192.png", optimize=True)
    draw(512, rounded=True, scale=1.0).save(OUT / "icon-512.png", optimize=True)
    # maskable: full bleed, content inside the central 80% safe zone
    draw(512, rounded=False, scale=0.78).convert("RGB").save(OUT / "icon-maskable-512.png", optimize=True)
    # iOS rounds the corners itself and shows black behind transparency, so no alpha
    draw(180, rounded=False, scale=0.9).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)


if __name__ == "__main__":
    main()
