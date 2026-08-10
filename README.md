# Environmental Epidemiology Resource Menu

A searchable, filterable card-based browser for the resource list. Builds to a
single self-contained HTML file you can email to people — it works offline with
no internet connection and no external files.

---

## The live site

Hosted on GitHub Pages at:

**<https://macfaddenolivia-oss.github.io/ISEENACPolicyMenu/>**

The page loads `data/resources.csv` at runtime, so **updating the list is just a
push — no rebuild needed**:

```bash
# 1. edit data/resources.csv
git add data/resources.csv
git commit -m "Update resources"
git push
```

Pages redeploys in about a minute. If you don't see the change, hard-refresh
(<kbd>⇧</kbd>+reload) to get past the browser cache.

---

## Everyday use

**Edit the data:** `data/resources.csv`

### Sending it to people

`dist/resources-app.html` is one self-contained file — no internet, no other
files needed. One thing worth telling recipients:

> **On iPhone/iPad, tap _Share → Open in Safari_** rather than viewing the
> attachment directly.

Tapping an HTML attachment in Mail or Files opens Apple's Quick Look preview,
which displays the page but does **not** run JavaScript, so search and filtering
won't work there. If that happens, the file falls back to a plain readable list
of every resource with working links, so it's never a dead end.

**Rebuild the shareable file:**

```bash
python3 tools/build.py
```

That regenerates `dist/resources-app.html`. Send that one file to anyone.

**Preview locally** (run from this folder, then open the URL):

```bash
python3 -m http.server 8000
```

→ open <http://localhost:8000/>

This is the same `index.html` that GitHub Pages serves, and it reads
`data/resources.csv` live — edit the CSV, hit refresh, see the change. Stop the
server with `Ctrl+C`.

> Local preview needs the little web server above — opening `index.html` directly
> from Finder won't work, because browsers block local file reads. The **built**
> file in `dist/` has no such restriction; double-clicking it works.

---

## About the data

Your original **`ListofResources.xlsx` is never touched** by anything here. It is
read-only source data. All tooling reads it and writes elsewhere.

The working copy you should edit going forward is **`data/resources.csv`**.

### A note on the columns

The original spreadsheet has no `Subtype` column. Instead it has five columns —
*Type of Letter Writing / Advocacy / Database / Guide / Event* — of which only one
is ever filled in per row, depending on that row's `Type`. They aren't duplicates
of a subtype; collectively they **are** the subtype, just split across five columns.

So they've been merged into one `Subtype` column. `data/resources.csv` has seven
clean columns:

```
Resource, Creator, Type, Subtype, Description, STEM Yes/No, Link
```

Currently: **65 resources · 16 types · 19 subtypes** (40 rows have a subtype; the
other 25 have none, which is fine — those cards just show a Type tag).

The `STEM Yes/No` column is kept in the CSV but is no longer used anywhere in the
app — it isn't a filter and isn't shown on the cards. It's preserved so the
column is still there if you ever want it back.

### If you edit the spreadsheet in Excel instead

You can keep working in Excel and re-export whenever you like:

```bash
python3 tools/xlsx_to_csv.py     # ListofResources.xlsx -> data/resources.csv
python3 tools/build.py           # then rebuild
```

⚠️ This **overwrites `data/resources.csv`**. If you've been editing the CSV
directly, those edits are lost. Pick one place to be the source of truth — either
the CSV (simplest) or the spreadsheet — and stick with it.

---

## What the app does

**Search & filter**
- Search-as-you-type across Resource, Creator, and Description, with a live count
- Matching text is highlighted in the results
- Multi-word search narrows (all words must match)
- Clickable pill filters for Type and Subtype — multi-select, with live counts
  that update as you narrow (e.g. `Guide (14)`); pills that would return nothing
  fade out
- Everything combines; active filters show as breadcrumbs you can remove one at a
  time
- A **Clear filters** button next to the search bar drops the search and every
  active filter at once. It stays greyed out until something is actually
  filtering, so it never looks clickable when there's nothing to clear
- Press <kbd>/</kbd> anywhere to jump to the search box, <kbd>Esc</kbd> to clear

**Hover interactions**
- Hovering a card lifts it and expands the full description
- Hovering reveals the Creator, keeping the resting card clean
- Hovering any Type or Subtype tag — on a card *or* in the filter bar — dims
  everything except the other cards sharing that tag
- A copy-link button appears on hover, so you can grab a URL without leaving

**Other**
- Each Type gets its own colour (stripe + tag), assigned deterministically so
  colours stay stable across rebuilds
- "Random resource" jumps to and flashes a random card from the current results
- Designed empty state and a shimmer loading state
- Respects dark mode and reduced-motion settings

**On phones and tablets**

Nothing is hidden behind hover, because touch screens have none:

- The full description, the Creator, and the copy-link button are all shown
  outright on cards rather than waiting for a hover
- The 35 filter pills collapse behind a **Filters** button so they don't swallow
  the screen. A badge on it shows how many are active while collapsed, and
  breadcrumbs still show what's applied
- Tap targets are enlarged to roughly 40px, and the layout drops to one column
- The search box uses 16px type, which stops iOS Safari zooming in when you tap it
- The tag cross-highlighting effect is switched off on touch, since a tap would
  otherwise leave the grid dimmed with no way to un-hover it

---

## Folder structure

```
ISEENACPolicyMenu/
├── index.html                    ← the live site (GitHub Pages serves this)
├── ListofResources.xlsx          ← your original. never modified, never pushed.
├── .gitignore
├── .nojekyll                     tells Pages to serve files as-is
├── README.md
│
├── data/
│   └── resources.csv             ← the working copy. edit this, then push.
│
├── src/
│   ├── styles.css
│   └── app.js                    parsing, filtering, rendering
│
├── tools/
│   ├── build.py                  CSV -> dist/resources-app.html (offline copy)
│   └── xlsx_to_csv.py            xlsx -> data/resources.csv (re-export)
│
└── dist/
    └── resources-app.html        offline copy you can email. rebuild to refresh.
```

`src/app.js` powers both the live site and the offline build, so there's only ever
one copy of the logic. `build.py` inlines the CSS and JS and embeds the rows.

No dependencies — Python 3 standard library only, no `npm install`, no build system.
