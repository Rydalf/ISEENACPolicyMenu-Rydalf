#!/usr/bin/env python3
"""
One-way export: ListofResources.xlsx  ->  data/resources.csv

Reads the ORIGINAL spreadsheet strictly read-only and writes a clean 7-column
working copy. The original .xlsx is never modified.

The source sheet has no "Subtype" column. Instead it has five mutually
exclusive columns -- Type of Letter Writing / Advocacy / Database / Guide /
Event -- only one of which is ever populated per row, keyed by that row's Type.
Those five are coalesced into a single "Subtype" column here.

Uses only the Python standard library (an .xlsx is a zip of XML).

Usage:
    python3 tools/xlsx_to_csv.py                  # default paths
    python3 tools/xlsx_to_csv.py in.xlsx out.csv
"""

import csv
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

# The five split subtype columns, in priority order, coalesced into "Subtype".
SUBTYPE_COLUMNS = [
    "Type of Letter Writing",
    "Type of Advocacy",
    "Type of Database",
    "Type of Guide",
    "Type of Event",
]

OUTPUT_COLUMNS = [
    "Resource",
    "Creator",
    "Type",
    "Subtype",
    "Description",
    "STEM Yes/No",
    "Link",
]


def col_index(cell_ref):
    """'BC12' -> zero-based column index."""
    letters = re.match(r"([A-Z]+)", cell_ref).group(1)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def read_shared_strings(zf):
    try:
        raw = zf.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(raw)
    return [
        "".join(t.text or "" for t in si.iter(NS + "t"))
        for si in root.findall(NS + "si")
    ]


def first_sheet_path(zf):
    names = [n for n in zf.namelist() if n.startswith("xl/worksheets/sheet")]
    if not names:
        raise SystemExit("No worksheet found inside the .xlsx")
    return sorted(names)[0]


def read_rows(path):
    """Yield rows as lists of strings, preserving column positions."""
    with zipfile.ZipFile(path) as zf:
        shared = read_shared_strings(zf)
        sheet = ET.fromstring(zf.read(first_sheet_path(zf)))

    rows = []
    for row in sheet.iter(NS + "row"):
        cells = {}
        for c in row.findall(NS + "c"):
            ctype = c.get("t")
            if ctype == "inlineStr":
                is_el = c.find(NS + "is")
                value = (
                    "".join(t.text or "" for t in is_el.iter(NS + "t"))
                    if is_el is not None
                    else ""
                )
            else:
                v = c.find(NS + "v")
                value = v.text if (v is not None and v.text) else ""
                if ctype == "s" and value:
                    idx = int(value)
                    value = shared[idx] if 0 <= idx < len(shared) else ""
            value = (value or "").replace(" ", " ").strip()
            if value:
                cells[col_index(c.get("r"))] = value
        if cells:
            width = max(cells) + 1
            rows.append([cells.get(i, "") for i in range(width)])
    return rows


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "ListofResources.xlsx"
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join("data", "resources.csv")

    if not os.path.exists(src):
        raise SystemExit("Source spreadsheet not found: %s" % src)

    rows = read_rows(src)
    if not rows:
        raise SystemExit("Spreadsheet appears to be empty: %s" % src)

    header = rows[0]
    pos = {name: i for i, name in enumerate(header)}

    missing = [c for c in ("Resource", "Type", "Link") if c not in pos]
    if missing:
        raise SystemExit("Source is missing expected column(s): %s" % ", ".join(missing))

    def cell(row, name):
        i = pos.get(name)
        return row[i].strip() if (i is not None and i < len(row)) else ""

    out_rows = []
    subtype_found = 0
    for row in rows[1:]:
        # Coalesce the five split subtype columns into one value.
        subtype = ""
        for name in SUBTYPE_COLUMNS:
            v = cell(row, name)
            if v:
                subtype = v
                break
        if subtype:
            subtype_found += 1

        record = [
            cell(row, "Resource"),
            cell(row, "Creator"),
            cell(row, "Type"),
            subtype,
            cell(row, "Description"),
            cell(row, "STEM Yes/No"),
            cell(row, "Link"),
        ]
        # Skip rows with no resource name and no link -- nothing to show.
        if not record[0] and not record[6]:
            continue
        out_rows.append(record)

    out_dir = os.path.dirname(dst)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    with open(dst, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(OUTPUT_COLUMNS)
        writer.writerows(out_rows)

    print("Read   %s (read-only, unmodified)" % src)
    print("Wrote  %s" % dst)
    print("       %d resources, %d with a subtype" % (len(out_rows), subtype_found))


if __name__ == "__main__":
    main()
