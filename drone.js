/* Overwatch - DRONE VIEW 3D: ortho drone ditempel ke DEM seluruh tambang (MapLibre GL, dimuat hanya saat dibuka).
 * Dimuat SETELAH app.js, infra.js, compare.js. Memakai: map (Leaflet, untuk sinkron posisi), releaseIndex,
 * activeReleaseId, owApi/owAuthHeaders, PMTILES_URL (ortho), window.pmtiles.
 *
 * Data:
 *  - Ortho  : PMTiles yang sama dengan peta 2D (server ortho-tiles, publik). Di atas zoom asli tile diperbesar
 *             (buram), TIDAK muncul "no data".
 *  - DEM    : terrain.pmtiles milik rilis (Terrarium PNG, dibuat Overwatch_Terrain_Tiles.py), dibaca dengan
 *             HTTP Range + token lewat Worker.
 *  - Overlay (opsional, default mati): Grade (isi), Lebar (garis), Crossfall (titik), Bundwall crest/toe (garis).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.OwDroneLib = factory(root);
})(typeof window !== "undefined" ? window : this, function (root) {
  "use strict";

  var ML_VER = "4.7.1";
  var ML_JS = "https://unpkg.com/maplibre-gl@" + ML_VER + "/dist/maplibre-gl.js";
  var ML_CSS = "https://unpkg.com/maplibre-gl@" + ML_VER + "/dist/maplibre-gl.css";
  var PROTO = "owtile";
  var TERRAIN_FILE = "terrain.pmtiles";
  var GRADE_FILE = "Road_Grade_Polygons.geojson";
  var ORTHO_MAX_ZOOM = 19;                       // sama dengan peta 2D (di atasnya diperbesar, buram)
  var MAX_FULL_BODY = 32 * 1048576;              // server tanpa dukungan Range tidak boleh menarik file DEM utuh
  var BUND_KEYS = { crest: 1, toe: 1, bundwall: 1 };
  var BUND_COLOR = { crest: "#facc15", toe: "#fb923c", bundwall: "#fbbf24" };   // sama dengan infra.js STYLE
  var EMPTY = { type: "FeatureCollection", features: [] };
  var OVERLAYS = [
    { k: "grade", label: "Grade", hint: "isi warna" },
    { k: "lebar", label: "Lebar jalan", hint: "garis tepi" },
    { k: "crossfall", label: "Crossfall", hint: "titik" },
    { k: "bundwall", label: "Bundwall", hint: "crest / toe" }
  ];
  var LAYER_OF = { grade: "ow-grade", lebar: "ow-lebar", crossfall: "ow-cf", bundwall: "ow-bund" };
  var LEGEND = {
    grade: [["#22c55e", "Aman"], ["#eab308", "Warning"], ["#e11d48", "Overgrade"]],
    lebar: [["#22c55e", "Sesuai standar"], ["#e11d48", "Kurang dari standar"]],
    crossfall: [["#22c55e", "2 sisi normal"], ["#eab308", "1 sisi"], ["#e11d48", "Di luar"]],
    bundwall: [["#facc15", "Crest"], ["#fb923c", "Toe"]]
  };

  function esc(s) {
    return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function httpErr(status, msg) { var e = new Error(msg); e.status = status; return e; }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? null : n; }
  function f1(x) { return x === null ? "-" : x.toFixed(1).replace(".", ","); }

  /* ---------- pilih rilis yang punya DEM ---------- */
  function terrainReleases(index) {
    return ((index && index.releases) || []).filter(function (r) { return r && r.id && (r.files || []).indexOf(TERRAIN_FILE) >= 0; });
  }
  // Prioritas: pilihan pengguna -> rilis aktif -> rilis terbaru yang punya DEM. null = belum ada DEM sama sekali.
  function pickTerrainRelease(index, activeId, wantId) {
    var list = terrainReleases(index);
    if (!list.length) return null;
    var hit = wantId && list.find(function (r) { return r.id === wantId; });
    var pick = hit || list.find(function (r) { return r.id === activeId; }) || list[0];
    return {
      id: pick.id, label: pick.label || pick.id, fallback: !!activeId && pick.id !== activeId,
      options: list.map(function (r) { return { id: r.id, label: r.label || r.id }; })
    };
  }

  /* ---------- sumber byte PMTiles dengan token + Range ---------- */
  function AuthSource(url, headersFn, fetchFn) {
    this.url = url; this.headersFn = headersFn;
    this.fetchFn = fetchFn || function () { return root.fetch.apply(root, arguments); };
  }
  AuthSource.prototype.getKey = function () { return this.url; };
  AuthSource.prototype.getBytes = async function (offset, length, signal) {
    var base = (await this.headersFn()) || {}, headers = {};
    Object.keys(base).forEach(function (k) { headers[k] = base[k]; });
    headers.Range = "bytes=" + offset + "-" + (offset + length - 1);
    var resp = await this.fetchFn(this.url, { headers: headers, signal: signal });
    if (resp.status === 401 || resp.status === 403) throw httpErr(resp.status, "Tidak berwenang membaca DEM (login ulang)");
    if (resp.status === 404) throw httpErr(404, "File DEM tidak ada di server");
    if (resp.status >= 300) throw httpErr(resp.status, "HTTP " + resp.status);
    var etag = resp.headers.get("ETag") || undefined;
    if (resp.status === 200) {            // server mengabaikan Range: terima hanya kalau file kecil
      var cl = parseInt(resp.headers.get("Content-Length") || "0", 10);
      if (cl > MAX_FULL_BODY) throw httpErr(0, "Server tidak mendukung Range untuk file DEM besar");
      return { data: (await resp.arrayBuffer()).slice(offset, offset + length), etag: etag };
    }
    return { data: await resp.arrayBuffer(), etag: etag, cacheControl: resp.headers.get("Cache-Control") || undefined, expires: resp.headers.get("Expires") || undefined };
  };

  /* ---------- protokol tile owtile://<sumber>/{z}/{x}/{y} ---------- */
  function parseTileUrl(url) {
    var m = /^owtile:\/\/([a-z0-9_-]+)\/(\d+)\/(\d+)\/(\d+)(?:[?#].*)?$/i.exec(String(url || ""));
    return m ? { key: m[1], z: +m[2], x: +m[3], y: +m[4] } : null;
  }
  // Mendukung MapLibre 4 (promise + AbortController) dan 3 (callback).
  function makeProtocolHandler(getReg) {
    async function load(params, signal) {
      var t = parseTileUrl(params && params.url);
      if (!t) throw httpErr(400, "URL tile tidak valid");
      var pm = (getReg() || {})[t.key];
      if (!pm) throw httpErr(404, "Sumber tile tidak ada");
      var r = await pm.getZxy(t.z, t.x, t.y, signal);
      if (!r || !r.data) throw httpErr(404, "Tile tidak ada");     // 404 = MapLibre diam-diam memakai tile induk
      return { data: r.data, cacheControl: r.cacheControl, expires: r.expires };
    }
    return function (params, arg2) {
      var isCtl = typeof AbortController !== "undefined" && arg2 instanceof AbortController;
      var p = load(params, isCtl ? arg2.signal : undefined);
      if (typeof arg2 === "function") {
        p.then(function (r) { arg2(null, r.data, r.cacheControl, r.expires); }, function (e) { arg2(e); });
        return { cancel: function () {} };
      }
      return p;
    };
  }

  /* ---------- kamera & gaya ---------- */
  function paddedBounds(b, frac) {
    var dx = (b[2] - b[0]) * frac, dy = (b[3] - b[1]) * frac;
    return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy];
  }
  // Mulai dari tempat pengguna sedang melihat di peta 2D (kalau masih di dalam cakupan DEM), kalau tidak: seluruh area.
  function initialView(ll, b, minZ, maxZ) {
    var inside = ll && isFinite(ll.lat) && isFinite(ll.lng) && ll.lng >= b[0] && ll.lng <= b[2] && ll.lat >= b[1] && ll.lat <= b[3];
    if (!inside) return { fit: true, pitch: 55, bearing: 0 };
    var z = (isFinite(ll.zoom) ? ll.zoom : 16) - 1;                 // zoom Leaflet (tile 256) -> MapLibre (tile 512)
    return { fit: false, center: [ll.lng, ll.lat], zoom: Math.max(minZ, Math.min(maxZ, z)), pitch: 55, bearing: 0 };
  }

  function buildStyle(o) {
    var tiles = function (k) { return [PROTO + "://" + k + "/{z}/{x}/{y}"]; };
    var style = {
      version: 8, name: "Overwatch Drone View",
      sources: {
        dem: { type: "raster-dem", tiles: tiles("dem"), tileSize: 256, minzoom: o.demMin, maxzoom: o.demMax, encoding: "terrarium", bounds: o.demBounds },
        "ow-blocks": { type: "geojson", data: EMPTY },
        "ow-blocks-pt": { type: "geojson", data: EMPTY },
        "ow-bund": { type: "geojson", data: EMPTY }
      },
      layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b1220" } }]
    };
    if (o.ortho) {
      style.sources.ortho = { type: "raster", tiles: tiles("ortho"), tileSize: 256, minzoom: o.ortho.min, maxzoom: o.ortho.max, bounds: o.ortho.bounds, attribution: "Drone Orthophoto" };
      style.layers.push({ id: "ortho", type: "raster", source: "ortho", paint: { "raster-resampling": "linear", "raster-fade-duration": 150 } });
    } else {                             // ortho tak terbaca: tetap ada gambaran medan (bayangan lereng)
      style.sources.hs = { type: "raster-dem", tiles: tiles("dem"), tileSize: 256, minzoom: o.demMin, maxzoom: o.demMax, encoding: "terrarium", bounds: o.demBounds };
      style.layers.push({ id: "hillshade", type: "hillshade", source: "hs", paint: { "hillshade-exaggeration": 0.7, "hillshade-shadow-color": "#020617", "hillshade-highlight-color": "#e2e8f0" } });
    }
    var hide = { visibility: "none" };
    style.layers.push(
      { id: "ow-grade", type: "fill", source: "ow-blocks", layout: hide, paint: { "fill-color": ["get", "_cg"], "fill-opacity": 0.62 } },
      { id: "ow-lebar", type: "line", source: "ow-blocks", layout: { visibility: "none", "line-join": "round" }, paint: { "line-color": ["get", "_cl"], "line-width": 3, "line-opacity": 0.95 } },
      { id: "ow-bund", type: "line", source: "ow-bund", layout: { visibility: "none", "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "_c"], "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 19, 4] } },
      { id: "ow-cf", type: "circle", source: "ow-blocks-pt", layout: hide, paint: { "circle-color": ["get", "_cc"], "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2, 18, 6], "circle-stroke-width": 1, "circle-stroke-color": "#0f172a" } }
    );
    style.terrain = { source: "dem", exaggeration: o.exag || 1 };
    return style;
  }

  /* ---------- data overlay ---------- */
  function nameKey(p) { return String((p && (p.Nama_Jalan || p["Nama Jalan"])) || "").trim().toLowerCase(); }
  function ringCentroid(g) {
    var c = !g ? null : g.type === "Polygon" ? g.coordinates[0] : g.type === "MultiPolygon" ? g.coordinates[0][0] : null;
    if (!c || !c.length) return null;
    var n = c.length; if (n > 1 && c[0][0] === c[n - 1][0] && c[0][1] === c[n - 1][1]) n--;
    var sx = 0, sy = 0; for (var i = 0; i < n; i++) { sx += c[i][0]; sy += c[i][1]; }
    return [sx / n, sy / n];
  }
  // colorFn(param, props, standarLebar) -> "#rrggbb"; stdOf(namaKecil) -> lebar standar
  function decorateBlocks(fc, colorFn, stdOf) {
    var polys = [], pts = [];
    ((fc && fc.features) || []).forEach(function (f) {
      var g = f && f.geometry; if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return;
      var p = f.properties || {}, std = stdOf ? stdOf(nameKey(p)) : 30.8, q = {};
      Object.keys(p).forEach(function (k) { q[k] = p[k]; });
      q._cg = colorFn("grade", p, std); q._cl = colorFn("lebar", p, std); q._cc = colorFn("crossfall", p, std);
      polys.push({ type: "Feature", geometry: g, properties: q });
      var c = ringCentroid(g);
      if (c) pts.push({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: q });
    });
    return { polys: { type: "FeatureCollection", features: polys }, points: { type: "FeatureCollection", features: pts } };
  }

  // Ambil semua garis crest/toe/bundwall dari desain infrastruktur. fetchDesign(obj) -> Promise<FeatureCollection>.
  async function collectBundwall(objects, fetchDesign, infraKey) {
    var out = [], failed = 0, list = (objects || []).filter(function (o) { return o && o.design; }), i = 0;
    async function worker() {
      while (i < list.length) {
        var o = list[i++];
        try {
          var fc = await fetchDesign(o);
          ((fc && fc.features) || []).forEach(function (f) {
            var k = infraKey(f.properties || {});
            if (!BUND_KEYS[k] || !f.geometry) return;
            out.push({ type: "Feature", geometry: f.geometry, properties: { _k: k, _c: BUND_COLOR[k], _n: o.name || o.id } });
          });
        } catch (e) { failed++; }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    return { fc: { type: "FeatureCollection", features: out }, failed: failed, objects: list.length };
  }

  function blockInfoHtml(p) {
    p = p || {};
    var g = num(p.Grade_Pct !== undefined ? p.Grade_Pct : (p["Grade Longitudinal (%)"] !== undefined ? p["Grade Longitudinal (%)"] : p.Grade));
    var w = num(p.Lebar_m), a = num(p.Crossfall_), b = num(p.Crossfall1);
    var sta = p.STA_Akhir || p.Station_m || "", st = p.Status_Gra || p["Status Grade"] || p.Status || "";
    return '<div class="ow-dr-pop"><b>' + esc(String(p.Nama_Jalan || "(tanpa nama)").trim()) + "</b>" + (sta !== "" ? " · STA " + esc(sta) : "") +
      "<br>Grade: <b>" + (g === null ? "-" : f1(Math.abs(g)) + "%") + "</b>" + (st ? " (" + esc(st) + ")" : "") +
      "<br>Lebar: <b>" + (w === null ? "-" : f1(w) + " m") + "</b>" +
      "<br>Crossfall K/R: <b>" + f1(a) + " / " + f1(b) + "</b></div>";
  }
  function bundInfoHtml(p) {
    p = p || {};
    return '<div class="ow-dr-pop"><b>' + (p._k === "toe" ? "Toe" : p._k === "crest" ? "Crest" : "Bundwall") + "</b><br>" + esc(p._n || "") + "</div>";
  }

  /* =====================================================================================================
   *  PENGENDALI: tombol, panel, siklus hidup peta 3D.   d = dependensi (diisi boot / tes)
   * ===================================================================================================== */
  function createDrone(d) {
    var doc = d.doc, S = null, seq = 0, protocolAdded = false, reg = {}, blocksCache = new Map(), bundCache = new Map();

    function toast(t) { if (d.toast) d.toast(t); }
    function api() { return d.api.apply(null, arguments); }

    function demUrl(id) { return d.apiBase + "/data/releases/" + encodeURIComponent(id) + "/" + TERRAIN_FILE; }

    /* ---------- buka / tutup ---------- */
    async function open() {
      if (S) return true;
      var why = d.blocked ? d.blocked() : ""; if (why) { toast(why); return false; }
      if (!d.apiBase) { toast("Drone View butuh server data (DATA_API di config.js belum diisi)."); return false; }
      if (d.isOnline && !d.isOnline()) { toast("Drone View butuh internet (mesin 3D & tile diunduh saat dibuka)."); return false; }
      var g = d.getState(), pick = pickTerrainRelease(g.releaseIndex, g.activeReleaseId, null);
      if (!pick) { toast("Belum ada DEM untuk 3D. Admin perlu upload terrain.pmtiles di halaman upload."); return false; }
      S = { id: ++seq, rel: pick, ov: { grade: false, lebar: false, crossfall: false, bundwall: false }, exag: 1, panel: false, ml: null, popup: null, msg: "", err: false, ready: false };
      var my = S;
      buildUi();
      doc.body.classList.add("ow-drone-on");
      S.onKey = function (e) { if (e.key === "Escape") close(); };
      doc.addEventListener("keydown", S.onKey);
      start(my, null);
      return true;
    }

    async function start(my, camera) {
      try {
        showMsg(my, "Memuat mesin 3D…");
        var ml = await d.ensureMapLibre();
        if (S !== my) return;
        var pmt = d.getPmtiles();
        if (!pmt) throw new Error("Pustaka PMTiles belum termuat");
        showMsg(my, "Membaca DEM " + my.rel.label + "…");
        var demPm = new pmt.PMTiles(new AuthSource(demUrl(my.rel.id), d.headers, d.fetch));
        var dh = await demPm.getHeader();
        if (S !== my) return;
        if (dh.tileType !== 2 && dh.tileType !== 4) throw new Error("Tile DEM bukan PNG/WebP lossless");
        var orthoInfo = null, orthoPm = null;
        try {
          orthoPm = new pmt.PMTiles(d.orthoUrl);
          var oh = await orthoPm.getHeader();
          orthoInfo = { min: oh.minZoom || 0, max: Math.min(oh.maxZoom || ORTHO_MAX_ZOOM, ORTHO_MAX_ZOOM), bounds: [oh.minLon, oh.minLat, oh.maxLon, oh.maxLat] };
          if (!orthoInfo.bounds.every(isFinite)) orthoInfo.bounds = undefined;
        } catch (e) { orthoPm = null; orthoInfo = null; toast("Ortho tidak terbaca, 3D tampil sebagai medan saja."); }
        if (S !== my) return;
        reg = { dem: demPm, ortho: orthoPm };
        if (!protocolAdded) { ml.addProtocol(PROTO, makeProtocolHandler(function () { return reg; })); protocolAdded = true; }

        var bounds = [dh.minLon, dh.minLat, dh.maxLon, dh.maxLat];
        my.bounds = bounds;
        var style = buildStyle({ demMin: dh.minZoom, demMax: dh.maxZoom, demBounds: bounds, ortho: orthoInfo, exag: my.exag });
        var view = camera ? { fit: false, center: camera.center, zoom: camera.zoom, pitch: camera.pitch, bearing: camera.bearing } :
          initialView(d.getLeafletView ? d.getLeafletView() : null, bounds, Math.max(dh.minZoom - 1, 8), 20);
        var opts = { container: my.mapEl, style: style, pitch: view.pitch, bearing: view.bearing, maxPitch: 82, maxBounds: paddedBounds(bounds, 0.08), antialias: true, attributionControl: false, fadeDuration: 150 };
        if (!view.fit) { opts.center = view.center; opts.zoom = view.zoom; }
        var map3 = new ml.Map(opts);
        my.ml = map3; my.mlns = ml;
        map3.addControl(new ml.AttributionControl({ compact: true }), "bottom-right");
        map3.addControl(new ml.NavigationControl({ visualizePitch: true }), "bottom-right");
        if (view.fit) map3.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { pitch: view.pitch, bearing: 0, padding: 24, duration: 0 });
        map3.on("error", function (ev) { onMlError(my, ev); });
        map3.on("click", function (ev) { onClick(my, ev); });
        map3.on("moveend", function () { updateElev(my); });
        map3.once("load", function () {
          if (S !== my) return;
          my.ready = true; showMsg(my, "");
          renderPanel();
          Object.keys(my.ov).forEach(function (k) { if (my.ov[k]) applyOverlay(my, k); });
          updateElev(my);
        });
        my.demInfo = dh;
        renderPanel();
      } catch (e) {
        if (S === my) fail(my, e);
      }
    }

    function fail(my, e) {
      var m = (e && e.message) || String(e);
      if (/Failed to fetch|NetworkError|Load failed/i.test(m)) m = "Tidak ada koneksi ke server (" + m + ")";
      my.err = true; showMsg(my, "Drone View gagal: " + m, true);
    }

    function close() {
      var my = S; if (!my) return;
      var cam = null;
      try { if (my.ml) cam = { c: my.ml.getCenter(), z: my.ml.getZoom() }; } catch (e) {}
      S = null;
      try { if (my.popup) my.popup.remove(); } catch (e) {}
      try { if (my.ml) my.ml.remove(); } catch (e) {}
      doc.removeEventListener("keydown", my.onKey);
      if (my.ui && my.ui.parentNode) my.ui.parentNode.removeChild(my.ui);
      doc.body.classList.remove("ow-drone-on");
      reg = {};
      if (d.restoreLeaflet) d.restoreLeaflet(cam ? { lat: cam.c.lat, lng: cam.c.lng, zoom: cam.z + 1 } : null);
    }

    function restart(newRel) {
      var my = S; if (!my) return;
      var cam = null;
      try { cam = { center: my.ml.getCenter().toArray ? my.ml.getCenter().toArray() : [my.ml.getCenter().lng, my.ml.getCenter().lat], zoom: my.ml.getZoom(), pitch: my.ml.getPitch(), bearing: my.ml.getBearing() }; } catch (e) {}
      try { if (my.popup) my.popup.remove(); } catch (e) {}
      try { if (my.ml) my.ml.remove(); } catch (e) {}
      my.ml = null; my.ready = false; my.rel = newRel; my.err = false; my.blocksSet = my.bundSet = null;
      my.mapEl.innerHTML = "";
      renderPanel();
      start(my, cam);
    }

    /* ---------- overlay ---------- */
    async function blocksFor(id) {
      if (blocksCache.has(id)) return blocksCache.get(id);
      var p = api("/data/releases/" + encodeURIComponent(id) + "/" + GRADE_FILE, 60000).then(function (r) {
        if (!r.ok) throw new Error("Data jalan rilis gagal dimuat (HTTP " + r.status + ")"); return r.json();
      }).then(function (fc) {
        if (d.normalize) fc = d.normalize(fc);
        var st = d.getState().stdMap || {};
        return decorateBlocks(fc, d.colorFn, function (k) { return st[k] || 30.8; });
      });
      p.catch(function () { blocksCache.delete(id); });
      blocksCache.set(id, p);
      return p;
    }
    async function bundwall() {
      var objs = await d.getInfraObjects();
      var key = (objs || []).map(function (o) { return o.id + "@" + (o.updatedAt || ""); }).join("|");
      if (bundCache.has(key)) return bundCache.get(key);
      var p = collectBundwall(objs, function (o) {
        return api("/data/infra/" + encodeURIComponent(o.id) + "/design.geojson?v=" + encodeURIComponent(o.updatedAt || ""), 30000).then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status); return r.json();
        });
      }, d.infraKey);
      p.catch(function () { bundCache.delete(key); });
      bundCache.set(key, p);
      return p;
    }

    async function applyOverlay(my, k) {
      if (S !== my || !my.ml || !my.ready) return;
      var on = my.ov[k], layer = LAYER_OF[k];
      try {
        if (on) {
          if (k === "bundwall") {
            my.bundLoading = true; renderPanel();
            var b = await bundwall();
            my.bundLoading = false;
            if (S !== my || !my.ml) return;
            if (my.bundSet !== b) { my.ml.getSource("ow-bund").setData(b.fc); my.bundSet = b; }
            my.bundInfo = b.objects ? (b.fc.features.length ? "" : "Belum ada garis crest/toe di desain infrastruktur.") : "Belum ada infrastruktur dengan desain.";
            if (b.failed) toast("Sebagian desain infra gagal dimuat (" + b.failed + ").");
          } else {
            my.blkLoading = true; renderPanel();
            var rel = my.rel.id, data = await blocksFor(rel);
            my.blkLoading = false;
            if (S !== my || !my.ml || my.rel.id !== rel) return;
            if (my.blocksSet !== data) {               // sekali per peta & rilis, walau 3 lapisan dinyalakan bergantian
              my.ml.getSource("ow-blocks").setData(data.polys);
              my.ml.getSource("ow-blocks-pt").setData(data.points);
              my.blocksSet = data;
            }
          }
        }
        if (S === my && my.ml) my.ml.setLayoutProperty(layer, "visibility", on ? "visible" : "none");
      } catch (e) {
        my.bundLoading = my.blkLoading = false;
        my.ov[k] = false;
        toast("Overlay " + k + " gagal dimuat: " + ((e && e.message) || e));
        if (S === my && my.ml) { try { my.ml.setLayoutProperty(layer, "visibility", "none"); } catch (e2) {} }
      }
      renderPanel();
    }

    function visibleLayers(my) {
      var out = [];
      Object.keys(my.ov).forEach(function (k) { if (my.ov[k]) out.push(LAYER_OF[k]); });
      return out;
    }
    function onClick(my, ev) {
      if (S !== my || !my.ml) return;
      var layers = visibleLayers(my); if (!layers.length) return;
      var fs = my.ml.queryRenderedFeatures(ev.point, { layers: layers }) || [];
      if (!fs.length) return;
      var f = fs[0], html = f.layer && f.layer.id === "ow-bund" ? bundInfoHtml(f.properties) : blockInfoHtml(f.properties);
      try { if (my.popup) my.popup.remove(); } catch (e) {}
      my.popup = new my.mlns.Popup({ closeButton: true, maxWidth: "240px" }).setLngLat(ev.lngLat).setHTML(html).addTo(my.ml);
    }
    function updateElev(my) {
      if (S !== my || !my.ml || !my.elevEl) return;
      var h = null;
      try { if (my.ml.queryTerrainElevation) h = my.ml.queryTerrainElevation(my.ml.getCenter()); } catch (e) {}
      my.elevEl.textContent = (typeof h === "number" && isFinite(h)) ? "Elevasi titik tengah: " + f1(h) + " m" : "";
    }
    var lastErrAt = 0;
    function onMlError(my, ev) {
      if (S !== my) return;
      var e = ev && ev.error, st = e && e.status;
      if (st === 404) return;                                     // tile di luar cakupan: normal
      var now = Date.now(); if (now - lastErrAt < 8000) return; lastErrAt = now;
      if (st === 401 || st === 403) showMsg(my, "Sesi habis / tidak berwenang membaca DEM. Login ulang lalu buka lagi.", true);
      else toast("Sebagian tile 3D gagal dimuat: " + ((e && e.message) || "jaringan"));
    }

    /* ---------- UI ---------- */
    function buildUi() {
      var my = S;
      my.ui = doc.createElement("div"); my.ui.id = "owDrone";
      my.ui.innerHTML =
        '<div class="ow-dr-map"></div>' +
        '<div class="ow-dr-top"><div class="ow-dr-title"><b>Drone View 3D</b><small class="ow-dr-sub"></small></div>' +
        '<button type="button" class="ow-dr-x" data-act="close" aria-label="Tutup Drone View">✕</button></div>' +
        '<button type="button" class="ow-dr-fab" data-act="panel" aria-expanded="false">☰ Layer</button>' +
        '<div class="ow-dr-panel hidden"></div>' +
        '<div class="ow-dr-elev"></div>' +
        '<div class="ow-dr-msg hidden"></div>';
      doc.body.appendChild(my.ui);
      my.mapEl = my.ui.querySelector(".ow-dr-map");
      my.elevEl = my.ui.querySelector(".ow-dr-elev");
      my.ui.addEventListener("click", onClickUi);
      my.ui.addEventListener("input", onInputUi);
      my.ui.addEventListener("change", onChangeUi);
      renderPanel();
    }
    function showMsg(my, text, withClose) {
      if (S !== my || !my.ui) return;
      var el = my.ui.querySelector(".ow-dr-msg");
      if (!text) { el.classList.add("hidden"); el.textContent = ""; return; }
      el.classList.remove("hidden");
      el.innerHTML = esc(text) + (withClose ? ' <button type="button" data-act="close">Tutup</button>' : "");
    }
    function renderPanel() {
      var my = S; if (!my || !my.ui) return;
      my.ui.querySelector(".ow-dr-sub").textContent = "DEM " + my.rel.label + (my.rel.fallback ? " (rilis aktif belum punya DEM)" : "") + " · ortho terbaru";
      var fab = my.ui.querySelector(".ow-dr-fab"); fab.setAttribute("aria-expanded", my.panel ? "true" : "false");
      var p = my.ui.querySelector(".ow-dr-panel"); p.classList.toggle("hidden", !my.panel);
      if (!my.panel) return;
      var h = '<div class="ow-dr-sec">Lapisan</div>';
      OVERLAYS.forEach(function (o) {
        h += '<label class="ow-dr-chk"><input type="checkbox" data-ov="' + o.k + '"' + (my.ov[o.k] ? " checked" : "") + (my.ready ? "" : " disabled") + "><span>" + esc(o.label) + "</span><i>" + esc(o.hint) + "</i></label>";
      });
      if (my.blkLoading || my.bundLoading) h += '<div class="ow-dr-note">Memuat data…</div>';
      if (my.ov.bundwall && my.bundInfo) h += '<div class="ow-dr-note">' + esc(my.bundInfo) + "</div>";
      var leg = "";
      Object.keys(LEGEND).forEach(function (k) {
        if (!my.ov[k]) return;
        leg += '<div class="ow-dr-leg-row"><b>' + esc((OVERLAYS.find(function (o) { return o.k === k; }) || {}).label) + "</b>" +
          LEGEND[k].map(function (c) { return '<span><u style="background:' + c[0] + '"></u>' + esc(c[1]) + "</span>"; }).join("") + "</div>";
      });
      h += leg;
      h += '<div class="ow-dr-sec">Tinggi vertikal <b id="owDrExV">' + f1(my.exag) + "×</b></div>" +
        '<input type="range" id="owDrExag" min="1" max="3" step="0.5" value="' + my.exag + '" aria-label="Pembesaran tinggi">';
      if (my.rel.options.length > 1) {
        h += '<div class="ow-dr-sec">Rilis DEM &amp; data jalan</div><select id="owDrRel">' + my.rel.options.map(function (o) {
          return '<option value="' + esc(o.id) + '"' + (o.id === my.rel.id ? " selected" : "") + ">" + esc(o.label) + "</option>";
        }).join("") + '</select><div class="ow-dr-note">Ortho selalu yang terbaru.</div>';
      }
      h += '<button type="button" class="ow-dr-reset" data-act="reset">⟲ Reset kamera</button>';
      p.innerHTML = h;
    }
    function onClickUi(ev) {
      var t = ev.target.closest ? ev.target.closest("[data-act]") : null; if (!t || !S) return;
      var a = t.getAttribute("data-act");
      if (a === "close") close();
      else if (a === "panel") { S.panel = !S.panel; renderPanel(); }
      else if (a === "reset" && S.ml && S.bounds) {
        var b = S.bounds;
        S.ml.fitBounds([[b[0], b[1]], [b[2], b[3]]], { pitch: 55, bearing: 0, padding: 24, duration: 600 });
      }
    }
    function onChangeUi(ev) {
      var t = ev.target; if (!S) return;
      if (t.getAttribute && t.getAttribute("data-ov")) {
        var k = t.getAttribute("data-ov"); S.ov[k] = !!t.checked; applyOverlay(S, k);
      } else if (t.id === "owDrRel") {
        var o = S.rel.options.find(function (x) { return x.id === t.value; });
        if (o) { var g = d.getState(); restart(pickTerrainRelease(d.getState().releaseIndex, g.activeReleaseId, o.id)); }
      }
    }
    function onInputUi(ev) {
      var t = ev.target; if (!S || t.id !== "owDrExag") return;
      S.exag = parseFloat(t.value) || 1;
      var lab = S.ui.querySelector("#owDrExV"); if (lab) lab.textContent = f1(S.exag) + "×";
      try { if (S.ml && S.ready) S.ml.setTerrain({ source: "dem", exaggeration: S.exag }); } catch (e) {}
    }

    return { open: open, close: close, toggle: function () { return S ? close() : open(); }, isOpen: function () { return !!S; }, _state: function () { return S; } };
  }

  /* ---------- pasang otomatis di halaman peta ---------- */
  if (typeof document !== "undefined" && typeof module === "undefined") {
    var boot = function () {
      var cfg = root.OVERWATCH_CONFIG || {};
      if (typeof map === "undefined" || typeof owApi !== "function" || !cfg.DATA_API) return;
      function loadOnce(tag, url, attrs) {
        return new Promise(function (resolve, reject) {
          var key = "data-ow-lib", el = document.querySelector("[" + key + '="' + url + '"]');
          if (el && el.getAttribute("data-ready") === "1") return resolve();
          if (!el) { el = document.createElement(tag); el.setAttribute(key, url); Object.keys(attrs).forEach(function (k) { el[k] = attrs[k]; }); document.head.appendChild(el); }
          var t = setTimeout(function () { reject(new Error("waktu habis memuat " + url)); }, 25000);
          el.addEventListener("load", function () { clearTimeout(t); el.setAttribute("data-ready", "1"); resolve(); });
          el.addEventListener("error", function () { clearTimeout(t); el.remove(); reject(new Error("gagal memuat mesin 3D (internet / diblokir?)")); });
        });
      }
      function ensureMapLibre() {
        if (root.maplibregl) return Promise.resolve(root.maplibregl);
        return Promise.all([
          loadOnce("link", ML_CSS, { rel: "stylesheet", href: ML_CSS }),
          loadOnce("script", ML_JS, { src: ML_JS, async: true })
        ]).then(function () {
          if (!root.maplibregl) throw new Error("mesin 3D tidak tersedia");
          var ok = false; try { var c = document.createElement("canvas"); ok = !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) {}
          if (!ok) throw new Error("perangkat/browser ini tidak mendukung WebGL");
          return root.maplibregl;
        });
      }
      var hiddenMap = false;
      root.OwDrone = createDrone({
        doc: document, apiBase: String(cfg.DATA_API).replace(/\/+$/, ""),
        api: function (p, ms) { return owApi(p, ms); },
        headers: function () { return owAuthHeaders(); },
        orthoUrl: typeof PMTILES_URL !== "undefined" ? PMTILES_URL : "",
        normalize: typeof OW_NORM === "function" ? OW_NORM : null,
        toast: function (t) { if (typeof showToastNotification === "function") showToastNotification(t); },
        isOnline: function () { return navigator.onLine !== false; },
        ensureMapLibre: ensureMapLibre,
        getPmtiles: function () { return root.pmtiles; },
        blocked: function () {
          var c = document.body.classList;
          if (c.contains("ow-drawing")) return "Selesaikan dulu gambar area WO.";
          if (c.contains("ow-measuring")) return "Tutup alat ukur dulu.";
          if (c.contains("ow-comparing")) return "Tutup mode banding dulu.";
          if (document.getElementById("owDash")) return "Tutup dashboard dulu.";
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
        colorFn: function (param, props, std) {
          var lib = root.OwCompareLib;
          return lib ? lib.styleFor(param, props, std).fillColor : "#94a3b8";
        },
        infraKey: function (props) { return root.OverwatchRelease && root.OverwatchRelease.infraKey ? root.OverwatchRelease.infraKey(props) : "lainnya"; },
        getInfraObjects: function () {
          var st = root.OwInfra && root.OwInfra.state && root.OwInfra.state();
          if (st && st.loaded) return Promise.resolve(st.objects || []);
          return owApi("/api/infra", 10000).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (j) { return j.objects || []; });
        },
        getLeafletView: function () { var c = map.getCenter(); return { lat: c.lat, lng: c.lng, zoom: map.getZoom() }; },
        restoreLeaflet: function (v) {
          setTimeout(function () {
            try { map.invalidateSize({ animate: false }); if (v) map.setView([v.lat, v.lng], Math.max(1, Math.min(22, Math.round(v.zoom))), { animate: false }); } catch (e) {}
          }, 30);
        }
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  }

  return {
    PROTO: PROTO, ML_JS: ML_JS, ML_CSS: ML_CSS, terrainReleases: terrainReleases, pickTerrainRelease: pickTerrainRelease,
    AuthSource: AuthSource, parseTileUrl: parseTileUrl, makeProtocolHandler: makeProtocolHandler, paddedBounds: paddedBounds,
    initialView: initialView, buildStyle: buildStyle, decorateBlocks: decorateBlocks, collectBundwall: collectBundwall,
    blockInfoHtml: blockInfoHtml, bundInfoHtml: bundInfoHtml, createDrone: createDrone, OVERLAYS: OVERLAYS, LAYER_OF: LAYER_OF
  };
});
