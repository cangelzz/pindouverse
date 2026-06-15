#!/usr/bin/env python3
"""Compose a themed poster from one or more PindouVerse bead-art exports.

Pipeline:
  1. Auto-crop each export to JUST the bead grid (drops the top "PindouVerse ..."
     title bar and the bottom color-count legend).
  2. Lay the cropped arts out (vertical stack by default) on a themed, textured
     background, each inside a themed frame/card with a soft shadow.
  3. Draw an optional title + credit.

Themes are pluggable: a theme is a dict of style params + a background painter +
a frame painter, registered in THEMES. Add a new style by adding one entry.

Usage:
  python make_poster.py --images a.png b.png \
      --theme pink-hearts --ratio 3:4 \
      --title "杀生丸和爆碎牙" --credit "@东门儿烤翅" --out poster.png

Run with --list-themes to see available styles.
Requires: Pillow.  Fonts: tries Windows MS YaHei; override with --font / --font-bold.
"""
import argparse, math, random, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# --------------------------------------------------------------------------
# 1. AUTO-CROP: isolate the bead grid from a PindouVerse export
# --------------------------------------------------------------------------
def crop_pindou_art(path, pad=2):
    """Return the bead-grid region of an export, dropping title bar + legend.

    Strategy: build a 'content' mask (saturated OR dark pixels — i.e. beads and
    grid lines, not near-white background or anti-aliased title text). The export
    is: [title text] gap [GRID] gap [legend swatches]. The GRID is by far the
    tallest run of content rows between blank horizontal bands — pick that run.
    """
    import numpy as np
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(int)
    mx, mn = a.max(2), a.min(2)
    content = ((mx - mn) > 40) | (mx < 150)          # saturated or dark
    dens = content.sum(1)
    blank = dens < (content.shape[1] * 0.004)         # near-empty rows
    # group consecutive non-blank rows into runs, keep the heaviest run
    runs, s = [], None
    for y, b in enumerate(blank):
        if not b and s is None:
            s = y
        elif b and s is not None:
            runs.append((s, y)); s = None
    if s is not None:
        runs.append((s, len(blank)))
    if not runs:
        return im
    top, bot = max(runs, key=lambda r: dens[r[0]:r[1]].sum())
    cols = np.where(content[top:bot].sum(0) > 5)[0]
    left, right = (int(cols.min()), int(cols.max())) if len(cols) else (0, im.width)
    box = (max(0, left - pad), max(0, top - pad),
           min(im.width, right + pad + 1), min(im.height, bot + pad + 1))
    return im.crop(box)

# --------------------------------------------------------------------------
# 2. SHARED DRAWING HELPERS
# --------------------------------------------------------------------------
def heart_poly(cx, cy, s, rot=0):
    pts = []
    for t in range(0, 360, 8):
        a = math.radians(t)
        x = 16 * math.sin(a) ** 3
        y = 13*math.cos(a) - 5*math.cos(2*a) - 2*math.cos(3*a) - math.cos(4*a)
        pts.append((x, -y))
    r = math.radians(rot); out = []
    for x, y in pts:
        out.append((cx + (x*math.cos(r) - y*math.sin(r))*s/16,
                    cy + (x*math.sin(r) + y*math.cos(r))*s/16))
    return out

def vgrad(W, H, top, bot):
    g = Image.new("RGB", (1, H))
    for y in range(H):
        t = y / max(1, H - 1)
        g.putpixel((0, y), tuple(int(top[i] + (bot[i]-top[i])*t) for i in range(3)))
    return g.resize((W, H))

def soft_shadow(poster, x, y, w, h, rad, blur, off, col):
    W, H = poster.size
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([x+10, y+off, x+w+10, y+h+off], rad, fill=col)
    return Image.alpha_composite(poster, sh.filter(ImageFilter.GaussianBlur(blur)))

# --------------------------------------------------------------------------
# 3. THEMES  (background painter + frame painter + title style)
# --------------------------------------------------------------------------
def bg_pink_hearts(W, H, rng):
    p = Image.new("RGB", (W, H), (252, 232, 240)).convert("RGBA")
    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    step = max(110, W // 16)
    for j, yy in enumerate(range(-40, H+120, step)):
        for i, xx in enumerate(range(-40, W+120, step)):
            ox = step//2 if j % 2 else 0
            cx, cy = xx+ox+rng.randint(-10, 10), yy+rng.randint(-10, 10)
            s = rng.randint(int(step*0.30), int(step*0.42))
            col = (250, 196, 216) if (i+j) % 2 == 0 else (252, 214, 228)
            d.polygon(heart_poly(cx, cy, s, rng.uniform(-18, 18)), fill=col+(170,))
    return Image.alpha_composite(p, lay)

def bg_sci(W, H, rng):
    p = vgrad(W, H, (11, 16, 38), (26, 17, 64)).convert("RGBA")
    neb = Image.new("RGBA", (W, H), (0, 0, 0, 0)); nd = ImageDraw.Draw(neb)
    for _ in range(6):
        cx, cy = rng.randint(0, W), rng.randint(0, H)
        r = rng.randint(W//5, W//2)
        col = rng.choice([(80, 40, 160), (30, 120, 170), (150, 40, 120)])
        nd.ellipse([cx-r, cy-r, cx+r, cy+r], fill=col+(40,))
    p = Image.alpha_composite(p, neb.filter(ImageFilter.GaussianBlur(W//12)))
    star = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(star)
    for _ in range(W*H // 1400):
        x, y = rng.randint(0, W), rng.randint(0, H)
        b = rng.randint(120, 255); r = rng.choice([1, 1, 1, 2])
        tint = rng.choice([(b, b, b), (b, b, 255), (180, 255, 255)])
        sd.ellipse([x-r, y-r, x+r, y+r], fill=tint+(rng.randint(120, 255),))
    return Image.alpha_composite(p, star)

def bg_gallery(W, H, rng):
    p = Image.new("RGB", (W, H), (242, 236, 222)).convert("RGBA")
    spec = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(spec)
    for _ in range(W*H // 600):                      # faint paper speckle
        x, y = rng.randint(0, W), rng.randint(0, H)
        v = rng.randint(0, 30)
        sd.point((x, y), fill=(120, 110, 90, v))
    return Image.alpha_composite(p, spec)

def frame_card(poster, art, x, y, cw, ch, pad, rad, th, rng):
    """Generic rounded-card frame, customised by the theme dict `th`."""
    W, H = poster.size
    poster = soft_shadow(poster, x, y, cw, ch, rad, th["shadow_blur"],
                         th["shadow_off"], th["shadow_col"])
    # optional glow (sci)
    if th.get("glow"):
        gl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(gl).rounded_rectangle([x-6, y-6, x+cw+6, y+ch+6], rad+6,
                                             fill=th["glow"])
        poster = Image.alpha_composite(poster, gl.filter(ImageFilter.GaussianBlur(18)))
    card = Image.new("RGB", (cw, ch), th["card_bg"])
    card.paste(art, (pad, pad))
    if th.get("inner_line"):                          # gallery mat inner line
        ImageDraw.Draw(card).rectangle([pad-8, pad-8, cw-pad+7, ch-pad+7],
                                       outline=th["inner_line"], width=2)
    m = Image.new("L", (cw, ch), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, cw-1, ch-1], rad, fill=255)
    poster.paste(card, (x, y), m)
    if th.get("border"):
        ImageDraw.Draw(poster).rounded_rectangle([x, y, x+cw-1, y+ch-1], rad,
                                                 outline=th["border"], width=th.get("border_w", 3))
    if th.get("tape"):                                # washi-tape corners
        tapes = th["tape"]
        for ci, c in enumerate([(x, y), (x+cw, y), (x, y+ch), (x+cw, y+ch)]):
            tp = Image.new("RGBA", (int(cw*0.21), int(cw*0.07)), tapes[ci % len(tapes)]+(150,))
            tp = tp.rotate(45 if ci in (0, 3) else -45, expand=True, resample=Image.BICUBIC)
            poster.alpha_composite(tp, (c[0]-tp.width//2, c[1]-tp.height//2))
    return poster

THEMES = {
    "pink-hearts": dict(bg=bg_pink_hearts, card_bg=(255, 255, 255), radius_f=0.008,
        shadow_col=(140, 80, 100, 95), shadow_blur=24, shadow_off=18,
        tape=[(255, 200, 150), (180, 220, 200), (200, 190, 235), (255, 190, 210)],
        title_col=(214, 84, 128), title_halo=(255, 255, 255), heart_accents=True, pad_f=0.017),
    "sci-fantasy": dict(bg=bg_sci, card_bg=(17, 22, 46), radius_f=0.006,
        shadow_col=(0, 0, 0, 120), shadow_blur=26, shadow_off=20,
        border=(90, 230, 255), border_w=3, glow=(70, 210, 255, 90),
        title_col=(120, 240, 255), title_halo=(20, 40, 80), pad_f=0.012),
    "art-gallery": dict(bg=bg_gallery, card_bg=(252, 250, 245), radius_f=0.002,
        shadow_col=(60, 50, 40, 80), shadow_blur=18, shadow_off=14,
        inner_line=(120, 110, 95), border=(70, 60, 50), border_w=2,
        title_col=(60, 50, 42), title_halo=None, pad_f=0.045),
}

# --------------------------------------------------------------------------
# 4. LAYOUT + COMPOSE
# --------------------------------------------------------------------------
def load_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return None

def compose(images, theme, ratio, title, credit, out, base_w, font_path, font_bold, seed):
    th = THEMES[theme]
    rw, rh = (int(x) for x in ratio.split(":"))
    W = base_w; H = int(round(W * rh / rw))
    rng = random.Random(seed)
    poster = th["bg"](W, H, rng).convert("RGBA")

    arts = [crop_pindou_art(p) for p in images]
    n = len(arts)
    pad = int(W * th["pad_f"])
    rad = max(6, int(W * th["radius_f"]))
    gap = int(W * 0.05)
    title_band = int(H * 0.075) if title else int(H * 0.02)
    bottom = int(H * 0.04) if credit else int(H * 0.02)
    side_min = int(W * 0.09)

    avail = H - title_band - bottom - (n-1)*gap - n*2*pad
    inv = sum(1.0/(im.width/im.height) for im in arts)   # sum of art_h per unit art_w
    art_w = avail / inv
    art_w = min(art_w, W - 2*side_min)
    art_w = int(art_w)

    sized, total = [], 0
    for im in arts:
        ah = int(art_w / (im.width/im.height))
        sized.append(im.resize((art_w, ah), Image.LANCZOS)); total += ah + 2*pad
    extra = (H - title_band - bottom - total - (n-1)*gap)
    y = title_band + max(0, extra)//2
    cw = art_w + 2*pad
    x = (W - cw)//2
    for im in sized:
        ch = im.height + 2*pad
        poster = frame_card(poster, im, x, y, cw, ch, pad, rad, th, rng)
        y += ch + gap

    poster = poster.convert("RGB"); d = ImageDraw.Draw(poster)
    if title:
        fb = load_font(font_bold, int(W*0.051)) or ImageFont.load_default()
        b = d.textbbox((0, 0), title, font=fb); tw = b[2]-b[0]; tht = b[3]-b[1]
        tx = (W-tw)//2; ty = title_band//2 - tht//2 - b[1]
        if th.get("title_halo"):
            for dx in (-3, 0, 3):
                for dy in (-3, 0, 3):
                    d.text((tx+dx, ty+dy), title, font=fb, fill=th["title_halo"])
        d.text((tx, ty), title, font=fb, fill=th["title_col"])
        if th.get("heart_accents"):
            hy = title_band//2
            for hx, sgn in [(tx-70, -1), (tx+tw+70, 1)]:
                d.polygon(heart_poly(hx, hy, 58, sgn*12), fill=(232, 96, 138))
                d.polygon(heart_poly(hx, hy, 40, sgn*12), fill=(255, 182, 205))
    if credit:
        fc = load_font(font_path, int(W*0.020)) or ImageFont.load_default()
        b = d.textbbox((0, 0), credit, font=fc)
        d.text(((W-(b[2]-b[0]))//2, H-bottom+int(H*0.006)), credit, font=fc, fill=th["title_col"])
    poster.save(out)
    return poster.size

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", nargs="+", help="one or more PindouVerse export PNGs")
    ap.add_argument("--theme", default="pink-hearts")
    ap.add_argument("--ratio", default="3:4", help="W:H, e.g. 3:4")
    ap.add_argument("--title", default="")
    ap.add_argument("--credit", default="")
    ap.add_argument("--out", default="poster.png")
    ap.add_argument("--width", type=int, default=2400)
    ap.add_argument("--font", default="C:/Windows/Fonts/msyh.ttc")
    ap.add_argument("--font-bold", default="C:/Windows/Fonts/msyhbd.ttc")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--list-themes", action="store_true")
    a = ap.parse_args()
    if a.list_themes:
        print("themes:", ", ".join(THEMES)); return
    if not a.images:
        ap.error("--images required")
    if a.theme not in THEMES:
        ap.error(f"unknown theme '{a.theme}'. choices: {', '.join(THEMES)}")
    sz = compose(a.images, a.theme, a.ratio, a.title, a.credit, a.out,
                 a.width, a.font, a.font_bold, a.seed)
    print(f"saved {a.out} {sz} theme={a.theme}")

if __name__ == "__main__":
    main()
