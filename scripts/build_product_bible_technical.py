from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps


WIDTH = 3840
HEIGHT = 2160
PANEL_X = 2600

INK = "#111318"
MUTED = "#626872"
LIGHT = "#E4E7EB"
SOFT = "#F6F7F8"
PINK = "#D90075"
WHITE = "#FFFFFF"


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    candidates = {
        "regular": ["C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/segoeui.ttf"],
        "bold": ["C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/seguisb.ttf"],
        "mono": ["C:/Windows/Fonts/consola.ttf", "C:/Windows/Fonts/cour.ttf"],
        "mono_bold": ["C:/Windows/Fonts/consolab.ttf", "C:/Windows/Fonts/courbd.ttf"],
    }[name]
    for candidate in candidates:
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default(size=size)


F = {
    "eyebrow": font("mono_bold", 30),
    "brand": font("bold", 112),
    "subtitle": font("bold", 40),
    "section": font("mono_bold", 25),
    "card_letter": font("bold", 47),
    "card_label": font("bold", 23),
    "card_status": font("mono_bold", 19),
    "body": font("regular", 23),
    "body_bold": font("bold", 23),
    "small": font("regular", 19),
    "small_bold": font("bold", 19),
    "tag": font("mono_bold", 22),
    "callout": font("bold", 30),
}


def text_width(draw: ImageDraw.ImageDraw, text: str, face: ImageFont.ImageFont) -> int:
    box = draw.textbbox((0, 0), text, font=face)
    return box[2] - box[0]


def wrap_lines(
    draw: ImageDraw.ImageDraw,
    text: str,
    face: ImageFont.ImageFont,
    max_width: int,
) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if not current or text_width(draw, candidate, face) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def draw_wrapped(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    face: ImageFont.ImageFont,
    fill: str,
    max_width: int,
    line_gap: int = 10,
) -> int:
    x, y = xy
    line_height = face.size + line_gap
    for line in wrap_lines(draw, text, face, max_width):
        draw.text((x, y), line, font=face, fill=fill)
        y += line_height
    return y


def section_title(draw: ImageDraw.ImageDraw, x: int, y: int, label: str) -> None:
    draw.rectangle((x, y + 7, x + 14, y + 30), fill=PINK)
    draw.text((x + 30, y), label, font=F["section"], fill=INK)


def measurement_card(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    letter: str,
    label: str,
    status: str,
) -> None:
    x0, y0, x1, y1 = box
    draw.rounded_rectangle(box, radius=14, fill=SOFT, outline=LIGHT, width=2)
    draw.text((x0 + 22, y0 + 18), letter, font=F["card_letter"], fill=PINK)
    draw.text((x0 + 86, y0 + 22), label, font=F["card_label"], fill=INK)
    draw.text((x0 + 86, y0 + 68), status, font=F["card_status"], fill=MUTED)


def arrow_head(draw: ImageDraw.ImageDraw, point: tuple[int, int], direction: str) -> None:
    x, y = point
    if direction == "left":
        polygon = [(x, y), (x + 24, y - 13), (x + 24, y + 13)]
    elif direction == "right":
        polygon = [(x, y), (x - 24, y - 13), (x - 24, y + 13)]
    elif direction == "up":
        polygon = [(x, y), (x - 13, y + 24), (x + 13, y + 24)]
    else:
        polygon = [(x, y), (x - 13, y - 24), (x + 13, y - 24)]
    draw.polygon(polygon, fill=PINK)


def callout_badge(draw: ImageDraw.ImageDraw, center: tuple[int, int], letter: str) -> None:
    x, y = center
    draw.ellipse((x - 27, y - 27, x + 27, y + 27), fill=WHITE, outline=PINK, width=6)
    bbox = draw.textbbox((0, 0), letter, font=F["callout"])
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    draw.text((x - tw / 2, y - th / 2 - bbox[1]), letter, font=F["callout"], fill=PINK)


def double_arrow(
    draw: ImageDraw.ImageDraw,
    start: tuple[int, int],
    end: tuple[int, int],
    letter: str,
    vertical: bool = False,
) -> None:
    draw.line((start, end), fill=WHITE, width=12)
    draw.line((start, end), fill=PINK, width=5)
    if vertical:
        arrow_head(draw, start, "up")
        arrow_head(draw, end, "down")
    else:
        arrow_head(draw, start, "left")
        arrow_head(draw, end, "right")
    callout_badge(draw, ((start[0] + end[0]) // 2, (start[1] + end[1]) // 2), letter)


def view_tag(draw: ImageDraw.ImageDraw, xy: tuple[int, int], label: str) -> None:
    x, y = xy
    padding_x = 20
    padding_y = 12
    width = text_width(draw, label, F["tag"]) + padding_x * 2
    height = F["tag"].size + padding_y * 2
    draw.rounded_rectangle((x, y, x + width, y + height), radius=10, fill=WHITE, outline=LIGHT, width=2)
    draw.text((x + padding_x, y + padding_y - 2), label, font=F["tag"], fill=INK)


def product_crop(image: Image.Image) -> Image.Image:
    rgb = image.convert("RGB")
    white = Image.new("RGB", rgb.size, WHITE)
    difference = ImageChops.difference(rgb, white).convert("L")
    mask = difference.point(lambda value: 255 if value > 8 else 0)
    bbox = mask.getbbox()
    if bbox is None:
        return rgb
    left, top, right, bottom = bbox
    pad_x = max(6, int((right - left) * 0.025))
    pad_y = max(6, int((bottom - top) * 0.025))
    return rgb.crop(
        (
            max(0, left - pad_x),
            max(0, top - pad_y),
            min(rgb.width, right + pad_x),
            min(rgb.height, bottom + pad_y),
        )
    )


def paste_product(
    canvas: Image.Image,
    source: Path,
    box: tuple[int, int, int, int],
) -> tuple[int, int, int, int]:
    with Image.open(source) as original:
        image = product_crop(original)
    x0, y0, x1, y1 = box
    available_w = x1 - x0
    available_h = y1 - y0
    scale = min(available_w / image.width, available_h / image.height)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    image = image.resize(size, Image.Resampling.LANCZOS)
    px = x0 + (available_w - image.width) // 2
    py = y0 + (available_h - image.height) // 2
    canvas.paste(image, (px, py))
    return (px, py, px + image.width, py + image.height)


def paste_detail_circle(
    canvas: Image.Image,
    source: Path,
    crop_box: tuple[int, int, int, int],
    center: tuple[int, int],
    radius: int,
) -> None:
    with Image.open(source) as original:
        crop = original.convert("RGB").crop(crop_box)
    detail = ImageOps.fit(
        crop,
        (radius * 2, radius * 2),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )
    mask = Image.new("L", detail.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.ellipse((0, 0, detail.width - 1, detail.height - 1), fill=255)
    canvas.paste(detail, (center[0] - radius, center[1] - radius), mask)
    ring = ImageDraw.Draw(canvas)
    ring.ellipse(
        (center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius),
        outline="#C9CDD3",
        width=5,
    )


def build(gallery_dir: Path, description_dir: Path, output: Path) -> None:
    gallery_01 = gallery_dir / "gallery_01.jpg"
    gallery_02 = gallery_dir / "gallery_02.jpg"
    gallery_03 = gallery_dir / "gallery_03.jpg"
    gallery_04 = gallery_dir / "gallery_04.jpg"
    opposite_side = description_dir / "desc_03.jpg"
    required = [gallery_01, gallery_02, gallery_03, gallery_04, opposite_side]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"Missing source photos: {missing}")

    canvas = Image.new("RGB", (WIDTH, HEIGHT), WHITE)

    draw = ImageDraw.Draw(canvas)

    # Product pixels come only from the five unique extracted photographs.
    front = paste_product(canvas, gallery_01, (70, 55, 1030, 820))
    three_quarter = paste_product(canvas, gallery_02, (1080, 80, 1810, 710))
    side_a = paste_product(canvas, gallery_03, (1840, 80, 2530, 710))
    side_b = paste_product(canvas, opposite_side, (70, 835, 790, 1490))
    interior = paste_product(canvas, gallery_04, (825, 785, 1625, 1515))

    # Measurement guide: correct anatomical landmarks, never fabricated values.
    guide_box = (1665, 800, 2530, 1505)
    draw.rounded_rectangle(guide_box, radius=18, fill=SOFT, outline=LIGHT, width=3)
    gx = guide_box[0] + 38
    gy = guide_box[1] + 34
    draw.text((gx, gy), "GUÍA DE MEDICIÓN", font=font("mono_bold", 29), fill=INK)
    draw.text((gx, gy + 52), "VALORES PENDIENTES DE MEDICIÓN FÍSICA", font=F["small_bold"], fill=PINK)
    guide_rows = [
        ("A", "ANCHO FRONTAL DE COPA", "Borde exterior a borde exterior"),
        ("B", "ALTURA DE COPA", "Botón superior a unión con visera"),
        ("C", "LARGO DE VISERA", "Unión de copa a punta frontal"),
        ("D", "CONTORNO INTERIOR", "Perímetro de la banda de sudor"),
    ]
    row_y = gy + 118
    for letter, label, help_text in guide_rows:
        callout_badge(draw, (gx + 30, row_y + 27), letter)
        draw.text((gx + 78, row_y), label, font=F["body_bold"], fill=INK)
        draw.text((gx + 78, row_y + 32), help_text, font=F["small"], fill=MUTED)
        row_y += 102
    draw.ellipse((gx + 245, row_y + 5, gx + 610, row_y + 155), outline=PINK, width=5)
    draw.line((gx + 245, row_y + 80, gx + 610, row_y + 80), fill=PINK, width=4)
    arrow_head(draw, (gx + 245, row_y + 80), "left")
    arrow_head(draw, (gx + 610, row_y + 80), "right")
    callout_badge(draw, (gx + 427, row_y + 80), "D")

    # Accurate guide positions over the corresponding real photographs.
    crown_y = round(front[1] + (front[3] - front[1]) * 0.59)
    crown_left = round(front[0] + (front[2] - front[0]) * 0.025)
    crown_right = round(front[2] - (front[2] - front[0]) * 0.025)
    double_arrow(draw, (crown_left, crown_y), (crown_right, crown_y), "A")
    double_arrow(
        draw,
        (front[0] + 45, front[1] + 18),
        (front[0] + 45, crown_y - 12),
        "B",
        vertical=True,
    )
    brim_y = side_b[3] - 42
    double_arrow(
        draw,
        (side_b[0] + 22, brim_y),
        (round(side_b[0] + (side_b[2] - side_b[0]) * 0.46), brim_y),
        "C",
    )

    view_tag(draw, (front[0], front[3] + 6), "VISTA FRONTAL")
    view_tag(draw, (three_quarter[0], three_quarter[3] + 6), "VISTA 3/4")
    view_tag(draw, (side_a[0], side_a[3] + 6), "LATERAL A")
    view_tag(draw, (side_b[0], side_b[3] + 6), "LATERAL B")
    view_tag(draw, (interior[0], interior[3] + 6), "INTERIOR / REVERSO")

    # Detail strip: every pixel is a crop from an extracted source photo.
    detail_centers = [(245, 1840), (715, 1840), (1185, 1840), (1655, 1840), (2125, 1840)]
    radius = 192
    paste_detail_circle(canvas, gallery_01, (300, 250, 1700, 1200), detail_centers[0], radius)
    paste_detail_circle(canvas, gallery_01, (120, 980, 1930, 1740), detail_centers[1], radius)
    paste_detail_circle(canvas, gallery_03, (10, 45, 365, 440), detail_centers[2], radius)
    paste_detail_circle(canvas, gallery_04, (95, 55, 430, 315), detail_centers[3], radius)
    paste_detail_circle(canvas, gallery_04, (175, 175, 500, 500), detail_centers[4], radius)
    detail_labels = ["BORDADO ABZ", "BORDADO DE VISERA", "PANEL ESTAMPADO", "CINTAS INTERIORES", "REVERSO CON DRAGONES"]
    for center, label in zip(detail_centers, detail_labels, strict=True):
        label_width = text_width(draw, label, F["tag"])
        draw.text((center[0] - label_width / 2, 2052), label, font=F["tag"], fill=INK)

    draw.rectangle((PANEL_X, 0, WIDTH, HEIGHT), fill=WHITE)
    draw.line((PANEL_X, 80, PANEL_X, HEIGHT - 80), fill=LIGHT, width=3)
    draw.rectangle((PANEL_X, 80, PANEL_X + 8, 310), fill=PINK)

    x = PANEL_X + 95
    right = WIDTH - 80
    usable = right - x

    draw.text((x, 88), "PRODUCT BIBLE / REV. 03", font=F["eyebrow"], fill=PINK)
    draw.text((x, 132), "ABZ", font=F["brand"], fill=INK)
    subtitle_y = 265
    subtitle_y = draw_wrapped(
        draw,
        (x, subtitle_y),
        "GORRA NEGRA CON DETALLES ROSA Y BLANCO",
        F["subtitle"],
        INK,
        usable,
        line_gap=5,
    )
    draw.text((x, subtitle_y + 12), "FICHA TÉCNICA VISUAL · FONDO BLANCO", font=F["small_bold"], fill=MUTED)
    draw.line((x, 425, right, 425), fill=LIGHT, width=2)

    section_title(draw, x, 465, "MEDIDAS DEL PRODUCTO")
    gap = 18
    card_w = (usable - gap) // 2
    measurement_card(draw, (x, 515, x + card_w, 650), "A", "ANCHO FRONTAL DE COPA", "NO PUBLICADO · POR MEDIR")
    measurement_card(draw, (x + card_w + gap, 515, right, 650), "B", "ALTURA DE COPA", "NO PUBLICADO · POR MEDIR")
    measurement_card(draw, (x, 668, x + card_w, 803), "C", "LARGO DE VISERA", "NO PUBLICADO · POR MEDIR")
    measurement_card(draw, (x + card_w + gap, 668, right, 803), "D", "CONTORNO", "RANGO NO PUBLICADO")

    section_title(draw, x, 845, "CONSTRUCCIÓN VISIBLE")
    bullets = [
        "Corona multipanel y visera curva",
        "Bordado frontal ABZ con relieve",
        "Costuras de contraste visibles",
        "Paneles gris rosado con gráficos",
        "Cierre posterior regulable tipo snap",
        "Cintas interiores y reverso con dragones",
    ]
    by = 895
    for bullet in bullets:
        draw.ellipse((x + 2, by + 9, x + 12, by + 19), fill=PINK)
        draw.text((x + 28, by), bullet, font=F["body"], fill=INK)
        by += 47

    section_title(draw, x, 1195, "MATERIAL / COMPOSICIÓN")
    draw.rounded_rectangle((x, 1245, right, 1395), radius=14, fill="#FFF4F8", outline="#F2C7DB", width=2)
    draw.text((x + 24, 1270), "NO DECLARADO POR EL VENDEDOR", font=F["body_bold"], fill=PINK)
    draw_wrapped(
        draw,
        (x + 24, 1313),
        "Visible: tejido exterior, bordados, cintas interiores y cierre regulable.",
        F["small"],
        MUTED,
        usable - 48,
        line_gap=5,
    )

    section_title(draw, x, 1435, "COLOR OBSERVABLE")
    swatches = [
        ("#111318", "NEGRO"),
        ("#FFFFFF", "BLANCO"),
        ("#D90075", "ROSA / MAGENTA"),
        ("#B09AA5", "GRIS ROSADO"),
    ]
    sx = x
    for color, label in swatches:
        draw.rounded_rectangle((sx, 1482, sx + 54, 1536), radius=8, fill=color, outline="#AEB3BA", width=2)
        draw.text((sx + 66, 1493), label, font=F["small_bold"], fill=INK)
        sx += 254

    section_title(draw, x, 1588, "DATOS LOGÍSTICOS DEL PAQUETE")
    draw.rounded_rectangle((x, 1638, right, 1874), radius=14, fill=SOFT, outline=LIGHT, width=2)
    draw.text((x + 25, 1665), "26 × 15 × 18  ·  PESO 120", font=font("bold", 32), fill=INK)
    draw.text((x + 25, 1720), "UNIDADES NO IDENTIFICADAS EN LA EXTRACCIÓN", font=F["small_bold"], fill=MUTED)
    draw.line((x + 25, 1764, right - 25, 1764), fill=LIGHT, width=2)
    draw_wrapped(
        draw,
        (x + 25, 1790),
        "Dato de logística. No corresponde a medidas confirmadas de la gorra.",
        F["small"],
        PINK,
        usable - 50,
        line_gap=5,
    )

    section_title(draw, x, 1918, "AJUSTE")
    draw_wrapped(
        draw,
        (x + 30, 1964),
        "REGULABLE SEGÚN EVIDENCIA VISUAL Y RESEÑA; RANGO NO PUBLICADO.",
        F["small_bold"],
        INK,
        usable - 30,
        line_gap=4,
    )
    draw.text((x, 2100), "FUENTES DISPONIBLES: 5 FOTOS ÚNICAS · FICHA EXTRAÍDA", font=F["small"], fill=MUTED)

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, format="PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the verified ABZ technical Product Bible.")
    parser.add_argument("--gallery-dir", type=Path, required=True)
    parser.add_argument("--description-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build(args.gallery_dir, args.description_dir, args.output)


if __name__ == "__main__":
    main()
