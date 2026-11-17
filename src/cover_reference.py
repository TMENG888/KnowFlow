import sys
from PIL import Image, ImageOps

# Keep analysis inputs bounded, remove metadata, preserve the entire cover.
Image.MAX_IMAGE_PIXELS = 40_000_000
with Image.open(sys.argv[1]) as original:
    original.seek(0)
    image = ImageOps.exif_transpose(original).convert('RGB')
    image.thumbnail((1024, 1024))
    image.save(sys.argv[2], 'JPEG', quality=88)
