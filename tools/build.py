#!/usr/bin/env python3
"""
Build a single self-contained HTML file from the working CSV.

Reads:   data/resources.csv, index.html, src/styles.css, src/app.js
Writes:  dist/resources-app.html

The output embeds the data as JavaScript and inlines all CSS/JS, so it has no
external files, makes no network requests, and works offline from a double-click.

Standard library only.

Usage:
    python3 tools/build.py
"""

import csv
import datetime
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CSV_IN = os.path.join(ROOT, "data", "resources.csv")
HTML_IN = os.path.join(ROOT, "index.html")
CSS_IN = os.path.join(ROOT, "src", "styles.css")
JS_IN = os.path.join(ROOT, "src", "app.js")
OUT = os.path.join(ROOT, "dist", "resources-app.html")

FIELDS = {
    "resource": "Resource",
    "creator": "Creator",
    "type": "Type",
    "subtype": "Subtype",
    "description": "Description",
    "stem": "STEM Yes/No",
    "link": "Link",
}


def read_text(path):
    if not os.path.exists(path):
        raise SystemExit("Missing required file: %s" % path)
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def load_records(path):
    """Parse the CSV into records, tolerating blank cells and ragged rows."""
    if not os.path.exists(path):
        raise SystemExit(
            "Missing %s\nGenerate it first with:  python3 tools/xlsx_to_csv.py" % path
        )

    with open(path, "r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.reader(fh)
        rows = [r for r in reader if any(str(c).strip() for c in r)]

    if not rows:
        raise SystemExit("No rows found in %s" % path)

    header = [str(h).strip() for h in rows[0]]
    pos = {}
    for i, name in enumerate(header):
        pos.setdefault(name, i)

    missing = [c for c in ("Resource", "Type", "Link") if c not in pos]
    if missing:
        raise SystemExit(
            "%s is missing expected column(s): %s\nFound: %s"
            % (path, ", ".join(missing), ", ".join(header))
        )

    records = []
    skipped = 0
    for row in rows[1:]:
        rec = {}
        for key, col in FIELDS.items():
            i = pos.get(col)
            rec[key] = str(row[i]).strip() if (i is not None and i < len(row)) else ""
        if not rec["resource"] and not rec["link"]:
            skipped += 1
            continue
        if not rec["resource"]:
            rec["resource"] = "(untitled resource)"
        records.append(rec)

    return records, skipped


def esc(s):
    return (
        str(s or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def safe_url(u):
    """Mirror the app's URL whitelist so the static list can't inject anything."""
    s = str(u or "").strip()
    low = s.lower()
    if low.startswith("http://") or low.startswith("https://") or low.startswith("mailto:"):
        return s
    if low.startswith("www."):
        return "https://" + s
    return ""


def noscript_list(records):
    """A plain, readable list shown when JavaScript never runs.

    Some viewers (notably iOS Quick Look, used when an .html file is tapped in
    Mail or Files) render HTML without executing scripts. Without this the page
    would sit on its "Loading…" placeholder forever.
    """
    items = []
    for r in records:
        url = safe_url(r["link"])
        title = esc(r["resource"])
        title_html = (
            '<a href="%s" target="_blank" rel="noopener noreferrer">%s</a>' % (esc(url), title)
            if url
            else "<strong>%s</strong>" % title
        )
        kind = " · ".join(
            esc(v) for v in (r["type"], r["subtype"], r["creator"]) if v
        )
        items.append(
            '<li class="nojs-item">%s<span class="nojs-kind">%s</span><p>%s</p></li>'
            % (title_html, kind, esc(r["description"]))
        )
    return '<ol class="nojs-list">\n' + "\n".join(items) + "\n</ol>"


def js_string_safe(text):
    """Keep inlined script/style text from prematurely closing its tag."""
    return re.sub(r"</(script|style)", r"<\\/\1", text, flags=re.IGNORECASE)


def json_for_html(data):
    """JSON that is safe to sit inside a <script> element."""
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    # Neutralise anything that could close the tag or break the JS parser.
    for bad, good in (
        ("<", "\\u003c"),
        (">", "\\u003e"),
        ("&", "\\u0026"),
        (" ", "\\u2028"),
        (" ", "\\u2029"),
    ):
        raw = raw.replace(bad, good)
    return raw




def main():
    records, skipped = load_records(CSV_IN)
    html = read_text(HTML_IN)
    css = read_text(CSS_IN)
    js = read_text(JS_IN)

    # Drop the dev-only preview banner.
    html = re.sub(
        r"[ \t]*<!--DEV-ONLY-START-->.*?<!--DEV-ONLY-END-->[ \t]*\n?",
        "",
        html,
        flags=re.DOTALL,
    )

    # Fill in the no-JavaScript fallback list.
    if "<!--NOSCRIPT-LIST-->" not in html:
        raise SystemExit("Could not find the <!--NOSCRIPT-LIST--> placeholder in index.html")
    html = html.replace("<!--NOSCRIPT-LIST-->", noscript_list(records))

    # Inline the stylesheet.
    if '<link rel="stylesheet" href="src/styles.css">' not in html:
        raise SystemExit("Could not find the stylesheet <link> tag in index.html")
    html = html.replace(
        '<link rel="stylesheet" href="src/styles.css">',
        "<style>\n" + js_string_safe(css) + "\n</style>",
    )

    # Embed the data, then inline the app script.
    if '<script src="src/app.js"></script>' not in html:
        raise SystemExit("Could not find the app <script> tag in index.html")

    built = datetime.datetime.now().strftime("%Y-%m-%d")
    payload = (
        "<script>window.__RESOURCES__="
        + json_for_html(records)
        + ";window.__BUILT__="
        + json.dumps(built)
        + ";</script>\n"
        + "<script>\n"
        + js_string_safe(js)
        + "\n</script>\n"
        + '<script>document.addEventListener("DOMContentLoaded",function(){'
        + 'var s=document.getElementById("stamp");'
        + 'if(s)s.textContent="'
        + str(len(records))
        + ' resources · built "+window.__BUILT__;});</script>'
    )
    html = html.replace('<script src="src/app.js"></script>', payload)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(html)

    size_kb = os.path.getsize(OUT) / 1024.0
    types = sorted({r["type"] for r in records if r["type"]})
    subs = sorted({r["subtype"] for r in records if r["subtype"]})

    print("Built  %s" % os.path.relpath(OUT, ROOT))
    print("       %d resources · %d types · %d subtypes · %.0f KB"
          % (len(records), len(types), len(subs), size_kb))
    if skipped:
        print("       skipped %d row(s) with no resource name and no link" % skipped)
    print("       self-contained — no external files, works offline")


if __name__ == "__main__":
    sys.exit(main())
