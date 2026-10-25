/* Overwatch - alat ukur HORIZONTAL di peta (jarak, keliling, luas) dalam UTM zona 50 selatan (WGS84, EPSG:32750).
 * Hasilnya sama dengan mengukur di ArcGIS Pro pada sistem koordinat yang sama (jarak bidang datar, bukan permukaan miring).
 * Dimuat SETELAH app.js dan wo-integration.js. Tombol "UKUR" ada di sidebar kiri.
 *
 * Cara pakai: ketuk peta untuk menambah titik, seret titik untuk menggeser, Undo / Ulang, ganti Garis <-> Area, Salin hasil.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.OwMeasureLib = factory(root);
})(typeof window !== "undefined" ? window : this, function (root) {
  "use strict";

  /* ---------- proyeksi: lat/lng WGS84 -> UTM 50S (Transverse Mercator, k0 = 0,9996, meridian tengah 117 BT) ---------- */
  var A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), EP2 = E2 / (1 - E2), K0 = 0.9996, LON0 = 117 * Math.PI / 180;
  function toUTM50S(lat, lng) {
    var p = lat * Math.PI / 180, l = lng * Math.PI / 180;
    var s = Math.sin(p), c = Math.cos(p), t = Math.tan(p);
    var N = A / Math.sqrt(1 - E2 * s * s), T = t * t, C = EP2 * c * c, a = (l - LON0) * c;
    var M = A * ((1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 * E2 * E2 / 256) * p
      - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2 * E2 * E2 / 1024) * Math.sin(2 * p)
      + (15 * E2 * E2 / 256 + 45 * E2 * E2 * E2 / 1024) * Math.sin(4 * p)
      - (35 * E2 * E2 * E2 / 3072) * Math.sin(6 * p));
    var a2 = a * a, a3 = a2 * a, a4 = a3 * a, a5 = a4 * a, a6 = a5 * a;
    var e = K0 * N * (a + (1 - T + C) * a3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * a5 / 120) + 500000;
    var n = K0 * (M + N * t * (a2 / 2 + (5 - T + 9 * C + 4 * C * C) * a4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * a6 / 720)) + 10000000;
    return { e: e, n: n };
  }

  function dist(p, q) { return Math.hypot(q.e - p.e, q.n - p.n); }
  // pts: [{lat,lng}] -> ukuran dalam meter / m²
  function measure(pts, closed) {
    var u = pts.map(function (p) { return toUTM50S(p.lat, p.lng); });
    var segs = [], total = 0, i;
    for (i = 1; i < u.length; i++) { var d = dist(u[i - 1], u[i]); segs.push(d); total += d; }
    var perimeter = total, area = 0;
    if (closed && u.length >= 3) {
      perimeter = total + dist(u[u.length - 1], u[0]);
      for (i = 0; i < u.length; i++) { var j = (i + 1) % u.length; area += u[i].e * u[j].n - u[j].e * u[i].n; }
      area = Math.abs(area) / 2;
    }
    return { utm: u, segs: segs, length: total, perimeter: perimeter, area: area };
  }

  function sep(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
  function fmtLen(m) {
    if (m < 999.95) return m.toFixed(1).replace(".", ",") + " m";
    return (m / 1000).toFixed(3).replace(".", ",") + " km";
  }
  function fmtArea(m2) {
    return m2 >= 10000 ? (m2 / 10000).toFixed(2).replace(".", ",") + " ha (" + sep(m2) + " m²)" : sep(m2) + " m²";
  }
  function summaryText(pts, mode) {
    var m = measure(pts, mode === "area");
    var t = "Pengukuran horizontal (UTM 50S, WGS84)\n";
    if (mode === "area" && pts.length >= 3) t += "Luas: " + fmtArea(m.area) + "\nKeliling: " + fmtLen(m.perimeter) + "\n";
    else t += "Panjang: " + fmtLen(m.length) + "\n";
    t += "Titik:\n";
    m.utm.forEach(function (p, i) { t += (i + 1) + "  E " + p.e.toFixed(1) + "  N " + p.n.toFixed(1) + "\n"; });
    return t.trim();
  }

  /* ---------- alat di peta ---------- */
  function createTool(d) {
    var L = d.L, map = d.map, doc = d.doc;
    var st = null;

    function vIcon(i, last) {
      return L.divIcon({
        className: "ow-mvtx", iconSize: [44, 44], iconAnchor: [22, 22],
        html: '<div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;touch-action:none"><div class="ow-mdot' + (last ? " last" : "") + '">' + (i + 1) + "</div></div>"
      });
    }
    function lblIcon(text) {
      return L.divIcon({ className: "ow-mlbl", iconSize: [0, 0], html: '<span class="ow-mlbl-t">' + text + "</span>" });
    }

    function readout() {
      var n = st.pts.length;
      if (n === 0) return "Ketuk peta untuk mulai mengukur";
      if (n === 1) return "Ketuk titik berikutnya";
      var m = measure(st.pts, st.mode === "area");
      if (st.mode === "area") {
        if (n < 3) return "Area butuh minimal 3 titik (" + n + " dibuat)";
        return "<b>" + fmtArea(m.area) + "</b> · keliling " + fmtLen(m.perimeter) + " · " + n + " titik";
      }
      return "<b>" + fmtLen(m.length) + "</b> · segmen terakhir " + fmtLen(m.segs[m.segs.length - 1]) + " · " + n + " titik";
    }

    function render(keepMarkers) {
      var s = st, ll = s.pts.map(function (p) { return [p.lat, p.lng]; });
      // bentuk
      if (s.shape) { s.group.removeLayer(s.shape); s.shape = null; }
      if (ll.length >= 2) {
        var o = { color: "#00f0ff", weight: 3, dashArray: "8 6", interactive: false };
        s.shape = (s.mode === "area" && ll.length >= 3) ? L.polygon(ll, Object.assign({ fillColor: "#00f0ff", fillOpacity: 0.15 }, o)) : L.polyline(ll, o);
        s.group.addLayer(s.shape);
      }
      // label panjang tiap segmen
      s.labels.forEach(function (m) { s.group.removeLayer(m); }); s.labels = [];
      var m = measure(s.pts, s.mode === "area"), k;
      var edges = m.segs.map(function (len, i) { return [i, i + 1, len]; });
      if (s.mode === "area" && s.pts.length >= 3) edges.push([s.pts.length - 1, 0, dist(m.utm[s.pts.length - 1], m.utm[0])]);
      for (k = 0; k < edges.length; k++) {
        var a = s.pts[edges[k][0]], b = s.pts[edges[k][1]];
        var lm = L.marker([(a.lat + b.lat) / 2, (a.lng + b.lng) / 2], { icon: lblIcon(fmtLen(edges[k][2])), interactive: false, keyboard: false });
        s.labels.push(lm); s.group.addLayer(lm);
      }
      // pegangan titik (dibangun ulang kecuali sedang diseret)
      if (!keepMarkers) {
        s.markers.forEach(function (mk) { s.group.removeLayer(mk); }); s.markers = [];
        s.pts.forEach(function (p, i) {
          var mk = L.marker([p.lat, p.lng], { icon: vIcon(i, i === s.pts.length - 1), draggable: true, keyboard: false, zIndexOffset: 1000 });
          mk.on("dragstart", function () { push(s.pts); });
          mk.on("drag", function () { var q = mk.getLatLng(); s.pts[i] = { lat: q.lat, lng: q.lng }; render(true); });
          mk.on("dragend", function () { render(false); });
          s.markers.push(mk); s.group.addLayer(mk);
        });
      }
      var r = s.bar && s.bar.querySelector("#owMeasureRead"); if (r) r.innerHTML = readout();
      var bm = s.bar && s.bar.querySelector("#owMeasureMode"); if (bm) bm.querySelector("span:last-child").textContent = s.mode === "area" ? "Area" : "Garis";
      var u = s.bar && s.bar.querySelector("#owMeasureUndo"); if (u) u.setAttribute("aria-disabled", s.hist.length ? "false" : "true");
    }

    function push(before) { st.hist.push(before.map(function (p) { return { lat: p.lat, lng: p.lng }; })); if (st.hist.length > 100) st.hist.shift(); }

    function buildBar() {
      var bar = doc.createElement("div");
      bar.id = "owMeasureBar";
      bar.innerHTML =
        '<div id="owMeasureRead"></div><div class="ow-mrow">' +
        b("owMeasureUndo", "↶", "Undo") + b("owMeasureClear", "↺", "Ulang") + b("owMeasureMode", "▱", "Garis") + b("owMeasureCopy", "⧉", "Salin") +
        '<button id="owMeasureClose" type="button" class="ow-mclose">✕ Tutup</button></div>';
      doc.body.appendChild(bar);
      return bar;
      function b(id, ico, label) { return '<button id="' + id + '" type="button" aria-label="' + label + '"><span>' + ico + "</span><span>" + label + "</span></button>"; }
    }

    function start() {
      if (st) return true;
      var why = d.blocked ? d.blocked() : "";
      if (why) { if (d.toast) d.toast(why); return false; }
      var s = st = { pts: [], hist: [], mode: "line", group: L.layerGroup(), shape: null, markers: [], labels: [], bar: null };
      s.group.addTo(map);
      s.onClick = function (e) {
        var before = s.pts.slice();
        if (before.length && Math.hypot(before[before.length - 1].lat - e.latlng.lat, before[before.length - 1].lng - e.latlng.lng) < 1e-9) return;   // ketukan ganda di titik yang sama
        push(before); s.pts.push({ lat: e.latlng.lat, lng: e.latlng.lng }); render(false);
      };
      map.on("click", s.onClick);
      if (map.doubleClickZoom) map.doubleClickZoom.disable();
      doc.body.classList.add("ow-measuring"); root.owMapPicking = true;
      s.bar = buildBar();
      s.bar.querySelector("#owMeasureUndo").onclick = function () { if (s.hist.length) { s.pts = s.hist.pop(); render(false); } };
      s.bar.querySelector("#owMeasureClear").onclick = function () { if (s.pts.length) { push(s.pts); s.pts = []; render(false); } };
      s.bar.querySelector("#owMeasureMode").onclick = function () { s.mode = s.mode === "area" ? "line" : "area"; render(true); };
      s.bar.querySelector("#owMeasureCopy").onclick = function () { copy(); };
      s.bar.querySelector("#owMeasureClose").onclick = function () { stop(); };
      render(false);
      return true;
    }

    function copy() {
      if (!st || st.pts.length < 2) { if (d.toast) d.toast("Belum ada ukuran untuk disalin"); return; }
      var text = summaryText(st.pts, st.mode);
      var ok = function () { if (d.toast) d.toast("Hasil ukur disalin"); };
      var fail = function () { if (d.toast) d.toast("Gagal menyalin. Tahan lalu salin manual dari layar."); };
      try {
        if (root.navigator && root.navigator.clipboard) root.navigator.clipboard.writeText(text).then(ok, fail); else fail();
      } catch (e) { fail(); }
    }

    function stop() {
      if (!st) return;
      map.off("click", st.onClick);
      map.removeLayer(st.group);
      if (st.bar) st.bar.remove();
      if (map.doubleClickZoom) map.doubleClickZoom.enable();
      doc.body.classList.remove("ow-measuring"); root.owMapPicking = false;
      st = null;
    }

    return { start: start, stop: stop, toggle: function () { return st ? (stop(), false) : start(); }, active: function () { return !!st; }, copy: copy, _state: function () { return st; } };
  }

  // ---- pasang otomatis di halaman peta ----
  if (typeof document !== "undefined" && typeof module === "undefined") {
    var boot = function () {
      if (typeof map === "undefined" || typeof L === "undefined") return;
      root.OwMeasure = createTool({
        L: L, map: map, doc: document,
        toast: function (t) { if (typeof showToastNotification === "function") showToastNotification(t); },
        blocked: function () {
          if (document.body.classList.contains("ow-drawing")) return "Selesaikan dulu gambar area WO.";
          if (typeof isWorkOrderModeActive !== "undefined" && isWorkOrderModeActive) return "Matikan mode WO dulu sebelum mengukur.";
          if (root.owMapPicking) return "Selesaikan dulu pemilihan titik di peta.";
          return "";
        }
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  }

  return { toUTM50S: toUTM50S, measure: measure, fmtLen: fmtLen, fmtArea: fmtArea, summaryText: summaryText, createTool: createTool };
});
