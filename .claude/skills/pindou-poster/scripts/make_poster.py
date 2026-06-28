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
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps, ImageEnhance, ImageChops

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

def sparkle_poly(cx, cy, R, r):
    """A 4-point twinkle/sparkle star (alternating long/short radii)."""
    pts = []
    for k in range(8):
        ang = math.radians(k*45)
        rad = R if k % 2 == 0 else r
        pts.append((cx + rad*math.sin(ang), cy - rad*math.cos(ang)))
    return pts

_PETAL = [(0.0, -0.50), (0.14, -0.34), (0.24, -0.05), (0.20, 0.30), (0.10, 0.46),
          (0.0, 0.36), (-0.10, 0.46), (-0.20, 0.30), (-0.24, -0.05), (-0.14, -0.34)]
def petal_poly(cx, cy, s, rot):
    """A cherry-blossom petal (notch at the wide end), scaled by `s`, rotated."""
    r = math.radians(rot); out = []
    for x, y in _PETAL:
        out.append((cx + (x*math.cos(r) - y*math.sin(r))*s,
                    cy + (x*math.sin(r) + y*math.cos(r))*s))
    return out

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

def _flower(d, cx, cy, s, petal, center, petals=6, rot=0.0):
    """A simple round-petal flower: `petals` round petals around a center disc."""
    pr = s * 0.42
    for k in range(petals):
        a = rot + k * (6.28318 / petals)
        px = cx + math.cos(a) * s * 0.6
        py = cy + math.sin(a) * s * 0.6
        d.ellipse([px-pr, py-pr, px+pr, py+pr], fill=petal)
    cr = s * 0.34
    d.ellipse([cx-cr, cy-cr, cx+cr, cy+cr], fill=center)

def bg_warm_flowers(W, H, rng):
    """Warm peach→rose gradient strewn with soft flowers: a blurred far layer for
    depth, sharper near flowers + a few leaves, and a faint warm speckle."""
    p = vgrad(W, H, (252, 233, 212), (240, 198, 180)).convert("RGBA")
    gl = Image.new("RGBA", (W, H), (0, 0, 0, 0))             # warm bloom upper-right
    r = int(W*0.40); cx, cy = int(W*0.62), int(H*0.13)
    ImageDraw.Draw(gl).ellipse([cx-r, cy-r, cx+r, cy+r], fill=(255, 236, 200, 70))
    p = Image.alpha_composite(p, gl.filter(ImageFilter.GaussianBlur(W//8)))
    PETALS = [(236, 150, 156), (245, 172, 120), (250, 214, 150), (252, 240, 226), (232, 168, 182), (238, 128, 120)]
    CENTERS = [(250, 224, 150), (248, 200, 120), (245, 180, 110)]
    far = Image.new("RGBA", (W, H), (0, 0, 0, 0)); fard = ImageDraw.Draw(far)
    for _ in range(max(10, W*H // 60000)):                   # blurred far flowers
        fx, fy = rng.randint(0, W), rng.randint(0, H); s = rng.randint(int(W*0.04), int(W*0.085))
        _flower(fard, fx, fy, s, rng.choice(PETALS)+(120,), rng.choice(CENTERS)+(140,),
                petals=rng.choice([5, 6]), rot=rng.uniform(0, 6.28))
    p = Image.alpha_composite(p, far.filter(ImageFilter.GaussianBlur(max(2, W//200))))
    near = Image.new("RGBA", (W, H), (0, 0, 0, 0)); neard = ImageDraw.Draw(near)
    for _ in range(max(8, W*H // 110000)):                   # sharper near flowers + leaves
        nx, ny = rng.randint(0, W), rng.randint(0, H); s = rng.randint(int(W*0.025), int(W*0.05))
        if rng.random() < 0.22:
            lc = rng.choice([(150, 170, 110), (168, 182, 120)])
            neard.ellipse([nx-s*0.75, ny-s*0.32, nx+s*0.75, ny+s*0.32], fill=lc+(150,))
        else:
            _flower(neard, nx, ny, s, rng.choice(PETALS)+(205,), rng.choice(CENTERS)+(225,),
                    petals=rng.choice([5, 6]), rot=rng.uniform(0, 6.28))
    p = Image.alpha_composite(p, near)
    spec = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(spec)
    for _ in range(W*H // 900):                              # faint warm speckle
        sd.point((rng.randint(0, W), rng.randint(0, H)), fill=(180, 120, 90, rng.randint(0, 22)))
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

def bg_genshin(W, H, rng):
    """Lovely light-blue sky: pale blue gradient, soft white blooms, and a cute
    offset pattern of translucent bubbles + twinkle sparkles, with scattered dots."""
    p = vgrad(W, H, (226, 241, 252), (188, 220, 247)).convert("RGBA")
    bl = Image.new("RGBA", (W, H), (0, 0, 0, 0)); bd = ImageDraw.Draw(bl)
    for _ in range(8):                                   # soft light blooms
        cx, cy = rng.randint(0, W), rng.randint(0, H); r = rng.randint(W//7, W//3)
        col = rng.choice([(255, 255, 255), (206, 232, 250), (224, 244, 252)])
        bd.ellipse([cx-r, cy-r, cx+r, cy+r], fill=col+(40,))
    p = Image.alpha_composite(p, bl.filter(ImageFilter.GaussianBlur(W//9)))
    pat = Image.new("RGBA", (W, H), (0, 0, 0, 0)); pd = ImageDraw.Draw(pat)
    step = max(120, W // 11)
    for j, yy in enumerate(range(-40, H+120, step)):
        for i, xx in enumerate(range(-40, W+120, step)):
            ox = step//2 if j % 2 else 0
            cx, cy = xx+ox+rng.randint(-10, 10), yy+rng.randint(-10, 10)
            if (i+j) % 2 == 0:                           # bubble + highlight
                r = rng.randint(int(step*0.16), int(step*0.24))
                pd.ellipse([cx-r, cy-r, cx+r, cy+r], fill=(255, 255, 255, 60))
                pd.ellipse([cx-r, cy-r, cx+r, cy+r], outline=(255, 255, 255, 120), width=3)
                hr = max(2, r//4)
                pd.ellipse([cx-r//2-hr, cy-r//2-hr, cx-r//2+hr, cy-r//2+hr], fill=(255, 255, 255, 170))
            else:                                        # twinkle sparkle
                R = rng.randint(int(step*0.16), int(step*0.26))
                pd.polygon(sparkle_poly(cx, cy, R, R*0.32), fill=(255, 255, 255, 150))
    p = Image.alpha_composite(p, pat)
    dot = Image.new("RGBA", (W, H), (0, 0, 0, 0)); dd = ImageDraw.Draw(dot)
    for _ in range(W*H // 2600):                          # scattered tiny dots
        x, y = rng.randint(0, W), rng.randint(0, H); r = rng.choice([2, 3])
        dd.ellipse([x-r, y-r, x+r, y+r], fill=(255, 255, 255, rng.randint(70, 140)))
    return Image.alpha_composite(p, dot)

def bg_aot(W, H, rng):
    """Attack on Titan / Survey Corps: dusty sepia sky, a weathered stone wall along
    the lower horizon (mortared blocks + grime), grunge speckle, and a soft vignette."""
    p = vgrad(W, H, (200, 186, 158), (132, 110, 84)).convert("RGBA")
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))           # hazy low sun
    r = int(W*0.5); cx, cy = int(W*0.5), int(H*0.30)
    ImageDraw.Draw(glow).ellipse([cx-r, cy-r, cx+r, cy+r], fill=(255, 240, 205, 60))
    p = Image.alpha_composite(p, glow.filter(ImageFilter.GaussianBlur(W//6)))
    wall = Image.new("RGBA", (W, H), (0, 0, 0, 0)); wd = ImageDraw.Draw(wall)
    wy0 = int(H*0.64)
    wd.rectangle([0, wy0, W, H], fill=(150, 138, 116, 240))
    bh = max(20, int(H*0.062)); bw = max(40, int(W*0.155))
    for ri, yy in enumerate(range(wy0, H, bh)):              # mortared stone blocks
        ox = bw//2 if ri % 2 else 0
        for xx in range(-bw, W+bw, bw):
            x0 = xx + ox; sh = rng.randint(-15, 15)
            wd.rectangle([x0, yy, x0+bw-1, yy+bh-1],
                         fill=(150+sh, 136+sh, 114+sh, 255), outline=(104, 92, 74, 255), width=3)
    for _ in range(50):                                      # grime blotches on wall
        bx, by = rng.randint(0, W), rng.randint(wy0, H)
        br = rng.randint(int(W*0.02), int(W*0.07))
        wd.ellipse([bx-br, by-br, bx+br, by+br], fill=(96, 82, 64, rng.randint(14, 40)))
    p = Image.alpha_composite(p, wall.filter(ImageFilter.GaussianBlur(1)))
    gr = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(gr)
    for _ in range(W*H // 900):                              # grunge speckle
        x, y = rng.randint(0, W), rng.randint(0, H)
        if rng.random() < 0.5:
            gd.point((x, y), fill=(60, 46, 32, rng.randint(0, 34)))
        else:
            gd.point((x, y), fill=(240, 230, 205, rng.randint(0, 30)))
    p = Image.alpha_composite(p, gr)
    vig = Image.new("L", (W, H), 0)                          # soft vignette
    ImageDraw.Draw(vig).ellipse([int(W*0.04), int(H*0.03), int(W*0.96), int(H*0.97)], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(W//6))
    dark = Image.new("RGBA", (W, H), (0, 0, 0, 120)); dark.putalpha(ImageOps.invert(vig))
    return Image.alpha_composite(p, dark)

def bg_aot_brick(W, H, rng):
    """Attack on Titan alt: a RED BRICK wall filling the whole frame, in a lighter dusty-red
    tone so the title logo and bead art stand out. A faint vertical gradient adds depth.
    Background only — the bead-art card is pasted on top afterwards, so the bead colors stay
    exactly as exported. A brighter, cleaner companion to the sepia-walled `aot` theme."""
    p = vgrad(W, H, (208, 152, 140), (184, 122, 110)).convert("RGBA")  # light dusty-red, soft
    wall = Image.new("RGBA", (W, H), (0, 0, 0, 0)); wd = ImageDraw.Draw(wall)
    bh = max(18, int(H*0.045)); bw = max(40, int(W*0.130))
    for ri, yy in enumerate(range(0, H, bh)):               # mortared brick courses, full height
        ox = bw//2 if ri % 2 else 0
        for xx in range(-bw, W+bw, bw):
            x0 = xx + ox; sh = rng.randint(-14, 14); hv = rng.randint(-6, 6)
            wd.rectangle([x0, yy, x0+bw-1, yy+bh-1],
                         fill=(200+sh, 130+sh+hv, 118+sh, 255),
                         outline=(152, 94, 84, 255), width=3)
    p = Image.alpha_composite(p, wall.filter(ImageFilter.GaussianBlur(0.6)))
    gr = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(gr)
    for _ in range(W*H // 1400):                             # faint grain (tiny, not dots)
        x, y = rng.randint(0, W), rng.randint(0, H)
        if rng.random() < 0.5:
            gd.point((x, y), fill=(150, 92, 82, rng.randint(0, 26)))
        else:
            gd.point((x, y), fill=(236, 212, 202, rng.randint(0, 22)))
    p = Image.alpha_composite(p, gr)
    return p

def bg_sakura(W, H, rng):
    """Lovely sakura sky: a soft pink gradient, gentle light blooms, and drifting
    cherry-blossom petals — a far blurred layer for depth and a crisper near layer."""
    p = vgrad(W, H, (253, 241, 246), (245, 222, 231)).convert("RGBA")
    bl = Image.new("RGBA", (W, H), (0, 0, 0, 0)); bd = ImageDraw.Draw(bl)
    for _ in range(8):                                   # soft light blooms
        cx, cy = rng.randint(0, W), rng.randint(0, H); r = rng.randint(W//7, W//3)
        col = rng.choice([(255, 255, 255), (255, 222, 234), (255, 236, 242)])
        bd.ellipse([cx-r, cy-r, cx+r, cy+r], fill=col+(42,))
    p = Image.alpha_composite(p, bl.filter(ImageFilter.GaussianBlur(W//9)))
    tints = [(255, 206, 220), (252, 190, 208), (255, 224, 234), (248, 178, 200)]
    far = Image.new("RGBA", (W, H), (0, 0, 0, 0)); fd = ImageDraw.Draw(far)
    for _ in range(W*H // 13000):                        # far petals (blurred)
        s = rng.randint(int(W*0.012), int(W*0.022))
        fd.polygon(petal_poly(rng.randint(0, W), rng.randint(0, H), s, rng.uniform(0, 360)),
                   fill=rng.choice(tints)+(150,))
    p = Image.alpha_composite(p, far.filter(ImageFilter.GaussianBlur(3)))
    near = Image.new("RGBA", (W, H), (0, 0, 0, 0)); nd = ImageDraw.Draw(near)
    for _ in range(W*H // 24000):                        # near petals (crisp)
        s = rng.randint(int(W*0.018), int(W*0.032))
        poly = petal_poly(rng.randint(0, W), rng.randint(0, H), s, rng.uniform(0, 360))
        nd.polygon(poly, fill=rng.choice(tints)+(225,), outline=(236, 150, 178, 200))
    return Image.alpha_composite(p, near)

def _crescent(W, H, rng, fill, mx_f=0.76, my_f=0.18, R_f=0.11):
    """A faint carved crescent moon layer (Sesshoumaru's mark)."""
    cr = Image.new("RGBA", (W, H), (0, 0, 0, 0)); cd = ImageDraw.Draw(cr)
    mx, my, R = int(W*mx_f), int(H*my_f), int(W*R_f)
    cd.ellipse([mx-R, my-R, mx+R, my+R], fill=fill)
    off = int(R*0.55)
    cd.ellipse([mx-R+off, my-R-int(R*0.12), mx+R+off, my+R-int(R*0.12)], fill=(0, 0, 0, 0))
    return cr.filter(ImageFilter.GaussianBlur(2))

def _blooms(W, H, rng, cols, n=8, a=42):
    bl = Image.new("RGBA", (W, H), (0, 0, 0, 0)); bd = ImageDraw.Draw(bl)
    for _ in range(n):
        cx, cy = rng.randint(0, W), rng.randint(0, H); r = rng.randint(W//7, W//3)
        bd.ellipse([cx-r, cy-r, cx+r, cy+r], fill=rng.choice(cols)+(a,))
    return bl.filter(ImageFilter.GaussianBlur(W//9))

def _drift(W, H, rng, tints, dens_far=13000, dens_near=24000, outline=None):
    """Two layers of drifting petal/leaf shapes (far blurred + near crisp)."""
    far = Image.new("RGBA", (W, H), (0, 0, 0, 0)); fd = ImageDraw.Draw(far)
    for _ in range(W*H // dens_far):
        s = rng.randint(int(W*0.012), int(W*0.022))
        fd.polygon(petal_poly(rng.randint(0, W), rng.randint(0, H), s, rng.uniform(0, 360)),
                   fill=rng.choice(tints)+(150,))
    near = Image.new("RGBA", (W, H), (0, 0, 0, 0)); nd = ImageDraw.Draw(near)
    for _ in range(W*H // dens_near):
        s = rng.randint(int(W*0.018), int(W*0.032))
        nd.polygon(petal_poly(rng.randint(0, W), rng.randint(0, H), s, rng.uniform(0, 360)),
                   fill=rng.choice(tints)+(225,), outline=outline)
    return far.filter(ImageFilter.GaussianBlur(3)), near

def bg_forest(W, H, rng):
    """Sunlit woodland: green-gold gradient, soft god rays, golden blooms, green leaves."""
    p = vgrad(W, H, (214, 226, 180), (150, 180, 122)).convert("RGBA")
    ray = Image.new("RGBA", (W, H), (0, 0, 0, 0)); rd = ImageDraw.Draw(ray)
    sx = int(W*0.34)
    for _ in range(8):
        x = rng.randint(0, W); w = rng.randint(W//28, W//11)
        rd.polygon([(sx, -60), (x-w, H), (x+w, H)], fill=(255, 250, 214, 16))
    p = Image.alpha_composite(p, ray.filter(ImageFilter.GaussianBlur(W//36)))
    p = Image.alpha_composite(p, _blooms(W, H, rng, [(255, 244, 196), (255, 250, 220)], a=40))
    far, near = _drift(W, H, rng, [(120, 170, 90), (150, 190, 110), (96, 150, 78), (174, 200, 120)],
                       16000, 30000, outline=(80, 120, 64, 160))
    return Image.alpha_composite(Image.alpha_composite(p, far), near)

def bg_sunset(W, H, rng):
    """Warm dusk: peach→rose gradient, a low sun with radial rays, soft cloud bands."""
    p = vgrad(W, H, (255, 222, 178), (246, 150, 138)).convert("RGBA")
    sun = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(sun)
    cx, cy = int(W*0.5), int(H*0.40)
    for _ in range(16):
        ang = rng.uniform(0, math.pi*2); ln = W
        x2, y2 = cx+math.cos(ang)*ln, cy+math.sin(ang)*ln; w = rng.randint(W//40, W//16)
        sd.polygon([(cx, cy), (x2-w, y2), (x2+w, y2)], fill=(255, 240, 200, 12))
    r = int(W*0.16); sd.ellipse([cx-r, cy-r, cx+r, cy+r], fill=(255, 244, 214, 150))
    p = Image.alpha_composite(p, sun.filter(ImageFilter.GaussianBlur(W//40)))
    cl = Image.new("RGBA", (W, H), (0, 0, 0, 0)); cd = ImageDraw.Draw(cl)
    for _ in range(10):
        ccx, ccy = rng.randint(0, W), rng.randint(int(H*0.08), int(H*0.7))
        cw, ch = rng.randint(W//4, W//2), rng.randint(H//30, H//16)
        col = rng.choice([(255, 225, 210), (255, 240, 232), (252, 200, 196)])
        cd.ellipse([ccx-cw, ccy-ch, ccx+cw, ccy+ch], fill=col+(70,))
    return Image.alpha_composite(p, cl.filter(ImageFilter.GaussianBlur(W//30)))

def bg_autumn(W, H, rng):
    """Autumn: warm cream→amber gradient, golden blooms, drifting maple-tone leaves."""
    p = vgrad(W, H, (251, 236, 206), (235, 196, 150)).convert("RGBA")
    p = Image.alpha_composite(p, _blooms(W, H, rng, [(255, 230, 180), (255, 242, 210)], a=40))
    far, near = _drift(W, H, rng, [(228, 120, 60), (240, 170, 70), (214, 80, 52), (236, 150, 72)],
                       13000, 24000, outline=(170, 86, 44, 170))
    return Image.alpha_composite(Image.alpha_composite(p, far), near)

def bg_moonlit(W, H, rng, moon=True):
    """Moonlit twilight: indigo→lavender gradient, a glowing moon, stars, twinkles, wisps."""
    p = vgrad(W, H, (44, 48, 92), (104, 96, 140)).convert("RGBA")
    if moon:
        mx, my, R = int(W*0.74), int(H*0.19), int(W*0.10)
        gl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(gl).ellipse([mx-R*2, my-R*2, mx+R*2, my+R*2], fill=(220, 226, 255, 60))
        p = Image.alpha_composite(p, gl.filter(ImageFilter.GaussianBlur(W//26)))
        mn = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(mn).ellipse([mx-R, my-R, mx+R, my+R], fill=(244, 246, 255, 240))
        p = Image.alpha_composite(p, mn)
    st = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(st)
    for _ in range(W*H // 4200):
        x, y = rng.randint(0, W), rng.randint(0, H); r = rng.choice([1, 1, 2])
        sd.ellipse([x-r, y-r, x+r, y+r], fill=(245, 247, 255, rng.randint(70, 180)))
    for _ in range(W*H // 60000):
        R2 = rng.randint(int(W*0.012), int(W*0.022))
        sd.polygon(sparkle_poly(rng.randint(0, W), rng.randint(0, H), R2, R2*0.34), fill=(255, 255, 255, 170))
    ws = Image.new("RGBA", (W, H), (0, 0, 0, 0)); wd = ImageDraw.Draw(ws)
    for _ in range(6):
        y0 = rng.randint(int(H*0.2), H); x0 = rng.randint(-100, W); ln = rng.randint(W//3, W)
        amp = rng.randint(20, 60); ph = rng.uniform(0, 6.28)
        pts = [(x0+i, y0+int(amp*math.sin(i/120.0+ph))) for i in range(0, ln, 8)]
        if len(pts) > 1:
            wd.line(pts, fill=(210, 220, 255, 60), width=3)
    return Image.alpha_composite(p, ws.filter(ImageFilter.GaussianBlur(2)))

def bg_lavender(W, H, rng):
    """Elegant lilac: soft lavender gradient, a faint crescent moon, sparkles, lilac petals."""
    p = vgrad(W, H, (240, 232, 250), (214, 202, 236)).convert("RGBA")
    p = Image.alpha_composite(p, _blooms(W, H, rng, [(255, 255, 255), (236, 226, 250)], a=40))
    p = Image.alpha_composite(p, _crescent(W, H, rng, (255, 255, 255, 80)))
    far, near = _drift(W, H, rng, [(226, 210, 244), (236, 224, 250), (214, 196, 236)],
                       16000, 30000, outline=(196, 176, 224, 150))
    p = Image.alpha_composite(Image.alpha_composite(p, far), near)
    sp = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(sp)
    for _ in range(W*H // 40000):
        R = rng.randint(int(W*0.012), int(W*0.024))
        sd.polygon(sparkle_poly(rng.randint(0, W), rng.randint(0, H), R, R*0.34), fill=(255, 255, 255, 150))
    return Image.alpha_composite(p, sp)

def bg_frost(W, H, rng):
    """Icy elegance: pale silver-blue gradient, a faint crescent, twinkles and snow dots."""
    p = vgrad(W, H, (232, 240, 250), (198, 214, 236)).convert("RGBA")
    p = Image.alpha_composite(p, _blooms(W, H, rng, [(255, 255, 255), (218, 232, 248)], a=44))
    p = Image.alpha_composite(p, _crescent(W, H, rng, (255, 255, 255, 70)))
    sp = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(sp)
    for _ in range(W*H // 18000):                        # twinkle snow
        R = rng.randint(int(W*0.010), int(W*0.024))
        sd.polygon(sparkle_poly(rng.randint(0, W), rng.randint(0, H), R, R*0.30), fill=(255, 255, 255, 150))
    for _ in range(W*H // 2600):                         # snow dots
        x, y = rng.randint(0, W), rng.randint(0, H); r = rng.choice([2, 3])
        sd.ellipse([x-r, y-r, x+r, y+r], fill=(255, 255, 255, rng.randint(70, 150)))
    return Image.alpha_composite(p, sp)

def bg_twilight(W, H, rng):
    """Moonlit theme without the moon — twilight gradient + stars, twinkles, wisps."""
    return bg_moonlit(W, H, rng, moon=False)

def bg_ember(W, H, rng):
    """Warm fiery sky: orange→red gradient, a golden low glow, soft warm clouds, and
    rising ember motes (a far blurred layer + a crisper near layer)."""
    p = vgrad(W, H, (255, 196, 128), (226, 104, 84)).convert("RGBA")
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    r = int(W*0.55); cx, cy = int(W*0.5), int(H*0.46)
    ImageDraw.Draw(glow).ellipse([cx-r, cy-r, cx+r, cy+r], fill=(255, 228, 168, 70))
    p = Image.alpha_composite(p, glow.filter(ImageFilter.GaussianBlur(W//6)))
    cl = Image.new("RGBA", (W, H), (0, 0, 0, 0)); cd = ImageDraw.Draw(cl)
    for _ in range(8):                                   # soft warm clouds
        ccx, ccy = rng.randint(0, W), rng.randint(int(H*0.08), int(H*0.72))
        cw, ch = rng.randint(W//4, W//2), rng.randint(H//30, H//16)
        col = rng.choice([(255, 214, 170), (255, 192, 150), (250, 168, 132)])
        cd.ellipse([ccx-cw, ccy-ch, ccx+cw, ccy+ch], fill=col+(60,))
    p = Image.alpha_composite(p, cl.filter(ImageFilter.GaussianBlur(W//28)))
    emb = [(255, 226, 150), (255, 196, 110), (255, 158, 96), (255, 230, 190)]
    far = Image.new("RGBA", (W, H), (0, 0, 0, 0)); fd = ImageDraw.Draw(far)
    for _ in range(W*H // 6000):                         # far ember motes
        x, y = rng.randint(0, W), rng.randint(0, H); r2 = rng.choice([2, 3, 4])
        fd.ellipse([x-r2, y-r2, x+r2, y+r2], fill=rng.choice(emb)+(120,))
    p = Image.alpha_composite(p, far.filter(ImageFilter.GaussianBlur(4)))
    near = Image.new("RGBA", (W, H), (0, 0, 0, 0)); nd = ImageDraw.Draw(near)
    for _ in range(W*H // 22000):                        # near glowing sparks
        R = rng.randint(int(W*0.010), int(W*0.020))
        nd.polygon(sparkle_poly(rng.randint(0, W), rng.randint(0, H), R, R*0.34),
                   fill=(255, 240, 200, 180))
    return Image.alpha_composite(p, near)

def bg_meadow(W, H, rng):
    """Green grass meadow: sky-blue→grass-green gradient, soft clouds + sun, a grassy
    foreground of blades, scattered little flowers, and drifting pollen/seed motes."""
    p = vgrad(W, H, (190, 219, 238), (120, 176, 92)).convert("RGBA")
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    r = int(W*0.4); cx, cy = int(W*0.7), int(H*0.16)
    ImageDraw.Draw(glow).ellipse([cx-r, cy-r, cx+r, cy+r], fill=(255, 248, 210, 70))
    p = Image.alpha_composite(p, glow.filter(ImageFilter.GaussianBlur(W//7)))
    cl = Image.new("RGBA", (W, H), (0, 0, 0, 0)); cd = ImageDraw.Draw(cl)
    for _ in range(7):
        ccx, ccy = rng.randint(0, W), rng.randint(int(H*0.04), int(H*0.5))
        cw, ch = rng.randint(W//5, W//2), rng.randint(H//26, H//14)
        cd.ellipse([ccx-cw, ccy-ch, ccx+cw, ccy+ch], fill=(255, 255, 255, 64))
    p = Image.alpha_composite(p, cl.filter(ImageFilter.GaussianBlur(W//26)))
    gr = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(gr)
    gtop = int(H*0.74)
    for _ in range(int(W*1.2)):                          # grass blades, fade up
        frac = rng.random()**0.5
        gy = gtop + int((H-gtop)*(0.10+0.90*frac)); gx = rng.randint(0, W)
        bl = rng.randint(int(H*0.02), int(H*0.06)); sway = rng.randint(-bl//3, bl//3)
        sh = rng.randint(-18, 18); col = (72+sh, 140+sh, 66+sh)
        gd.line([(gx, gy), (gx+sway, gy-bl)], fill=col+(int(110+120*frac),), width=rng.choice([2, 2, 3]))
    for _ in range(int(W/9)):                            # little flowers in the grass
        fx, fy = rng.randint(0, W), rng.randint(gtop, H)
        col = rng.choice([(255, 255, 255), (255, 236, 150), (255, 196, 214), (220, 200, 255)])
        pr = rng.randint(3, 6)
        for k in range(5):
            ang = math.radians(k*72)
            gd.ellipse([fx+math.cos(ang)*pr-pr, fy+math.sin(ang)*pr-pr,
                        fx+math.cos(ang)*pr+pr, fy+math.sin(ang)*pr+pr], fill=col+(220,))
        gd.ellipse([fx-pr//2, fy-pr//2, fx+pr//2, fy+pr//2], fill=(255, 224, 120, 240))
    p = Image.alpha_composite(p, gr)
    po = Image.new("RGBA", (W, H), (0, 0, 0, 0)); pod = ImageDraw.Draw(po)
    for _ in range(W*H // 9000):                          # drifting pollen / seed motes
        x, y = rng.randint(0, W), rng.randint(0, H); pr = rng.choice([2, 3])
        pod.ellipse([x-pr, y-pr, x+pr, y+pr], fill=(255, 255, 240, rng.randint(60, 130)))
    return Image.alpha_composite(p, po.filter(ImageFilter.GaussianBlur(1)))

def bg_soccer(W, H, rng):
    """Green football pitch: vertical mown stripes (alternating light/dark grass),
    crisp white pitch markings (center line + center circle + a penalty arc),
    a soft stadium-light glow up top, and fine grass speckle. Built for Captain
    Tsubasa / any sports bead-art."""
    # base green gradient (a touch brighter at the top for logo legibility)
    p = vgrad(W, H, (86, 168, 78), (52, 134, 58)).convert("RGBA")
    # vertical mown stripes — alternating lighter / darker translucent bands
    st = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(st)
    nb = 9
    bw = W / nb
    for i in range(nb):
        x0 = int(i*bw); x1 = int((i+1)*bw)
        if i % 2 == 0:
            sd.rectangle([x0, 0, x1, H], fill=(255, 255, 255, 26))   # lit stripe
        else:
            sd.rectangle([x0, 0, x1, H], fill=(0, 60, 20, 30))       # shaded stripe
    p = Image.alpha_composite(p, st)
    # stadium light wash top
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([-W//3, -int(H*0.5), W+W//3, int(H*0.28)],
                                 fill=(220, 255, 210, 70))
    p = Image.alpha_composite(p, glow.filter(ImageFilter.GaussianBlur(W//7)))
    # white pitch markings
    mk = Image.new("RGBA", (W, H), (0, 0, 0, 0)); md = ImageDraw.Draw(mk)
    lw = max(3, W//220); col = (255, 255, 255, 150)
    cy = int(H*0.52)
    md.line([(int(W*0.04), cy), (int(W*0.96), cy)], fill=col, width=lw)   # halfway line
    cr = int(W*0.17)                                                      # center circle
    md.ellipse([W//2-cr, cy-cr, W//2+cr, cy+cr], outline=col, width=lw)
    md.ellipse([W//2-lw*2, cy-lw*2, W//2+lw*2, cy+lw*2], fill=col)        # center spot
    # penalty arc hint near the bottom edge
    pr = int(W*0.22); pby = int(H*1.02)
    md.arc([W//2-pr, pby-pr, W//2+pr, pby+pr], 200, 340, fill=col, width=lw)
    # corner arcs
    ca = int(W*0.05)
    md.arc([-ca, -ca, ca, ca], 0, 90, fill=col, width=lw)
    md.arc([W-ca, -ca, W+ca, ca], 90, 180, fill=col, width=lw)
    p = Image.alpha_composite(p, mk)
    # fine grass speckle / clipping texture
    gr = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(gr)
    for _ in range(W*H // 2600):
        x, y = rng.randint(0, W), rng.randint(0, H)
        sh = rng.randint(-22, 22)
        gd.point((x, y), fill=(70+sh, 150+sh, 66+sh, 90))
    p = Image.alpha_composite(p, gr)
    return p


def bg_amethyst(W, H, rng):
    """Dreamy purple: soft lilac→violet gradient, blurred bokeh orbs, drifting
    purple petals, and white twinkle sparkles. Lovely and magical."""
    p = vgrad(W, H, (238, 226, 248), (184, 152, 216)).convert("RGBA")
    bo = Image.new("RGBA", (W, H), (0, 0, 0, 0)); bd = ImageDraw.Draw(bo)
    for _ in range(16):                                  # soft bokeh orbs
        cx, cy = rng.randint(0, W), rng.randint(0, H); r = rng.randint(W//16, W//6)
        col = rng.choice([(255, 255, 255), (232, 204, 250), (214, 176, 240), (248, 220, 250)])
        bd.ellipse([cx-r, cy-r, cx+r, cy+r], fill=col+(rng.randint(26, 54),))
    p = Image.alpha_composite(p, bo.filter(ImageFilter.GaussianBlur(W//40)))
    dot = Image.new("RGBA", (W, H), (0, 0, 0, 0)); dd = ImageDraw.Draw(dot)
    for _ in range(W*H // 26000):                        # crisp little bokeh dots
        x, y = rng.randint(0, W), rng.randint(0, H); r = rng.choice([3, 4, 6])
        dd.ellipse([x-r, y-r, x+r, y+r], fill=rng.choice([(255, 255, 255), (236, 212, 250)])+(120,))
    p = Image.alpha_composite(p, dot)
    far, near = _drift(W, H, rng, [(230, 200, 248), (216, 180, 240), (244, 214, 250)],
                       16000, 30000, outline=(190, 150, 220, 150))
    p = Image.alpha_composite(Image.alpha_composite(p, far), near)
    sp = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(sp)
    for _ in range(W*H // 40000):
        R = rng.randint(int(W*0.012), int(W*0.024))
        sd.polygon(sparkle_poly(rng.randint(0, W), rng.randint(0, H), R, R*0.34), fill=(255, 255, 255, 160))
    return Image.alpha_composite(p, sp)

def bg_wizard(W, H, rng):
    """Magical night: deep indigo gradient, a soft moon, golden stars and floating-
    candle bokeh, twinkles, and a faint castle skyline with lit windows along the base."""
    p = vgrad(W, H, (18, 20, 48), (44, 38, 78)).convert("RGBA")
    lt = Image.new("RGBA", (W, H), (0, 0, 0, 0))         # lighter top band (logo legibility)
    ImageDraw.Draw(lt).ellipse([-W//3, -int(H*0.55), W+W//3, int(H*0.30)], fill=(120, 132, 200, 90))
    p = Image.alpha_composite(p, lt.filter(ImageFilter.GaussianBlur(W//7)))
    gl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    r = int(W*0.18); mx, my = int(W*0.76), int(H*0.16)
    ImageDraw.Draw(gl).ellipse([mx-r, my-r, mx+r, my+r], fill=(220, 220, 255, 55))
    p = Image.alpha_composite(p, gl.filter(ImageFilter.GaussianBlur(W//18)))
    bo = Image.new("RGBA", (W, H), (0, 0, 0, 0)); bd = ImageDraw.Draw(bo)
    for _ in range(14):                                  # floating-candle bokeh
        cx, cy = rng.randint(0, W), rng.randint(0, int(H*0.85)); rr = rng.randint(W//18, W//7)
        col = rng.choice([(255, 226, 150), (255, 240, 200), (250, 210, 130)])
        bd.ellipse([cx-rr, cy-rr, cx+rr, cy+rr], fill=col+(rng.randint(20, 44),))
    p = Image.alpha_composite(p, bo.filter(ImageFilter.GaussianBlur(W//34)))
    st = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(st)
    for _ in range(W*H // 2400):                          # golden / white stars
        x, y = rng.randint(0, W), rng.randint(0, H); rr = rng.choice([1, 1, 2])
        col = rng.choice([(255, 240, 200), (255, 255, 255), (255, 220, 150)])
        sd.ellipse([x-rr, y-rr, x+rr, y+rr], fill=col+(rng.randint(80, 200),))
    for _ in range(W*H // 52000):                         # twinkles
        R = rng.randint(int(W*0.012), int(W*0.022))
        sd.polygon(sparkle_poly(rng.randint(0, W), rng.randint(0, int(H*0.8)), R, R*0.32),
                   fill=(255, 244, 210, 180))
    p = Image.alpha_composite(p, st)
    cas = Image.new("RGBA", (W, H), (0, 0, 0, 0)); cd = ImageDraw.Draw(cas)
    ground = int(H*0.92)
    cd.rectangle([0, ground, W, H], fill=(8, 9, 22, 255))
    x = -int(W*0.03)
    while x < W:                                          # castle skyline + lit windows
        tw = rng.randint(W//16, W//9); th = rng.randint(int(H*0.04), int(H*0.12))
        ty = ground - th
        cd.rectangle([x, ty, x+tw, ground], fill=(10, 11, 26, 255))
        cd.polygon([(x-5, ty), (x+tw+5, ty), (x+tw//2, ty-int(th*0.6))], fill=(10, 11, 26, 255))
        for _ in range(rng.randint(1, 3)):
            wx, wy = rng.randint(x+6, x+tw-6), rng.randint(ty+10, ground-10)
            cd.ellipse([wx-3, wy-3, wx+3, wy+3], fill=(255, 208, 120, 230))
        x += tw + rng.randint(W//70, W//26)
    return Image.alpha_composite(p, cas)

def _edge_pos(W, H, rng, mx=0.30, top=0.16, bot=0.97, ymin=0.0):
    """Sample a point biased to the page margins, avoiding the central card box
    (|x-mid| < mx*W and top*H < y < bot*H) and never above ymin*H (keeps the top
    logo band clear). Decorations land in the side strips, lower band and corners."""
    x = y = 0
    for _ in range(12):
        x, y = rng.randint(0, W), rng.randint(int(H*ymin), H)
        if not (abs(x - W*0.5) < W*mx and H*top < y < H*bot):
            return x, y
    return x, y

def bg_alchemy(W, H, rng):
    """Alchemist's field notes (Edward): aged-parchment gradient with a warm glow,
    faint sepia transmutation circles (ring + inscribed pentagram + tick marks),
    benzene-ring molecule hexagons, and scattered periodic-table element cells.
    Decorations hug the page margins so the centered card doesn't bury them."""
    p = vgrad(W, H, (238, 226, 200), (212, 190, 152)).convert("RGBA")
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))               # warm lamp glow
    r = int(W*0.52); cx, cy = int(W*0.5), int(H*0.42)
    ImageDraw.Draw(glow).ellipse([cx-r, cy-r, cx+r, cy+r], fill=(212, 150, 70, 30))
    p = Image.alpha_composite(p, glow.filter(ImageFilter.GaussianBlur(W//6)))
    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    ink = (96, 48, 30)                                          # deep sepia ink
    corners = [(int(W*0.08), int(H*0.12)), (int(W*0.92), int(H*0.12)),
               (int(W*0.08), int(H*0.88)), (int(W*0.92), int(H*0.88))]
    for ccx, ccy in corners:                                     # transmutation circles in corners
        R = rng.randint(int(W*0.13), int(W*0.20)); a = rng.randint(46, 66); col = ink + (a,)
        d.ellipse([ccx-R, ccy-R, ccx+R, ccy+R], outline=col, width=3)
        ri = int(R*0.80); d.ellipse([ccx-ri, ccy-ri, ccx+ri, ccy+ri], outline=col, width=2)
        ph = rng.uniform(0, 72)
        pts = [(ccx+ri*math.sin(math.radians(k*72+ph)), ccy-ri*math.cos(math.radians(k*72+ph)))
               for k in range(5)]
        d.line([pts[i] for i in (0, 2, 4, 1, 3, 0)], fill=col, width=2)   # pentagram
        for k in range(0, 360, 15):                             # outer ticks
            a1 = math.radians(k)
            d.line([(ccx+R*math.sin(a1), ccy-R*math.cos(a1)),
                    (ccx+R*1.05*math.sin(a1), ccy-R*1.05*math.cos(a1))], fill=col, width=1)
    for _ in range(rng.randint(14, 18)):                        # benzene-ring hexagons (margins)
        hx, hy = _edge_pos(W, H, rng); s = rng.randint(int(W*0.03), int(W*0.06))
        a = rng.randint(40, 58); col = ink + (a,)
        hp = [(hx+s*math.sin(math.radians(k*60)), hy-s*math.cos(math.radians(k*60))) for k in range(6)]
        d.polygon(hp, outline=col)
        hi = [(hx+s*0.66*math.sin(math.radians(k*60)), hy-s*0.66*math.cos(math.radians(k*60))) for k in range(6)]
        d.polygon(hi, outline=col)                              # inner ring (aromatic)
    try:
        fsym = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", max(15, W//34))
        fnum = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", max(9, W//72))
    except Exception:
        fsym = fnum = ImageFont.load_default()
    ELE = [("H", 1), ("C", 6), ("N", 7), ("O", 8), ("Na", 11), ("P", 15), ("S", 16), ("Cl", 17),
           ("K", 19), ("Ca", 20), ("Fe", 26), ("Cu", 29), ("Ag", 47), ("Au", 79), ("Hg", 80), ("Pb", 82)]
    cell = max(64, W//15)
    for _ in range(rng.randint(18, 22)):                        # periodic-table cells (margins)
        px, py = _edge_pos(W, H, rng)
        ex = min(max(0, px-cell//2), W-cell); ey = min(max(0, py-cell//2), H-cell)
        sym, num = rng.choice(ELE); a = rng.randint(46, 66); col = ink + (a,)
        d.rectangle([ex, ey, ex+cell, ey+cell], outline=col, width=2)
        d.text((ex+cell*0.12, ey+cell*0.05), str(num), font=fnum, fill=col)
        d.text((ex+cell*0.16, ey+cell*0.30), sym, font=fsym, fill=col)
    p = Image.alpha_composite(p, lay)
    spec = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(spec)
    for _ in range(W*H // 800):                                 # faint ink speckle
        sd.point((rng.randint(0, W), rng.randint(0, H)), fill=(110, 70, 50, rng.randint(0, 26)))
    return Image.alpha_composite(p, spec)

def _sword_tile(L, col, edge):
    """A small upward-pointing sword silhouette on a transparent LxL tile."""
    t = Image.new("RGBA", (L, L), (0, 0, 0, 0)); d = ImageDraw.Draw(t)
    cx = L//2; w = max(6, L//16)
    bt, bb = int(L*0.05), int(L*0.60)                            # blade top/bottom
    d.polygon([(cx, bt), (cx+w, bb), (cx-w, bb)], fill=col, outline=edge)
    d.line([(cx, bt+w), (cx, bb-w)], fill=edge, width=1)         # fuller
    gw = int(L*0.20)                                             # crossguard
    d.rectangle([cx-gw, bb-w//2, cx+gw, bb+w//2], fill=col, outline=edge)
    d.rectangle([cx-w//2, bb, cx+w//2, int(L*0.82)], fill=col, outline=edge)   # grip
    pr = int(w*0.9); py = int(L*0.82)                            # pommel
    d.ellipse([cx-pr, py-pr, cx+pr, py+pr], fill=col, outline=edge)
    return t

def _shield_tile(L, col, edge):
    """A heater shield that clearly reads as one: filled body with a thick rim,
    an inner rim line, a heraldic cross dividing it into quarters, rivets around
    the border and a raised center boss."""
    t = Image.new("RGBA", (L, L), (0, 0, 0, 0)); d = ImageDraw.Draw(t)
    pts = [(0.14, 0.12), (0.50, 0.07), (0.86, 0.12), (0.86, 0.44),
           (0.74, 0.68), (0.50, 0.93), (0.26, 0.68), (0.14, 0.44)]
    P = [(x*L, y*L) for x, y in pts]
    d.polygon(P, fill=col)
    d.line(P + [P[0]], fill=edge, width=max(2, L//22))          # thick outer rim
    cx, cy = 0.5*L, 0.46*L
    Pin = [(cx+(px-cx)*0.82, cy+(py-cy)*0.82) for px, py in P]   # inner rim
    d.line(Pin + [Pin[0]], fill=edge, width=max(1, L//44))
    d.line([(cx, 0.11*L), (cx, 0.88*L)], fill=edge, width=max(1, L//34))      # cross: vertical
    d.line([(0.16*L, 0.40*L), (0.84*L, 0.40*L)], fill=edge, width=max(1, L//34))  # cross: horizontal
    for fx, fy in [(0.20, 0.16), (0.50, 0.10), (0.80, 0.16), (0.83, 0.40),
                   (0.68, 0.66), (0.32, 0.66), (0.17, 0.40)]:    # border rivets
        rr = max(2, L//34)
        d.ellipse([fx*L-rr, fy*L-rr, fx*L+rr, fy*L+rr], fill=edge)
    br = L*0.085                                                 # raised center boss
    d.ellipse([cx-br, cy-br, cx+br, cy+br], outline=edge, width=max(2, L//40))
    d.ellipse([cx-br*0.42, cy-br*0.42, cx+br*0.42, cy+br*0.42], fill=edge)
    return t

def bg_blades(W, H, rng):
    """Steel armoury (Alphonse): cool steel-blue→dark gradient, brushed-metal sheen
    blooms, a lighter top band for logo legibility, and scattered single swords and
    heater shields with a faint metallic glint."""
    p = vgrad(W, H, (78, 92, 112), (34, 42, 56)).convert("RGBA")
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0)); shd = ImageDraw.Draw(sh)
    for _ in range(7):                                           # brushed-metal sheen blooms
        bx, by = rng.randint(0, W), rng.randint(0, H); r = rng.randint(W//6, W//3)
        col = rng.choice([(150, 168, 192), (110, 130, 156), (180, 196, 214)])
        shd.ellipse([bx-r, by-r, bx+r, by+r], fill=col+(34,))
    p = Image.alpha_composite(p, sh.filter(ImageFilter.GaussianBlur(W//9)))
    top = Image.new("RGBA", (W, H), (0, 0, 0, 0))               # lighter top band (logo)
    ImageDraw.Draw(top).ellipse([-W//3, -int(H*0.52), W+W//3, int(H*0.26)], fill=(176, 192, 214, 80))
    p = Image.alpha_composite(p, top.filter(ImageFilter.GaussianBlur(W//7)))
    sl = Image.new("RGBA", (W, H), (0, 0, 0, 0))                # single swords + shields (margins)
    blade = (172, 186, 208); edge = (60, 70, 90); placed = []
    for i in range(rng.randint(6, 8)):
        if i % 2 == 0:                                          # shield (upright-ish, below logo)
            L = rng.randint(int(W*0.12), int(W*0.18))
            tile = _shield_tile(L, (150, 164, 188, 115), edge+(150,))
            tile = tile.rotate(rng.uniform(-14, 14), expand=True, resample=Image.BICUBIC)
            ymin = 0.26
        else:                                                  # single sword (any angle)
            L = rng.randint(int(W*0.16), int(W*0.26))
            tile = _sword_tile(L, blade+(120,), edge+(150,))
            tile = tile.rotate(rng.uniform(-150, 150), expand=True, resample=Image.BICUBIC)
            ymin = 0.17
        ex, ey = _edge_pos(W, H, rng, ymin=ymin)               # disperse: keep them apart
        for _try in range(20):
            cx2, cy2 = _edge_pos(W, H, rng, ymin=ymin)
            if all((cx2-px)**2 + (cy2-py)**2 > (W*0.21)**2 for px, py in placed):
                ex, ey = cx2, cy2; break
        placed.append((ex, ey))
        sl.alpha_composite(tile, (ex-tile.width//2, ey-tile.height//2))
    p = Image.alpha_composite(p, sl)
    gl = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(gl)
    for _ in range(W*H // 42000):                               # metallic glints (sparse)
        R = rng.randint(int(W*0.008), int(W*0.016))
        gd.polygon(sparkle_poly(rng.randint(0, W), rng.randint(0, H), R, R*0.30), fill=(220, 232, 248, 130))
    return Image.alpha_composite(p, gl)

def bg_breakfast(W, H, rng):
    """Warm morning meal (city street breakfast): cream→amber gradient, a soft golden
    sun glow, rising steam wisps from hot food, warm bokeh motes, and faint bowl +
    chopsticks + steam icons tucked into the margins — cozy and appetising."""
    p = vgrad(W, H, (255, 238, 206), (242, 198, 150)).convert("RGBA")
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))              # golden morning glow
    r = int(W*0.5); cx, cy = int(W*0.5), int(H*0.30)
    ImageDraw.Draw(glow).ellipse([cx-r, cy-r, cx+r, cy+r], fill=(255, 226, 158, 72))
    p = Image.alpha_composite(p, glow.filter(ImageFilter.GaussianBlur(W//6)))
    bo = Image.new("RGBA", (W, H), (0, 0, 0, 0)); bd = ImageDraw.Draw(bo)
    for _ in range(14):                                         # warm bokeh motes
        bx, by = rng.randint(0, W), rng.randint(0, H); rr = rng.randint(W//16, W//7)
        col = rng.choice([(255, 236, 180), (255, 214, 150), (255, 246, 214)])
        bd.ellipse([bx-rr, by-rr, bx+rr, by+rr], fill=col+(rng.randint(26, 50),))
    p = Image.alpha_composite(p, bo.filter(ImageFilter.GaussianBlur(W//34)))
    st = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(st)
    for _ in range(10):                                         # rising steam wisps
        x0 = rng.randint(0, W); y1 = rng.randint(int(H*0.35), H); ln = rng.randint(int(H*0.18), int(H*0.40))
        ph = rng.uniform(0, 6.28); amp = rng.randint(int(W*0.01), int(W*0.03))
        pts = [(x0+int(amp*math.sin(t/26.0+ph)), y1-t) for t in range(0, ln, 6)]
        if len(pts) > 1:
            sd.line(pts, fill=(255, 250, 240, rng.randint(26, 54)), width=rng.choice([3, 4, 5]))
    p = Image.alpha_composite(p, st.filter(ImageFilter.GaussianBlur(3)))
    ic = Image.new("RGBA", (W, H), (0, 0, 0, 0)); icd = ImageDraw.Draw(ic)
    brown = (148, 92, 50)
    for _ in range(rng.randint(6, 8)):                          # bowl + chopsticks + steam icons
        bx, by = _edge_pos(W, H, rng, ymin=0.18); s = rng.randint(int(W*0.035), int(W*0.06))
        a = rng.randint(36, 58); col = brown + (a,); w = max(2, int(s*0.10))
        icd.arc([bx-s, int(by-s*0.55), bx+s, int(by+s*1.1)], start=18, end=162, fill=col, width=w)  # bowl U
        icd.line([(bx-s*0.95, by), (bx+s*0.95, by)], fill=col, width=w)                              # rim
        for sx in (bx-s*0.32, bx+s*0.30):                       # two steam curls above the bowl
            cp = [(sx+s*0.16*math.sin(k/2.0), by-s*0.25-k*s*0.12) for k in range(5)]
            icd.line(cp, fill=col, width=max(1, w-1))
        icd.line([(bx+s*0.2, by-s*0.1), (bx+s*1.12, by-s*0.92)], fill=col, width=max(1, w-1))   # chopsticks
        icd.line([(bx+s*0.38, by-s*0.04), (bx+s*1.26, by-s*0.78)], fill=col, width=max(1, w-1))
    p = Image.alpha_composite(p, ic)
    spec = Image.new("RGBA", (W, H), (0, 0, 0, 0)); spd = ImageDraw.Draw(spec)
    for _ in range(W*H // 900):                                 # faint warm speckle
        spd.point((rng.randint(0, W), rng.randint(0, H)), fill=(180, 120, 70, rng.randint(0, 22)))
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
    "warm-flowers": dict(bg=bg_warm_flowers, card_bg=(252, 246, 238), radius_f=0.006,
        shadow_col=(120, 70, 50, 90), shadow_blur=22, shadow_off=16,
        border=(210, 150, 120), border_w=4, inner_line=(228, 180, 150),
        title_col=(170, 80, 60), title_halo=(255, 250, 244), pad_f=0.02),
    "genshin": dict(bg=bg_genshin, card_bg=(255, 255, 255), radius_f=0.012,
        shadow_col=(70, 110, 160, 95), shadow_blur=24, shadow_off=18,
        border=(118, 178, 230), border_w=5, inner_line=(190, 214, 240),
        title_col=(44, 74, 128), title_halo=(255, 255, 255), pad_f=0.02),
    "aot": dict(bg=bg_aot, card_bg=(244, 236, 220), radius_f=0.004,
        shadow_col=(40, 28, 18, 120), shadow_blur=24, shadow_off=18,
        border=(96, 68, 44), border_w=5, inner_line=(150, 120, 84),
        title_col=(74, 52, 34), title_halo=(244, 236, 220), pad_f=0.018),
    "aot-brick": dict(bg=bg_aot_brick, card_bg=(248, 242, 232), radius_f=0.004,
        shadow_col=(60, 28, 24, 120), shadow_blur=24, shadow_off=18,
        border=(150, 94, 84), border_w=5, inner_line=(206, 150, 140),
        title_col=(120, 60, 52), title_halo=(248, 242, 232), pad_f=0.018),
    "sakura": dict(bg=bg_sakura, card_bg=(255, 255, 255), radius_f=0.012,
        shadow_col=(150, 90, 120, 90), shadow_blur=24, shadow_off=18,
        border=(240, 158, 190), border_w=5, inner_line=(250, 210, 224),
        title_col=(200, 80, 120), title_halo=(255, 255, 255), pad_f=0.018),
    "forest": dict(bg=bg_forest, card_bg=(250, 250, 242), radius_f=0.010,
        shadow_col=(40, 70, 36, 95), shadow_blur=24, shadow_off=18,
        border=(96, 150, 78), border_w=5, inner_line=(184, 208, 152),
        title_col=(58, 100, 56), title_halo=(250, 250, 242), pad_f=0.018),
    "sunset": dict(bg=bg_sunset, card_bg=(255, 250, 244), radius_f=0.012,
        shadow_col=(150, 70, 50, 95), shadow_blur=24, shadow_off=18,
        border=(228, 122, 92), border_w=5, inner_line=(250, 202, 182),
        title_col=(186, 84, 60), title_halo=(255, 250, 244), pad_f=0.018),
    "autumn": dict(bg=bg_autumn, card_bg=(252, 246, 234), radius_f=0.010,
        shadow_col=(120, 70, 30, 95), shadow_blur=24, shadow_off=18,
        border=(192, 112, 58), border_w=5, inner_line=(226, 182, 130),
        title_col=(154, 84, 40), title_halo=(252, 246, 234), pad_f=0.018),
    "moonlit": dict(bg=bg_moonlit, card_bg=(248, 249, 255), radius_f=0.012,
        shadow_col=(10, 14, 40, 140), shadow_blur=26, shadow_off=20,
        border=(150, 160, 214), border_w=5, inner_line=(206, 212, 240),
        title_col=(78, 88, 142), title_halo=(248, 249, 255), pad_f=0.018),
    "lavender": dict(bg=bg_lavender, card_bg=(255, 255, 255), radius_f=0.012,
        shadow_col=(130, 110, 160, 90), shadow_blur=24, shadow_off=18,
        border=(190, 168, 224), border_w=5, inner_line=(226, 214, 242),
        title_col=(122, 92, 162), title_halo=(255, 255, 255), pad_f=0.018),
    "frost": dict(bg=bg_frost, card_bg=(255, 255, 255), radius_f=0.012,
        shadow_col=(70, 110, 150, 90), shadow_blur=24, shadow_off=18,
        border=(140, 176, 214), border_w=5, inner_line=(206, 224, 242),
        title_col=(64, 108, 150), title_halo=(255, 255, 255), pad_f=0.018),
    "twilight": dict(bg=bg_twilight, card_bg=(248, 249, 255), radius_f=0.012,
        shadow_col=(10, 14, 40, 140), shadow_blur=26, shadow_off=20,
        border=(150, 160, 214), border_w=5, inner_line=(206, 212, 240),
        title_col=(78, 88, 142), title_halo=(248, 249, 255), pad_f=0.018),
    "ember": dict(bg=bg_ember, card_bg=(255, 248, 238), radius_f=0.010,
        shadow_col=(150, 56, 30, 100), shadow_blur=24, shadow_off=18,
        border=(214, 92, 60), border_w=5, inner_line=(250, 196, 168),
        title_col=(190, 70, 44), title_halo=(255, 248, 238), pad_f=0.018),
    "meadow": dict(bg=bg_meadow, card_bg=(250, 250, 244), radius_f=0.010,
        shadow_col=(40, 80, 40, 95), shadow_blur=24, shadow_off=18,
        border=(104, 162, 82), border_w=5, inner_line=(184, 210, 152),
        title_col=(60, 104, 56), title_halo=(250, 250, 244), pad_f=0.018),
    "soccer-pitch": dict(bg=bg_soccer, card_bg=(250, 250, 246), radius_f=0.010,
        shadow_col=(20, 60, 24, 110), shadow_blur=26, shadow_off=18,
        border=(255, 255, 255), border_w=6, inner_line=(150, 200, 140),
        title_col=(28, 96, 48), title_halo=(255, 255, 255), pad_f=0.018),
    "amethyst": dict(bg=bg_amethyst, card_bg=(255, 255, 255), radius_f=0.012,
        shadow_col=(110, 70, 150, 95), shadow_blur=24, shadow_off=18,
        border=(170, 120, 200), border_w=5, inner_line=(222, 200, 238),
        title_col=(120, 70, 162), title_halo=(255, 255, 255), pad_f=0.018),
    "wizard": dict(bg=bg_wizard, card_bg=(22, 26, 54), radius_f=0.006,
        shadow_col=(0, 0, 0, 150), shadow_blur=26, shadow_off=20,
        border=(196, 164, 92), border_w=5, inner_line=(150, 126, 70),
        title_col=(214, 184, 116), title_halo=(8, 10, 28), pad_f=0.016),
    "alchemy": dict(bg=bg_alchemy, card_bg=(252, 248, 236), radius_f=0.006,
        shadow_col=(80, 44, 24, 100), shadow_blur=24, shadow_off=18,
        border=(160, 44, 40), border_w=5, inner_line=(190, 150, 92),
        title_col=(150, 32, 30), title_halo=(252, 248, 236), pad_f=0.018),
    "blades": dict(bg=bg_blades, card_bg=(238, 242, 248), radius_f=0.006,
        shadow_col=(0, 0, 0, 150), shadow_blur=26, shadow_off=20,
        border=(150, 166, 188), border_w=5, inner_line=(112, 130, 154),
        title_col=(206, 220, 238), title_halo=(30, 38, 52), pad_f=0.018),
    "breakfast": dict(bg=bg_breakfast, card_bg=(255, 250, 242), radius_f=0.010,
        shadow_col=(120, 70, 30, 95), shadow_blur=24, shadow_off=18,
        border=(196, 132, 72), border_w=5, inner_line=(232, 192, 150),
        title_col=(150, 92, 48), title_halo=(255, 250, 242), pad_f=0.018),
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

def add_logo_effects(logo, stroke=0, stroke_fill=(24, 18, 14), shadow_blur=0,
                     shadow_off=(0, 0), shadow_alpha=150):
    """Return the logo RGBA with an outline stroke and/or soft drop shadow
    composited behind it, so a wordmark pops off a textured background. The
    canvas grows by a transparent margin to hold the stroke/shadow spread."""
    pad = stroke*4 + shadow_blur + max(abs(shadow_off[0]), abs(shadow_off[1])) + 6
    W, H = logo.width + 2*pad, logo.height + 2*pad
    lx, ly = pad, pad
    alpha = logo.split()[3]
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if shadow_blur > 0:                                   # soft drop shadow
        sa = Image.new("L", (W, H), 0)
        sa.paste(alpha, (lx + shadow_off[0], ly + shadow_off[1]))
        sa = sa.filter(ImageFilter.MaxFilter(3)).filter(             # densify, then soften
            ImageFilter.GaussianBlur(shadow_blur)).point(lambda v: int(v * shadow_alpha / 255))
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 255)); sh.putalpha(sa)
        out = Image.alpha_composite(out, sh)
    if stroke > 0:                                        # soft shadow-style outline (even halo)
        da = Image.new("L", (W, H), 0); da.paste(alpha, (lx, ly))
        r = stroke
        while r > 0:                                      # grow the halo out from the edge
            step = min(2, r)
            da = da.filter(ImageFilter.MaxFilter(2*step + 1)); r -= step
        da = da.filter(ImageFilter.GaussianBlur(max(1.5, stroke*1.4)))  # soft, not a hard line
        st = Image.new("RGBA", (W, H), tuple(stroke_fill) + (255,)); st.putalpha(da)
        out = Image.alpha_composite(out, st)
    top = Image.new("RGBA", (W, H), (0, 0, 0, 0)); top.paste(logo, (lx, ly), logo)
    return Image.alpha_composite(out, top)

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
            layout="vstack", title_image=None, title_keep_bg=False, bg_image=None, bg_dim=0.5,
            title_scale=1.0, title_contrast=1.0, art_scale=1.0, title_shadow=False, title_stroke=False,
            title_stroke_color=None):
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
    title_band = int(H * 0.135 * title_scale) if title_image else (int(H * 0.075) if title else int(H * 0.02))
    bottom = int(H * 0.04) if credit else int(H * 0.02)
    side_min = int(W * 0.07)
    aspects = [im.width/im.height for im in arts]

    if layout == "hstack":
        # one shared art height; widths follow each aspect; fit poster width
        avail_w = W - 2*side_min - (n-1)*gap - n*2*pad
        art_h = int(avail_w / sum(aspects))
        art_h = min(art_h, H - title_band - bottom - 2*int(H*0.03))
        art_h = int(art_h * art_scale)
        sized = [im.resize((max(1, int(art_h*asp)), art_h), Image.LANCZOS)
                 for im, asp in zip(arts, aspects)]
        total_w = sum(im.width + 2*pad for im in sized) + (n-1)*gap
        x = (W - total_w)//2
        cy = title_band + (H - title_band - bottom)//2
        card_top = cy - (sized[0].height + 2*pad)//2
        for im in sized:
            cw, ch = im.width + 2*pad, im.height + 2*pad
            poster = frame_card(poster, im, x, cy-ch//2, cw, ch, pad, rad, th, rng)
            x += cw + gap
    else:  # vstack
        avail = H - title_band - bottom - (n-1)*gap - n*2*pad
        art_w = min(avail / sum(1.0/a for a in aspects), W - 2*side_min)
        art_w = int(art_w * art_scale)
        sized = [im.resize((art_w, int(art_w/asp)), Image.LANCZOS)
                 for im, asp in zip(arts, aspects)]
        total = sum(im.height + 2*pad for im in sized) + (n-1)*gap
        y = title_band + max(0, H - title_band - bottom - total)//4   # bias card up toward title
        card_top = y
        cw = art_w + 2*pad; x = (W - cw)//2
        for im in sized:
            ch = im.height + 2*pad
            poster = frame_card(poster, im, x, y, cw, ch, pad, rad, th, rng)
            y += ch + gap

    poster = poster.convert("RGB"); d = ImageDraw.Draw(poster)
    if title_image:
        logo = load_title_image(title_image, title_keep_bg)
        if title_contrast != 1.0:                         # boost wordmark contrast (alpha kept)
            r, g, b, a = logo.split()
            rgb = ImageEnhance.Contrast(Image.merge("RGB", (r, g, b))).enhance(title_contrast)
            logo = Image.merge("RGBA", (*rgb.split(), a))
        scale = min(W*0.66/logo.width, title_band*0.96/logo.height)
        logo = logo.resize((max(1, int(logo.width*scale)), max(1, int(logo.height*scale))),
                           Image.LANCZOS)
        if title_shadow:                                  # heavy soft drop shadow (+opt stroke)
            blur = max(5, int(W*0.016)); off = (int(W*0.011), int(W*0.015))
            stroke = max(2, int(W*0.0032)) if title_stroke else 0
            stroke_fill = title_stroke_color or th.get("logo_stroke", (24, 18, 14))
            logo = add_logo_effects(logo, stroke, stroke_fill, blur, off, 235)
            if logo.height > title_band*1.10:             # re-clamp after the margin grew
                s2 = title_band*1.10/logo.height
                logo = logo.resize((max(1, int(logo.width*s2)), max(1, int(logo.height*s2))),
                                   Image.LANCZOS)
        poster.paste(logo, ((W-logo.width)//2, max(0, card_top//2 - logo.height//2)), logo)
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
    ap.add_argument("--title-scale", type=float, default=1.0,
                    help="enlarge/shrink the title logo (grows the title band; padding kept). Default 1.0")
    ap.add_argument("--title-contrast", type=float, default=1.0,
                    help="contrast boost for the title logo (e.g. 1.5 to make a silver wordmark pop). Default 1.0")
    ap.add_argument("--title-shadow", action="store_true",
                    help="add a soft drop shadow behind the title logo so it pops off the background")
    ap.add_argument("--title-stroke", action="store_true",
                    help="also add an outline stroke around the title logo (use with --title-shadow)")
    ap.add_argument("--title-stroke-color", default=None,
                    help="stroke color as 'r,g,b' (e.g. '96,82,76' for a lighter, softer outline). Default dark.")
    ap.add_argument("--art-scale", type=float, default=1.0,
                    help="scale the bead-art card relative to its fitted size (e.g. 0.9 shrinks it, exposing more background). Default 1.0")
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
    stroke_col = tuple(int(c) for c in a.title_stroke_color.split(",")) if a.title_stroke_color else None
    sz = compose(a.images, a.theme, a.ratio, a.title, a.credit, a.out,
                 a.width, a.font, a.font_bold, a.seed, a.layout,
                 a.title_image, a.title_keep_bg, a.bg_image, a.bg_dim,
                 a.title_scale, a.title_contrast, a.art_scale, a.title_shadow, a.title_stroke,
                 stroke_col)
    print(f"saved {a.out} {sz} theme={a.theme} layout={a.layout}")

if __name__ == "__main__":
    main()
