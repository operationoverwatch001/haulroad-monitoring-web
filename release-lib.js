/* =====================================================================
   OVERWATCH - release-lib.js
   Logika murni (tanpa DOM) untuk sistem rilis data mingguan:
   nama rilis, nomor minggu, validasi GeoJSON hasil script ArcGIS,
   dan pembuatan summary.json. Dipakai upload.html (browser) dan tes (Node).
   ===================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OverwatchRelease = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Batas wajar koordinat WGS84 untuk Indonesia. Di luar ini hampir pasti salah proyeksi (UTM, dll).
  var BOUNDS = { lonMin: 90, lonMax: 145, latMin: -12, latMax: 7 };

  // Nama field resmi + alias (shapefile memotong nama jadi 10 karakter).
  var FIELD_ALIASES = {
    Status_Gra: ["Status_Gra", "Status_Grade", "Status Grade"],
    Label_Grad: ["Label_Grad", "Label_Grade"],
    Crossfall_: ["Crossfall_", "Crossfall_L"],
    Crossfall1: ["Crossfall1", "Crossfall_R"],
    Kelas_Jala: ["Kelas_Jala", "Kelas_Jalan"]
  };

  var REQUIRED = {
    layers: ["Nama_Jalan", "Station_m", "Lebar_m", "Standar_m", "Status", "Tipe"],
    grade: ["Nama_Jalan", "STA_Akhir", "Grade_Pct", "Status_Gra", "Lebar_m", "Crossfall_", "Crossfall1"]
  };

  var XLSX_SHEETS = {
    "Data_Monitoring": ["Nama Jalan", "STA", "Grade Longitudinal (%)", "Status Grade", "Lebar Total (m)"],
    "CrossSection_3Pts": ["Key", "Nama Jalan", "STA", "Point", "Elevasi_RL"]
  };

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  // ISO-8601 week number dari string "YYYY-MM-DD" (tanpa efek timezone).
  function isoWeek(ymd) {
    var p = ymd.split("-").map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    var day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  }

  // "2026-10-22" + 42 -> "Week42_(22-10-2026)"
  function releaseId(ymd, week) {
    var p = ymd.split("-");
    return "Week" + week + "_(" + p[2] + "-" + p[1] + "-" + p[0] + ")";
  }

  var RELEASE_ID_RE = /^Week\d{1,2}_\(\d{2}-\d{2}-\d{4}\)$/;
  var BLAST_ID_RE = /^\d{4}-\d{2}-\d{2}(_[A-Za-z0-9]{1,10})?$/;

  function parseReleaseId(id) {
    var m = /^Week(\d{1,2})_\((\d{2})-(\d{2})-(\d{4})\)$/.exec(id || "");
    if (!m) return null;
    return { week: +m[1], dateDEM: m[4] + "-" + m[3] + "-" + m[2] };
  }

  var BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  function prettyDate(ymd) {
    var p = ymd.split("-");
    return +p[2] + " " + BULAN[+p[1] - 1] + " " + p[0];
  }

  function getProp(props, name) {
    if (!props) return undefined;
    var list = FIELD_ALIASES[name] || [name];
    for (var i = 0; i < list.length; i++) {
      if (props[list[i]] !== undefined) return props[list[i]];
    }
    return undefined;
  }

  // Tambahkan nama field resmi (alias) ke setiap fitur, supaya app.js cukup baca satu nama.
  function normalizeProps(fc) {
    if (!fc || !fc.features) return fc;
    for (var i = 0; i < fc.features.length; i++) {
      var pr = fc.features[i].properties;
      if (!pr) continue;
      for (var k in FIELD_ALIASES) {
        if (pr[k] === undefined) {
          var v = getProp(pr, k);
          if (v !== undefined) pr[k] = v;
        }
      }
    }
    return fc;
  }

  function firstCoord(geom) {
    var c = geom && geom.coordinates;
    while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
    return Array.isArray(c) && typeof c[0] === "number" ? c : null;
  }

  function checkBasic(fc, kind, res, expectGeom) {
    if (!fc || fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
      res.errors.push(kind + ": bukan GeoJSON FeatureCollection.");
      return false;
    }
    if (fc.features.length === 0) {
      res.errors.push(kind + ": tidak ada fitur sama sekali.");
      return false;
    }
    var bad = 0, outside = 0, nogeom = 0;
    for (var i = 0; i < fc.features.length; i++) {
      var g = fc.features[i].geometry;
      if (!g) { nogeom++; continue; }
      if (expectGeom && expectGeom.indexOf(g.type) < 0) bad++;
      var c = firstCoord(g);
      if (c && (c[0] < BOUNDS.lonMin || c[0] > BOUNDS.lonMax || c[1] < BOUNDS.latMin || c[1] > BOUNDS.latMax)) outside++;
    }
    if (outside > 0) {
      res.errors.push(kind + ": " + outside + " fitur koordinatnya di luar Indonesia. Hampir pasti belum diproyeksi ke WGS84 (EPSG:4326). " +
        "Jalankan Project ke WGS 1984 sebelum export.");
    }
    if (bad > 0) res.errors.push(kind + ": " + bad + " fitur bertipe geometri salah (harusnya " + expectGeom.join("/") + ").");
    if (nogeom > 0) res.warnings.push(kind + ": " + nogeom + " fitur tanpa geometri akan diabaikan.");
    return true;
  }

  function checkFields(fc, kind, key, res) {
    var req = REQUIRED[key], n = fc.features.length;
    var missing = {};
    for (var i = 0; i < n; i++) {
      var pr = fc.features[i].properties || {};
      for (var j = 0; j < req.length; j++) {
        var v = getProp(pr, req[j]);
        if (v === undefined) missing[req[j]] = (missing[req[j]] || 0) + 1;
      }
    }
    for (var f in missing) {
      if (missing[f] === n) res.errors.push(kind + ": kolom wajib '" + f + "' tidak ada. Nama kolom harus sama persis dengan rilis sebelumnya.");
      else res.warnings.push(kind + ": kolom '" + f + "' kosong di " + missing[f] + " fitur.");
    }
    var noName = 0;
    for (var k = 0; k < n; k++) {
      var nm = (fc.features[k].properties || {}).Nama_Jalan;
      if (nm === null || nm === undefined || String(nm).trim() === "") noName++;
    }
    if (noName > 0) res.warnings.push(kind + ": " + noName + " fitur tanpa Nama_Jalan (akan tampil tanpa nama ruas).");
  }

  function roadSet(fc) {
    var s = {};
    for (var i = 0; i < fc.features.length; i++) {
      var nm = ((fc.features[i].properties || {}).Nama_Jalan || "").toString().trim();
      if (nm) s[nm] = true;
    }
    return s;
  }

  function validateRoadLayers(fc) {
    var res = { errors: [], warnings: [], stats: {} };
    if (!checkBasic(fc, "Road_Layers", res, ["LineString", "MultiLineString"])) return res;
    checkFields(fc, "Road_Layers", "layers", res);
    res.stats.features = fc.features.length;
    res.stats.roads = Object.keys(roadSet(fc)).length;
    return res;
  }

  function validateGradePolygons(fc) {
    var res = { errors: [], warnings: [], stats: {} };
    if (!checkBasic(fc, "Road_Grade_Polygons", res, ["Polygon", "MultiPolygon"])) return res;
    checkFields(fc, "Road_Grade_Polygons", "grade", res);
    res.stats.features = fc.features.length;
    res.stats.roads = Object.keys(roadSet(fc)).length;
    return res;
  }

  // sheets: { "Data_Monitoring": [ {kolom:nilai,...}, ... ], "CrossSection_3Pts": [...] }
  function validateWorkbook(sheets) {
    var res = { errors: [], warnings: [], stats: {} };
    for (var name in XLSX_SHEETS) {
      var rows = sheets && sheets[name];
      if (!rows) { res.errors.push("Overwatch.xlsx: sheet '" + name + "' tidak ditemukan."); continue; }
      if (rows.length === 0) { res.errors.push("Overwatch.xlsx: sheet '" + name + "' kosong."); continue; }
      var cols = {};
      for (var i = 0; i < Math.min(rows.length, 200); i++) for (var c in rows[i]) cols[c] = true;
      XLSX_SHEETS[name].forEach(function (need) {
        if (!cols[need]) res.errors.push("Overwatch.xlsx: sheet '" + name + "' tidak punya kolom '" + need + "'.");
      });
      res.stats[name] = rows.length;
    }
    return res;
  }

  // Bandingkan daftar jalan antar file / antar rilis, kasih peringatan (bukan error).
  function compareRoads(layersFC, gradeFC, prevRoads) {
    var warns = [];
    var a = roadSet(layersFC), b = roadSet(gradeFC);
    var onlyA = Object.keys(a).filter(function (k) { return !b[k]; });
    var onlyB = Object.keys(b).filter(function (k) { return !a[k]; });
    if (onlyA.length) warns.push("Jalan ada di Road_Layers tapi tidak di Grade_Polygons: " + onlyA.join(", "));
    if (onlyB.length) warns.push("Jalan ada di Grade_Polygons tapi tidak di Road_Layers: " + onlyB.join(", "));
    if (prevRoads && prevRoads.length) {
      var now = {}; Object.keys(b).concat(Object.keys(a)).forEach(function (k) { now[k] = true; });
      var prev = {}; prevRoads.forEach(function (k) { prev[k] = true; });
      var gone = prevRoads.filter(function (k) { return !now[k]; });
      var added = Object.keys(now).filter(function (k) { return !prev[k]; });
      if (gone.length) warns.push("Jalan yang ada di rilis sebelumnya tapi hilang sekarang: " + gone.join(", "));
      if (added.length) warns.push("Jalan baru dibanding rilis sebelumnya: " + added.join(", "));
    }
    return warns;
  }

  function round(v, d) { var m = Math.pow(10, d || 1); return Math.round(v * m) / m; }

  function gradeClass(pr) {
    var s = String(getProp(pr, "Status_Gra") || "").toUpperCase();
    if (s.indexOf("OVER") >= 0) return "overgrade";
    if (s.indexOf("WARN") >= 0) return "warning";
    return "aman";
  }

  function cfStandard(v) {
    if (v === null || v === undefined || v === "" || isNaN(+v)) return null;
    var a = Math.abs(+v);
    return a >= 2 && a <= 4;
  }

  // summary.json: ringkasan per jalan + total, dipakai dashboard "semua jalan" dan tren antar minggu.
  function buildSummary(layersFC, gradeFC) {
    var roads = {};
    function R(name) {
      name = (name || "(tanpa nama)").toString().trim() || "(tanpa nama)";
      if (!roads[name]) roads[name] = {
        name: name, lengthM: 0,
        grade: { aman: 0, warning: 0, overgrade: 0 },
        lebar: { standar: 0, nonstandar: 0, sumLebar: 0, n: 0 },
        crossfall: { standar: 0, nonstandar: 0 }
      };
      return roads[name];
    }
    gradeFC.features.forEach(function (f) {
      var pr = f.properties || {};
      var r = R(pr.Nama_Jalan);
      var len = +pr.Shape_Leng || 20;
      r.lengthM += len;
      r.grade[gradeClass(pr)] += len;
      [getProp(pr, "Crossfall_"), getProp(pr, "Crossfall1")].forEach(function (v) {
        var s = cfStandard(v);
        if (s === true) r.crossfall.standar++; else if (s === false) r.crossfall.nonstandar++;
      });
    });
    layersFC.features.forEach(function (f) {
      var pr = f.properties || {};
      var r = R(pr.Nama_Jalan);
      var ok = String(pr.Status || "").toUpperCase() === "COMPLIANT";
      if (ok) r.lebar.standar++; else r.lebar.nonstandar++;
      if (!isNaN(+pr.Lebar_m)) { r.lebar.sumLebar += +pr.Lebar_m; r.lebar.n++; }
    });
    var list = Object.keys(roads).sort().map(function (k) {
      var r = roads[k];
      return {
        name: r.name,
        lengthM: round(r.lengthM, 0),
        grade: { aman: round(r.grade.aman, 0), warning: round(r.grade.warning, 0), overgrade: round(r.grade.overgrade, 0) },
        lebar: { standar: r.lebar.standar, nonstandar: r.lebar.nonstandar, avgM: r.lebar.n ? round(r.lebar.sumLebar / r.lebar.n, 2) : null },
        crossfall: r.crossfall
      };
    });
    var t = { lengthM: 0, grade: { aman: 0, warning: 0, overgrade: 0 }, lebar: { standar: 0, nonstandar: 0 }, crossfall: { standar: 0, nonstandar: 0 } };
    list.forEach(function (r) {
      t.lengthM += r.lengthM;
      ["aman", "warning", "overgrade"].forEach(function (k) { t.grade[k] += r.grade[k]; });
      t.lebar.standar += r.lebar.standar; t.lebar.nonstandar += r.lebar.nonstandar;
      t.crossfall.standar += r.crossfall.standar; t.crossfall.nonstandar += r.crossfall.nonstandar;
    });
    ["aman", "warning", "overgrade"].forEach(function (k) { t.grade[k] = round(t.grade[k], 0); });
    t.lengthM = round(t.lengthM, 0);
    return { version: 1, generatedAt: new Date().toISOString(), totals: t, roads: list };
  }

  // Serialisasi GeoJSON ringkas: koordinat dibulatkan (7 desimal = ~1 cm), tanpa spasi.
  // File asli ArcGIS pakai 15 desimal, jadi ukurannya turun jauh (hemat kuota HP lapangan).
  function compactGeoJSON(fc, decimals) {
    var m = Math.pow(10, decimals === undefined ? 7 : decimals);
    function rc(c) {
      if (typeof c[0] === "number") return c.map(function (v) { return Math.round(v * m) / m; });
      return c.map(rc);
    }
    return JSON.stringify(fc, function (k, v) {
      if (k === "coordinates" && Array.isArray(v)) return rc(v);
      return v;
    });
  }

  function validateBlast(fc) {
    var res = { errors: [], warnings: [], stats: {} };
    if (!checkBasic(fc, "Blastmap", res, null)) return res;
    var types = {};
    fc.features.forEach(function (f) { var t = f.geometry && f.geometry.type; if (t) types[t] = (types[t] || 0) + 1; });
    res.stats.features = fc.features.length;
    res.stats.types = types;
    return res;
  }

  function validateStatic(fc, name) {
    var res = { errors: [], warnings: [], stats: {} };
    checkBasic(fc, name, res, null);
    if (fc && fc.features) res.stats.features = fc.features.length;
    return res;
  }


  // ---- Desain infrastruktur (CSA, waterfill, pitstop, buspad, dst) ----
  // Properti opsional "Kategori" menentukan gaya & sub-layer di peta.
  var INFRA_CATS = {
    batas: "Batas area", boundary: "Batas area", csa: "Batas area",
    crest: "Crest bundwall", toe: "Toe bundwall", bundwall: "Bundwall",
    parkir: "Slot parkir", slot: "Slot parkir",
    dt: "Unit DT", unit: "Unit DT", truck: "Unit DT",
    buspad: "Buspad", fasilitas: "Fasilitas", jalan: "Jalan akses"
  };
  function infraCategory(props) {
    var p = props || {};
    // TYPE/Type = nama field keluaran Crest_Toe_Extractor.py (CREST / TOE)
    var v = p.Kategori || p.kategori || p.KATEGORI || p.Layer || p.layer || p.Kelas || p.TYPE || p.Type || "";
    v = String(v).trim().toLowerCase();
    return v || "";
  }
  // Kunci gaya kanonik untuk satu fitur desain (alias -> kunci). Dipakai peta dan halaman upload.
  var INFRA_KEYS = { batas: "batas", boundary: "batas", csa: "batas", crest: "crest", toe: "toe", bundwall: "bundwall",
    parkir: "parkir", slot: "parkir", dt: "dt", unit: "dt", truck: "dt", buspad: "buspad", jalan: "jalan", fasilitas: "fasilitas" };
  function infraKey(props) { return INFRA_KEYS[infraCategory(props)] || "lainnya"; }

  // [minLon, minLat, maxLon, maxLat] dari semua koordinat FeatureCollection; null kalau kosong / tidak valid.
  function geojsonBBox(fc) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    function walk(c) {
      if (typeof c[0] === "number") {
        if (isFinite(c[0]) && isFinite(c[1])) {
          if (c[0] < b[0]) b[0] = c[0]; if (c[0] > b[2]) b[2] = c[0];
          if (c[1] < b[1]) b[1] = c[1]; if (c[1] > b[3]) b[3] = c[1];
        }
      } else for (var i = 0; i < c.length; i++) walk(c[i]);
    }
    ((fc && fc.features) || []).forEach(function (f) { if (f && f.geometry && f.geometry.coordinates) walk(f.geometry.coordinates); });
    return isFinite(b[0]) ? b : null;
  }

  function validateInfraDesign(fc) {
    var res = { errors: [], warnings: [], stats: {} };
    if (!checkBasic(fc, "Desain infra", res, null)) return res;
    var cats = {}, types = {}, n = 0;
    fc.features.forEach(function (f) {
      if (!f.geometry) return;
      n++;
      types[f.geometry.type] = (types[f.geometry.type] || 0) + 1;
      var c = infraCategory(f.properties) || "(tanpa kategori)";
      cats[c] = (cats[c] || 0) + 1;
    });
    res.stats.features = n; res.stats.categories = cats; res.stats.geomTypes = types;
    if (!Object.keys(cats).some(function (c) { return c !== "(tanpa kategori)"; })) {
      res.warnings.push("Fitur belum punya atribut Kategori (batas, crest, toe, parkir, dt, buspad). Tetap tampil, tapi dengan satu warna.");
    }
    return res;
  }

  // Baca header PMTiles v3 (127 byte pertama): untuk memastikan file tile elevasi benar sebelum diunggah.
  function parsePmtilesHeader(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.length < 127) return { ok: false, error: "File terlalu kecil untuk PMTiles." };
    var magic = String.fromCharCode.apply(null, Array.prototype.slice.call(u8, 0, 7));
    if (magic !== "PMTiles") return { ok: false, error: "Bukan file PMTiles." };
    if (u8[7] !== 3) return { ok: false, error: "PMTiles versi " + u8[7] + " tidak didukung (butuh v3)." };
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var types = { 0: "unknown", 1: "mvt", 2: "png", 3: "jpeg", 4: "webp", 5: "avif" };
    return {
      ok: true, minZoom: u8[100], maxZoom: u8[101], tileType: types[u8[99]] || "unknown",
      bounds: [dv.getInt32(102, true) / 1e7, dv.getInt32(106, true) / 1e7, dv.getInt32(110, true) / 1e7, dv.getInt32(114, true) / 1e7]
    };
  }
  function validateTerrainHeader(h) {
    var res = { errors: [], warnings: [], stats: {} };
    if (!h.ok) { res.errors.push(h.error); return res; }
    res.stats = { minZoom: h.minZoom, maxZoom: h.maxZoom, tileType: h.tileType };
    if (h.tileType !== "png" && h.tileType !== "webp") res.errors.push("Tile elevasi harus PNG atau WebP lossless (sekarang: " + h.tileType + "). JPEG merusak nilai tinggi.");
    if (h.maxZoom < 15) res.warnings.push("Zoom maksimal hanya " + h.maxZoom + ". Tampilan 3D akan kasar saat didekati.");
    var b = h.bounds;
    if (b && (b[0] < BOUNDS.lonMin || b[2] > BOUNDS.lonMax || b[1] < BOUNDS.latMin || b[3] > BOUNDS.latMax)) res.errors.push("Cakupan tile di luar Indonesia. Cek proyeksi / script ekspornya.");
    return res;
  }

  return {
    isoWeek: isoWeek, releaseId: releaseId, parseReleaseId: parseReleaseId, prettyDate: prettyDate,
    RELEASE_ID_RE: RELEASE_ID_RE, BLAST_ID_RE: BLAST_ID_RE,
    normalizeProps: normalizeProps, getProp: getProp,
    validateRoadLayers: validateRoadLayers, validateGradePolygons: validateGradePolygons,
    validateWorkbook: validateWorkbook, validateBlast: validateBlast, validateStatic: validateStatic,
    compareRoads: compareRoads, buildSummary: buildSummary, roadSet: roadSet, compactGeoJSON: compactGeoJSON,
    INFRA_CATS: INFRA_CATS, infraCategory: infraCategory, infraKey: infraKey, geojsonBBox: geojsonBBox, validateInfraDesign: validateInfraDesign,
    parsePmtilesHeader: parsePmtilesHeader, validateTerrainHeader: validateTerrainHeader
  };
});
