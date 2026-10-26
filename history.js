/* Overwatch - RIWAYAT satu segmen jalan: grade, lebar, crossfall dari rilis ke rilis.
 * Dimuat SETELAH app.js. Memakai: monitoringData, releaseIndex, activeReleaseId, activeRoad, owApi, map.
 *
 * Cara pakai: menu TOOLS > RIWAYAT (otomatis pindah ke tab PARAMETER bila sedang di MAP), lalu ketuk satu segmen jalan di peta. Muncul lembar di bawah berisi tren segmen itu
 * (STA yang sama di ruas yang sama) di sampai 12 rilis terakhir. Ketuk segmen lain = lembar langsung berganti.
 * Aturan status SAMA dengan dashboard.js / Summary di app.js: grade < 7,9 aman, 7,9-8,9 warning, > 8,9 overgrade;
 * lebar >= standar ruas; crossfall 2-4 % normal. Data tiap rilis = monitoring.json milik rilis itu (diunduh sekali, disimpan).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.OwHistoryLib = factory(root);
})(typeof window !== "undefined" ? window : this, function (root) {
  "use strict";

  var COLOR = { ok: "#22c55e", warn: "#eab308", bad: "#e11d48", na: "#64748b" };

  function parseMeterSTA(val) {
    if (val === undefined || val === null || val === "") return 0;
    var str = val.toString().trim();
    if (str.indexOf("+") >= 0) {
      var parts = str.split("+");
      return (parseFloat(parts[0]) || 0) * 1000 + (parseFloat(parts[1]) || 0);
    }
    return parseFloat(str) || 0;
  }
  function roadKey(n) { return String(n === undefined || n === null ? "" : n).trim().toLowerCase(); }
  function fmtSTA(m) { m = Math.max(0, Math.round(m)); return Math.floor(m / 1000) + "+" + ("00" + (m % 1000)).slice(-3); }
  function num(v) {
    if (v === undefined || v === null || v === "") return null;
    var n = parseFloat(String(v).replace(",", "."));
    return isNaN(n) ? null : n;
  }
  function absn(v) { return v === null ? null : Math.abs(v); }
  function fmt(n, dec) { return n === null || n === undefined ? "-" : Number(n).toFixed(dec === undefined ? 1 : dec).replace(".", ","); }
  function esc(s) { return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // ---- aturan status (sama dengan dashboard.js) ----
  function gradeClass(g) { return g === null ? "na" : g < 7.9 ? "ok" : g <= 8.9 ? "warn" : "bad"; }
  function widthClass(w, std) { return w === null || w <= 0 ? "na" : (std !== null && w < std) ? "bad" : "ok"; }
  function cfClass(c) { return c === null ? "na" : (c >= 2 && c <= 4) ? "ok" : "bad"; }

  // Lebar standar ruas = baris PERTAMA ruas itu di rilis tersebut, cadangan 30,8 m (sama dengan getActiveRoadStandardWidth).
  function roadStandard(rows, road) {
    var key = roadKey(road);
    for (var i = 0; i < rows.length; i++) {
      if (roadKey(rows[i]["Nama Jalan"]) !== key) continue;
      var s = parseFloat(rows[i]["Lebar Standar (m)"]);
      return !isNaN(s) && s > 0 ? s : 30.8;
    }
    return 30.8;
  }

  // Baris monitoring untuk ruas + STA tertentu (toleransi 1 m, sama dengan app.js).
  function findRow(rows, road, meter) {
    var key = roadKey(road), best = null, bd = Infinity;
    for (var i = 0; i < (rows || []).length; i++) {
      var r = rows[i];
      if (roadKey(r["Nama Jalan"]) !== key) continue;
      var dd = Math.abs(parseMeterSTA(r["STA"]) - meter);
      if (dd < bd) { bd = dd; best = r; }
    }
    return bd <= 1 ? best : null;
  }

  function shortLabel(e) { return e.week ? "W" + e.week : String(e.id).slice(-5); }

  // entries: [{id,label,week,rows|null,err}] urut LAMA -> BARU. state: ok | none (ruas/STA tidak ada) | err | wait
  function buildSeries(entries, road, meter) {
    return entries.map(function (e) {
      var p = { id: e.id, label: e.label || e.id, short: shortLabel(e), week: e.week, state: "ok", grade: null, width: null, std: null, cfL: null, cfR: null, gc: "na", wc: "na", lc: "na", rc: "na" };
      if (!e.rows) { p.state = e.err ? "err" : "wait"; return p; }
      var row = findRow(e.rows, road, meter);
      if (!row) { p.state = "none"; return p; }
      p.grade = absn(num(row["Grade Longitudinal (%)"]));
      p.width = num(row["Lebar Total (m)"]);
      p.std = roadStandard(e.rows, road);
      p.cfL = absn(num(row["Crossfall Kiri (%)"]));
      p.cfR = absn(num(row["Crossfall Kanan (%)"]));
      p.gc = gradeClass(p.grade); p.wc = widthClass(p.width, p.std); p.lc = cfClass(p.cfL); p.rc = cfClass(p.cfR);
      return p;
    });
  }

  // selisih nilai terbaru terhadap rilis valid sebelumnya
  function latestDelta(points, key) {
    var v = points.filter(function (p) { return p.state === "ok" && p[key] !== null; });
    if (v.length < 2) return null;
    return Math.round((v[v.length - 1][key] - v[v.length - 2][key]) * 100) / 100;
  }

  /* grafik garis kecil. spec: { keys:[{k,color,cls}], bands:[{from,to,c}], ref:{v}, min, max, dec, unit } */
  function chartSvg(points, spec) {
    var W = 320, H = 112, L = 30, R = 16, T = 12, B = 22, n = points.length;
    if (!n) return "";
    var vals = [];
    points.forEach(function (p) { if (p.state !== "ok") return; spec.keys.forEach(function (kk) { if (p[kk.k] !== null) vals.push(p[kk.k]); }); });
    if (spec.ref && spec.ref.v !== null && spec.ref.v !== undefined) vals.push(spec.ref.v);
    if (!vals.length) return '<div class="oh-empty">Belum ada nilai</div>';
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var ymin = spec.min !== undefined ? Math.min(spec.min, lo) : lo - 1, ymax = spec.max !== undefined ? Math.max(spec.max, hi) : hi + 1;
    if (ymax - ymin < 0.5) { ymax += 0.5; ymin -= 0.5; }
    function x(i) { return n === 1 ? (L + (W - L - R) / 2) : L + (W - L - R) * i / (n - 1); }
    function y(v) { return T + (H - T - B) * (1 - (v - ymin) / (ymax - ymin)); }
    var g = "";
    (spec.bands || []).forEach(function (b) {
      var a = Math.max(ymin, b.from), c = Math.min(ymax, b.to === undefined ? Infinity : b.to);
      if (c <= a) return;
      g += '<rect x="' + L + '" y="' + y(c).toFixed(1) + '" width="' + (W - L - R) + '" height="' + (y(a) - y(c)).toFixed(1) + '" fill="' + COLOR[b.c] + '" opacity="0.13"/>';
    });
    [ymin, (ymin + ymax) / 2, ymax].forEach(function (v) {
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" stroke="#1e293b" stroke-width="1"/>' +
        '<text x="' + (L - 4) + '" y="' + (y(v) + 3).toFixed(1) + '" text-anchor="end" fill="#64748b" font-size="9">' + fmt(v, spec.dec === undefined ? 1 : spec.dec) + "</text>";
    });
    if (spec.ref && spec.ref.v !== null && spec.ref.v !== undefined) {
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(spec.ref.v).toFixed(1) + '" y2="' + y(spec.ref.v).toFixed(1) + '" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4 3"/>' +
        '<text x="' + (W - R) + '" y="' + (y(spec.ref.v) - 3).toFixed(1) + '" text-anchor="end" fill="#94a3b8" font-size="9">' + esc(spec.ref.label || "") + "</text>";
    }
    spec.keys.forEach(function (kk) {
      var d = "", pen = false, dots = "", last = null;
      points.forEach(function (p, i) {
        if (p.state !== "ok" || p[kk.k] === null) { pen = false; return; }
        d += (pen ? "L" : "M") + x(i).toFixed(1) + " " + y(p[kk.k]).toFixed(1) + " "; pen = true;
        dots += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p[kk.k]).toFixed(1) + '" r="3.4" fill="' + COLOR[p[kk.cls]] + '" stroke="#020617" stroke-width="1.2"/>';
        last = { i: i, v: p[kk.k] };
      });
      g += (d ? '<path d="' + d.trim() + '" fill="none" stroke="' + kk.color + '" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>' : "") + dots;
      if (last) g += '<text x="' + Math.min(W - R, x(last.i) + 2).toFixed(1) + '" y="' + (y(last.v) - 7).toFixed(1) + '" text-anchor="end" fill="' + kk.color + '" font-size="10" font-weight="700">' + fmt(last.v, spec.dec === undefined ? 1 : spec.dec) + "</text>";
    });
    g += points.map(function (p, i) {
      return (n <= 8 || i % 2 === (n - 1) % 2) ? '<text x="' + x(i).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle" fill="#94a3b8" font-size="9">' + esc(p.short) + "</text>" : "";
    }).join("");
    return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(spec.title || "Tren") + '" style="width:100%;height:auto">' + g + "</svg>";
  }

  var SPECS = {
    grade: { title: "Grade longitudinal (%)", keys: [{ k: "grade", color: "#00f0ff", cls: "gc" }], min: 0, max: 10, dec: 1, bands: [{ from: 0, to: 7.9, c: "ok" }, { from: 7.9, to: 8.9, c: "warn" }, { from: 8.9, to: Infinity, c: "bad" }] },
    cross: { title: "Crossfall kiri / kanan (%)", keys: [{ k: "cfL", color: "#38bdf8", cls: "lc" }, { k: "cfR", color: "#f59e0b", cls: "rc" }], min: 0, max: 6, dec: 1, bands: [{ from: 2, to: 4, c: "ok" }] }
  };
  function widthSpec(points) {
    var std = null;
    points.forEach(function (p) { if (p.state === "ok") std = p.std; });
    return { title: "Lebar total (m)", keys: [{ k: "width", color: "#a78bfa", cls: "wc" }], dec: 1, ref: std === null ? null : { v: std, label: "standar " + fmt(std, 1) }, bands: std === null ? [] : [{ from: -Infinity, to: std, c: "bad" }, { from: std, to: Infinity, c: "ok" }] };
  }

  /* ---------------- tampilan ---------------- */
  function createHistory(d) {
    var doc = d.doc, MAXREL = 12, POOL = 3;
    var cache = new Map();            // releaseId -> Promise<rows[]>
    var on = false, S = null, hint = null, sheet = null, seq = 0, openTimer = null;

    function relList() { var ix = d.getState().releaseIndex; return (ix && ix.releases) || []; }

    function rowsFor(id) {
      var g = d.getState();
      if (id === g.activeReleaseId) return Promise.resolve(g.monitoringData || []);
      if (cache.has(id)) return cache.get(id);
      var p = d.api("/data/releases/" + encodeURIComponent(id) + "/monitoring.json", 40000).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (j) { return j.monitoring || []; });
      p.catch(function () { cache.delete(id); });
      cache.set(id, p);
      return p;
    }

    function entryList() {
      var g = d.getState(), rel = relList().slice(0, MAXREL);
      if (!rel.length) return [{ id: g.activeReleaseId || "aktif", label: g.activeReleaseId || "Data aktif", week: null }];
      return rel.slice().reverse();     // lama -> baru
    }

    function start() {
      var g = d.getState();
      if (!g.monitoringData || !g.monitoringData.length) { if (d.toast) d.toast("Data audit belum termuat."); return false; }
      if (on) return true;
      on = true; S = null;
      if (d.ensureView) d.ensureView();       // tab MAP hanya menampilkan garis ruas tanpa STA; segmen ada di tab PARAMETER
      doc.body.classList.add("ow-history-on");
      hint = doc.createElement("div"); hint.id = "owHistHint";
      hint.innerHTML = '<span>🕒 <b>RIWAYAT</b> · ketuk satu segmen jalan di peta (tab PARAMETER)</span><button type="button" data-act="close" aria-label="Batal">✕</button>';
      hint.addEventListener("click", onClick);
      doc.body.appendChild(hint);
      requestAnimationFrame(function () { if (hint) hint.classList.add("open"); });
      return true;
    }

    function removeLater(el) {
      if (!el) return;
      el.classList.remove("open");
      setTimeout(function () { if (el.parentNode) el.remove(); }, 380);
    }
    function stop() {
      if (!on) return;
      on = false; seq++; S = null;
      doc.body.classList.remove("ow-history-on");
      if (d.clearHighlight) d.clearHighlight();
      removeLater(hint); hint = null;
      removeLater(sheet); sheet = null;
      if (openTimer) { clearTimeout(openTimer); openTimer = null; }
    }

    // dipanggil app.js sebelum klik segmen diproses biasa; true = klik dipakai alat ini
    function intercept(feature) {
      if (!on) return false;
      pick(feature);
      return true;
    }

    function pick(feature) {
      var p = (feature && feature.properties) || {};
      var road = String(p.Nama_Jalan || p["Nama Jalan"] || (d.getState().activeRoad || "")).trim();
      var endRaw = p.STA_Akhir || p.STA_Awal || p.Station_m || p.STA;
      if (!road || endRaw === undefined || endRaw === null || endRaw === "") { if (d.toast) d.toast("Segmen ini tidak punya data STA."); return false; }
      var end = parseMeterSTA(endRaw);
      var startM = p.STA_Awal && p.STA_Akhir ? parseMeterSTA(p.STA_Awal) : (p.STA_Akhir ? Math.max(0, end - 20) : end);
      var my = ++seq;
      var entries = entryList().map(function (e) { return { id: e.id, label: e.label, week: e.week, rows: null, err: "" }; });
      S = { road: road, start: startM, end: end, entries: entries, done: 0, total: entries.length, my: my };
      if (d.highlight) d.highlight(feature);
      if (hint) { removeLater(hint); hint = null; }
      ensureSheet();
      draw();
      var q = entries.slice(), running = 0;
      (function next() {
        while (running < POOL && q.length) {
          (function (e) {
            running++;
            rowsFor(e.id).then(function (rows) { e.rows = rows; }).catch(function (err) { e.err = (err && err.message) || "gagal"; })
              .then(function () { running--; if (my !== seq) return; S.done++; draw(); next(); });
          })(q.shift());
        }
      })();
      return true;
    }

    function ensureSheet() {
      if (sheet) return;
      sheet = doc.createElement("div"); sheet.id = "owHist";
      sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-label", "Riwayat segmen jalan");
      sheet.addEventListener("click", onClick);
      doc.body.appendChild(sheet);
      requestAnimationFrame(function () { requestAnimationFrame(function () { if (sheet) sheet.classList.add("open"); }); });
    }

    function chip(label, valueHtml, cls, delta, upIsGood) {
      var dh = "";
      if (delta !== null && delta !== undefined) {
        var z = Math.abs(delta) < 0.05;
        dh = z ? '<i class="oh-d zero">±0</i>' : '<i class="oh-d ' + ((delta > 0) === upIsGood ? "good" : "bad") + '">' + (delta > 0 ? "▲" : "▼") + " " + fmt(Math.abs(delta), 1) + "</i>";
      }
      return '<div class="oh-chip ' + cls + '"><small>' + esc(label) + "</small><b>" + valueHtml + "</b>" + dh + "</div>";
    }

    function draw() {
      if (!sheet || !S) return;
      var g = d.getState();
      var pts = buildSeries(S.entries, S.road, S.end);
      var ok = pts.filter(function (p) { return p.state === "ok"; });
      var last = ok[ok.length - 1] || null;
      var range = S.start === S.end ? "STA " + fmtSTA(S.end) : "STA " + fmtSTA(S.start) + " – " + fmtSTA(S.end);
      var h = '<div class="oh-grab" aria-hidden="true"></div><div class="oh-head"><div><b>' + esc(S.road) + "</b><small>" + range + " · " + S.total + ' rilis</small></div><button type="button" data-act="close" aria-label="Tutup">✕</button></div><div class="oh-body">';
      if (S.done < S.total) h += '<div class="oh-note">Memuat riwayat ' + S.done + "/" + S.total + "...</div>";
      if (last) {
        h += '<div class="oh-chips">' +
          chip("Grade", fmt(last.grade) + "%", last.gc, latestDelta(pts, "grade"), false) +
          chip("Lebar", fmt(last.width) + " m", last.wc, latestDelta(pts, "width"), true) +
          chip("Crossfall", fmt(last.cfL) + " / " + fmt(last.cfR) + "%", last.lc === "ok" && last.rc === "ok" ? "ok" : "bad", null, true) + "</div>";
      }
      if (ok.length) {
        h += '<section><h4>Grade (%)</h4>' + chartSvg(pts, SPECS.grade) + "</section>" +
          '<section><h4>Lebar total (m)</h4>' + chartSvg(pts, widthSpec(pts)) + "</section>" +
          '<section><h4>Crossfall <span class="oh-k" style="color:#38bdf8">● kiri</span> <span class="oh-k" style="color:#f59e0b">● kanan</span></h4>' + chartSvg(pts, SPECS.cross) + "</section>";
        if (ok.length === 1) h += '<div class="oh-note">Baru satu rilis yang memuat segmen ini, jadi belum ada tren.</div>';
      } else if (S.done >= S.total) {
        h += '<div class="oh-note err">Segmen ini tidak ditemukan di rilis mana pun. Coba ketuk segmen lain.</div>';
      }
      var miss = pts.filter(function (p) { return p.state === "none"; }).map(function (p) { return p.short; });
      var bad = pts.filter(function (p) { return p.state === "err"; }).map(function (p) { return p.short; });
      if (miss.length && ok.length) h += '<div class="oh-note">Tidak ada di rilis: ' + esc(miss.join(", ")) + ".</div>";
      if (bad.length) h += '<div class="oh-note err">Gagal dimuat: ' + esc(bad.join(", ")) + ".</div>";
      if (ok.length) {
        h += '<table class="oh-tab"><thead><tr><th>Rilis</th><th>Grade</th><th>Lebar</th><th>Crossfall</th></tr></thead><tbody>';
        pts.slice().reverse().forEach(function (p) {
          var cur = p.id === g.activeReleaseId ? " cur" : "";
          if (p.state !== "ok") { h += '<tr class="na' + cur + '"><td>' + esc(p.short) + '</td><td colspan="3">' + (p.state === "none" ? "tidak ada data" : p.state === "err" ? "gagal dimuat" : "memuat...") + "</td></tr>"; return; }
          h += '<tr class="' + cur.trim() + '"><td title="' + esc(p.label) + '">' + esc(p.short) + "</td>" +
            '<td class="' + p.gc + '">' + fmt(p.grade) + "%</td><td class=\"" + p.wc + '">' + fmt(p.width) + " m</td>" +
            '<td><span class="' + p.lc + '">' + fmt(p.cfL) + '</span> / <span class="' + p.rc + '">' + fmt(p.cfR) + "</span></td></tr>";
        });
        h += "</tbody></table>";
      }
      h += '<div class="oh-foot">Ketuk segmen lain di peta untuk berganti. Hijau = sesuai standar, kuning = warning grade, merah = di luar standar.</div></div>';
      var keep = sheet.querySelector(".oh-body"), top = keep ? keep.scrollTop : 0;
      sheet.innerHTML = h;
      var nb = sheet.querySelector(".oh-body"); if (nb) nb.scrollTop = top;
    }

    function onClick(e) {
      var a = e.target.closest("[data-act]");
      if (a && a.getAttribute("data-act") === "close") stop();
    }

    return {
      start: start, stop: stop, toggle: function () { if (on) { stop(); return false; } return start(); },
      active: function () { return on; }, intercept: intercept, pick: pick, _state: function () { return S; }
    };
  }

  // ---- pasang otomatis di halaman peta ----
  if (typeof document !== "undefined" && typeof module === "undefined") {
    var boot = function () {
      if (typeof map === "undefined" || typeof L === "undefined" || typeof owApi !== "function") return;
      var hl = null;
      root.OwHistory = createHistory({
        doc: document,
        api: function (p, ms) { return owApi(p, ms); },
        toast: function (t) { if (typeof showToastNotification === "function") showToastNotification(t); },
        getState: function () {
          return {
            monitoringData: typeof monitoringData !== "undefined" ? monitoringData : [],
            releaseIndex: typeof releaseIndex !== "undefined" ? releaseIndex : null,
            activeReleaseId: typeof activeReleaseId !== "undefined" ? activeReleaseId : null,
            activeRoad: typeof activeRoad !== "undefined" ? activeRoad : ""
          };
        },
        ensureView: function () {
          try {
            if (typeof currentMainTab !== "undefined" && currentMainTab !== "parameter" && typeof selectParameter === "function") {
              selectParameter(typeof currentParam !== "undefined" && currentParam ? currentParam : "grade");
              return true;
            }
          } catch (e) { /* biarkan tab apa adanya */ }
          return false;
        },
        highlight: function (feature) {
          try {
            if (hl) map.removeLayer(hl);
            hl = L.geoJSON(feature, { style: { color: "#00f0ff", weight: 4, fillColor: "#00f0ff", fillOpacity: 0.28, interactive: false }, interactive: false }).addTo(map);
          } catch (e) { hl = null; }
        },
        clearHighlight: function () { try { if (hl) map.removeLayer(hl); } catch (e) { /* abaikan */ } hl = null; }
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  }

  return {
    parseMeterSTA: parseMeterSTA, fmtSTA: fmtSTA, findRow: findRow, roadStandard: roadStandard, buildSeries: buildSeries, latestDelta: latestDelta,
    gradeClass: gradeClass, widthClass: widthClass, cfClass: cfClass, chartSvg: chartSvg, SPECS: SPECS, widthSpec: widthSpec, createHistory: createHistory
  };
});
