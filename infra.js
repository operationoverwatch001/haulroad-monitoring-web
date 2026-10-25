/* Overwatch - modul Infrastruktur di peta (CSA, waterfill, pitstop, buspad, dst).
 * Dimuat SETELAH app.js (memakai: map, L, owApi). Data dari Worker: /api/infra + /data/infra/<id>/...
 *
 * - Pin per objek selalu tampil (kalau toggle Infra ON), desain GeoJSON baru dimuat saat di-zoom dekat & objek ada di layar.
 * - Klik pin / bentuk desain -> popup: nama, kapasitas per kelas (100/150/200 T), fasilitas, catatan, foto drone terbaru (bisa digeser).
 * - Foto ada di bucket privat, jadi diambil lewat fetch ber-token lalu diubah ke blob URL.
 * - Pilihan ON/OFF dan jenis yang ditampilkan diingat per perangkat.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.OwInfraLib = factory(root);
})(typeof window !== "undefined" ? window : this, function (root) {
  "use strict";

  var KEY = "ow_infra_v1";
  var MIN_DESIGN_ZOOM = 16;      // desain detail (crest, toe, slot DT) baru digambar mulai zoom ini
  var PHOTO_CACHE_MAX = 12;

  var TYPES = {
    csa:       { label: "CSA",       icon: "🅿️", color: "#38bdf8" },
    waterfill: { label: "Waterfill", icon: "💧", color: "#22d3ee" },
    pitstop:   { label: "Pitstop",   icon: "⛽", color: "#fb923c" },
    buspad:    { label: "Buspad",    icon: "🚌", color: "#a78bfa" },
    lainnya:   { label: "Lainnya",   icon: "📍", color: "#94a3b8" }
  };
  var STYLE = {
    batas:     { color: "#38bdf8", weight: 2,   dashArray: "6 4", fillColor: "#38bdf8", fillOpacity: 0.07 },
    crest:     { color: "#facc15", weight: 3,   fillOpacity: 0 },
    toe:       { color: "#fb923c", weight: 3,   fillOpacity: 0 },
    bundwall:  { color: "#fbbf24", weight: 3,   fillOpacity: 0 },
    parkir:    { color: "#a3e635", weight: 1,   fillColor: "#a3e635", fillOpacity: 0.10 },
    dt:        { color: "#0f172a", weight: 1,   fillColor: "#e2e8f0", fillOpacity: 0.85 },
    buspad:    { color: "#a78bfa", weight: 2,   fillColor: "#a78bfa", fillOpacity: 0.25 },
    jalan:     { color: "#94a3b8", weight: 2,   fillOpacity: 0 },
    fasilitas: { color: "#f472b6", weight: 1.5, fillColor: "#f472b6", fillOpacity: 0.35 },
    lainnya:   { color: "#94a3b8", weight: 1.5, fillColor: "#94a3b8", fillOpacity: 0.15 }
  };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

  function esc(s) {
    return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? (+m[3]) + " " + MONTHS[+m[2] - 1] + " " + m[1] : "";
  }
  function totalCap(c) { c = c || {}; return (c.t100 || 0) + (c.t150 || 0) + (c.t200 || 0); }
  function styleKey(props) {
    var RL = root.OverwatchRelease;
    return RL && RL.infraKey ? RL.infraKey(props) : "lainnya";
  }

  // Isi popup. Semua teks dari server di-escape. Aksi lewat atribut data-act (tanpa onclick inline).
  function buildPopupHtml(o) {
    var t = TYPES[o.type] || TYPES.lainnya, h = "";
    h += '<div class="ow-ip">';
    h += '<div class="ow-ip-h"><span class="ow-ip-type" style="background:' + t.color + '">' + esc(t.label) + "</span><b>" + esc(o.name) + "</b></div>";

    var photos = o.photos || [];
    if (photos.length) {
      h += '<div class="ow-ip-photo"><img class="ow-ip-img" alt="Foto drone ' + esc(o.name) + '" data-act="zoom">';
      if (photos.length > 1) h += '<button type="button" class="ow-ip-nav ow-ip-prev" data-act="prev" aria-label="Foto sebelumnya">‹</button><button type="button" class="ow-ip-nav ow-ip-next" data-act="next" aria-label="Foto berikutnya">›</button>';
      h += '<div class="ow-ip-cap" data-cap></div></div>';
    } else {
      h += '<div class="ow-ip-nophoto">Belum ada foto drone</div>';
    }

    var total = totalCap(o.capacity);
    if (o.type === "csa" || total > 0) {
      var c = o.capacity || {};
      h += '<div class="ow-ip-sec">Kapasitas unit</div><div class="ow-ip-cap3">';
      [["100 T", c.t100], ["150 T", c.t150], ["200 T", c.t200]].forEach(function (x) {
        h += '<div><b>' + esc(x[1] || 0) + "</b><small>" + x[0] + "</small></div>";
      });
      h += '<div class="ow-ip-tot"><b>' + esc(total) + "</b><small>Total</small></div></div>";
    }

    var facs = o.facilities || [];
    if (facs.length) {
      h += '<div class="ow-ip-sec">Fasilitas</div><div class="ow-ip-chips">';
      facs.forEach(function (f) { h += '<span class="ow-ip-chip">' + esc(f.name) + " <b>×" + esc(f.qty) + "</b></span>"; });
      h += "</div>";
    }
    if (o.note) h += '<div class="ow-ip-note">' + esc(o.note) + "</div>";
    var up = fmtDate(o.updatedAt);
    if (up) h += '<div class="ow-ip-foot">Data diperbarui ' + esc(up) + "</div>";
    return h + "</div>";
  }

  function createManager(d) {
    var L = d.L, map = d.map, doc = d.doc;
    var st = { on: true, types: {}, objects: [], loaded: false, loading: false, error: "", entries: {}, panelOpen: false };
    Object.keys(TYPES).forEach(function (k) { st.types[k] = true; });
    var photoCache = new Map();    // "id/file" -> Promise<blobUrl>
    var pins = L.layerGroup();
    var ui = {};

    /* ---------- simpan pilihan ---------- */
    function saveState() {
      try { d.storage.setItem(KEY, JSON.stringify({ on: st.on, types: st.types })); } catch (e) {}
    }
    function restoreState() {
      try {
        var s = JSON.parse(d.storage.getItem(KEY) || "null");
        if (!s) return;
        if (typeof s.on === "boolean") st.on = s.on;
        if (s.types) Object.keys(TYPES).forEach(function (k) { if (typeof s.types[k] === "boolean") st.types[k] = s.types[k]; });
      } catch (e) {}
    }

    function busy() { try { return !!d.isBusy(); } catch (e) { return false; } }
    function find(id) { return st.objects.find(function (o) { return o.id === id; }); }

    /* ---------- ambil data ---------- */
    async function load() {
      if (st.loading) return;
      st.loading = true; st.error = "";
      try {
        var r = await d.api("/api/infra", 10000);
        if (!r.ok) throw new Error(r.status === 401 ? "Belum login" : "HTTP " + r.status);
        var j = await r.json();
        st.objects = (j.objects || []).filter(function (o) {
          var ok = o && o.id && o.center && isFinite(o.center.lat) && isFinite(o.center.lng);
          if (!ok && o && o.id) console.warn("Infra " + o.id + " dilewati: belum punya koordinat (upload ulang desainnya).");
          return ok;
        });
        st.loaded = true;
      } catch (e) {
        st.error = e.message || String(e);
        if (d.toast && !st.loaded) d.toast("Infra tidak bisa dimuat: " + st.error);
      }
      st.loading = false;
      render();
    }

    /* ---------- pin & desain ---------- */
    function enabled(o) { return st.on && st.types[o.type] !== false; }

    function makePin(o) {
      var t = TYPES[o.type] || TYPES.lainnya;
      var m = L.marker([o.center.lat, o.center.lng], {
        icon: L.divIcon({
          className: "ow-infra-wrap",
          html: '<div class="ow-infra-pin" style="--c:' + t.color + '">' + t.icon + '</div><div class="ow-infra-lbl">' + esc(o.name) + "</div>",
          iconSize: [34, 34], iconAnchor: [17, 17]
        }),
        title: o.name, keyboard: false, zIndexOffset: -500
      });
      m.on("click", function () { if (!busy()) openPopup(o, m.getLatLng()); });
      return m;
    }

    function render() {
      // buang entri objek yang sudah dihapus dari server
      Object.keys(st.entries).forEach(function (id) {
        if (!find(id)) { dropEntry(st.entries[id]); delete st.entries[id]; }
      });
      st.objects.forEach(function (o) {
        var e = st.entries[o.id] || (st.entries[o.id] = {});
        if (e.ver !== o.updatedAt) {            // data berubah -> bangun ulang pin, desain diambil ulang
          dropEntry(e); e.ver = o.updatedAt; e.fc = null;
        }
        if (!e.pin) e.pin = makePin(o);
        if (enabled(o)) { if (!pins.hasLayer(e.pin)) pins.addLayer(e.pin); }
        else if (pins.hasLayer(e.pin)) pins.removeLayer(e.pin);
      });
      if (st.on && !map.hasLayer(pins)) pins.addTo(map);
      if (!st.on && map.hasLayer(pins)) map.removeLayer(pins);
      refreshDesigns();
      renderUi();
    }

    function dropEntry(e) {
      if (!e) return;
      if (e.pin && pins.hasLayer(e.pin)) pins.removeLayer(e.pin);
      if (e.layer) { if (map.hasLayer(e.layer)) map.removeLayer(e.layer); e.layer = null; }
      e.pin = null;
    }

    function inView(o, b) {
      if (!o.bbox) return true;
      var padX = (b.getEast() - b.getWest()) * 0.3, padY = (b.getNorth() - b.getSouth()) * 0.3;
      return !(o.bbox[2] < b.getWest() - padX || o.bbox[0] > b.getEast() + padX || o.bbox[3] < b.getSouth() - padY || o.bbox[1] > b.getNorth() + padY);
    }

    function refreshDesigns() {
      var z = map.getZoom(), b = map.getBounds();
      st.objects.forEach(function (o) {
        var e = st.entries[o.id]; if (!e) return;
        var want = enabled(o) && o.design && z >= MIN_DESIGN_ZOOM && inView(o, b);
        if (!want) { if (e.layer && map.hasLayer(e.layer)) map.removeLayer(e.layer); return; }
        if (e.layer) { if (!map.hasLayer(e.layer)) { e.layer.addTo(map); toBack(e.layer); } return; }
        if (e.loading) return;
        loadDesign(o, e);
      });
    }
    function toBack(layer) { if (layer && layer.bringToBack) layer.bringToBack(); }

    async function loadDesign(o, e) {
      e.loading = true;
      try {
        if (!e.fc) {
          var r = await d.api("/data/infra/" + encodeURIComponent(o.id) + "/design.geojson?v=" + encodeURIComponent(o.updatedAt || ""), 30000);
          if (!r.ok) throw new Error("HTTP " + r.status);
          e.fc = await r.json();
        }
        if (st.entries[o.id] !== e) return;     // objek sudah dihapus / dibangun ulang saat menunggu
        e.layer = L.geoJSON(e.fc, {
          style: function (f) { return STYLE[styleKey(f.properties)] || STYLE.lainnya; },
          pointToLayer: function (f, ll) { return L.circleMarker(ll, Object.assign({ radius: 5 }, STYLE[styleKey(f.properties)] || STYLE.lainnya)); },
          onEachFeature: function (f, layer) {
            layer.on("click", function (ev) { if (!busy()) openPopup(o, ev && ev.latlng); });
          }
        });
        refreshDesigns();
      } catch (err) {
        console.warn("Desain infra " + o.id + " gagal dimuat:", err.message);
      }
      e.loading = false;
    }

    /* ---------- popup ---------- */
    function openPopup(o, latlng) {
      var p = L.popup({ maxWidth: 320, minWidth: 250, className: "ow-infra-popup", autoPanPaddingTopLeft: [10, 70], autoPanPaddingBottomRight: [10, 70] });
      p._owInfra = o.id;
      p.setLatLng(latlng || o.center).setContent(buildPopupHtml(o)).openOn(map);
    }

    function photoUrl(o, file) {
      var key = o.id + "/" + file;
      if (photoCache.has(key)) { var v = photoCache.get(key); photoCache.delete(key); photoCache.set(key, v); return v; }
      var pr = d.api("/data/infra/" + encodeURIComponent(o.id) + "/" + encodeURIComponent(file), 40000).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.blob();
      }).then(function (b) { return URL.createObjectURL(b); });
      pr.catch(function () { photoCache.delete(key); });
      photoCache.set(key, pr);
      while (photoCache.size > PHOTO_CACHE_MAX) {
        var oldKey = photoCache.keys().next().value, old = photoCache.get(oldKey);
        photoCache.delete(oldKey);
        old.then(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} }, function () {});
      }
      return pr;
    }

    function bindPopup(popup) {
      var o = find(popup._owInfra); if (!o) return;
      var el = popup.getElement && popup.getElement(); if (!el) return;
      var photos = o.photos || [], idx = 0;
      var img = el.querySelector(".ow-ip-img"), cap = el.querySelector("[data-cap]");
      function show(i) {
        if (!img) return;
        idx = (i + photos.length) % photos.length;
        var p = photos[idx];
        cap.textContent = (fmtDate(p.date) || "Tanggal tidak diisi") + (photos.length > 1 ? "  ·  " + (idx + 1) + "/" + photos.length : "");
        img.classList.add("ow-ip-loading"); img.removeAttribute("src");
        var my = idx;
        photoUrl(o, p.file).then(function (u) {
          if (my !== idx) return;
          img.onload = function () { img.classList.remove("ow-ip-loading"); if (popup.update) popup.update(); };
          img.src = u; img.dataset.url = u;
        }).catch(function () { if (my === idx) { img.classList.remove("ow-ip-loading"); cap.textContent = "Foto gagal dimuat (offline?)"; } });
      }
      el.addEventListener("click", function (ev) {
        var a = ev.target.closest && ev.target.closest("[data-act]"); if (!a) return;
        var act = a.getAttribute("data-act");
        if (act === "prev") show(idx - 1);
        else if (act === "next") show(idx + 1);
        else if (act === "zoom" && img && img.dataset.url) openViewer(img.dataset.url, cap.textContent, o.name);
      });
      if (photos.length) show(0);
    }

    function openViewer(url, caption, name) {
      closeViewer();
      var v = doc.createElement("div");
      v.id = "owInfraViewer";
      v.innerHTML = '<div class="ow-iv-bar"><span></span><button type="button" aria-label="Tutup" data-close>✕</button></div><div class="ow-iv-scroll"><img alt=""></div><div class="ow-iv-tip">Ketuk foto untuk zoom</div>';
      v.querySelector(".ow-iv-bar span").textContent = (name || "") + "  ·  " + (caption || "");
      var im = v.querySelector("img"); im.src = url;
      im.addEventListener("click", function () { v.classList.toggle("zoomed"); });
      v.querySelector("[data-close]").addEventListener("click", closeViewer);
      doc.body.appendChild(v);
    }
    function closeViewer() { var v = doc.getElementById("owInfraViewer"); if (v) v.remove(); }

    /* ---------- kontrol UI ---------- */
    function ensureUi() {
      if (ui.root) return;
      var r = doc.createElement("div");
      r.id = "infraCtl";
      r.innerHTML =
        '<div class="ow-ic-row">' +
        '<button type="button" id="btnToggleInfra" title="Tampilkan / sembunyikan infrastruktur (CSA, waterfill, pitstop, buspad)"></button>' +
        '<button type="button" id="btnInfraFilter" title="Pilih jenis infrastruktur" aria-label="Pilih jenis">▾</button></div>' +
        '<div id="infraPanel" class="hidden"><div id="infraTypes"></div><div class="ow-ic-foot"><span id="infraStatus"></span><button type="button" id="btnInfraReload">Muat ulang</button></div></div>';
      doc.body.appendChild(r);
      ui.root = r;
      r.querySelector("#btnToggleInfra").addEventListener("click", function () { setOn(!st.on); });
      r.querySelector("#btnInfraFilter").addEventListener("click", function () { st.panelOpen = !st.panelOpen; renderUi(); });
      r.querySelector("#btnInfraReload").addEventListener("click", function () { load(); });
      r.querySelector("#infraTypes").addEventListener("change", function (ev) {
        var k = ev.target && ev.target.getAttribute("data-type"); if (!k) return;
        st.types[k] = !!ev.target.checked; saveState(); render();
      });
    }
    function renderUi() {
      ensureUi();
      var b = ui.root.querySelector("#btnToggleInfra");
      b.innerHTML = "🏗️ Infra: <b>" + (st.on ? "ON" : "OFF") + "</b>";
      b.classList.toggle("off", !st.on);
      ui.root.querySelector("#infraPanel").classList.toggle("hidden", !st.panelOpen);
      var counts = {}; st.objects.forEach(function (o) { counts[o.type] = (counts[o.type] || 0) + 1; });
      ui.root.querySelector("#infraTypes").innerHTML = Object.keys(TYPES).map(function (k) {
        var n = counts[k] || 0;
        return '<label class="' + (n ? "" : "dim") + '"><input type="checkbox" data-type="' + k + '"' + (st.types[k] ? " checked" : "") + (n ? "" : " disabled") + "> " +
          TYPES[k].icon + " " + esc(TYPES[k].label) + " <small>(" + n + ")</small></label>";
      }).join("");
      ui.root.querySelector("#infraStatus").textContent = st.loading ? "Memuat..." : st.error ? "Gagal: " + st.error : st.objects.length + " objek";
    }

    function setOn(on) {
      st.on = !!on; saveState();
      if (st.on && !st.loaded && !st.loading) load(); else render();
    }
    function setType(k, on) { if (k in TYPES) { st.types[k] = !!on; saveState(); render(); } }

    function init() {
      restoreState();
      ensureUi(); renderUi();
      map.on("moveend", refreshDesigns);
      map.on("zoomend", function () {
        var c = map.getContainer && map.getContainer();
        if (c && c.classList) c.classList.toggle("ow-infra-nolabel", map.getZoom() < 15);
      });
      map.on("popupopen", function (e) { if (e.popup && e.popup._owInfra) bindPopup(e.popup); });
      if (d.onAuth) d.onAuth(function () { if (st.on && !st.loaded) load(); });
      if (st.on) load();
    }

    return { init: init, load: load, setOn: setOn, setType: setType, state: function () { return st; }, closeViewer: closeViewer, _refresh: refreshDesigns };
  }

  // ---- pasang otomatis di halaman peta ----
  if (typeof document !== "undefined" && typeof module === "undefined") {
    var boot = function () {
      if (typeof map === "undefined" || typeof L === "undefined" || typeof owApi !== "function" || !(root.OVERWATCH_CONFIG || {}).DATA_API) return;
      var storage = (function () { try { return root.localStorage; } catch (e) { return { getItem: function () { return null; }, setItem: function () {} }; } })();
      root.OwInfra = createManager({
        L: L, map: map, doc: document, storage: storage,
        api: function (path, ms) { return owApi(path, ms); },
        toast: function (t) { if (typeof showToastNotification === "function") showToastNotification(t); },
        isBusy: function () {
          return document.body.classList.contains("ow-drawing") || !!root.owMapPicking ||
            (typeof isWorkOrderModeActive !== "undefined" && isWorkOrderModeActive) || (typeof activeWoTool !== "undefined" && !!activeWoTool);
        },
        onAuth: function (cb) { try { _supabase.auth.onAuthStateChange(function (ev, s) { if (s) cb(); }); } catch (e) {} }
      });
      root.OwInfra.init();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  }

  return { createManager: createManager, buildPopupHtml: buildPopupHtml, fmtDate: fmtDate, esc: esc, TYPES: TYPES, STYLE: STYLE, MIN_DESIGN_ZOOM: MIN_DESIGN_ZOOM, KEY: KEY };
});
