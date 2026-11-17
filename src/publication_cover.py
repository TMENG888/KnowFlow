"""Adapt a cover composed for the platform safe area; retain original generation."""
import sys
from PIL import Image, ImageOps

with Image.open(sys.argv[1]) as source:
    size = (int(sys.argv[3]), int(sys.argv[4]))
    if len(sys.argv) > 5 and sys.argv[5].split(':')[0] == 'fill':
        # New layout explicitly reserves a central final-ratio composition.
        center_y = float(sys.argv[5].split(':')[1]) if ':' in sys.argv[5] else 0.5
        if not 0 <= center_y <= 1:
            raise ValueError('crop center must be between 0 and 1')
        cover = ImageOps.fit(source.convert('RGB'), size, method=Image.Resampling.LANCZOS, centering=(0.5, center_y))
    else:
        fitted = ImageOps.contain(source.convert('RGB'), size, method=Image.Resampling.LANCZOS)
        cover = Image.new('RGB', size, 'white')
        cover.paste(fitted, ((size[0] - fitted.width) // 2, (size[1] - fitted.height) // 2))
    cover.save(sys.argv[2], 'JPEG', quality=94, optimize=True)
