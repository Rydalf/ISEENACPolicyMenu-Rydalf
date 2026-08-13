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

Currently: **65 resources · 16 types · 19 subtypes · 29 organizations** (40 rows
have a subtype; the other 25 have none, which is fine — those cards just show a
Type tag). "Organization" in the app is this Creator column, relabeled.

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

**Start Here**
- Collapsed by default on every page load, for every visitor. The intro's
  second line — "New to environmental health advocacy?..." — is a toggle
  button with a chevron that expands it; it's the only way in, and there's no
  persistence, so it starts collapsed again on the next visit too
- Once expanded: four curated shortcut cards for first-time visitors with
  no policy background: *New to advocacy? Start here*, *Want to contact a
  policymaker?*, *Looking for guides*, and *Explore organizations to get
  involved with*
- Each one pre-applies the relevant Type/Subtype filters — it's a shortcut into
  the same filter system the pills use, not a separate feature. A card lights
  up while its exact filter combination is active
- Clicking a card replaces any current search/filters with that pathway's, so
  the result is always a clean, guided set

**Search & filter**
- Search-as-you-type across Resource, Creator, and Description, with a live count
- Matching text is highlighted in the results
- Multi-word search narrows (all words must match)
- Clickable pill filters for Type, Subtype, and Organization (the
  Creator column, relabeled in the UI) — multi-select, with live counts
  that update as you narrow (e.g. `Guide (14)`); pills that would return nothing
  fade out
- By default you see a preview of the top pills in each of the three —
  sized to roughly fill a single row at a typical width (an estimate, not
  a measurement of actual layout, backstopped by a CSS clamp so it can't
  visibly wrap into a partial second row even if the estimate runs a
  little generous) — plus anything already active, even if it'd otherwise
  fall outside that top slice, rather than the full wall or nothing at
  all. Whenever a preview is hiding real values, a trailing **+N more**
  pill (styled like the others) sits at the end of that row — clicking it
  opens **Browse filters**, same as the button
- The **Match all / Match any** toggle is always visible (it's not part of
  the collapse below) since it governs how every active facet combines.
  Label and toggle share one compact line at every screen width; the
  explanation of what "all" vs "any" means lives behind a small (i) button
  next to it — hover, keyboard focus, or tap to reveal it, instead of a
  permanent line of text
- **Random resource** sits directly beside the search bar. Below that,
  tags on the left, a fixed action column on the right (**Browse
  filters** on top, **Clear filters** below). Type+Subtype sit in one
  bordered box and Organization in its own, so the three categories read
  as two visual groups rather than one continuous wall. **Browse
  filters** swaps each box's preview for its complete pill list and
  relabels itself **Hide filters**; clicking it again collapses back to
  the preview. A badge on the button shows how many filters are
  active. On narrow screens the tags stack above the buttons, and the
  buttons switch to a row instead of a column
- Everything combines; active filters show as breadcrumbs you can remove one at a
  time
- A **Clear filters** button drops the search and every active filter at
  once. It stays greyed out until something is actually filtering, so it
  never looks clickable when there's nothing to clear. While viewing a
  random pick, it instead just exits that view — same as **Back to all
  resources** — rather than also clearing filters the pick itself never
  touched
- Press <kbd>/</kbd> anywhere to jump to the search box, <kbd>Esc</kbd> to clear

**Hover interactions**
- Hovering a card lifts it and expands the full description
- Hovering any Type or Subtype tag — on a card *or* in the filter bar — dims
  everything except the other cards sharing that tag
- A copy-link button appears on hover, so you can grab a URL without leaving

The Organization (Creator) is always shown at the bottom of each card, not
just on hover.

**Other**
- Each Type gets its own colour (stripe + tag), assigned deterministically so
  colours stay stable across rebuilds
- "Random resource" narrows the grid to a single card drawn from the
  *current* filtered results (not always all 65). While a pick is showing,
  **Another random resource** re-rolls a new one from the same pool, and
  **Back to all resources** returns to the normal grid. Changing any
  search/filter exits the single-pick view automatically
- Designed empty state and a shimmer loading state
- Respects dark mode and reduced-motion settings
- The card grid uses a fluid column count (CSS Grid `auto-fit`/`minmax`)
  rather than fixed breakpoints — 1 column on phones, 2 on tablets, 3+ on
  laptops, and more on wide monitors, scaling continuously in between. The
  page container caps out at 1600px so text and cards stay readable instead
  of stretching edge-to-edge on ultra-wide displays

**On phones and tablets**

Nothing is hidden behind hover, because touch screens have none:

- The full description, the Creator, and the copy-link button are all shown
  outright on cards rather than waiting for a hover
- **Browse filters** shows the complete Type/Subtype/Organization pill
  lists in one tap — no further nested disclosure to dig through, so every
  value in the data stays reachable in a single click
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
