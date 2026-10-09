#!/usr/bin/env python3
"""
Extract the product photos from the Mihan catalog PDF, square them (white
padding, nothing cropped) and name them after the products in image_map.json.

    python3 scripts/catalog/extract_catalog_images.py catalog.pdf --list
        -> prints every raster image per page (size, colourspace) so the
           page/index numbering can be checked against image_map.json

    python3 scripts/catalog/extract_catalog_images.py catalog.pdf
        -> writes images/<slug>.jpg for every product whose page/index is
           known, a per-page preview sheet to /tmp/catalog-preview, and the
           final SQL to documents/products_with_images.sql

The page/index numbering mirrors the original `pageXX_imgYY` extraction:
pages are 0-based, images are enumerated in the order PyMuPDF returns them
for the page (page.get_images(full=True)), after dropping images smaller
than --min-size on either side (logos, icons, bullets).
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

import pymupdf  # PyMuPDF
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
MAP_JSON = HERE / "image_map.json"
IMAGES_DIR = REPO / "images"
SQL_OUT = REPO / "documents" / "products_with_images.sql"
PREVIEW_DIR = Path("/tmp/catalog-preview")

URL_PREFIX = "/images/"


# --------------------------------------------------------------------------- #
# PDF side
# --------------------------------------------------------------------------- #
def page_images(doc: pymupdf.Document, page_no: int, min_size: int) -> list[dict]:
    """Raster images on a page, in PyMuPDF order, with small ones dropped."""
    page = doc[page_no]
    out: list[dict] = []
    seen_xrefs: set[int] = set()
    for info in page.get_images(full=True):
        xref, smask, w, h, bpc, cs, _alt, name, _filter, _ref = info
        if xref in seen_xrefs:
            continue
        seen_xrefs.add(xref)
        if w < min_size or h < min_size:
            continue
        out.append(
            {"xref": xref, "smask": smask, "w": w, "h": h, "bpc": bpc, "cs": cs, "name": name}
        )
    return out


def load_pixmap(doc: pymupdf.Document, meta: dict) -> Image.Image:
    """Decode an embedded image (plus its soft mask) to an RGB PIL image on white."""
    pix = pymupdf.Pixmap(doc, meta["xref"])
    if pix.n - pix.alpha >= 4:  # CMYK & friends
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    img = Image.open(io.BytesIO(pix.tobytes("png")))

    if meta["smask"]:
        mask_pix = pymupdf.Pixmap(doc, meta["smask"])
        mask = Image.open(io.BytesIO(mask_pix.tobytes("png"))).convert("L")
        if mask.size != img.size:
            mask = mask.resize(img.size, Image.LANCZOS)
        img = img.convert("RGBA")
        img.putalpha(mask)

    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    return img.convert("RGB")


# --------------------------------------------------------------------------- #
# Image processing
# --------------------------------------------------------------------------- #
def trim_white(img: Image.Image, tolerance: int = 18) -> Image.Image:
    """Cut uniform near-white borders so the product sits centred after padding.

    Only trims when the corners really are white-ish; coloured backgrounds are
    left alone.
    """
    w, h = img.size
    corners = [img.getpixel((0, 0)), img.getpixel((w - 1, 0)), img.getpixel((0, h - 1)), img.getpixel((w - 1, h - 1))]
    if not all(min(c) >= 255 - tolerance for c in corners):
        return img
    bg = Image.new("RGB", img.size, (255, 255, 255))
    diff = ImageChops.difference(img, bg).convert("L")
    diff = diff.point(lambda v: 255 if v > tolerance else 0)
    bbox = diff.getbbox()
    if not bbox:
        return img
    # keep a hair of breathing room so anti-aliased edges are not clipped
    pad = max(2, int(0.01 * max(w, h)))
    l, t, r, b = bbox
    return img.crop((max(0, l - pad), max(0, t - pad), min(w, r + pad), min(h, b + pad)))


def squarify(img: Image.Image, margin: float, max_side: int) -> Image.Image:
    """Pad to a square white canvas (optionally with a margin) and cap the size."""
    w, h = img.size
    side = int(round(max(w, h) * (1 + 2 * margin)))
    canvas = Image.new("RGB", (side, side), (255, 255, 255))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2))
    if side > max_side:
        canvas = canvas.resize((max_side, max_side), Image.LANCZOS)
    return canvas


# --------------------------------------------------------------------------- #
# Preview sheet (for eyeballing page/index -> product name)
# --------------------------------------------------------------------------- #
def preview_sheet(page_no: int, tiles: list[tuple[Image.Image, str]], out_dir: Path) -> None:
    if not tiles:
        return
    tile, gap, label_h = 240, 16, 50
    cols = min(6, len(tiles))
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (tile + gap) + gap, rows * (tile + label_h + gap) + gap), "white")
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 13)
    except OSError:
        font = ImageFont.load_default()
    for i, (im, label) in enumerate(tiles):
        r, c = divmod(i, cols)
        x = gap + c * (tile + gap)
        y = gap + r * (tile + label_h + gap)
        thumb = ImageOps.contain(im, (tile, tile))
        sheet.paste(thumb, (x + (tile - thumb.width) // 2, y + (tile - thumb.height) // 2))
        draw.rectangle([x, y, x + tile, y + tile], outline=(200, 200, 200))
        draw.text((x, y + tile + 4), label[:30], fill="black", font=font)
        if len(label) > 30:
            draw.text((x, y + tile + 22), label[30:60], fill="black", font=font)
    out_dir.mkdir(parents=True, exist_ok=True)
    sheet.save(out_dir / f"page{page_no:02d}.png")


# --------------------------------------------------------------------------- #
# SQL output
# --------------------------------------------------------------------------- #
def sql_str(v: str | None) -> str:
    if v is None:
        return "NULL"
    return "'" + v.replace("\\", "\\\\").replace("'", "''") + "'"


def write_sql(rows: list[dict], out: Path) -> None:
    cols = (
        "`id`, `name`, `category`, `baseUnitPrice`, `unitsPerCartonDefault`, `isGlobal`, "
        "`createdById`, `createdAt`, `updatedAt`, `brand`, `imageUrl`"
    )
    lines = [
        "-- Product catalog with square product photos.",
        f"-- Images live in /images at the repository root and are referenced as {URL_PREFIX}<slug>.jpg",
        "-- Generated by scripts/catalog/extract_catalog_images.py",
        "",
        f"INSERT INTO `products` ({cols}) VALUES",
    ]
    tuples = []
    for r in rows:
        tuples.append(
            "("
            + ", ".join(
                [
                    sql_str(r["id"]),
                    sql_str(r["name"]),
                    sql_str(r["category"]),
                    r["baseUnitPrice"],
                    str(r["unitsPerCartonDefault"]),
                    str(r["isGlobal"]),
                    sql_str(r["createdById"]),
                    sql_str(r["createdAt"]),
                    sql_str(r["updatedAt"]),
                    sql_str(r["brand"]),
                    sql_str(r["imageUrl"]),
                ]
            )
            + ")"
        )
    lines.append(",\n".join(tuples) + ";")
    lines.append("")
    lines.append("-- Same mapping as UPDATE statements, for databases that already contain the rows:")
    for r in rows:
        if r["imageUrl"]:
            lines.append(f"UPDATE `products` SET `imageUrl` = {sql_str(r['imageUrl'])} WHERE `id` = {sql_str(r['id'])};")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")


# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", type=Path)
    ap.add_argument("--list", action="store_true", help="only print the per-page image inventory")
    ap.add_argument("--min-size", type=int, default=120, help="ignore images smaller than this (px)")
    ap.add_argument("--margin", type=float, default=0.04, help="white margin around the product (fraction of side)")
    ap.add_argument("--max-side", type=int, default=1000, help="cap the output square at this many px")
    ap.add_argument("--quality", type=int, default=88)
    ap.add_argument("--no-trim", action="store_true", help="do not trim white borders before squaring")
    ap.add_argument("--out-dir", type=Path, default=IMAGES_DIR, help="where the jpgs go (default: <repo>/images)")
    ap.add_argument("--sql-out", type=Path, default=SQL_OUT, help="where the SQL goes")
    ap.add_argument("--preview-dir", type=Path, default=PREVIEW_DIR)
    args = ap.parse_args()
    out_dir: Path = args.out_dir
    sql_out: Path = args.sql_out
    preview_dir: Path = args.preview_dir

    if not args.pdf.exists():
        print(f"PDF not found: {args.pdf}", file=sys.stderr)
        return 1

    rows = json.loads(MAP_JSON.read_text(encoding="utf-8"))
    expected: dict[int, int] = {}
    for r in rows:
        if r["page"] is not None:
            expected[r["page"]] = max(expected.get(r["page"], 0), r["index"] + 1)

    doc = pymupdf.open(args.pdf)
    print(f"{args.pdf.name}: {doc.page_count} pages")

    inventory: dict[int, list[dict]] = {}
    for page_no in range(doc.page_count):
        inventory[page_no] = page_images(doc, page_no, args.min_size)

    # ---- inventory / sanity report -------------------------------------- #
    mismatch = False
    for page_no in range(doc.page_count):
        imgs = inventory[page_no]
        exp = expected.get(page_no, 0)
        flag = "" if len(imgs) == exp else "   <-- expected %d" % exp
        if flag:
            mismatch = True
        print(f"page {page_no:02d}: {len(imgs)} images{flag}")
        if args.list:
            for i, m in enumerate(imgs):
                print(f"    img{i:02d} xref={m['xref']:<5} {m['w']}x{m['h']} {m['cs']} bpc={m['bpc']} smask={m['smask']}")
    if args.list:
        return 0
    if mismatch:
        print("\nWARNING: image counts differ from the pageXX_imgYY numbering in image_map.json;"
              " check the preview sheets before trusting the mapping.\n")

    # ---- extract ---------------------------------------------------------- #
    out_dir.mkdir(parents=True, exist_ok=True)
    by_pos = {(r["page"], r["index"]): r for r in rows if r["page"] is not None}
    written = 0
    for page_no in range(doc.page_count):
        tiles: list[tuple[Image.Image, str]] = []
        for i, meta in enumerate(inventory[page_no]):
            img = load_pixmap(doc, meta)
            if not args.no_trim:
                img = trim_white(img)
            sq = squarify(img, args.margin, args.max_side)
            r = by_pos.get((page_no, i))
            if r:
                sq.save(out_dir / r["file"], "JPEG", quality=args.quality, optimize=True, progressive=True)
                r["imageUrl"] = URL_PREFIX + r["file"]
                written += 1
                tiles.append((sq, f"img{i:02d} {r['slug']}"))
            else:
                tiles.append((sq, f"img{i:02d} (unmapped)"))
        preview_sheet(page_no, tiles, preview_dir)

    for r in rows:
        r.setdefault("imageUrl", None)

    sql_out.parent.mkdir(parents=True, exist_ok=True)
    write_sql(rows, sql_out)
    if out_dir == IMAGES_DIR:
        MAP_JSON.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    missing = [r for r in rows if r["page"] is not None and not r["imageUrl"]]
    print(f"\nwrote {written} images to {out_dir}/")
    print(f"wrote {sql_out}")
    print(f"preview sheets in {preview_dir}")
    if missing:
        print(f"{len(missing)} mapped products had no image at their page/index:")
        for r in missing:
            print(f"   {r['old_image']}  {r['name']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
