# Catalog image pipeline

Turns the Mihan catalog PDF into square product photos under `/images`
(repository root) and produces the `products` SQL with the matching
`imageUrl` (`/images/<slug>.jpg`).

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install pymupdf pillow

python3 scripts/catalog/build_image_map.py                       # Persian name -> english slug (image_map.json)
python3 scripts/catalog/extract_catalog_images.py catalog.pdf --list   # check page/index numbering
python3 scripts/catalog/extract_catalog_images.py catalog.pdf    # images/*.jpg + documents/products_with_images.sql
```

* `products_input.sql` – the product rows as exported from the database
  (`imageUrl` still pointing at the old `product_images/pageXX_imgYY.jpg`).
* `image_map.json` – one entry per product: id, name, brand, old image,
  PDF page/index, slug, output file, final `imageUrl`.
* Images are padded (never cropped) onto a white square with a 4 % margin,
  capped at 1000×1000 px, JPEG quality 88.
* Panda products have no catalog photo yet and keep `imageUrl = NULL`.
