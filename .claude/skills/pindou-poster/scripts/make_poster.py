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
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

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

def draw_apple(d, cx, cy, s, fill, stem=None):
    """A small, recognisable apple (two lobes + body), optional stem."""
    r = s*0.30; o = s*0.18
    d.ellipse([cx-o-r, cy-r, cx-o+r, cy+r], fill=fill)
    d.ellipse([cx+o-r, cy-r, cx+o+r, cy+r], fill=fill)
    d.ellipse([cx-r*1.15, cy-r*0.4, cx+r*1.15, cy+r*1.35], fill=fill)
    if stem:
        d.line([(cx, cy-r*0.9), (cx+s*0.06, cy-r-s*0.22)], fill=stem, width=max(2, int(s*0.05)))

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

def bg_deathnote(W, H, rng):
    """Aged notebook page: warm parchment gradient, faint crimson glow, red ruled
    lines (the Death Note page), and drifting muted-red apple silhouettes. Light."""
    p = vgrad(W, H, (238, 230, 214), (220, 208, 188)).convert("RGBA")
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    r = int(W*0.60); cx, cy = W//2, int(H*0.42)
    ImageDraw.Draw(glow).ellipse([cx-r, cy-r, cx+r, cy+r], fill=(190, 40, 48, 28))
    p = Image.alpha_composite(p, glow.filter(ImageFilter.GaussianBlur(W//6)))
    ln = Image.new("RGBA", (W, H), (0, 0, 0, 0)); ld = ImageDraw.Draw(ln)
    for y in range(int(H*0.05), H, max(36, H//42)):  # red notebook ruling
        ld.line([(int(W*0.04), y), (int(W*0.96), y)], fill=(150, 30, 36, 26), width=2)
    p = Image.alpha_composite(p, ln)
    ap = Image.new("RGBA", (W, H), (0, 0, 0, 0)); ad = ImageDraw.Draw(ap)
    for _ in range(7):
        draw_apple(ad, rng.randint(0, W), rng.randint(0, H),
                   rng.randint(W//12, W//6), (170, 40, 46, 26))
    return Image.alpha_composite(p, ap.filter(ImageFilter.GaussianBlur(4)))

def bg_deathnote_noir(W, H, rng):
    """Dark gothic: near-black gradient, crimson glow, faint ruled notebook lines,
    drifting blood-red apple silhouettes, and an edge vignette."""
    p = vgrad(W, H, (10, 9, 11), (26, 7, 10)).convert("RGBA")
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    r = int(W*0.62); cx, cy = W//2, int(H*0.40)
    ImageDraw.Draw(glow).ellipse([cx-r, cy-r, cx+r, cy+r], fill=(150, 18, 28, 75))
    p = Image.alpha_composite(p, glow.filter(ImageFilter.GaussianBlur(W//6)))
    ln = Image.new("RGBA", (W, H), (0, 0, 0, 0)); ld = ImageDraw.Draw(ln)
    for y in range(int(H*0.05), H, max(36, H//42)):  # faint notebook ruling
        ld.line([(int(W*0.04), y), (int(W*0.96), y)], fill=(255, 255, 255, 9), width=2)
    p = Image.alpha_composite(p, ln)
    ap = Image.new("RGBA", (W, H), (0, 0, 0, 0)); ad = ImageDraw.Draw(ap)
    for _ in range(7):
        draw_apple(ad, rng.randint(0, W), rng.randint(0, H),
                   rng.randint(W//12, W//6), (120, 16, 24, 30))
    p = Image.alpha_composite(p, ap.filter(ImageFilter.GaussianBlur(4)))
    vig = Image.new("L", (W, H), 0)                  # edge vignette
    ImageDraw.Draw(vig).ellipse([int(W*0.06), int(H*0.05), int(W*0.94), int(H*0.95)], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(W//6))
    dark = Image.new("RGBA", (W, H), (0, 0, 0, 175)); dark.putalpha(ImageOps.invert(vig))
    return Image.alpha_composite(p, dark)

def bg_village(W, H, rng):
    """Countryside small town easing into a grassy foreground: warm sky-to-meadow
    gradient, a soft sun, two rolling hills, a terracotta-roof cottage skyline, and
    a band of bushes + grass blades along the bottom that fades in toward the edge."""
    p = vgrad(W, H, (231, 226, 205), (181, 190, 138)).convert("RGBA")
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))           # soft sun, upper-left
    r = int(W*0.42); cx, cy = int(W*0.30), int(H*0.18)
    ImageDraw.Draw(glow).ellipse([cx-r, cy-r, cx+r, cy+r], fill=(255, 240, 198, 60))
    p = Image.alpha_composite(p, glow.filter(ImageFilter.GaussianBlur(W//7)))
    hl = Image.new("RGBA", (W, H), (0, 0, 0, 0)); hd = ImageDraw.Draw(hl)
    for yf, col, ph in [(0.72, (150, 162, 116, 130), 9.0), (0.80, (132, 150, 104, 150), 4.0)]:
        base = int(H*yf); amp = int(H*0.05)
        pts = [(0, H)]
        for xx in range(0, W+1, max(8, W//60)):
            pts.append((xx, base + int(amp*math.sin(xx/W*math.pi*2 + ph))))
        pts += [(W, H)]
        hd.polygon(pts, fill=col)
    p = Image.alpha_composite(p, hl)
    cot = Image.new("RGBA", (W, H), (0, 0, 0, 0)); cd = ImageDraw.Draw(cot)
    ground = int(H*0.84); x = -int(W*0.04)
    while x < W:                                             # cottage skyline
        wdt = rng.randint(int(W*0.05), int(W*0.085))
        ht = rng.randint(int(wdt*0.7), int(wdt*1.05))
        wall = rng.choice([(206, 188, 158), (196, 176, 150), (214, 198, 168)])
        roof = rng.choice([(168, 92, 66), (150, 80, 58), (178, 104, 74)])
        by = ground - ht; oh = int(wdt*0.14)
        cd.rectangle([x, by, x+wdt, ground], fill=wall+(205,))
        cd.polygon([(x-oh, by), (x+wdt+oh, by), (x+wdt//2, by-int(ht*0.5))], fill=roof+(215,))
        x += wdt + rng.randint(int(W*0.006), int(W*0.03))
    p = Image.alpha_composite(p, cot)
    gr = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(gr)
    gtop = int(H*0.78)                                       # grass/bush foreground
    for _ in range(int(W/22)):                               # bush clumps, denser low
        frac = rng.random()**0.5
        by = gtop + int((H-gtop)*(0.40+0.60*frac)); bx = rng.randint(0, W)
        bw = rng.randint(int(W*0.05), int(W*0.11)); bh = int(bw*rng.uniform(0.45, 0.70))
        col = rng.choice([(96, 120, 66), (82, 108, 56), (110, 134, 78)])
        gd.ellipse([bx-bw, by-bh, bx+bw, by+bh], fill=col+(int(120+110*frac),))
    for _ in range(int(W*1.3)):                              # grass blades, fade up
        frac = rng.random()**0.5
        gy = gtop + int((H-gtop)*(0.15+0.85*frac)); gx = rng.randint(0, W)
        bl = rng.randint(int(H*0.02), int(H*0.055)); sway = rng.randint(-bl//3, bl//3)
        sh = rng.randint(-18, 18); col = (88+sh, 116+sh, 62+sh)
        gd.line([(gx, gy), (gx+sway, gy-bl)], fill=col+(int(110+120*frac),), width=rng.choice([2, 2, 3]))
    p = Image.alpha_composite(p, gr)
    spec = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(spec)
    for _ in range(W*H // 700):                             # faint earthy speckle
        sd.point((rng.randint(0, W), rng.randint(0, H)), fill=(110, 96, 70, rng.randint(0, 26)))
    return Image.alpha_composite(p, spec)

def bg_beach(W, H, rng):
    """Stylised seaside *texture* (not a literal scene): a soft aqua→sand gradient
    washed with blurred light blooms, layered wavy ripple strokes (water caustics up
    top, sand ripples low) and foam flecks. Organic — reads well where only edges show."""
    p = vgrad(W, H, (78, 174, 196), (228, 214, 176)).convert("RGBA")   # sea → sand
    bl = Image.new("RGBA", (W, H), (0, 0, 0, 0)); bd = ImageDraw.Draw(bl)
    for _ in range(8):                                       # soft light blooms
        cx, cy = rng.randint(0, W), rng.randint(0, int(H*0.72)); r = rng.randint(W//6, W//3)
        col = rng.choice([(150, 226, 230), (104, 198, 212), (206, 242, 240)])
        bd.ellipse([cx-r, cy-r, cx+r, cy+r], fill=col+(48,))
    p = Image.alpha_composite(p, bl.filter(ImageFilter.GaussianBlur(W//9)))
    wv = Image.new("RGBA", (W, H), (0, 0, 0, 0)); wd = ImageDraw.Draw(wv)
    for _ in range(int(H*0.95)):                             # wavy ripple strokes
        y = rng.randint(0, H); x0 = rng.randint(-60, W); ln = rng.randint(int(W*0.06), int(W*0.22))
        amp = rng.randint(3, 9); ph = rng.uniform(0, 6.28); t = y / H
        if t < 0.62:                                         # water caustics
            col = rng.choice([(236, 250, 250), (182, 232, 235), (120, 206, 214)]); a = rng.randint(30, 90)
        else:                                                # sand ripples
            col = rng.choice([(208, 188, 144), (226, 211, 172), (190, 168, 126)]); a = rng.randint(25, 70)
        pts = [(x0+i, y+int(amp*math.sin(i/18.0+ph))) for i in range(0, ln, 6)]
        if len(pts) > 1:
            wd.line(pts, fill=col+(a,), width=2)
    p = Image.alpha_composite(p, wv.filter(ImageFilter.GaussianBlur(1)))
    fk = Image.new("RGBA", (W, H), (0, 0, 0, 0)); fd = ImageDraw.Draw(fk)
    for _ in range(W*H // 1600):                             # foam flecks
        x, y = rng.randint(0, W), rng.randint(0, int(H*0.66)); r = rng.choice([1, 1, 2])
        fd.ellipse([x-r, y-r, x+r, y+r], fill=(255, 255, 255, rng.randint(60, 150)))
    return Image.alpha_composite(p, fk)

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
    "deathnote": dict(bg=bg_deathnote, card_bg=(252, 250, 244), radius_f=0.004,
        shadow_col=(80, 30, 30, 90), shadow_blur=22, shadow_off=16,
        border=(160, 26, 34), border_w=4, inner_line=(170, 40, 48),
        title_col=(150, 22, 30), title_halo=(255, 250, 242), apple_accents=True, pad_f=0.016),
    "deathnote-noir": dict(bg=bg_deathnote_noir, card_bg=(14, 14, 16), radius_f=0.004,
        shadow_col=(0, 0, 0, 160), shadow_blur=28, shadow_off=22,
        border=(176, 20, 32), border_w=4, glow=(190, 20, 30, 90),
        title_col=(214, 28, 38), title_halo=(0, 0, 0), apple_accents=True, pad_f=0.016),
    "village": dict(bg=bg_village, card_bg=(250, 245, 233), radius_f=0.006,
        shadow_col=(70, 55, 35, 95), shadow_blur=22, shadow_off=16,
        border=(120, 86, 54), border_w=4, inner_line=(150, 120, 84),
        title_col=(86, 60, 38), title_halo=(250, 245, 233), pad_f=0.02),
    "beach": dict(bg=bg_beach, card_bg=(250, 247, 238), radius_f=0.006,
        shadow_col=(40, 70, 80, 90), shadow_blur=22, shadow_off=16,
        border=(86, 140, 150), border_w=4, inner_line=(150, 178, 180),
        title_col=(34, 92, 104), title_halo=(250, 247, 238), pad_f=0.02),
}

# --------------------------------------------------------------------------
# 4. LAYOUT + COMPOSE
# --------------------------------------------------------------------------
def load_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return None

def load_title_image(path, keep_bg=False):
    """Load a logo/wordmark for the title slot. If it's opaque and `keep_bg` is
    off, key out the (white) background by deriving alpha from inverse luminance —
    so black-on-white logos drop onto a textured background cleanly."""
    import numpy as np
    im = Image.open(path).convert("RGBA")
    if not keep_bg and np.asarray(im)[..., 3].min() == 255:
        arr = np.asarray(im.convert("RGB")).astype(int)
        alpha = (255 - arr.mean(2)).clip(0, 255).astype("uint8")
        im = Image.fromarray(np.dstack([arr.astype("uint8"), alpha]), "RGBA")
    return im

def bg_photo(path, W, H, dim=0.5):
    """Use a photo as the background: cover-fit (scale to fill, center-crop) then
    darken (scaled by `dim`, 0..1) with a uniform wash + edge vignette so the card,
    logo and credit pop. Lower dim keeps a bright photo bright."""
    im = Image.open(path).convert("RGB")
    s = max(W / im.width, H / im.height)
    nw, nh = int(im.width * s + 0.5), int(im.height * s + 0.5)
    im = im.resize((nw, nh), Image.LANCZOS)
    x, y = (nw - W) // 2, (nh - H) // 2
    im = im.crop((x, y, x + W, y + H)).convert("RGBA")
    wash = Image.new("RGBA", (W, H), (12, 10, 8, int(130*dim)))   # uniform wash
    im = Image.alpha_composite(im, wash)
    vig = Image.new("L", (W, H), 0)                          # edge vignette
    ImageDraw.Draw(vig).ellipse([int(W*0.05), int(H*0.04), int(W*0.95), int(H*0.96)], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(W//7))
    dark = Image.new("RGBA", (W, H), (0, 0, 0, int(210*dim)))
    dark.putalpha(ImageOps.invert(vig).point(lambda v: int(v*dim)))
    return Image.alpha_composite(im, dark)

def compose(images, theme, ratio, title, credit, out, base_w, font_path, font_bold, seed,
            layout="vstack", title_image=None, title_keep_bg=False, bg_image=None, bg_dim=0.5):
    th = THEMES[theme]
    rw, rh = (int(x) for x in ratio.split(":"))
    W = base_w; H = int(round(W * rh / rw))
    rng = random.Random(seed)
    poster = (bg_photo(bg_image, W, H, bg_dim) if bg_image else th["bg"](W, H, rng)).convert("RGBA")

    arts = [crop_pindou_art(p) for p in images]
    n = len(arts)
    pad = int(W * th["pad_f"])
    rad = max(6, int(W * th["radius_f"]))
    gap = int(W * 0.05)
    title_band = int(H * 0.15) if title_image else (int(H * 0.075) if title else int(H * 0.02))
    bottom = int(H * 0.04) if credit else int(H * 0.02)
    side_min = int(W * 0.07)
    aspects = [im.width/im.height for im in arts]

    if layout == "hstack":
        # one shared art height; widths follow each aspect; fit poster width
        avail_w = W - 2*side_min - (n-1)*gap - n*2*pad
        art_h = int(avail_w / sum(aspects))
        art_h = min(art_h, H - title_band - bottom - 2*int(H*0.03))
        sized = [im.resize((max(1, int(art_h*asp)), art_h), Image.LANCZOS)
                 for im, asp in zip(arts, aspects)]
        total_w = sum(im.width + 2*pad for im in sized) + (n-1)*gap
        x = (W - total_w)//2
        cy = title_band + (H - title_band - bottom)//2
        for im in sized:
            cw, ch = im.width + 2*pad, im.height + 2*pad
            poster = frame_card(poster, im, x, cy-ch//2, cw, ch, pad, rad, th, rng)
            x += cw + gap
    else:  # vstack
        avail = H - title_band - bottom - (n-1)*gap - n*2*pad
        art_w = min(avail / sum(1.0/a for a in aspects), W - 2*side_min)
        art_w = int(art_w)
        sized = [im.resize((art_w, int(art_w/asp)), Image.LANCZOS)
                 for im, asp in zip(arts, aspects)]
        total = sum(im.height + 2*pad for im in sized) + (n-1)*gap
        y = title_band + max(0, H - title_band - bottom - total)//2
        cw = art_w + 2*pad; x = (W - cw)//2
        for im in sized:
            ch = im.height + 2*pad
            poster = frame_card(poster, im, x, y, cw, ch, pad, rad, th, rng)
            y += ch + gap

    poster = poster.convert("RGB"); d = ImageDraw.Draw(poster)
    if title_image:
        logo = load_title_image(title_image, title_keep_bg)
        scale = min(W*0.66/logo.width, title_band*0.86/logo.height)
        logo = logo.resize((max(1, int(logo.width*scale)), max(1, int(logo.height*scale))),
                           Image.LANCZOS)
        poster.paste(logo, ((W-logo.width)//2, title_band//2 - logo.height//2), logo)
    elif title:
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
        if th.get("apple_accents"):
            hy = title_band//2
            for hx in (tx-72, tx+tw+72):
                draw_apple(d, hx, hy, 78, (200, 28, 38), stem=(70, 42, 22))
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
    ap.add_argument("--layout", default="vstack", choices=["vstack", "hstack"],
                    help="vstack = stacked top-to-bottom; hstack = side by side")
    ap.add_argument("--title", default="")
    ap.add_argument("--title-image", default=None,
                    help="logo/wordmark PNG for the title slot (overrides --title); white bg auto-keyed")
    ap.add_argument("--title-keep-bg", action="store_true",
                    help="don't key out the title image's background")
    ap.add_argument("--bg-image", default=None,
                    help="photo to use as the background (cover-fit + darkened); overrides the theme background")
    ap.add_argument("--bg-dim", type=float, default=0.5,
                    help="darkening strength for --bg-image, 0..1 (lower = brighter). Default 0.5")
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
                 a.width, a.font, a.font_bold, a.seed, a.layout,
                 a.title_image, a.title_keep_bg, a.bg_image, a.bg_dim)
    print(f"saved {a.out} {sz} theme={a.theme} layout={a.layout}")

if __name__ == "__main__":
    main()
