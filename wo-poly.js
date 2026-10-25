/* =====================================================================
   OVERWATCH - wo-poly.js
   Editor area Work Order (poligon) yang ramah jari:
     - tap peta = tambah titik (peta tetap bisa digeser/zoom, tidak ada mode "kunci")
     - UNDO / REDO, hapus titik terpilih, ulang, batal
     - titik bisa DIGESER; titik tengah sisi (+) menambah titik baru
     - dipakai untuk menggambar area baru dan mengubah area yang sudah ada
   Bagian logika (PolyDraft) murni dan dites terpisah dari Leaflet.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OverwatchPoly = factory();
}(typeof self !== "undefined" ? self : this, function () {

  /* ------------------------------ logika murni ------------------------------ */
  function PolyDraft(points) {
    this.pts = (points || []).map(norm);
    this.past = [];
    this.future = [];
  }
  function norm(p) { return Array.isArray(p) ? { lat: +p[0], lng: +p[1] } : { lat: +p.lat, lng: +p.lng }; }
  function snap(pts) { return pts.map(function (p) { return { lat: p.lat, lng: p.lng }; }); }

  PolyDraft.prototype._push = function () { this.past.push(snap(this.pts)); if (this.past.length > 200) this.past.shift(); this.future = []; };
  PolyDraft.prototype.add = function (p) { this._push(); this.pts.push(norm(p)); return this.pts.length - 1; };
  PolyDraft.prototype.insert = function (i, p) { this._push(); this.pts.splice(i, 0, norm(p)); return i; };
  PolyDraft.prototype.move = function (i, p, commit) {
    if (i < 0 || i >= this.pts.length) return;
    if (commit !== false) this._push();
    this.pts[i] = norm(p);
  };
  // Geser titik = banyak event 'drag' lalu satu 'dragend'. Simpan riwayat sekali saat mulai geser.
  PolyDraft.prototype.beginMove = function () { this._push(); };
  PolyDraft.prototype.removeAt = function (i) { if (i < 0 || i >= this.pts.length) return false; this._push(); this.pts.splice(i, 1); return true; };
  PolyDraft.prototype.removeLast = function () { return this.removeAt(this.pts.length - 1); };
  PolyDraft.prototype.clear = function () { if (!this.pts.length) return; this._push(); this.pts = []; };
  PolyDraft.prototype.undo = function () { if (!this.past.length) return false; this.future.push(snap(this.pts)); this.pts = this.past.pop(); return true; };
  PolyDraft.prototype.redo = function () { if (!this.future.length) return false; this.past.push(snap(this.pts)); this.pts = this.future.pop(); return true; };
  PolyDraft.prototype.canUndo = function () { return this.past.length > 0; };
  PolyDraft.prototype.canRedo = function () { return this.future.length > 0; };
  PolyDraft.prototype.dirty = function () { return this.past.length > 0; };
  PolyDraft.prototype.areaM2 = function () { return areaM2(this.pts); };
  PolyDraft.prototype.selfIntersects = function () { return selfIntersects(this.pts); };
  // Hasil pemeriksaan untuk tombol Selesai: { ok, reason }
  PolyDraft.prototype.check = function () {
    if (this.pts.length < 3) return { ok: false, reason: "Minimal 3 titik (sekarang " + this.pts.length + ")." };
    if (this.selfIntersects()) return { ok: false, reason: "Sisi area saling bersilangan. Geser titiknya dulu." };
    if (this.areaM2() < 2) return { ok: false, reason: "Area terlalu kecil." };
    return { ok: true, reason: "" };
  };

  function project(pts) {
    var lat0 = pts.reduce(function (s, p) { return s + p.lat; }, 0) / (pts.length || 1);
    var kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
    return pts.map(function (p) { return { x: p.lng * kx, y: p.lat * ky }; });
  }
  function areaM2(pts) {
    if (pts.length < 3) return 0;
    var q = project(pts), s = 0;
    for (var i = 0, j = q.length - 1; i < q.length; j = i++) s += (q[j].x * q[i].y) - (q[i].x * q[j].y);
    return Math.abs(s) / 2;
  }
  function ccw(a, b, c) { return (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x); }
  function segHit(a, b, c, d) {
    var d1 = ccw(a, b, c), d2 = ccw(a, b, d), d3 = ccw(c, d, a), d4 = ccw(c, d, b);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }
  function selfIntersects(pts) {
    var n = pts.length; if (n < 4) return false;
    var q = project(pts);
    for (var i = 0; i < n; i++) {
      var a = q[i], b = q[(i + 1) % n];
      for (var j = i + 1; j < n; j++) {
        if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;   // sisi bertetangga
        if (segHit(a, b, q[j], q[(j + 1) % n])) return true;
      }
    }
    return false;
  }
  function pointInPolygon(pt, vs) {
    var x = pt.lng, y = pt.lat, inside = false;
    for (var i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      var xi = vs[i].lng, yi = vs[i].lat, xj = vs[j].lng, yj = vs[j].lat;
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function centroid(pts) {
    var n = pts.length || 1;
    return { lat: pts.reduce(function (s, p) { return s + p.lat; }, 0) / n, lng: pts.reduce(function (s, p) { return s + p.lng; }, 0) / n };
  }
  function fmtArea(m2) { return m2 >= 10000 ? (m2 / 10000).toFixed(2) + " ha" : Math.round(m2) + " m²"; }

  /* ------------------------------ alat Leaflet ------------------------------ */
  function WoPolyTool(L, map, doc) {
    doc = doc || document;
    var st = null;   // sesi aktif

    function vIcon(selected, first) {
      return L.divIcon({
        className: "ow-vtx", iconSize: [44, 44], iconAnchor: [22, 22],
        html: '<div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;touch-action:none">' +
              '<div style="width:' + (selected ? 24 : 18) + 'px;height:' + (selected ? 24 : 18) + 'px;border-radius:50%;background:' + (first ? '#22c55e' : '#fff') +
              ';border:3px solid ' + (selected ? '#f59e0b' : '#e11d48') + ';box-shadow:0 1px 6px rgba(0,0,0,.6)"></div></div>'
      });
    }
    function midIcon() {
      return L.divIcon({
        className: "ow-mid", iconSize: [36, 36], iconAnchor: [18, 18],
        html: '<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center"><div style="width:16px;height:16px;border-radius:50%;background:rgba(15,23,42,.85);color:#fff;font:700 13px/15px system-ui;text-align:center;border:1.5px solid #fff">+</div></div>'
      });
    }

    function buildBar() {
      var bar = doc.createElement("div");
      bar.id = "owPolyBar";
      bar.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:100010;display:flex;flex-direction:column;gap:6px;align-items:center;max-width:96vw";
      bar.innerHTML =
        '<div id="owPolyHint" style="background:rgba(15,23,42,.94);color:#e2e8f0;font:12px/1.35 system-ui;padding:7px 12px;border-radius:10px;border:1px solid #334155;text-align:center"></div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center">' +
        btn("owPolyUndo", "↶", "Undo") + btn("owPolyRedo", "↷", "Redo") + btn("owPolyDelPt", "⌫", "Hapus titik") +
        btn("owPolyClear", "↺", "Ulang") + btn("owPolyCancel", "✕", "Batal") +
        '<button id="owPolyDone" type="button" style="min-height:44px;padding:0 18px;border-radius:12px;border:none;background:#22c55e;color:#04210e;font:700 14px system-ui;cursor:pointer">✓ Selesai</button>' +
        '</div>';
      doc.body.appendChild(bar);
      return bar;
    }
    function btn(id, ico, label) {
      return '<button id="' + id + '" type="button" aria-label="' + label + '" style="min-height:44px;min-width:56px;padding:0 10px;border-radius:12px;border:1px solid #475569;background:#0f172a;color:#f1f5f9;font:600 12px system-ui;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.1"><span style="font-size:17px">' + ico + '</span><span>' + label + '</span></button>';
    }

    function start(opts) {
      if (st) cancel();
      var draft = new PolyDraft(opts.points || []);
      var s = st = {
        opts: opts, draft: draft, selected: -1, layers: L.featureGroup().addTo(map), vtx: [], mids: [], shape: null,
        bar: buildBar(), dblZoom: map.doubleClickZoom && map.doubleClickZoom.enabled && map.doubleClickZoom.enabled()
      };
      if (s.dblZoom) map.doubleClickZoom.disable();

      s.onMapClick = function (e) { if (!st) return; draft.add(e.latlng); s.selected = draft.pts.length - 1; render(); };
      map.on("click", s.onMapClick);
      s.onKey = function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); act(e.shiftKey ? "redo" : "undo"); }
        else if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); act("redo"); }
        else if (e.key === "Escape") cancel();
      };
      doc.addEventListener("keydown", s.onKey);

      var $ = function (id) { return s.bar.querySelector("#" + id); };
      $("owPolyUndo").onclick = function () { act("undo"); };
      $("owPolyRedo").onclick = function () { act("redo"); };
      $("owPolyDelPt").onclick = function () { act("delpt"); };
      $("owPolyClear").onclick = function () { act("clear"); };
      $("owPolyCancel").onclick = function () { cancel(); };
      $("owPolyDone").onclick = function () { finish(); };
      s.$ = $;
      render();
      if (draft.pts.length >= 3) { try { map.fitBounds(L.latLngBounds(draft.pts.map(function (p) { return [p.lat, p.lng]; })), { padding: [60, 120], maxZoom: 20 }); } catch (e) {} }
      return api;
    }

    function act(a) {
      if (!st) return;
      var d = st.draft;
      if (a === "undo") d.undo();
      else if (a === "redo") d.redo();
      else if (a === "clear") d.clear();
      else if (a === "delpt") { var i = st.selected >= 0 ? st.selected : d.pts.length - 1; d.removeAt(i); }
      st.selected = Math.min(st.selected, d.pts.length - 1);
      render();
    }

    function render() {
      if (!st) return;
      var s = st, d = s.draft, pts = d.pts, ll = pts.map(function (p) { return [p.lat, p.lng]; });
      s.layers.clearLayers(); s.vtx = []; s.mids = [];
      var bad = d.selfIntersects();
      var style = { color: bad ? "#f59e0b" : "#e11d48", weight: 4, fillColor: bad ? "#f59e0b" : "#e11d48", fillOpacity: 0.18, interactive: false };
      if (ll.length >= 3) s.shape = L.polygon(ll, style).addTo(s.layers);
      else if (ll.length >= 2) s.shape = L.polyline(ll, Object.assign({}, style, { dashArray: "6 6" })).addTo(s.layers);
      else s.shape = null;

      // titik tengah sisi (+)
      if (ll.length >= 2) {
        var n = pts.length, edges = n >= 3 ? n : n - 1;
        for (var e = 0; e < edges; e++) {
          (function (e) {
            var a = pts[e], b = pts[(e + 1) % n];
            var m = L.marker([(a.lat + b.lat) / 2, (a.lng + b.lng) / 2], { icon: midIcon(), draggable: true, keyboard: false }).addTo(s.layers);
            var inserted = false;
            m.on("dragstart", function () { s.draft.insert(e + 1, m.getLatLng()); inserted = true; });
            m.on("drag", function () { if (inserted) { s.draft.move(e + 1, m.getLatLng(), false); softShape(); } });
            m.on("dragend", function () { s.selected = e + 1; render(); });
            m.on("click", function () { s.draft.insert(e + 1, m.getLatLng()); s.selected = e + 1; render(); });
            s.mids.push(m);
          })(e);
        }
      }
      // titik sudut
      pts.forEach(function (p, i) {
        var m = L.marker([p.lat, p.lng], { icon: vIcon(i === s.selected, i === 0 && pts.length >= 3), draggable: true, keyboard: false }).addTo(s.layers);
        m.on("click", function () { s.selected = (s.selected === i ? -1 : i); render(); });
        m.on("dragstart", function () { s.draft.beginMove(); s.selected = i; });
        m.on("drag", function () { s.draft.move(i, m.getLatLng(), false); softShape(); });
        m.on("dragend", function () { render(); });
        s.vtx.push(m);
      });
      status();
    }

    // saat menggeser, hanya gambar ulang bentuknya (marker lain tidak dibangun ulang supaya drag mulus)
    function softShape() {
      if (!st || !st.shape) return;
      var ll = st.draft.pts.map(function (p) { return [p.lat, p.lng]; });
      st.shape.setLatLngs(ll);
      status();
    }

    function status() {
      var s = st, d = s.draft, chk = d.check(), $ = s.$;
      var hint = d.pts.length === 0 ? "Ketuk peta untuk mulai menandai area WO."
        : d.pts.length < 3 ? "Ketuk peta untuk menambah titik (" + d.pts.length + "/3 minimal)."
        : (chk.ok ? d.pts.length + " titik · " + fmtArea(d.areaM2()) + ". Geser titik untuk koreksi, ketuk (+) untuk menambah, lalu Selesai." : "⚠ " + chk.reason);
      $("owPolyHint").textContent = hint;
      setEnabled($("owPolyUndo"), d.canUndo());
      setEnabled($("owPolyRedo"), d.canRedo());
      setEnabled($("owPolyDelPt"), d.pts.length > 0);
      setEnabled($("owPolyClear"), d.pts.length > 0);
      setEnabled($("owPolyDone"), chk.ok, true);
    }
    function setEnabled(el, on, big) { el.style.opacity = on ? "1" : (big ? "0.45" : "0.4"); el.dataset.off = on ? "" : "1"; el.setAttribute("aria-disabled", on ? "false" : "true"); }

    function finish() {
      if (!st) return;
      var chk = st.draft.check();
      if (!chk.ok) { st.$("owPolyHint").textContent = "⚠ " + chk.reason; return; }
      var s = st, pts = snap(s.draft.pts), cb = s.opts.onDone;
      teardown();
      if (cb) cb(pts, { areaM2: areaM2(pts), center: centroid(pts) });
    }

    function cancel() {
      if (!st) return;
      var s = st;
      if (s.draft.dirty() && s.opts.confirmCancel !== false && typeof confirm === "function") {
        if (!confirm("Buang gambar area ini?")) return;
      }
      var cb = s.opts.onCancel;
      teardown();
      if (cb) cb();
    }

    function teardown() {
      var s = st; if (!s) return;
      map.off("click", s.onMapClick);
      doc.removeEventListener("keydown", s.onKey);
      map.removeLayer(s.layers);
      if (s.bar && s.bar.parentNode) s.bar.parentNode.removeChild(s.bar);
      if (s.dblZoom) map.doubleClickZoom.enable();
      st = null;
    }

    var api = { start: start, cancel: cancel, finish: finish, act: act, active: function () { return !!st; }, _state: function () { return st; } };
    return api;
  }

  return { PolyDraft: PolyDraft, WoPolyTool: WoPolyTool, areaM2: areaM2, selfIntersects: selfIntersects, pointInPolygon: pointInPolygon, centroid: centroid, fmtArea: fmtArea };
}));
