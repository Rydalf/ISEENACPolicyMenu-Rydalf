/* Resource Menu — shared app logic.
 *
 * Runs in two modes with no changes:
 *   hosted     -> fetches data/resources.csv at runtime (GitHub Pages, local server)
 *   standalone -> reads window.__RESOURCES__ injected by tools/build.py
 */
(function () {
  "use strict";

  // Relative to index.html at the site root, so it works both locally and
  // under a GitHub Pages project subpath (…github.io/<repo>/).
  var CSV_PATH = "data/resources.csv";

  /* ---------------- CSV parsing ---------------- */

  // Full RFC-4180-ish parser: quoted fields, embedded commas/newlines,
  // "" escapes, CRLF or LF, ragged rows, stray blank lines.
  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    var i = 0;

    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM

    function endField() {
      row.push(field);
      field = "";
    }
    function endRow() {
      endField();
      rows.push(row);
      row = [];
    }

    while (i < text.length) {
      var ch = text[i];

      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += ch;
        i++;
        continue;
      }

      if (ch === '"') {
        // Only treat as an opening quote at the start of a field; a stray
        // quote mid-field is kept literally rather than throwing.
        if (field === "") {
          inQuotes = true;
          i++;
          continue;
        }
        field += ch;
        i++;
        continue;
      }
      if (ch === ",") {
        endField();
        i++;
        continue;
      }
      if (ch === "\r") {
        if (text[i + 1] === "\n") i++;
        endRow();
        i++;
        continue;
      }
      if (ch === "\n") {
        endRow();
        i++;
        continue;
      }
      field += ch;
      i++;
    }
    if (field !== "" || row.length) endRow();

    // Drop rows that are entirely empty.
    return rows.filter(function (r) {
      return r.some(function (c) {
        return String(c).trim() !== "";
      });
    });
  }

  function rowsToRecords(rows) {
    if (!rows.length) return [];
    var header = rows[0].map(function (h) {
      return String(h).trim();
    });
    var idx = {};
    header.forEach(function (h, i) {
      if (!(h in idx)) idx[h] = i;
    });

    function pick(row, name) {
      var i = idx[name];
      if (i === undefined || i >= row.length) return "";
      return String(row[i] == null ? "" : row[i]).trim();
    }

    var out = [];
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var rec = {
        resource: pick(row, "Resource"),
        creator: pick(row, "Creator"),
        type: pick(row, "Type"),
        subtype: pick(row, "Subtype"),
        description: pick(row, "Description"),
        stem: pick(row, "STEM Yes/No"),
        link: pick(row, "Link"),
      };
      if (!rec.resource && !rec.link) continue; // nothing renderable
      if (!rec.resource) rec.resource = "(untitled resource)";
      out.push(rec);
    }
    return out;
  }

  /* ---------------- helpers ---------------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function reEsc(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function norm(s) {
    return String(s || "").toLowerCase();
  }

  // Escape text, wrapping every occurrence of any search term in <mark>.
  function highlight(text, terms) {
    var t = String(text == null ? "" : text);
    if (!terms.length) return esc(t);
    var rx = new RegExp("(" + terms.map(reEsc).join("|") + ")", "gi");
    var out = "";
    var last = 0;
    var m;
    while ((m = rx.exec(t)) !== null) {
      if (m[0].length === 0) {
        rx.lastIndex++;
        continue;
      }
      if (m.index > last) out += esc(t.slice(last, m.index));
      out += "<mark>" + esc(m[0]) + "</mark>";
      last = m.index + m[0].length;
    }
    return out + esc(t.slice(last));
  }

  function safeUrl(u) {
    var s = String(u || "").trim();
    if (!s) return "";
    // Allow only http(s)/mailto; anything else (javascript:, data:) is dropped.
    if (/^https?:\/\//i.test(s) || /^mailto:/i.test(s)) return s;
    if (/^www\./i.test(s)) return "https://" + s;
    return "";
  }

  // Deterministic, well-spaced hues so each Type keeps its colour across rebuilds.
  var HUES = [210, 145, 28, 340, 265, 190, 95, 12, 300, 45, 170, 240, 320, 70, 355, 225];

  /* ---------------- state ---------------- */

  var ALL = [];
  var typeHue = {};
  var state = {
    q: "",
    terms: [],
    types: [], // selected Type values (OR within group)
    subs: [],  // selected Subtype values (OR within group)
  };

  var el = {};
  var toastTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  /* ---------------- filtering ---------------- */

  function matchesSearch(r) {
    if (!state.terms.length) return true;
    var hay = norm(r.resource + "\n" + r.creator + "\n" + r.description);
    return state.terms.every(function (t) {
      return hay.indexOf(t) !== -1;
    });
  }

  // `skip` lets us compute facet counts that ignore their own dimension.
  function passes(r, skip) {
    if (skip !== "search" && !matchesSearch(r)) return false;
    if (skip !== "type" && state.types.length && state.types.indexOf(r.type) === -1) return false;
    if (skip !== "sub" && state.subs.length && state.subs.indexOf(r.subtype) === -1) return false;
    return true;
  }

  function hasActiveFilters() {
    return !!(state.q.trim() || state.types.length || state.subs.length);
  }

  function clearAll() {
    state.types.length = 0;
    state.subs.length = 0;
    setSearch("");
    el.search.value = "";
  }

  function currentResults() {
    return ALL.filter(function (r) {
      return passes(r, null);
    });
  }

  function countBy(field, skip) {
    var counts = Object.create(null);
    ALL.forEach(function (r) {
      if (!passes(r, skip)) return;
      var v = r[field];
      if (!v) return;
      counts[v] = (counts[v] || 0) + 1;
    });
    return counts;
  }

  /* ---------------- rendering ---------------- */

  var ICON = {
    search:
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    person:
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    copy:
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check:
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    empty:
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M8.5 11h5"/></svg>',
    dice:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.3" fill="currentColor"/></svg>',
  };

  function pillHTML(value, count, active, kind) {
    var hue = kind === "type" ? typeHue[value] : null;
    return (
      '<button class="pill' + (count === 0 ? " is-empty" : "") + '"' +
      ' type="button"' +
      ' aria-pressed="' + (active ? "true" : "false") + '"' +
      ' data-filter="' + kind + '"' +
      ' data-value="' + esc(value) + '"' +
      ' data-tagkey="' + kind + ":" + esc(value) + '"' +
      (hue != null ? ' style="--type-h:' + hue + '"' : "") +
      ">" +
      (kind === "type" ? '<span class="dot"></span>' : "") +
      "<span>" + esc(value) + "</span>" +
      '<span class="n">' + count + "</span>" +
      "</button>"
    );
  }

  function renderFilters() {
    var typeCounts = countBy("type", "type");
    var subCounts = countBy("subtype", "sub");

    var types = Object.keys(typeHue).sort(function (a, b) {
      return (typeCounts[b] || 0) - (typeCounts[a] || 0) || a.localeCompare(b);
    });
    el.typePills.innerHTML = types
      .map(function (t) {
        return pillHTML(t, typeCounts[t] || 0, state.types.indexOf(t) !== -1, "type");
      })
      .join("");

    var allSubs = {};
    ALL.forEach(function (r) {
      if (r.subtype) allSubs[r.subtype] = true;
    });
    var subs = Object.keys(allSubs).sort(function (a, b) {
      return (subCounts[b] || 0) - (subCounts[a] || 0) || a.localeCompare(b);
    });
    el.subPills.innerHTML = subs
      .map(function (s) {
        return pillHTML(s, subCounts[s] || 0, state.subs.indexOf(s) !== -1, "sub");
      })
      .join("");
  }

  function renderCrumbs() {
    var parts = [];
    if (state.q.trim()) {
      parts.push(crumb("search", "Search", state.q.trim()));
    }
    state.types.forEach(function (v) {
      parts.push(crumb("type", "Type", v));
    });
    state.subs.forEach(function (v) {
      parts.push(crumb("sub", "Subtype", v));
    });
    el.crumbs.innerHTML = parts.join("");
  }

  function crumb(kind, label, value) {
    return (
      '<button class="crumb" type="button" data-crumb="' + kind + '"' +
      ' data-value="' + esc(value) + '"' +
      ' aria-label="Remove filter ' + esc(label) + ": " + esc(value) + '">' +
      '<span class="k">' + esc(label) + ":</span> " +
      "<span>" + esc(value) + "</span>" +
      '<span class="x" aria-hidden="true">×</span>' +
      "</button>"
    );
  }

  function cardHTML(r, i) {
    var terms = state.terms;
    var hue = typeHue[r.type] != null ? typeHue[r.type] : 220;
    var url = safeUrl(r.link);
    var delay = Math.min(i, 18) * 22;

    var tags = "";
    if (r.type) {
      tags +=
        '<button class="tag type" type="button" data-filter="type"' +
        ' data-value="' + esc(r.type) + '" data-tagkey="type:' + esc(r.type) + '"' +
        ' aria-pressed="' + (state.types.indexOf(r.type) !== -1 ? "true" : "false") + '"' +
        ' title="Filter by ' + esc(r.type) + '">' + esc(r.type) + "</button>";
    }
    if (r.subtype) {
      tags +=
        '<button class="tag sub" type="button" data-filter="sub"' +
        ' data-value="' + esc(r.subtype) + '" data-tagkey="sub:' + esc(r.subtype) + '"' +
        ' aria-pressed="' + (state.subs.indexOf(r.subtype) !== -1 ? "true" : "false") + '"' +
        ' title="Filter by ' + esc(r.subtype) + '">' + esc(r.subtype) + "</button>";
    }

    var meta = "";
    if (r.creator) {
      meta +=
        '<span class="meta-item">' + ICON.person +
        '<span class="v">' + highlight(r.creator, terms) + "</span></span>";
    }

    var title = url
      ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' +
        highlight(r.resource, terms) + "</a>"
      : highlight(r.resource, terms);

    return (
      '<article class="card" style="--type-h:' + hue + ";--d:" + delay + 'ms"' +
      ' data-type="' + esc(r.type) + '" data-sub="' + esc(r.subtype) + '"' +
      (url ? ' data-url="' + esc(url) + '" tabindex="0"' : "") +
      ">" +
      '<div class="card-head"><h3>' + title + "</h3>" +
      (url
        ? '<button class="copy" type="button" data-copy="' + esc(url) +
          '" title="Copy link" aria-label="Copy link to ' + esc(r.resource) + '">' +
          ICON.copy + "</button>"
        : "") +
      "</div>" +
      (tags ? '<div class="tagrow">' + tags + "</div>" : "") +
      '<p class="desc">' + highlight(r.description || "No description provided.", terms) + "</p>" +
      (meta ? '<div class="meta"><div><div class="meta-inner">' + meta + "</div></div></div>" : "") +
      "</article>"
    );
  }

  function render() {
    renderFilters();
    renderCrumbs();

    var results = currentResults();

    el.count.innerHTML =
      "<strong>" + results.length + "</strong> of " + ALL.length + " resources";
    el.random.disabled = results.length === 0;
    el.clearFilters.disabled = !hasActiveFilters();

    // Show how many pill filters are active, since they're collapsed on mobile
    var activePills = state.types.length + state.subs.length;
    el.filterBadge.textContent = activePills ? String(activePills) : "";

    if (!results.length) {
      el.grid.className = "";
      el.grid.innerHTML =
        '<div class="state">' +
        '<div class="icon">' + ICON.empty + "</div>" +
        "<h2>No resources match</h2>" +
        "<p>Try removing a filter or searching for something broader" +
        (state.q.trim() ? " than “" + esc(state.q.trim()) + "”" : "") +
        ".</p>" +
        '<button class="btn" type="button" data-crumb="all">Clear all filters</button>' +
        "</div>";
      return;
    }

    el.grid.className = "grid";
    el.grid.setAttribute("aria-busy", "false");
    el.grid.innerHTML = results
      .map(function (r, i) {
        return cardHTML(r, i);
      })
      .join("");
  }

  /* ---------------- interactions ---------------- */

  function toggleIn(list, value) {
    var i = list.indexOf(value);
    if (i === -1) list.push(value);
    else list.splice(i, 1);
  }

  function setSearch(v) {
    state.q = v;
    state.terms = norm(v).split(/\s+/).filter(Boolean);
    el.searchbox.classList.toggle("has-value", v.length > 0);
  }

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.classList.remove("show");
    }, 1900);
  }

  function copyText(text, btn) {
    function ok() {
      if (btn) {
        btn.classList.add("copied");
        btn.innerHTML = ICON.check;
        setTimeout(function () {
          btn.classList.remove("copied");
          btn.innerHTML = ICON.copy;
        }, 1400);
      }
      toast("Link copied");
    }
    // Clipboard API needs a secure context; fall back for file:// use.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () {
        legacyCopy(text) ? ok() : toast("Couldn't copy — press ⌘C");
      });
      return;
    }
    legacyCopy(text) ? ok() : toast("Couldn't copy — press ⌘C");
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      var okc = document.execCommand("copy");
      document.body.removeChild(ta);
      return okc;
    } catch (e) {
      return false;
    }
  }

  function applyFilterClick(kind, value) {
    if (kind === "type") toggleIn(state.types, value);
    else if (kind === "sub") toggleIn(state.subs, value);
    render();
  }

  function clearTagHighlight() {
    el.grid.classList.remove("dimming");
    var marked = el.grid.querySelectorAll(".card.tag-match");
    for (var i = 0; i < marked.length; i++) marked[i].classList.remove("tag-match");
  }

  function applyTagHighlight(tagkey) {
    var sep = tagkey.indexOf(":");
    var kind = tagkey.slice(0, sep);
    var value = tagkey.slice(sep + 1);
    var attr = kind === "type" ? "data-type" : "data-sub";
    var cards = el.grid.querySelectorAll(".card");
    var any = false;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute(attr) === value) {
        cards[i].classList.add("tag-match");
        any = true;
      }
    }
    if (any) el.grid.classList.add("dimming");
  }

  function wire() {
    // Search
    el.search.addEventListener("input", function () {
      setSearch(el.search.value);
      render();
    });
    el.clearSearch.addEventListener("click", function () {
      setSearch("");
      el.search.value = "";
      el.search.focus();
      render();
    });

    // "/" focuses search; Escape clears it
    document.addEventListener("keydown", function (e) {
      var tag = (e.target.tagName || "").toLowerCase();
      var typing = tag === "input" || tag === "textarea" || e.target.isContentEditable;
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        el.search.focus();
        el.search.select();
      } else if (e.key === "Escape" && e.target === el.search) {
        if (el.search.value) {
          setSearch("");
          el.search.value = "";
          render();
        } else {
          el.search.blur();
        }
      }
    });

    // Clear-filters button (next to the search bar)
    el.clearFilters.addEventListener("click", function () {
      clearAll();
      render();
      el.search.focus();
    });

    // Filter pills (delegated on the whole controls area)
    el.controls.addEventListener("click", function (e) {
      var p = e.target.closest(".pill");
      if (!p) return;
      applyFilterClick(p.getAttribute("data-filter"), p.getAttribute("data-value"));
    });

    // Breadcrumbs (and the empty-state "clear all" button)
    document.addEventListener("click", function (e) {
      var c = e.target.closest("[data-crumb]");
      if (!c) return;
      var kind = c.getAttribute("data-crumb");
      var value = c.getAttribute("data-value");
      if (kind === "all") {
        clearAll();
      } else if (kind === "search") {
        setSearch("");
        el.search.value = "";
      } else if (kind === "type") {
        toggleIn(state.types, value);
      } else if (kind === "sub") {
        toggleIn(state.subs, value);
      }
      render();
    });

    // Card interactions
    el.grid.addEventListener("click", function (e) {
      var copyBtn = e.target.closest(".copy");
      if (copyBtn) {
        e.preventDefault();
        e.stopPropagation();
        copyText(copyBtn.getAttribute("data-copy"), copyBtn);
        return;
      }
      var tag = e.target.closest(".tag");
      if (tag) {
        e.preventDefault();
        e.stopPropagation();
        clearTagHighlight();
        applyFilterClick(tag.getAttribute("data-filter"), tag.getAttribute("data-value"));
        return;
      }
      if (e.target.closest("a")) return; // let the title link work normally
      var card = e.target.closest(".card[data-url]");
      if (card) window.open(card.getAttribute("data-url"), "_blank", "noopener");
    });

    el.grid.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var card = e.target.closest(".card[data-url]");
      if (card && e.target === card) window.open(card.getAttribute("data-url"), "_blank", "noopener");
    });

    // Hovering any Type/Subtype tag highlights every card sharing it.
    // Skipped on touch devices: tapping there synthesises a mouseover and would
    // leave the grid dimmed with no way to un-hover.
    var canHover =
      !window.matchMedia || window.matchMedia("(hover: hover)").matches;

    if (canHover) {
      document.addEventListener("mouseover", function (e) {
        var t = e.target.closest("[data-tagkey]");
        if (!t) return;
        clearTagHighlight();
        applyTagHighlight(t.getAttribute("data-tagkey"));
      });
      document.addEventListener("mouseout", function (e) {
        var t = e.target.closest("[data-tagkey]");
        if (!t) return;
        var to = e.relatedTarget;
        if (to && to.closest && to.closest("[data-tagkey]") === t) return;
        clearTagHighlight();
      });
    }

    // Filters disclosure (visible on narrow screens only)
    el.filterToggle.addEventListener("click", function () {
      var open = !el.controls.classList.contains("filters-open");
      el.controls.classList.toggle("filters-open", open);
      el.filterToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    // Random resource
    el.random.addEventListener("click", function () {
      var results = currentResults();
      if (!results.length) return;
      var n = Math.floor(Math.random() * results.length);
      var card = el.grid.children[n];
      if (!card) return;
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      var cards = el.grid.querySelectorAll(".card.flash");
      for (var i = 0; i < cards.length; i++) cards[i].classList.remove("flash");
      void card.offsetWidth; // restart the animation
      card.classList.add("flash");
      toast("Random pick: " + results[n].resource);
    });

    // Sticky-header shadow
    var sentinel = el.controls.offsetTop;
    window.addEventListener(
      "scroll",
      function () {
        el.controls.classList.toggle("is-stuck", window.scrollY > sentinel);
      },
      { passive: true }
    );
  }

  /* ---------------- boot ---------------- */

  // Deliberately reaches for the DOM directly rather than the cached `el`, so it
  // still works if boot() failed before those lookups happened.
  function showError(msg, detail) {
    var grid = document.getElementById("grid");
    var count = document.getElementById("count");
    if (count) count.textContent = "";
    if (!grid) return;
    grid.className = "";
    grid.setAttribute("aria-busy", "false");
    grid.innerHTML =
      '<div class="error-box"><strong>' + esc(msg) + "</strong>" +
      (detail ? "<p>" + detail + "</p>" : "") +
      "</div>";
  }

  function errText(e) {
    return esc((e && (e.message || e.name)) || String(e));
  }

  // Last resort: never leave the user staring at "Loading…" with no explanation.
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("error", function (ev) {
      var count = document.getElementById("count");
      if (count && count.textContent.indexOf("Loading") !== -1) {
        showError("The app hit an error while starting.", esc(ev.message || "Unknown error"));
      }
    });
  }

  function start(records) {
    ALL = records;

    Object.keys(
      ALL.reduce(function (acc, r) {
        if (r.type) acc[r.type] = 1;
        return acc;
      }, {})
    )
      .sort()
      .forEach(function (t, i) {
        // Offset each wrap so new Types stay visually distinct past 16.
        var shift = 13 * Math.floor(i / HUES.length);
        typeHue[t] = (HUES[i % HUES.length] + shift) % 360;
      });

    if (!ALL.length) {
      showError("No resources found in the data file.", "Check that the CSV has rows below its header.");
      return;
    }

    wire();
    render();
  }

  function boot() {
    el = {
      controls: $("controls"),
      search: $("search"),
      searchbox: $("searchbox"),
      clearSearch: $("clear-search"),
      typePills: $("type-pills"),
      subPills: $("sub-pills"),
      clearFilters: $("clear-filters"),
      filterToggle: $("filter-toggle"),
      filterBadge: $("filter-badge"),
      crumbs: $("crumbs"),
      count: $("count"),
      grid: $("grid"),
      random: $("random"),
      toast: $("toast"),
    };

    var missing = [];
    for (var k in el) {
      if (Object.prototype.hasOwnProperty.call(el, k) && !el[k]) missing.push(k);
    }
    if (missing.length) {
      showError(
        "This page is missing elements the app needs.",
        "Missing: <code>" + esc(missing.join(", ")) + "</code>"
      );
      return;
    }

    try {
      $("search-icon").innerHTML = ICON.search;
      el.random.insertAdjacentHTML("afterbegin", ICON.dice);
    } catch (e) {
      /* icons are decorative — never block startup on them */
    }

    // Standalone build: the data is already here, so render synchronously.
    // No promises, no network, nothing that can leave the page hanging.
    var embedded = typeof window !== "undefined" && window.__RESOURCES__;
    if (embedded && embedded.length) {
      try {
        start(embedded);
      } catch (e) {
        showError("Couldn't display the resources.", errText(e));
      }
      return;
    }

    // Dev preview only: read the CSV over HTTP.
    var devHint = function (err) {
      var viaFile =
        typeof location !== "undefined" && location.protocol === "file:";
      return (
        "Reading <code>" + esc(CSV_PATH) + "</code> failed (" + errText(err) + "). " +
        (viaFile
          ? "Browsers block local file reads, so this page needs to be served over " +
            "HTTP — run <code>python3 -m http.server 8000</code> from the project " +
            "folder and open <code>http://localhost:8000/</code>. For an offline " +
            "copy you can email, use <code>dist/resources-app.html</code> instead."
          : "Check that <code>data/resources.csv</code> exists alongside this page " +
            "and try reloading.")
      );
    };

    try {
      if (typeof fetch !== "function") throw new Error("fetch unavailable");
      fetch(CSV_PATH, { cache: "no-store" })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.text();
        })
        .then(function (text) {
          start(rowsToRecords(parseCSV(text)));
        })
        // A single .catch also covers anything start() throws, so a render
        // error surfaces instead of vanishing into an unhandled rejection.
        .catch(function (err) {
          showError("Couldn't load the resource data.", devHint(err));
        });
    } catch (e) {
      showError("Couldn't load the resource data.", devHint(e));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
