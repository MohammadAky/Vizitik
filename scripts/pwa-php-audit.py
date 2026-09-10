#!/usr/bin/env python3
"""
pwa-php-audit.py - find where the React PWA diverges from the PHP app in ways that
break behaviour, not looks.

What it compares, per screen and across the whole app:

  1. Persian UI strings   every visible text of the PHP page (labels, buttons,
                          headings, empty states, placeholders, <option> texts) must
                          appear in the React screen that replaced it. A renamed or
                          dropped string is how a filter silently stops matching.
  2. filter value lists    the literal option/category/brand values of PHP selects and
                          chips are compared with the arrays the React screen uses.
  3. API surface           endpoint + method pairs found in frontend/*.php and
                          frontend/js/*.js against the api() calls of frontend-app, and
                          the keys of the JSON bodies on both sides.
  4. self-hosted assets    no cdn url in either app.

Usage:  python3 scripts/pwa-php-audit.py [--verbose]
Exit code is 0 when nothing was found, 1 otherwise (usable as a gate).
"""
import re
import sys
import json
import pathlib
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
PHP_DIR = ROOT / "frontend"
APP_DIR = ROOT / "frontend-app" / "src"
FA = re.compile(r"[\u0600-\u06FF\u200C]")

# the PHP page that a React screen is a port of
SCREENS = {
    "Dashboard.jsx": "dashboard.php",
    "Products.jsx": "products.php",
    "NewOrder.jsx": "new-order.php",
    "Orders.jsx": "orders.php",
    "Payment.jsx": "payment.php",
    "Customers.jsx": "customers.php",
    "Collections.jsx": "collections.php",
    "VanLoading.jsx": "van-loading.php",
    "BaleBot.jsx": "bale-bot.php",
    "Settings.jsx": "settings.php",
    "Help.jsx": "help.php",
    "About.jsx": "about.php",
    "Terms.jsx": "terms.php",
    "Auth.jsx": "index.php",
    "Register.jsx": "register.php",
}

PHP_JS = sorted((PHP_DIR / "js").glob("*.js"))


def read(p: pathlib.Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except Exception:
        return ""


def strip_php(src: str) -> str:
    """remove php blocks, comments, style and script bodies: keep the markup"""
    src = re.sub(r"<\?php.*?\?>", " ", src, flags=re.S)
    src = re.sub(r"<\?=.*?\?>", " ", src, flags=re.S)
    src = re.sub(r"<style.*?</style>", " ", src, flags=re.S | re.I)
    src = re.sub(r"<script.*?</script>", " ", src, flags=re.S | re.I)
    src = re.sub(r"<!--.*?-->", " ", src, flags=re.S)
    return src


def php_strings(src: str):
    """visible Persian strings + placeholder/alt/option text of a PHP page"""
    out = set()
    markup = strip_php(src)
    for attr in ("placeholder", "alt", "title", "aria-label"):
        for v in re.findall(rf'{attr}\s*=\s*"([^"]*)"', markup):
            if FA.search(v):
                out.add(norm(v))
    text = re.sub(r"<[^>]+>", "\n", markup)
    for line in text.split("\n"):
        line = line.strip()
        if len(line) > 1 and FA.search(line):
            out.add(norm(line))
    for v in re.findall(r"<option[^>]*>\s*([^<]+?)\s*<", markup):
        if FA.search(v):
            out.add(norm(v))
    return out


def norm(s: str) -> str:
    s = s.replace("\u200c", " ").replace("\u200f", "")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def jsx_strings(src: str):
    """visible Persian strings of a React screen: JSX text, string props, string literals"""
    out = set()
    src_nocomment = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)
    src_nocomment = re.sub(r"^\s*//.*$", " ", src_nocomment, flags=re.M)
    for attr in ("placeholder", "alt", "title", "aria-label", "label"):
        for v in re.findall(rf'{attr}\s*=\s*"[^"]*"' , src_nocomment):
            inner = v.split('"')[1]
            if FA.search(inner):
                out.add(norm(inner))
    # JSX text nodes
    for m in re.finditer(r">([^<>{}\n][^<>{}\n]*[\u0600-\u06FF][^<>{}\n]*)<", src_nocomment):
        out.add(norm(m.group(1)))
    # string literals anywhere (covers arrays of labels and toast texts)
    for m in re.finditer(r"'([^'\n]*[\u0600-\u06FF][^'\n]*)'", src_nocomment):
        out.add(norm(m.group(1)))
    for m in re.finditer(r'"([^"\n]*[\u0600-\u06FF][^"\n]*)"', src_nocomment):
        out.add(norm(m.group(1)))
    for m in re.finditer(r"`([^`\n]*[\u0600-\u06FF][^`\n]*)`", src_nocomment):
        out.add(norm(m.group(1)))
    # {name} inside a template string is a hole, keep the literal part only
    return {re.sub(r"\$\{[^}]*\}", "", s).strip() for s in out if s.strip()}


def value_lists(src: str, is_php: bool):
    """the literal option lists: PHP <option value> / chips, React string arrays"""
    vals = defaultdict(set)
    if is_php:
        markup = strip_php(src)
        for name, block in re.findall(r'<select[^>]*id="([^"]+)"[^>]*>(.*?)</select>', markup, re.S):
            for v in re.findall(r'<option[^>]*value="([^"]+)"', block):
                vals[f"select#{name}"].add(v)
        for track, block in re.findall(r'<div[^>]*id="(brand|category)ChipsTrack"[^>]*>(.*?)</div>\s*</div>', markup, re.S):
            for v in re.findall(r'data-(?:brand|category)="([^"]+)"', block):
                vals[f"chips:{track}"].add(v)
        for name, block in re.findall(r"\$(defaultCategories|defaultBrands)\s*=\s*\[(.*?)\]", src, re.S):
            for v in re.findall(r"'([^']+)'", block):
                vals["php:$" + name].add(v)
    else:
        for name, block in re.findall(r"const\s+(\w*(?:CATEGOR|BRAND)\w*)\s*=\s*\[(.*?)\]", src, re.S):
            for v in re.findall(r"'([^']+)'", block):
                if FA.search(v):
                    vals[f"js:{name}"].add(v)
        for m in re.finditer(r"\[\s*'([\u0600-\u06FF][^]]*?)\]", src):
            chunk = m.group(1)
            got = re.findall(r"'([^']+)'", chunk)
            if len(got) >= 3:
                vals["js:inline array"].update(g for g in got if FA.search(g))
    return vals


def obj_keys(block: str):
    """property names of a JS object literal: explicit `k:` and shorthand `{ k, }`"""
    found = set(re.findall(r"[{,]\s*([A-Za-z_$][\w$]*)\s*:", block))
    found |= set(re.findall(r"[{,]\s*([A-Za-z_$][\w$]*)\s*[,}]", block))
    return {k for k in found if k not in ("JSON", "stringify", "true", "false", "null")}


def norm_ep(method: str, raw: str) -> str:
    path = raw.split("?")[0]
    path = re.sub(r"^[\w.:/\-]*?/api", "", path)          # drop origin and the /api prefix
    path = re.sub(r"\$\{[^}]*\}", ":id", path)            # php template hole
    path = re.sub(r":[A-Za-z_][\w]*", ":id", path)         # react param
    path = re.sub(r"/{2,}", "/", path).strip("/")
    return f"{method} /{path}"


def api_calls(text: str, kind: str):
    """endpoint + method pairs and the payload keys of every call"""
    calls = defaultdict(set)
    if kind == "php":
        pattern = re.compile(r"fetch\(\s*[`'\"]([^`'\"]*?/api/(?P<path>[^`'\"?]+))", re.S)
        for m in pattern.finditer(text):
            path = m.group("path").split("?")[0]
            tail = text[max(0, m.start() - 1500):m.end() + 900]
            meth = re.search(r"method:\s*['\"](\w+)['\"]", tail)
            method = meth.group(1).upper() if meth else "GET"
            keys = set()
            for blk in re.findall(r"(?:payload|body)\s*=\s*({[^{}]*(?:{[^{}]*}[^{}]*)*})", tail, re.S) + \
                      re.findall(r"JSON\.stringify\(\s*({[^{}]*(?:{[^{}]*}[^{}]*)*})", tail, re.S):
                keys |= obj_keys(blk)
            calls[norm_ep(method, path)].update(k for k in keys if k not in ("JSON", "stringify"))
    else:
        for m in re.finditer(r"api(?:Silent)?\(\s*[`'\"]([^`'\"]+)[`'\"]\s*(?:,\s*({.*?})\s*)?\)", text, re.S):
            raw_path, opts = m.group(1), (m.group(2) or "")
            path = re.sub(r"\$\{[^}]*\}", ":id", raw_path.split("?")[0])
            meth = re.search(r"method:\s*['\"](\w+)['\"]", opts)
            method = meth.group(1).upper() if meth else "GET"
            keys = set()
            for blk in re.findall(r"body:\s*({[^{}]*(?:{[^{}]*}[^{}]*)*})", opts, re.S):
                keys |= obj_keys(blk)
            for var in re.findall(r"body:\s*(\w+)", opts):
                for blk in re.findall(rf"{var}\s*=\s*({{[^{{}}]*(?:{{[^{{}}]*}}[^{{}}]*)*}})", text, re.S):
                    keys |= obj_keys(blk)
            calls[norm_ep(method, path)].update(k for k in keys if k not in ("JSON", "stringify"))
    return calls


def main():
    verbose = "--verbose" in sys.argv
    problems = 0

    def report(title, lines):
        nonlocal problems
        if not lines:
            return
        problems += len(lines)
        print(f"\n=== {title} ({len(lines)}) ===")
        for line in lines:
            print("  " + line)

    # ---- 1+2 per screen -------------------------------------------------
    app_all = set()
    for f in sorted((APP_DIR).rglob("*.jsx")) + sorted((APP_DIR / "lib").glob("*.js")):
        app_all |= jsx_strings(read(f))
    app_all |= {norm(x) for x in re.findall(r"'([^'\n]*[\u0600-\u06FF][^'\n]*)'", read(APP_DIR / "lib" / "terms.js"))} if (APP_DIR / "lib" / "terms.js").exists() else set()
    missing_text, moved_text, list_diffs = [], [], []
    for screen, php_page in SCREENS.items():
        sp = APP_DIR / "screens" / screen
        pp = PHP_DIR / php_page
        if not sp.exists() or not pp.exists():
            continue
        p_txt, j_txt = read(pp), read(sp)
        # also the page script of the php app, when one exists
        js = PHP_DIR / "js" / (pp.stem + ".js")
        p_api_src = p_txt + "\n" + (read(js) if js.exists() else "")
        php, react = php_strings(p_txt), jsx_strings(j_txt)
        # a PHP string the screen dropped or renamed
        for s in sorted(php):
            if len(s) < 4:
                continue
            if s in react or any(s in r or r in s for r in react if len(r) > 3):
                continue
            if not re.search(r"[A-Za-z]{4}", s) and FA.search(s):
                if any(s in r or r in s for r in app_all if len(r) > 3):
                    moved_text.append(f"{screen}: «{s}» lives in a shared component")
                else:
                    missing_text.append(f"{screen}: nowhere in the PWA: «{s}»")
        # literal option lists
        pv, jv = value_lists(p_txt, True), value_lists(j_txt, False)
        all_php = set().union(*pv.values()) if pv else set()
        all_js = set().union(*jv.values()) if jv else set()
        lost = {v for v in all_php if FA.search(v) and v not in all_js and len(v) > 2 and not any(v in r for r in app_all)}
        for v in sorted(lost):
            src = [k for k, vs in pv.items() if v in vs]
            list_diffs.append(f"{screen}: «{v}» is an option in PHP ({', '.join(src)}) but appears nowhere in the screen")
        # ---- 3 api calls ----
    # ---- 3 app-wide api surface ----------------------------------------
    php_src = "\n".join(read(p) for p in sorted(PHP_DIR.glob("*.php"))) + "\n" + \
              "\n".join(read(p) for p in PHP_JS)
    app_src = "\n".join(read(p) for p in sorted(APP_DIR.rglob("*.js*")))
    pa, ja = api_calls(php_src, "php"), api_calls(app_src, "react")
    only_php = sorted(set(pa) - set(ja))
    only_js = sorted(set(ja) - set(pa))
    key_diffs = []
    for ep in sorted(set(pa) & set(ja)):
        a, b = pa[ep], ja[ep]
        if a and b and a != b:
            left, right = sorted(a - b), sorted(b - a)
            if left or right:
                key_diffs.append(f"{ep}: php sends {left or '-'} | react sends {right or '-'}")

    report("PHP strings that exist nowhere in the PWA", missing_text[:40])
    if verbose:
        report("php text served by a shared component", moved_text[:40])
    report("option / filter values that exist only in PHP", list_diffs[:40])
    report("endpoints used by the PHP app but not by the PWA", [f"{e}" for e in only_php[:30]])
    report("endpoints used by the PWA but not by the PHP app", [f"{e}" for e in only_js[:30]])
    report("payload keys that differ", key_diffs[:40])

    # ---- 4 cdn -----------------------------------------------------------
    cdn = []
    for p in list(PHP_DIR.rglob("*.php")) + list(APP_DIR.rglob("*.js*")) + [APP_DIR.parent / "index.html"]:
        t = read(p)
        for m in re.findall(r"https?://(?:cdn|fonts|unpkg|cdnjs)[^\s\"')]+", t):
            if "self-hosted" not in t[max(0, t.find(m) - 200):t.find(m)]:
                cdn.append(f"{p.relative_to(ROOT)}: {m[:90]}")
    report("external cdn reference (must be self-hosted)", cdn)

    # ---- summary ---------------------------------------------------------
    print("\n== summary ==")
    print(f"  screens compared      : {sum(1 for s, p in SCREENS.items() if (APP_DIR / 'screens' / s).exists() and (PHP_DIR / p).exists())}")
    print(f"  php endpoints         : {len(pa)}   react endpoints: {len(ja)}")
    print(f"  findings              : {problems}")
    if verbose:
        print("\n-- endpoints of the php app --")
        for k in sorted(pa):
            print(f"   {k}   keys={sorted(pa[k]) if pa[k] else '-'}")
        print("-- endpoints of the PWA --")
        for k in sorted(ja):
            print(f"   {k}   keys={sorted(ja[k]) if ja[k] else '-'}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
