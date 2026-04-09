blue = [(3,2),(3,3),(1,4),(2,4),(3,4),(4,4),(3,5),(3,6),(3,7),(4,7),(1,8),(2,8),(3,8),(3,9),(3,10),(3,11),(1,12),(3,12),(2,13),(3,13)]
orange = [(7,2),(13,2),(8,3),(12,3),(6,4),(7,4),(8,4),(9,4),(10,4),(11,4),(12,4),(13,4),(14,4),(8,5),(12,5),(8,6),(12,6),(8,7),(12,7),(6,8),(7,8),(8,8),(9,8),(10,8),(11,8),(12,8),(13,8),(14,8),(8,9),(12,9),(8,10),(12,10),(8,11),(12,11),(7,12),(12,12),(6,13),(12,13)]

blue_set = set(blue)
orange_set = set(orange)

origin = 55
step = 62

def bead_svg(cx, cy, fill, hole):
    return (f'  <circle cx="{cx}" cy="{cy}" r="28" fill="{fill}"/>'
            f'<circle cx="{cx-6}" cy="{cy-6}" r="14" fill="white" opacity="0.18"/>'
            f'<circle cx="{cx}" cy="{cy}" r="9" fill="{hole}"/>')

bg_beads = []
bg_holes = []
blue_beads = []
orange_beads = []

for row in range(16):
    for col in range(16):
        cx = origin + col * step
        cy = origin + row * step
        if (col, row) in blue_set:
            blue_beads.append(bead_svg(cx, cy, '#3B82F6', '#1D4ED8'))
        elif (col, row) in orange_set:
            orange_beads.append(bead_svg(cx, cy, '#F97316', '#C2410C'))
        else:
            bg_beads.append(f'      <circle cx="{cx}" cy="{cy}" r="28"/>')
            bg_holes.append(f'      <circle cx="{cx}" cy="{cy}" r="9"/>')

import os
out_dir = os.path.join(os.path.dirname(__file__), '..', 'temp')
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, 'icon_choice_B4.svg')

with open(out_path, 'w') as f:
    f.write('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">\n')
    f.write('  <defs><clipPath id="clip"><rect width="1024" height="1024" rx="180"/></clipPath></defs>\n')
    f.write('  <rect width="1024" height="1024" rx="180" fill="#E0E0E0"/>\n')
    f.write('  <g clip-path="url(#clip)">\n')
    f.write('  <g fill="#D4D4D4" stroke="#C0C0C0" stroke-width="1">\n')
    f.write('\n'.join(bg_beads) + '\n')
    f.write('  </g>\n')
    f.write('  <g fill="#E0E0E0">\n')
    f.write('\n'.join(bg_holes) + '\n')
    f.write('  </g>\n')
    f.write('\n'.join(blue_beads) + '\n')
    f.write('\n'.join(orange_beads) + '\n')
    f.write('  </g>\n')
    f.write('</svg>\n')

print(f'Done: {len(blue_beads)} blue, {len(orange_beads)} orange, {len(bg_beads)} bg')
