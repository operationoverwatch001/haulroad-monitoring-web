/* Overwatch - BANDINGKAN dua rilis audit (sebelum / sesudah): geser (swipe) di peta + daftar perubahan per blok 20 m.
 * Dimuat SETELAH app.js. Memakai: monitoringData (lebar standar), releaseIndex, activeReleaseId, owApi, map.
 *
 * Kenapa pencocokan spasial: garis tengah jalan boleh berubah antar rilis (regrade, pelebaran, geser jalur), jadi STA
 * tidak bisa dipakai sebagai kunci. Tiap blok "sesudah" dicocokkan ke blok "sebelum" TERDEKAT dalam radius 10 m
 * (titik tengah blok) pada ruas yang sama namanya. Blok tanpa pasangan = BARU (sesudah) / HILANG (sebelum).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.OwCompareLib = factory(root);
})(typeof window !== "undefined" ? window : this, function (root) {
  "use strict";

  var RADIUS_M = 10;
  var CELL = 0.0002;               // ~22 m, lebih besar dari radius sehingga cukup periksa 3x3 sel
  var M_LAT = 110574, M_LNG = 111320;

  /* ---------- geometri ---------- */
  function ringOf(f) {
    var g = f && f.geometry; if (!g) return null;
    var c = g.type === "Polygon" ? g.coordinates[0] : g.type === "MultiPolygon" ? g.coordinates[0][0] : g.type === "LineString" ? g.coordinates : null;
    if (!c || !c.length) return null;
    if (g.type !== "LineString" && c.length > 1 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1]) c = c.slice(0, -1);
    return c;
  }
  function centroid(f) {
    var c = ringOf(f); if (!c) return null;
    var sx = 0, sy = 0; c.forEach(function (p) { sx += p[0]; sy += p[1]; });
    return { lat: sy / c.length, lng: sx / c.length };
  }
  function bboxOf(f) {
    var c = ringOf(f); if (!c) return null;
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    c.forEach(function (p) { if (p[0] < b[0]) b[0] = p[0]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[1] > b[3]) b[3] = p[1]; });
    return b;
  }
  function distM(a, b) {
    var dy = (b.lat - a.lat) * M_LAT, dx = (b.lng - a.lng) * M_LNG * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
    return Math.sqrt(dx * dx + dy * dy);
  }
  function cellKey(ix, iy) { return ix + "," + iy; }
  function buildGrid(items) {
    var g = new Map();
    items.forEach(function (it) {
      var k = cellKey(Math.floor(it.c.lng / CELL), Math.floor(it.c.lat / CELL));
      var a = g.get(k); if (!a) g.set(k, a = []); a.push(it);
    });
    return g;
  }
  function near(grid, c, fn) {
    var ix = Math.floor(c.lng / CELL), iy = Math.floor(c.lat / CELL);
    for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
      var a = grid.get(cellKey(ix + dx, iy + dy)); if (a) a.forEach(fn);
    }
  }
  function nameKey(f) { var p = (f && f.properties) || {}; return String(p.Nama_Jalan || p["Nama Jalan"] || "").trim().toLowerCase(); }

  /* ---------- klasifikasi (aturan SAMA dengan gaya peta di app.js) ---------- */
  function num(v) { var n = parseFloat(v); return isNaN(n) ? null : n; }
  function gradeVal(p) { var g = num(p.Grade_Pct !== undefined ? p.Grade_Pct : (p["Grade Longitudinal (%)"] !== undefined ? p["Grade Longitudinal (%)"] : p.Grade)); return g === null ? null : Math.abs(g); }
  // 0 aman, 1 warning, 2 overgrade
  function gradeRank(p) {
    var s = String(p.Status_Gra || p["Status Grade"] || p.Status || "").toUpperCase(), g = gradeVal(p) || 0;
    if (s.indexOf("OVERGRADE") >= 0 || s.indexOf("NON COMPLIANT") >= 0 || g >= 9.0) return 2;
    if (s.indexOf("WARNING") >= 0 || g >= 8.0) return 1;
    return 0;
  }
  function widthVal(p) { return num(p.Lebar_m); }
  function widthRank(p, std) { var w = widthVal(p); return (w !== null && w > 0 && w < std) ? 2 : 0; }
  function cfNormalCount(p) {
    var n = 0;
    [p.Crossfall_, p.Crossfall1].forEach(function (v) { var x = num(v); if (x !== null && Math.abs(x) >= 2 && Math.abs(x) <= 4) n++; });
    return n;
  }
  function cfRank(p) { return 2 - cfNormalCount(p); }       // 0 dua sisi normal, 1 satu sisi, 2 dua sisi di luar

  var PARAMS = {
    grade: { label: "Grade", color: ["#22c55e", "#eab308", "#e11d48"], rank: function (p) { return gradeRank(p); }, val: gradeVal, unit: "%", worseDelta: 1 },
    lebar: { label: "Lebar", color: ["#22c55e", "#22c55e", "#e11d48"], rank: null, val: widthVal, unit: " m", worseDelta: 1 },
    crossfall: { label: "Crossfall", color: ["#22c55e", "#eab308", "#e11d48"], rank: function (p) { return cfRank(p); }, val: null, unit: "", worseDelta: 0 }
  };
  function rankOf(param, p, std) { return param === "lebar" ? widthRank(p, std) : PARAMS[param].rank(p); }
  function styleFor(param, p, std) {
    var r = rankOf(param, p, std), color = PARAMS[param].color[r];
    return r ? { color: "#0f172a", weight: 1.4, opacity: 0.95, fillColor: color, fillOpacity: 0.92, lineJoin: "round" }
             : { color: color, weight: 1.4, opacity: 0.78, fillColor: color, fillOpacity: 0.78, lineJoin: "round" };
  }
  function describe(param, p) {
    if (param === "grade") { var g = gradeVal(p); return g === null ? "-" : g.toFixed(1).replace(".", ",") + "%"; }
    if (param === "lebar") { var w = widthVal(p); return w === null ? "-" : w.toFixed(1).replace(".", ",") + " m"; }
    var a = num(p.Crossfall_), b = num(p.Crossfall1);
    function f(x) { return x === null ? "-" : x.toFixed(1).replace(".", ","); }
    return "K " + f(a) + " / R " + f(b);
  }

  /* ---------- pencocokan ---------- */
  function matchBlocks(oldFeatures, newFeatures, radius) {
    radius = radius || RADIUS_M;
    var olds = [], news = [];
    oldFeatures.forEach(function (f) { var c = centroid(f); if (c) olds.push({ f: f, c: c, name: nameKey(f) }); });
    newFeatures.forEach(function (f) { var c = centroid(f); if (c) news.push({ f: f, c: c, name: nameKey(f) }); });
    var oldGrid = buildGrid(olds), newGrid = buildGrid(news);
    var pairs = [], added = [], removed = [];
    // Hanya ruas yang NAMANYA SAMA yang dicocokkan. Di persimpangan blok dua ruas saling berdekatan; tanpa aturan ini
    // blok ruas lain ikut terpasang dan perubahannya jadi menyesatkan. Ruas yang diganti nama muncul sebagai baru/hilang.
    news.forEach(function (n) {
      var best = null, dBest = Infinity;
      near(oldGrid, n.c, function (o) {
        if (o.name !== n.name) return;
        var d = distM(n.c, o.c); if (d <= radius && d < dBest) { dBest = d; best = o; }
      });
      if (best) pairs.push({ n: n.f, o: best.f, d: dBest, c: n.c });
      else added.push({ n: n.f, c: n.c });
    });
    olds.forEach(function (o) {
      var any = false;
      near(newGrid, o.c, function (n) { if (!any && n.name === o.name && distM(o.c, n.c) <= radius) any = true; });
      if (!any) removed.push({ o: o.f, c: o.c });
    });
    return { pairs: pairs, added: added, removed: removed };
  }

  // Ringkasan + daftar baris perubahan untuk satu parameter.
  function summarize(match, param, stdOf) {
    var P = PARAMS[param], rows = [], cnt = { worse: 0, better: 0, same: 0, added: match.added.length, removed: match.removed.length };
    function stdFor(f) { return stdOf ? stdOf(nameKey(f)) : 30.8; }
    match.pairs.forEach(function (pr) {
      var po = pr.o.properties || {}, pn = pr.n.properties || {}, sO = stdFor(pr.o), sN = stdFor(pr.n);
      var ro = rankOf(param, po, sO), rn = rankOf(param, pn, sN), vo = P.val ? P.val(po) : null, vn = P.val ? P.val(pn) : null;
      var delta = (vo !== null && vn !== null) ? vn - vo : 0, cls, severity;
      if (param === "lebar") {
        // lebar: makin sempit = makin buruk
        if (rn > ro) cls = "worse"; else if (rn < ro) cls = "better"; else cls = delta <= -P.worseDelta ? "worse" : delta >= P.worseDelta ? "better" : "same";
        severity = (rn - ro) * 100 + (-delta);
      } else if (param === "crossfall") {
        cls = rn > ro ? "worse" : rn < ro ? "better" : "same";
        severity = (rn - ro) * 100;
      } else {
        if (rn > ro) cls = "worse"; else if (rn < ro) cls = "better"; else cls = delta >= P.worseDelta ? "worse" : delta <= -P.worseDelta ? "better" : "same";
        severity = (rn - ro) * 100 + delta;
      }
      cnt[cls]++;
      rows.push({ cls: cls, severity: severity, road: String(pn.Nama_Jalan || "").trim(), sta: pn.STA_Akhir || pn.Station_m || "", before: describe(param, po), after: describe(param, pn), delta: delta, bbox: bboxOf(pr.n), c: pr.c, d: pr.d });
    });
    match.added.forEach(function (a) { var p = a.n.properties || {}; rows.push({ cls: "added", severity: -1e6, road: String(p.Nama_Jalan || "").trim(), sta: p.STA_Akhir || "", before: "—", after: describe(param, p), delta: 0, bbox: bboxOf(a.n), c: a.c }); });
    match.removed.forEach(function (r) { var p = r.o.properties || {}; rows.push({ cls: "removed", severity: -2e6, road: String(p.Nama_Jalan || "").trim(), sta: p.STA_Akhir || "", before: describe(param, p), after: "—", delta: 0, bbox: bboxOf(r.o), c: r.c }); });
    var order = { worse: 0, better: 1, added: 2, removed: 3, same: 4 };
    rows.sort(function (a, b) { return order[a.cls] - order[b.cls] || (a.cls === "better" ? a.severity - b.severity : b.severity - a.severity); });
    return { counts: cnt, rows: rows };
  }

  /* ---------- clip untuk swipe (dihitung di koordinat layer, sama seperti plugin side-by-side) ---------- */
  function clipPolygons(nw, se, x) {
    function poly(a, b, c, d) { return "polygon(" + [a + "px " + b + "px", c + "px " + b + "px", c + "px " + d + "px", a + "px " + d + "px"].join(",") + ")"; }
    return { left: poly(nw.x, nw.y, x, se.y), right: poly(x, nw.y, se.x, se.y) };
  }

  /* ---------- tampilan ---------- */
  function esc(s) { return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function createCompare(d) {
    var L = d.L, map = d.map, doc = d.doc;
    var cache = new Map();   // "id" -> Promise<FeatureCollection>
    var S = null;

    function grade(id) {
      if (cache.has(id)) return cache.get(id);
      var p = d.api("/data/releases/" + encodeURIComponent(id) + "/Road_Grade_Polygons.geojson", 60000).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status); return r.json();
      }).then(function (fc) { return d.normalize ? d.normalize(fc) : fc; });
      p.catch(function () { cache.delete(id); });
      cache.set(id, p);
      return p;
    }
    function rel() { var ix = d.getState().releaseIndex; return (ix && ix.releases) || []; }
    function label(id) { var r = rel().find(function (x) { return x.id === id; }); return r ? r.label : id; }

    function start() {
      if (S) return true;
      var why = d.blocked ? d.blocked() : ""; if (why) { if (d.toast) d.toast(why); return false; }
      var g = d.getState(), list = rel();
      if (!g.activeReleaseId || list.length < 2) { if (d.toast) d.toast("Butuh minimal 2 rilis untuk dibandingkan."); return false; }
      var i = list.findIndex(function (r) { return r.id === g.activeReleaseId; });
      var older = list[i + 1] || list.find(function (r) { return r.id !== g.activeReleaseId; });
      S = { before: older.id, after: g.activeReleaseId, param: "grade", ratio: 0.5, tab: "swipe", match: null, sum: null, shown: 40, busy: true, err: "", layerA: null, layerB: null, sheetOpen: false };
      doc.body.classList.add("ow-comparing");
      S.paneA = map.createPane("owCmpA"); S.paneB = map.createPane("owCmpB");
      S.paneA.style.zIndex = 440; S.paneB.style.zIndex = 441;
      S.rendA = L.canvas({ pane: "owCmpA", padding: 0.5 }); S.rendB = L.canvas({ pane: "owCmpB", padding: 0.5 });
      S.onMove = applyClip; map.on("move zoom resize viewreset", S.onMove);
      if (d.hideBase) d.hideBase();
      S.ui = doc.createElement("div"); S.ui.id = "owCmp";
      S.ui.addEventListener("click", onClick); S.ui.addEventListener("change", onChange);
      doc.body.appendChild(S.ui);
      S.divider = doc.createElement("div"); S.divider.id = "owCmpDivider";
      S.divider.innerHTML = '<div class="ow-cd-line"></div><div class="ow-cd-grip" role="slider" aria-label="Geser pembanding" tabindex="0">⇆</div>';
      doc.body.appendChild(S.divider);
      bindDrag(S.divider);
      draw(); load();
      return true;
    }

    function stdOf(name) { var m = d.getState().stdMap; return (m && m[name]) || 30.8; }

    function load() {
      var my = S; S.busy = true; S.err = ""; draw();
      Promise.all([grade(S.before), grade(S.after)]).then(function (res) {
        if (S !== my) return;
        S.fcB = res[0]; S.fcA = res[1];
        S.match = matchBlocks(S.fcB.features, S.fcA.features);
        S.busy = false; rebuild();
      }).catch(function (e) { if (S !== my) return; S.busy = false; S.err = "Gagal memuat data rilis (" + e.message + ")"; draw(); });
    }

    function rebuild() {
      if (!S) return;
      [S.layerA, S.layerB].forEach(function (l) { if (l) map.removeLayer(l); });
      var param = S.param;
      function mk(fc, rend) {
        return L.geoJSON(fc, { renderer: rend, interactive: false, style: function (f) { return styleFor(param, f.properties || {}, stdOf(nameKey(f))); } }).addTo(map);
      }
      S.layerB = mk(S.fcB, S.rendA);      // kiri = SEBELUM (pane A)
      S.layerA = mk(S.fcA, S.rendB);      // kanan = SESUDAH (pane B)
      S.sum = summarize(S.match, param, stdOf);
      S.shown = 40;
      applyClip(); draw();
    }

    function applyClip() {
      if (!S || !S.paneA) return;
      var size = map.getSize(), nw = map.containerPointToLayerPoint([0, 0]), se = map.containerPointToLayerPoint(size);
      var x = nw.x + size.x * S.ratio, c = clipPolygons(nw, se, x);
      S.paneA.style.clipPath = S.paneA.style.webkitClipPath = c.left;
      S.paneB.style.clipPath = S.paneB.style.webkitClipPath = c.right;
      S.divider.style.left = (size.x * S.ratio) + "px";
      S.divider.style.display = S.tab === "swipe" ? "" : "none";
    }

    function bindDrag(el) {
      var dragging = false;
      function move(ev) {
        if (!dragging || !S) return;
        var w = (map.getSize && map.getSize().x) || doc.documentElement.clientWidth;
        S.ratio = Math.max(0.02, Math.min(0.98, ev.clientX / w)); applyClip(); ev.preventDefault();
      }
      el.addEventListener("pointerdown", function (ev) { dragging = true; try { el.setPointerCapture(ev.pointerId); } catch (e) {} ev.preventDefault(); });
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", function () { dragging = false; });
      el.addEventListener("pointercancel", function () { dragging = false; });
      el.addEventListener("keydown", function (ev) { if (!S) return; if (ev.key === "ArrowLeft") S.ratio = Math.max(0.02, S.ratio - 0.05); else if (ev.key === "ArrowRight") S.ratio = Math.min(0.98, S.ratio + 0.05); else return; applyClip(); ev.preventDefault(); });
    }

    function chip(cls, sym, n, label) { return '<span class="ow-cc ' + cls + '" title="' + label + '">' + sym + " <b>" + n + "</b> " + label + "</span>"; }
    function draw() {
      if (!S) return;
      var list = rel(), P = PARAMS[S.param], h = "";
      h += '<div class="ow-cmp-top"><div class="ow-cmp-row">' +
        '<label>Sebelum<select data-k="before">' + list.filter(function (r) { return r.id !== S.after; }).map(function (r) { return '<option value="' + esc(r.id) + '"' + (r.id === S.before ? " selected" : "") + ">" + esc(r.label) + "</option>"; }).join("") + "</select></label>" +
        '<label>Sesudah<select data-k="after">' + list.filter(function (r) { return r.id !== S.before; }).map(function (r) { return '<option value="' + esc(r.id) + '"' + (r.id === S.after ? " selected" : "") + ">" + esc(r.label) + "</option>"; }).join("") + "</select></label>" +
        '<label>Parameter<select data-k="param">' + Object.keys(PARAMS).map(function (k) { return '<option value="' + k + '"' + (k === S.param ? " selected" : "") + ">" + PARAMS[k].label + "</option>"; }).join("") + "</select></label>" +
        '<button type="button" class="ow-cmp-x" data-act="close" aria-label="Tutup">✕</button></div>' +
        '<div class="ow-cmp-tabs"><button type="button" data-act="tab" data-v="swipe" class="' + (S.tab === "swipe" ? "on" : "") + '">↔ Geser</button><button type="button" data-act="tab" data-v="list" class="' + (S.tab === "list" ? "on" : "") + '">☰ Perubahan</button></div></div>';
      if (S.tab === "swipe") {
        h += '<div class="ow-cmp-tag l">SEBELUM · ' + esc(label(S.before)) + '</div><div class="ow-cmp-tag r">SESUDAH · ' + esc(label(S.after)) + "</div>";
      }
      if (S.busy) h += '<div class="ow-cmp-msg">Memuat dan mencocokkan blok...</div>';
      if (S.err) h += '<div class="ow-cmp-msg err">' + esc(S.err) + ' <button type="button" data-act="retry">Coba lagi</button></div>';
      if (S.sum && !S.busy) {
        var c = S.sum.counts;
        h += '<div class="ow-cmp-sum">' + chip("bad", "▼", c.worse, "memburuk") + chip("good", "▲", c.better, "membaik") + chip("same", "＝", c.same, "tetap") + chip("new", "＋", c.added, "baru") + chip("gone", "−", c.removed, "hilang") + "</div>";
      }
      if (S.tab === "list" && S.sum && !S.busy) {
        var rows = S.sum.rows.filter(function (r) { return r.cls !== "same"; }), shown = rows.slice(0, S.shown);
        h += '<div class="ow-cmp-list">';
        if (!rows.length) h += '<div class="ow-cmp-msg">Tidak ada perubahan pada parameter ini.</div>';
        shown.forEach(function (r, i) {
          var sign = r.cls === "worse" ? "▼" : r.cls === "better" ? "▲" : r.cls === "added" ? "＋" : "−";
          var dtxt = (S.param !== "crossfall" && r.cls !== "added" && r.cls !== "removed" && r.delta) ? " (" + (r.delta > 0 ? "+" : "−") + Math.abs(r.delta).toFixed(1).replace(".", ",") + P.unit.trim() + ")" : "";
          h += '<button type="button" class="ow-cmp-item ' + r.cls + '" data-act="go" data-i="' + S.sum.rows.indexOf(r) + '"><span class="s">' + sign + "</span><span class=\"t\"><b>" + esc(r.road || "(tanpa nama)") + "</b> · STA " + esc(r.sta) + "<small>" + esc(r.before) + " → " + esc(r.after) + esc(dtxt) + "</small></span></button>";
        });
        if (rows.length > shown.length) h += '<button type="button" class="ow-cmp-more" data-act="more">Tampilkan lebih banyak (' + (rows.length - shown.length) + ")</button>";
        h += "</div>";
      }
      var keep = S.ui.querySelector(".ow-cmp-list"), top = keep ? keep.scrollTop : 0;
      S.ui.className = "tab-" + S.tab;
      S.ui.innerHTML = h;
      var nl = S.ui.querySelector(".ow-cmp-list"); if (nl) nl.scrollTop = top;
      if (S.divider) S.divider.style.display = S.tab === "swipe" && !S.busy ? "" : "none";
    }

    function onChange(e) {
      var k = e.target.getAttribute && e.target.getAttribute("data-k"); if (!k || !S) return;
      S[k] = e.target.value;
      if (k === "param") { if (S.match) rebuild(); } else load();
    }
    function onClick(e) {
      var a = e.target.closest("[data-act]"); if (!a || !S) return;
      var act = a.getAttribute("data-act");
      if (act === "close") stop();
      else if (act === "tab") { S.tab = a.getAttribute("data-v"); draw(); applyClip(); }
      else if (act === "more") { S.shown += 60; draw(); }
      else if (act === "retry") load();
      else if (act === "go") {
        var r = S.sum.rows[parseInt(a.getAttribute("data-i"), 10)]; if (!r || !r.bbox) return;
        S.tab = "swipe"; S.ratio = 0.5; draw();
        map.fitBounds([[r.bbox[1], r.bbox[0]], [r.bbox[3], r.bbox[2]]], { padding: [60, 60], maxZoom: 19 });
        applyClip();
      }
    }

    function stop() {
      if (!S) return;
      map.off("move zoom resize viewreset", S.onMove);
      [S.layerA, S.layerB].forEach(function (l) { if (l) map.removeLayer(l); });
      S.paneA.style.clipPath = S.paneA.style.webkitClipPath = ""; S.paneB.style.clipPath = S.paneB.style.webkitClipPath = "";
      if (S.ui) S.ui.remove(); if (S.divider) S.divider.remove();
      doc.body.classList.remove("ow-comparing");
      if (d.showBase) d.showBase();
      S = null;
    }

    return { start: start, stop: stop, toggle: function () { return S ? (stop(), false) : start(); }, active: function () { return !!S; }, _state: function () { return S; }, _applyClip: applyClip };
  }

  // ---- pasang otomatis di halaman peta ----
  if (typeof document !== "undefined" && typeof module === "undefined") {
    var boot = function () {
      if (typeof map === "undefined" || typeof L === "undefined" || typeof owApi !== "function") return;
      var hidden = [];
      root.OwCompare = createCompare({
        L: L, map: map, doc: document,
        api: function (p, ms) { return owApi(p, ms); },
        normalize: typeof OW_NORM === "function" ? OW_NORM : null,
        toast: function (t) { if (typeof showToastNotification === "function") showToastNotification(t); },
        blocked: function () {
          if (document.body.classList.contains("ow-drawing")) return "Selesaikan dulu gambar area WO.";
          if (document.body.classList.contains("ow-measuring")) return "Tutup alat ukur dulu.";
          if (typeof isWorkOrderModeActive !== "undefined" && isWorkOrderModeActive) return "Matikan mode WO dulu.";
          return "";
        },
        getState: function () {
          var std = {};
          (typeof monitoringData !== "undefined" ? monitoringData : []).forEach(function (r) {
            var k = String(r["Nama Jalan"] || "").trim().toLowerCase();
            if (k && std[k] === undefined) { var v = parseFloat(r["Lebar Standar (m)"]); std[k] = (!isNaN(v) && v > 0) ? v : 30.8; }
          });
          return { releaseIndex: typeof releaseIndex !== "undefined" ? releaseIndex : null, activeReleaseId: typeof activeReleaseId !== "undefined" ? activeReleaseId : null, stdMap: std };
        },
        // layer jalan bawaan disembunyikan selama membandingkan, dikembalikan lewat refreshVisibleLayers()
        hideBase: function () {
          hidden = [];
          [typeof roadGradeLayer !== "undefined" ? roadGradeLayer : null, typeof roadWidthLayer !== "undefined" ? roadWidthLayer : null, typeof crossfallVisualLayer !== "undefined" ? crossfallVisualLayer : null, typeof roadMapLayer !== "undefined" ? roadMapLayer : null]
            .forEach(function (l) { if (l && map.hasLayer(l)) { map.removeLayer(l); hidden.push(l); } });
        },
        showBase: function () { hidden.forEach(function (l) { if (!map.hasLayer(l)) l.addTo(map); }); hidden = []; if (typeof refreshVisibleLayers === "function") refreshVisibleLayers(); }
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  }

  return {
    RADIUS_M: RADIUS_M, PARAMS: PARAMS, centroid: centroid, distM: distM, matchBlocks: matchBlocks, summarize: summarize,
    styleFor: styleFor, gradeRank: gradeRank, widthRank: widthRank, cfRank: cfRank, clipPolygons: clipPolygons, createCompare: createCompare
  };
});
