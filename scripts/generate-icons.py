"""Render original Murmur mark to Windows icon assets; no external images."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
scale = 4
img = Image.new('RGBA', (256 * scale, 256 * scale))
draw = ImageDraw.Draw(img)
def rect(box, radius, fill):
    draw.rounded_rectangle(tuple(int(v * scale) for v in box), int(radius * scale), fill=fill)
rect((8, 8, 248, 248), 64, '#194638')
for x, y, h in [(59, 98, 60), (98, 62, 132), (137, 78, 100), (176, 108, 40)]:
    rect((x, y, x + 22, y + h), 11, '#f1f4df')
draw.ellipse(tuple(v * scale for v in (178, 63, 196, 81)), fill='#d7d890')
img = img.resize((256, 256), Image.Resampling.LANCZOS)
img.save(root / 'assets' / 'icon.png')
img.save(root / 'assets' / 'icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
img.resize((32, 32), Image.Resampling.LANCZOS).save(root / 'assets' / 'tray.png')
print('Generated original PNG, ICO and tray icon.')
