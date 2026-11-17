"""Build a platform-import document from an immutable publication manifest."""
import json
import sys
from pathlib import Path
from io import BytesIO
from PIL import Image
from PIL import ImageDraw, ImageFont, ImageOps
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml.ns import qn

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
document = Document()
document.core_properties.author = ""
document.core_properties.last_modified_by = ""
document.core_properties.title = manifest["title"]
section = document.sections[0]
section.top_margin = section.bottom_margin = Inches(.8)
section.left_margin = section.right_margin = Inches(.8)
for name in ("Normal", "Title"):
    style = document.styles[name]
    style.font.name = "Microsoft YaHei"
    style.font.color.rgb = RGBColor(0, 0, 0)
    style.element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), "Microsoft YaHei")
document.styles["Normal"].font.size = Pt(11)
document.styles["Normal"].paragraph_format.line_spacing = 1.4
document.styles["Normal"].paragraph_format.space_after = Pt(10)
document.styles["Title"].font.size = Pt(22)
# Both publishers have a separate title field. Keeping it out of the imported
# body also avoids the empty heading paragraph left by platform conversion.
images = {image["id"]: image for image in manifest["images"]}
for block in manifest["blocks"]:
    if block["type"] == "text":
        document.add_paragraph(block["text"])
    else:
        image = images[block["imageId"]]
        run = document.add_paragraph().add_run()
        # A compressed publishing copy keeps all illustrations while avoiding
        # huge PNG archives. Original downloaded images remain untouched.
        with Image.open(image["localFile"]) as original:
            rgb = original.convert("RGB")
            rgb.thumbnail((1600, 1600))
            encoded = BytesIO()
            rgb.save(encoded, "JPEG", quality=90, optimize=True)
        encoded.seek(0)
        shape = run.add_picture(encoded, width=section.page_width-section.left_margin-section.right_margin)
        shape._inline.docPr.set("descr", image.get("title", "章节示意图"))
# Some platform importers drop a drawing when it is the terminal paragraph.
# An empty trailing paragraph preserves the last picture without visible text.
document.add_paragraph()
output = Path(sys.argv[2])
document.save(output)
if manifest["images"]:
    cover = Image.new("RGB", (720, 960), "#f5f1e8")
    draw = ImageDraw.Draw(cover)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 34)
    except OSError:
        font = ImageFont.load_default(size=34)
    lines, line = [], ""
    for char in manifest["title"]:
        if draw.textlength(line + char, font=font) > 620:
            lines.append(line)
            line = char
        else:
            line += char
    lines.append(line)
    draw.multiline_text((50, 110), "\n".join(lines), fill="#26333b", font=font, spacing=18)
    cover_image = next((i for i in manifest["images"] if i["id"] == manifest.get("coverImageId")), manifest["images"][0])
    with Image.open(cover_image["localFile"]) as image:
        diagram = ImageOps.contain(image.convert("RGB"), (680, 580))
        cover.paste(diagram, ((720-diagram.width)//2, 370+(420-diagram.height)//2))
    cover.save(output.with_name("cover.jpg"), quality=92)
print(json.dumps({"images": len(document.inline_shapes), "paragraphs": len(document.paragraphs)}, ensure_ascii=False))
