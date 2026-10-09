#!/usr/bin/env python3
"""
Build the product → image-file mapping for the catalog import.

Reads the product rows from products_input.sql, turns every Persian product
name into a readable English slug (brand prefix + descriptor), and writes
image_map.json with one entry per product:

    {
      "id":        "<uuid>",
      "name":      "<persian name>",
      "brand":     "میهن" | "پاندا",
      "old_image": "product_images/page00_img00.jpg" | null,
      "page":      0 | null,       # page index inside the PDF (from old_image)
      "index":     0 | null,       # image index on that page (from old_image)
      "slug":      "mihan-mirax-stick-vanilla-chocolate-coated",
      "file":      "mihan-mirax-stick-vanilla-chocolate-coated.jpg"
    }

Run:  python3 scripts/catalog/build_image_map.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
INPUT_SQL = HERE / "products_input.sql"
OUTPUT_JSON = HERE / "image_map.json"

BRAND_SLUG = {"میهن": "mihan", "پاندا": "panda"}
CATEGORY_SLUG = {
    "چوبی": "stick",
    "قیفی": "cone",
    "لیوانی": "cup",
    "یخی": "ice",
    "کترینگ": "catering",
    "سنتی و حصیری": "wafer",
}

# Multi-word phrases first (longest match wins), then single words.
# Empty string = drop the word from the slug.
PHRASES: dict[str, str] = {
    # --- generic / connectors (dropped) ---
    "بستنی": "",
    "پاندا": "",            # brand prefix already carries it
    "با": "",
    "و": "",
    "ها": "",
    "های": "",
    "تکه های شکلات": "chocolate-chunks",
    "تکه های": "",
    "تکه": "",
    # --- sauces / cakes (phrase so the order reads naturally) ---
    "سس شکلات": "chocolate-sauce",
    "سس میوه ای": "fruit-sauce",
    "سس عسل": "honey-sauce",
    "سس مرکبات": "citrus-sauce",
    "سس شاتوت": "blackberry-sauce",
    "سس انبه آلفونسو": "alphonso-mango-sauce",
    "سس توت های جنگلی": "wild-berries-sauce",
    "کیک شکلات": "chocolate-cake",
    "کیک رد ولوت": "red-velvet-cake",
    # --- sizes / forms ---
    "۴ کیلویی": "4kg",
    "یک لیتری": "1l",
    "دو لیتری": "2l",
    "لیتری": "liter",
    "کترینگ": "catering",
    "چوبی": "stick",
    "قیفی": "cone",
    "لیوانی": "cup",
    "سه بعدی": "3d",
    "دیسک": "disc",
    "ساندویچی": "sandwich",
    "سنتی": "traditional",
    "سوپر": "super",
    "دوقلو": "twin",
    "میکس": "mix",
    "ساندی کاپ": "sundae-cup",
    "ماکسی": "maxi",
    # --- product lines / brand names ---
    "میرکس": "mirax",
    "عروسکی": "doll",
    "چارلی": "charlie",
    "چوکوپیرال": "chocospiral",
    "هایپیرال": "hispiral",
    "میلکی": "milky",
    "سوتمک": "sutmak",
    "کولفی": "kulfi",
    "کیماک": "kaymak",
    "خرسی": "bear",
    "ماین کرافت": "minecraft",
    "تابلرنات": "tablernut",
    "سوهان": "sohan",
    "گز": "gaz",
    "بیسکورول": "biscoroll",
    "فروتاره": "frutare",
    "فالوده": "faloodeh",
    "آیس مک": "ice-mac",
    "ترش اسکری": "sour-scary",
    "آیس جامپ": "ice-jump",
    "اسکیمو": "eskimo",
    "ویفرنا": "waferna",
    "هایلی": "hayli",
    "نونی": "bread",
    "ویفر": "wafer",
    "نون خامه ای": "cream-puff",
    "خامه ای": "cream",
    "خامه": "cream",
    "شیرینی": "pastry",
    "کیک": "cake",
    "کارنیتا": "carnita",
    "کارنیلو": "carnilo",
    "رد ولوت": "red-velvet",
    "پریما": "prima",
    "پریمارس": "primars",
    "گلد": "gold",
    "گلدن": "golden",
    "دبل میکس بری": "double-mixed-berry",
    "دبل چاکلت": "double-chocolate",
    "دبی چاکلت": "dubai-chocolate",
    "کوکی": "cookie",
    "معجون ترش": "sour-majoon",
    "معجون": "majoon",
    "ایتالیایی": "italian",
    "سالار": "salar",
    "توئیست": "twist",
    "لاوتلا": "lavtella",
    "سمفونی": "symphony",
    "فیت": "fit",
    "لوماک": "lomac",
    "رویا": "roya",
    "ژلاتو": "gelato",
    "باقلوا کادایف": "baklava-kadayif",
    "ماراش": "maras",
    "چیزکیک": "cheesecake",
    "قلبی": "heart",
    "شیر گاومیش": "buffalo-milk",
    "سربت": "sorbet",
    "اورئو": "oreo",
    "نسکافه": "nescafe",
    "اسپرسو": "espresso",
    # --- coatings (phrase so the order reads naturally) ---
    "روکش شکلاتی کاراملی": "chocolate-caramel-coated",
    "روکش شکلاتی": "chocolate-coated",
    "روکش شکلات": "chocolate-coated",
    "روکش توت فرنگی": "strawberry-coated",
    "روکش موزی": "banana-coated",
    "روکش": "coated",
    # --- flavours ---
    "وانیلی": "vanilla",
    "وانیل": "vanilla",
    "شکلات تلخ": "dark-chocolate",
    "شکلات سفید": "white-chocolate",
    "شکلاتی": "chocolate",
    "شکلات": "chocolate",
    "کاکائویی": "cocoa",
    "کاکائو": "cocoa",
    "ورمیشل": "vermicelli",
    "زعفرانی": "saffron",
    "زعفران": "saffron",
    "کاراملی": "caramel",
    "کارامل": "caramel",
    "قهوه ملایم": "mild-coffee",
    "قهوه": "coffee",
    "انبه آلفونسو": "alphonso-mango",
    "انبه": "mango",
    "توت فرنگی-طالبی": "strawberry-melon",
    "موز-طالبی-توت فرنگی": "banana-melon-strawberry",
    "توت فرنگی": "strawberry",
    "توتی فروتی": "tutti-frutti",
    "توت های جنگلی": "wild-berries",
    "مخلوط توت ها": "mixed-berries",
    "میوه های سرخ": "red-fruits",
    "میوه ای": "fruit",
    "میوه": "fruit",
    "کره هلندی": "dutch-butter",
    "کره ای": "butter",
    "کره": "butter",
    "هلندی": "dutch",
    "هلو": "peach",
    "موزی": "banana",
    "موز": "banana",
    "طالبی": "melon",
    "سیب ترش": "sour-apple",
    "ترش": "sour",
    "آناناس": "pineapple",
    "پرتقال": "orange",
    "بلوبری": "blueberry",
    "بادام زمینی": "peanut",
    "پسته ای": "pistachio",
    "پسته": "pistachio",
    "استوایی": "tropical",
    "هویج": "carrot",
    "هندوانه": "watermelon",
    "لیمویی": "lemon",
    "لیمو": "lemon",
    "کیوی": "kiwi",
    "آلوچه جنگلی": "wild-plum",
    "آلبالو": "sour-cherry",
    "گلپر": "golpar",
    "شاتوت": "blackberry",
    "تمشک": "raspberry",
    "انگور قرمز": "red-grape",
    "انگور": "grape",
    "نارگیلی": "coconut",
    "نارگیل": "coconut",
    "فندقی": "hazelnut",
    "فندق": "hazelnut",
    "گردو": "walnut",
    "دراژه": "dragee",
    "انار": "pomegranate",
    "عسل": "honey",
    "مرکبات": "citrus",
    "سس": "sauce",
    "بیسکوئیتی": "biscuit",
    "بیسکویت": "biscuit",
    "قرمز": "red",
    "سفید": "white",
    "تلخ": "dark",
}

# Sort phrases by word count (longest first) so multi-word phrases win.
_PHRASE_LIST = sorted(PHRASES.items(), key=lambda kv: -len(kv[0].split()))

ROW_RE = re.compile(
    r"\('(?P<id>[0-9a-f-]{36})',\s*'(?P<name>(?:[^'\\]|\\.)*)',\s*"
    r"(?:'(?P<category>(?:[^'\\]|\\.)*)'|NULL),\s*"
    r"(?P<price>[0-9.]+),\s*(?P<units>\d+),\s*(?P<global>\d),\s*"
    r"(?P<created_by>NULL|'[^']*'),\s*'(?P<created>[^']*)',\s*'(?P<updated>[^']*)',\s*"
    r"'(?P<brand>(?:[^'\\]|\\.)*)',\s*(?:'(?P<image>[^']*)'|NULL)\)",
    re.UNICODE,
)
OLD_IMG_RE = re.compile(r"page(\d+)_img(\d+)\.(?:jpe?g|png)$", re.IGNORECASE)


def normalize(name: str) -> list[str]:
    """Collapse whitespace, unify Arabic/Persian letter variants, split to words."""
    name = name.replace("ي", "ی").replace("ك", "ک").replace("\u200c", " ")
    return name.split()


def slugify(name: str, brand: str) -> str:
    words = normalize(name)
    out: list[str] = []
    i = 0
    while i < len(words):
        for phrase, repl in _PHRASE_LIST:
            pw = phrase.split()
            if words[i : i + len(pw)] == pw:
                if repl:
                    out.append(repl)
                i += len(pw)
                break
        else:
            # Unknown word: fail loudly so the dictionary gets completed.
            raise KeyError(f"no slug for word {words[i]!r} in {name!r}")
    slug = "-".join(out)
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    return f"{BRAND_SLUG[brand]}-{slug}" if slug else BRAND_SLUG[brand]


def parse_rows(sql: str) -> list[dict]:
    rows = []
    for m in ROW_RE.finditer(sql):
        d = m.groupdict()
        rows.append(
            {
                "id": d["id"],
                "name": d["name"],
                "category": d["category"],
                "baseUnitPrice": d["price"],
                "unitsPerCartonDefault": int(d["units"]),
                "isGlobal": int(d["global"]),
                "createdById": None if d["created_by"] == "NULL" else d["created_by"].strip("'"),
                "createdAt": d["created"],
                "updatedAt": d["updated"],
                "brand": d["brand"],
                "old_image": d["image"],
            }
        )
    return rows


def main() -> int:
    sql = INPUT_SQL.read_text(encoding="utf-8")
    rows = parse_rows(sql)
    expected = sql.count("\n('")
    if len(rows) != expected:
        print(f"ERROR: parsed {len(rows)} rows but the file has {expected} value tuples", file=sys.stderr)
        return 1

    # First pass: base slugs. Then resolve collisions - if the colliding
    # products live in different categories (e.g. stick vs cup "Prima vanilla")
    # the category disambiguates; otherwise fall back to a numeric suffix.
    for r in rows:
        r["slug"] = slugify(r["name"], r["brand"])
    groups: dict[str, list[dict]] = {}
    for r in rows:
        groups.setdefault(r["slug"], []).append(r)
    for slug, members in groups.items():
        if len(members) == 1:
            continue
        cats = [CATEGORY_SLUG.get(m["category"] or "", "") for m in members]
        if all(cats) and len(set(cats)) == len(cats):
            for m, c in zip(members, cats):
                m["slug"] = f"{slug}-{c}"
        else:
            for n, m in enumerate(members, start=1):
                if n > 1:
                    m["slug"] = f"{slug}-{n}"
    for r in rows:
        slug = r["slug"]
        r["file"] = f"{slug}.jpg"
        r["page"] = r["index"] = None
        if r["old_image"]:
            m = OLD_IMG_RE.search(r["old_image"])
            if m:
                r["page"], r["index"] = int(m.group(1)), int(m.group(2))

    OUTPUT_JSON.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    with_img = sum(1 for r in rows if r["old_image"])
    print(f"{len(rows)} products parsed, {with_img} reference a catalog image -> {OUTPUT_JSON.name}")
    for r in rows:
        print(f"  {r['old_image'] or '-':34} {r['slug']:48} {r['name']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
