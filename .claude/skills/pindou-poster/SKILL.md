---
name: pindou-poster
description: Use when composing a poster, collage, or print layout from one or more PindouVerse bead-art exports (the *_pindou_export.png files) — arranging the cropped bead grids on a themed textured background with frames, a title, and a credit line.
---

# Pindou Poster Composer

## Overview
Turn one or more PindouVerse bead-art exports into a framed, themed poster at any
aspect ratio. The hard part is done by `scripts/make_poster.py`: it **auto-crops**
each export down to just the bead grid (dropping the top "PindouVerse …" title bar
and the bottom color-count legend), then lays the arts out on a **pluggable theme**
background with frames, a title, and a credit.

The theme/style is just a parameter — pink-hearts is one option, not the point.

## When to Use
- "Make a poster / collage from these pindou exports"
- Stacking or gridding 1–N bead patterns onto a decorative background
- Any time you'd otherwise hand-crop the export and composite in an image editor

## Workflow (follow in order)
1. **Confirm two choices before rendering** (they dominate the result):
   - *Content form*: keep the full grid+legend, or crop to clean bead art (default,
     what the script does).
   - *Theme/style*: e.g. `pink-hearts`, `sci-fantasy`, `art-gallery`, or a new one.
   Use `AskUserQuestion` with concrete style options.
2. **Render a half-resolution preview** (`--width 1200`), Read it, let the user pick
   / tweak. Do NOT jump to full size.
3. **Render full size** (`--width 2400`) only after sign-off. Output goes in `temp/`
   (it's gitignored; see the repo's temp-files convention).

## Usage
```bash
python scripts/make_poster.py \
  --images a_pindou_export.png b_pindou_export.png \
  --theme pink-hearts --ratio 3:4 \
  --title "杀生丸和爆碎牙" --credit "@东门儿烤翅" \
  --out poster.png --width 2400
```
`--list-themes` lists styles. Multiple `--images` stack vertically, auto-scaled to
fit the ratio (near-square arts leave side margins — the textured bg fills them).
Fonts default to Windows MS YaHei; override with `--font` / `--font-bold`.

## Themes
| theme | background | frame | vibe |
|-------|-----------|-------|------|
| `pink-hearts` | pale pink + heart polka tiles | white card + washi-tape corners | kawaii |
| `sci-fantasy` | navy gradient + nebula + starfield | dark card, neon-cyan border + glow | sci-fi |
| `art-gallery` | cream paper speckle | white mat + inner line + thin frame | museum |

**Add a theme:** write a `bg_<name>(W,H,rng)` painter and add one entry to the
`THEMES` dict (card color, radius_f, shadow, optional `border`/`glow`/`tape`/
`inner_line`, title color/halo, pad_f). `frame_card` is generic and reads those keys.

## How the auto-crop works (the non-obvious bit)
A "content" mask = saturated OR dark pixels (beads + grid lines, not near-white bg
or anti-aliased title text). Row-density then has the shape *[title] gap [GRID] gap
[legend]*. The grid is the **heaviest run of non-blank rows** between blank bands —
pick that run, take its column extent. This adapts to any export size; never
hardcode a crop box.

## Common Mistakes
- **♡ / ⚔ / ★ render as tofu boxes (□)** in CJK fonts. Draw the shape (the script's
  `heart_poly`) instead of typing the glyph into title text.
- **Mislabeling versions as different subjects.** Two exports of the same character
  (e.g. with vs without an energy effect) are *one theme*, not "char A" + "char B".
  Don't caption them as different things — use one shared title.
- **Wrong characters.** Read the source's own caption for the exact title (e.g. 爆碎牙
  not 暴碎牙); don't guess from memory.
- **Rendering full-res before sign-off.** Always preview small first.
- **Dumping outputs in repo root.** Write to `temp/`.
