#!/usr/bin/env python3
"""Vizitik PWA / PHP parity checks.

1) every frontend/css/*.css must be copied byte-for-byte into frontend-app/src/styles
2) classes used in a screen must exist in the stylesheets that page loads, and PHP
   classes missing from the screen are reported
3) Material Symbols icon names used by a PHP page must exist in the PWA code

Exit code: 0 when the CSS copies and the icon set are complete.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PHP = ROOT / "frontend"
APP = ROOT / "frontend-app"

SHARED = ["src/components/BottomNav.jsx", "src/components/SideMenu.jsx", "src/components/Skeleton.jsx", "src/lib/pages.js", "src/App.jsx"]

PAGES = {
    "dashboard.php": ["src/screens/Dashboard.jsx"],
    "van-loading.php": ["src/screens/VanLoading.jsx"],
    "customers.php": ["src/screens/Customers.jsx", "src/js-customers.js"],
    "orders.php": ["src/screens/Orders.jsx"],
    "collections.php": ["src/screens/Collections.jsx"],
    "new-order.php": ["src/screens/NewOrder.jsx"],
    "products.php": ["src/screens/Products.jsx"],
    "payment.php": ["src/screens/Payment.jsx"],
    "settings.php": ["src/screens/Settings.jsx"],
    "bale-bot.php": ["src/screens/BaleBot.jsx", "src/screens/Settings.jsx"],
    "index.php": ["src/screens/Auth.jsx"],
    "help.php": ["src/screens/Info.jsx"],
    "about.php": ["src/screens/Info.jsx"],
}

PAGE_CSS = {
    "dashboard.php": [],
    "van-loading.php": ["van-loading"],
    "customers.php": ["customers"],
    "orders.php": ["orders", "payment"],
    "collections.php": ["collections"],
    "new-order.php": ["new-order"],
    "products.php": ["products"],
    "payment.php": ["payment"],
    "settings.php": ["settings"],
    "bale-bot.php": ["settings", "bale-bot"],
    "index.php": ["inline-login"],
    "help.php": ["inline-help", "inline-about"],
    "about.php": ["inline-about", "inline-help"],
}

CLS_RE = re.compile(r'class(?:Name)?\s*=\s*"([^"]*)"')
JS_CLS_RE = re.compile(r"classList\.(?:add|remove|toggle)\(\s*['\"]([\w-]+)['\"]")
TPL_CLS_RE = re.compile(r'class="([^"]*)"')
ICON_RE = re.compile(r'material-symbols-outlined[^>]*>\s*([a-z_]+)\s*<')
JSX_ICON_RE = re.compile(r'material-symbols-outlined[^\n]*?>\s*\{?\s*\'?([a-z_]+)\'?')
IDENT = re.compile(r"^[a-z][a-z0-9-]*$")


def css_classes(styles):
    """every class defined in style.css + the requested page stylesheets"""
    files = [APP / "src/styles/style.css"] + [APP / f"src/styles/{n}.css" for n in styles]
    out = set()
    for f in files:
        if not f.exists():
            continue
        txt = f.read_text(encoding="utf-8", errors="ignore")
        for sel in re.findall(r"\.([a-zA-Z][\w-]*)", txt):
            out.add(sel.lower())
    return out


def php_classes(page):
    """classes used in the page HTML plus the helper JS of that page"""
    src = (PHP / page).read_text(encoding="utf-8", errors="ignore")
    body = re.sub(r"<script.*?</script>", "", src, flags=re.S)
    body = re.sub(r"<!--.*?-->", "", body, flags=re.S)
    body = re.sub(r"<style.*?</style>", "", body, flags=re.S)
    found = set()
    for attr in CLS_RE.findall(body):
        for tok in attr.split():
            tok = tok.strip()
            if "<?" in tok or "$" in tok or not IDENT.match(tok):
                continue
            found.add(tok)
    js = PHP / "js" / page.replace(".php", ".js")
    if js.exists():
        jtxt = js.read_text(encoding="utf-8", errors="ignore")
        for attr in TPL_CLS_RE.findall(jtxt):
            for tok in attr.split():
                if "${" in tok or "<?" in tok or not IDENT.match(tok):
                    continue
                found.add(tok)
        for tok in JS_CLS_RE.findall(jtxt):
            if IDENT.match(tok.lower()):
                found.add(tok.lower())
    return found


def jsx_classes(paths):
    """classes used in the screen: className literals, template classes and string props"""
    found = set()
    dq = chr(34)
    bt = chr(96)
    for rel in paths:
        f = APP / rel
        if not f.exists():
            continue
        for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
            for attr in CLS_RE.findall(line):
                attr = re.sub(r"\$\{[^}]*\}", " ", attr)
                for tok in attr.split():
                    if IDENT.match(tok):
                        found.add(tok)
            if "className={" in line and bt in line:
                inner = line[line.index(bt) + 1: line.rindex(bt)]
                inner = re.sub(r"\$\{[^}]*\}", " ", inner)
                for tok in inner.split():
                    if IDENT.match(tok):
                        found.add(tok)
            for m in re.finditer(r"[=:]\s*" + chr(39) + r"([a-z][a-z0-9 -]{2,})" + chr(39), line):
                for tok in m.group(1).split():
                    if IDENT.match(tok):
                        found.add(tok)
            for m in re.finditer(dq + r"([a-z][a-z0-9 -]{2,})" + dq, line):
                for tok in m.group(1).split():
                    if IDENT.match(tok):
                        found.add(tok)
    return found


def php_icons(page):
    src = (PHP / page).read_text(encoding="utf-8", errors="ignore")
    return {m for m in ICON_RE.findall(src) if m not in {"font", "icon"}}


def app_icons():
    """every icon name available anywhere in the PWA code"""
    out = set()
    for f in list((APP / "src").rglob("*.jsx")) + list((APP / "src").rglob("*.js")):
        txt = f.read_text(encoding="utf-8", errors="ignore")
        out |= {m for m in ICON_RE.findall(txt)}
        out |= {m for m in re.findall(r"'([a-z_]{3,30})'", txt)}
        out |= {m for m in re.findall(r'"([a-z_]{3,30})"', txt)}
    return out


def main():
    print("== 1) CSS copied verbatim from the PHP app ==")
    diff_css = 0
    for f in sorted((PHP / "css").glob("*.css")):
        copy = APP / "src/styles" / f.name
        if not copy.exists():
            print(f"  MISSING   {f.name} (not copied into the PWA)")
            diff_css += 1
            continue
        same = f.read_bytes() == copy.read_bytes()
        print(f"  {'IDENTICAL' if same else 'MODIFIED '} {f.name}")
        if not same:
            diff_css += 1
    for f in sorted((APP / "src/styles").glob("inline-*.css")):
        print(f"  EXTRACTED {f.name} (from the page inline <style>)")

    app_ic = app_icons()
    total_missing_cls = 0
    total_missing_icons = 0
    print("\n== 2 and 3) classes and icons per page ==")
    for page, jsx_files in PAGES.items():
        jsx_files = jsx_files + SHARED
        styles = ["style"] + PAGE_CSS.get(page, [])
        defined = css_classes(PAGE_CSS.get(page, []))
        used = jsx_classes(jsx_files)
        NOISE = {"app", "show", "active", "echo", "php", "none", "auto", "flex", "inherit", "center", "pointer", "hidden", "ltr", "rtl", "block", "relative", "solid", "middle", "button", "text", "number", "tel", "password", "checkbox", "image", "small", "large", "cover", "blank"}
        php_used = php_classes(page)
        undef = sorted(c for c in used - php_used if c not in defined and c not in NOISE and "-" in c)
        php_used = php_classes(page)
        missing = sorted(c for c in php_used if c not in used and c not in NOISE)
        icons = php_icons(page)
        missing_icons = sorted(i for i in icons if i not in app_ic)
        total_missing_cls += len(missing) + len(undef)
        total_missing_icons += len(missing_icons)
        print(f"\n  {page}  ({len(php_used)} classes in PHP, {len(used)} classes in JSX)")
        print(f"    classes used in JSX but not styled here : {', '.join(undef) if undef else '-'}")
        print(f"    classes used in PHP but missing in JSX  : {', '.join(missing) if missing else '-'}")
        print(f"    icons used in PHP but missing in PWA   : {', '.join(missing_icons) if missing_icons else '-'}")

    print(f"\n== summary == incomplete CSS copies: {diff_css} | class diffs: {total_missing_cls} | missing icons: {total_missing_icons}")
    return 0 if (diff_css == 0 and total_missing_icons == 0) else 1


if __name__ == "__main__":
    sys.exit(main())
