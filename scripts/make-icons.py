#!/usr/bin/env python3
"""
Draws the Tex-Trak app icon (a frosted-glass card over soft coloured light, with the
scan frame on it) and writes every size the app needs: the Android launcher icons
(legacy + adaptive layers) and the web icons.

    python3 scripts/make-icons.py

Needs Pillow and numpy. The in-app mark (src/components/BrandMark.tsx) and
public/icon.svg are the same design drawn as SVG.
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
S = 1024  # work large, shrink for clean edges


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def background(size):
    """Teal gradient with soft orbs of warm and cool light - the 'colour behind the glass'."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    t = (x * 0.45 + y * 0.55) / size
    c0 = np.array([22, 184, 166], np.float32)
    c1 = np.array([9, 62, 60], np.float32)
    g = c0[None, None, :] * (1 - t[..., None]) + c1[None, None, :] * t[..., None]
    img = Image.fromarray(g.clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')

    def orb(cx, cy, r, colour, alpha):
        layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(layer).ellipse((cx - r, cy - r, cx + r, cy + r), fill=colour + (alpha,))
        return layer.filter(ImageFilter.GaussianBlur(size * 0.085))

    for args in (
        (0.80, 0.18, 0.26, (255, 138, 76), 235),   # warm, top right
        (0.17, 0.84, 0.30, (74, 163, 255), 220),   # cool, bottom left
        (0.28, 0.16, 0.20, (126, 240, 216), 150),  # mint, top left
        (0.85, 0.88, 0.18, (143, 114, 224), 120),  # violet, bottom right
    ):
        img = Image.alpha_composite(img, orb(args[0] * size, args[1] * size, args[2] * size, args[3], args[4]))
    return img


def glass_card(base, frac, radius_frac=0.27, with_backdrop=True):
    """The frosted card with scan glyph, drawn onto `base` (RGBA). Returns the new image."""
    size = base.width
    w = size * frac
    x0 = y0 = (size - w) / 2
    x1 = y1 = x0 + w
    r = w * radius_frac
    box = (x0, y0, x1, y1)

    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, r, fill=255)

    # soft shadow under the card
    sh = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((x0, y0 + w * 0.05, x1, y1 + w * 0.05), r, fill=(2, 30, 30, 120))
    base = Image.alpha_composite(base, sh.filter(ImageFilter.GaussianBlur(w * 0.06)))

    # frosted backdrop: the colours behind the card, blurred
    if with_backdrop:
        blurred = base.filter(ImageFilter.GaussianBlur(w * 0.05))
        base = Image.composite(blurred, base, mask)

    # glass body: a light veil, brighter towards the top-left
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    k = ((xx - x0) * 0.6 + (yy - y0) * 0.4) / w
    veil_a = (np.clip(0.34 - 0.26 * k, 0.06, 0.36) * 255).astype(np.uint8)
    veil = Image.new('RGBA', (size, size), (255, 255, 255, 0))
    veil.putalpha(Image.fromarray(veil_a, 'L'))
    veil.putalpha(Image.composite(veil.getchannel('A'), Image.new('L', (size, size), 0), mask))
    base = Image.alpha_composite(base, veil)

    # specular sheen across the top
    sheen = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(sheen).ellipse((x0 - w * 0.1, y0 - w * 0.55, x1 + w * 0.1, y0 + w * 0.34), fill=(255, 255, 255, 70))
    sheen.putalpha(Image.composite(sheen.getchannel('A').filter(ImageFilter.GaussianBlur(w * 0.03)),
                                   Image.new('L', (size, size), 0), mask))
    base = Image.alpha_composite(base, sheen)

    # rim light: bright on the top-left edge, faint on the bottom-right
    rim = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(rim).rounded_rectangle(box, r, outline=(255, 255, 255, 215), width=max(2, int(w * 0.011)))
    fade = np.clip(1.15 - 1.0 * ((xx - x0) * 0.5 + (yy - y0) * 0.5) / w, 0.18, 1.0)
    rim_a = (np.array(rim.getchannel('A'), np.float32) * fade).astype(np.uint8)
    rim.putalpha(Image.fromarray(rim_a, 'L'))
    base = Image.alpha_composite(base, rim)

    # scan glyph
    glyph = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glyph)
    c = size / 2
    half = w * 0.31
    arm = w * 0.17
    sw = int(w * 0.075)

    def corner(pts):
        gd.line(pts, fill=(255, 255, 255, 250), width=sw, joint='curve')
        for p in (pts[0], pts[-1]):
            gd.ellipse((p[0] - sw / 2, p[1] - sw / 2, p[0] + sw / 2, p[1] + sw / 2), fill=(255, 255, 255, 250))

    corner([(c - half, c - half + arm), (c - half, c - half), (c - half + arm, c - half)])
    corner([(c + half - arm, c - half), (c + half, c - half), (c + half, c - half + arm)])
    corner([(c + half, c + half - arm), (c + half, c + half), (c + half - arm, c + half)])
    corner([(c - half + arm, c + half), (c - half, c + half), (c - half, c + half - arm)])

    # the scan beam: warm glow behind a bright bar
    beam = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(beam).rounded_rectangle((c - half * 0.78, c - sw * 0.9, c + half * 0.78, c + sw * 0.9),
                                           sw, fill=(255, 150, 90, 210))
    glow = beam.filter(ImageFilter.GaussianBlur(w * 0.035))
    sh2 = glyph.filter(ImageFilter.GaussianBlur(w * 0.02))
    shadow = Image.new('RGBA', (size, size), (0, 40, 40, 0))
    shadow.putalpha(sh2.getchannel('A').point(lambda v: int(v * 0.35)))
    base = Image.alpha_composite(base, shadow)
    base = Image.alpha_composite(base, glow)
    bar = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(bar).rounded_rectangle((c - half * 0.74, c - sw / 2, c + half * 0.74, c + sw / 2), sw / 2,
                                          fill=(255, 236, 222, 255))
    base = Image.alpha_composite(base, glyph)
    base = Image.alpha_composite(base, bar)
    return base


def full_icon(frac=0.62):
    return glass_card(background(S), frac)


def foreground_layer(frac):
    """Adaptive-icon foreground: just the card on transparency (the OS supplies the background)."""
    return glass_card(Image.new('RGBA', (S, S), (0, 0, 0, 0)), frac, with_backdrop=False)


def rounded(img, radius_frac):
    m = Image.new('L', img.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, img.width - 1, img.height - 1), img.width * radius_frac, fill=255)
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), m)
    return out


def circle(img):
    m = Image.new('L', img.size, 0)
    ImageDraw.Draw(m).ellipse((0, 0, img.width - 1, img.height - 1), fill=255)
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), m)
    return out


def save(img, path, size):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.resize((size, size), Image.LANCZOS).save(path)


if __name__ == '__main__':
    master = full_icon(0.66)
    bg_only = background(S)
    fg = foreground_layer(0.60)

    res = os.path.join(ROOT, 'android/app/src/main/res')
    for dpi, legacy, adaptive in (('mdpi', 48, 108), ('hdpi', 72, 162), ('xhdpi', 96, 216),
                                  ('xxhdpi', 144, 324), ('xxxhdpi', 192, 432)):
        d = os.path.join(res, f'mipmap-{dpi}')
        save(rounded(master, 0.22), os.path.join(d, 'ic_launcher.png'), legacy)
        save(circle(master), os.path.join(d, 'ic_launcher_round.png'), legacy)
        save(fg, os.path.join(d, 'ic_launcher_foreground.png'), adaptive)
        save(bg_only, os.path.join(d, 'ic_launcher_background.png'), adaptive)

    pub = os.path.join(ROOT, 'public')
    save(master, os.path.join(pub, 'icon-512.png'), 512)
    save(master, os.path.join(pub, 'icon-192.png'), 192)
    save(master, os.path.join(pub, 'apple-touch-icon.png'), 180)
    master.resize((1024, 1024), Image.LANCZOS).save('/tmp/tex-trak-icon-preview.png')
    print('icons written')
