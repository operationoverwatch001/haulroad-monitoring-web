/* Overwatch - Dashboard SEMUA jalan (peringkat ruas, KPI jaringan, perubahan vs rilis lain, tren mingguan).
 * Dimuat SETELAH app.js. Memakai: monitoringData, releaseIndex, activeReleaseId, owApi, changeRoad.
 *
 * Angka per ruas dihitung dengan aturan yang SAMA PERSIS dengan "📊 Summary" per ruas di app.js
 * (calculateRoadAuditMetrics): grade <7,9 aman, 7,9-8,9 warning, >8,9 overgrade; lebar >= standar ruas;
 * crossfall 2-4 % normal. Tes tests/dashboard.test.js membandingkan keduanya langsung dari kode app.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.OwDashLib = factory(root);
})(typeof window !== "undefined" ? window : this, function (root) {
  "use strict";

  function parseMeterSTA(val) {
    if (val === undefined || val === null || val === "") return 0;
    var str = val.toString().trim();
    if (str.indexOf("+") >= 0) {
      var parts = str.split("+");
      return (parseFloat(parts[0]) || 0) * 1000 + (parseFloat(parts[1]) || 0);
    }
    return parseFloat(str) || 0;
  }
  function roadKey(r) { return String(r["Nama Jalan"] || "").trim().toLowerCase(); }

  // Lebar standar ruas = baris PERTAMA ruas itu (urutan data asli), cadangan 30,8 m. Sama dengan getActiveRoadStandardWidth.
  function standardWidth(rows) {
    var row = rows[0];
    if (row && row["Lebar Standar (m)"]) {
      var std = parseFloat(row["Lebar Standar (m)"]);
      if (!isNaN(std) && std > 0) return std;
    }
    return 30.8;
  }

  function roadMetrics(rowsIn, name) {
    if (!rowsIn || !rowsIn.length) return null;
    var stdLebar = standardWidth(rowsIn);
    var rows = rowsIn.slice().sort(function (a, b) { return parseMeterSTA(a["STA"]) - parseMeterSTA(b["STA"]); });
    var minMeter = parseMeterSTA(rows[0]["STA"]), maxMeter = parseMeterSTA(rows[rows.length - 1]["STA"]);
    var totalLength = Math.max(0, maxMeter - minMeter) || (rows.length * 20);
    var step = totalLength / Math.max(1, rows.length);
    var payloadClass = stdLebar <= 25 ? "Class 100 Ton" : (stdLebar <= 30 ? "Class 150 Ton" : "Class 200 Ton");

    var ongrade = 0, warning = 0, overgrade = 0, maxGrade = 0, sumGrade = 0;
    rows.forEach(function (r) {
      var g = Math.abs(parseFloat(r["Grade Longitudinal (%)"]) || 0);
      sumGrade += g; if (g > maxGrade) maxGrade = g;
      if (g < 7.9) ongrade++; else if (g <= 8.9) warning++; else overgrade++;
    });
    var stdW = 0, nonStdW = 0;
    rows.forEach(function (r) {
      var w = parseFloat(r["Lebar Total (m)"] || 0);
      if (w >= stdLebar) stdW++; else if (w > 0) nonStdW++;
    });
    var cfNorm = 0, cfAll = 0;
    rows.forEach(function (r) {
      [Math.abs(parseFloat(r["Crossfall Kiri (%)"]) || 0), Math.abs(parseFloat(r["Crossfall Kanan (%)"]) || 0)].forEach(function (cf) {
        cfAll++; if (cf >= 2.0 && cf <= 4.0) cfNorm++;
      });
    });
    var n = rows.length, cfTotal = cfAll || 1;
    var gradeComp = ongrade / n * 100, widthComp = stdW / n * 100, cfComp = cfNorm / cfTotal * 100;
    return {
      roadName: name, payloadClass: payloadClass, standardWidth: stdLebar, nRows: n, totalLength: totalLength,
      grade: {
        ongradeM: Math.round(ongrade * step), warningM: Math.round(warning * step), overgradeM: Math.round(overgrade * step),
        ongradePct: Math.round(ongrade / n * 100), warningPct: Math.round(warning / n * 100), overgradePct: Math.round(overgrade / n * 100),
        avg: (sumGrade / n).toFixed(1), max: maxGrade.toFixed(1)
      },
      width: { stdM: Math.round(stdW * step), nonStdM: Math.round(nonStdW * step), stdPct: Math.round(stdW / n * 100), nonStdPct: Math.round(nonStdW / n * 100) },
      crossfall: { normPct: Math.round(cfNorm / cfTotal * 100) },
      overallScore: Math.round((gradeComp + widthComp + cfComp) / 3)
    };
  }

  // Semua ruas dari baris monitoring + total jaringan (rata-rata skor dibobot panjang ruas).
  function buildNetwork(rows) {
    var groups = {}, order = [];
    (rows || []).forEach(function (r) {
      var k = roadKey(r); if (!k) return;
      if (!groups[k]) { groups[k] = { name: String(r["Nama Jalan"]).trim(), rows: [] }; order.push(k); }
      groups[k].rows.push(r);
    });
    var roads = order.map(function (k) { return roadMetrics(groups[k].rows, groups[k].name); }).filter(Boolean);
    var t = { roads: roads.length, lengthM: 0, overgradeM: 0, warningM: 0, nonStdM: 0, scoreW: 0, attention: 0 };
    roads.forEach(function (r) {
      t.lengthM += r.totalLength; t.overgradeM += r.grade.overgradeM; t.warningM += r.grade.warningM; t.nonStdM += r.width.nonStdM;
      t.scoreW += r.overallScore * r.totalLength; if (r.overallScore < 70) t.attention++;
    });
    t.score = t.lengthM ? Math.round(t.scoreW / t.lengthM) : 0;
    t.overgradePct = t.lengthM ? t.overgradeM / t.lengthM * 100 : 0;
    t.warningPct = t.lengthM ? t.warningM / t.lengthM * 100 : 0;
    t.nonStdPct = t.lengthM ? t.nonStdM / t.lengthM * 100 : 0;
    return { roads: roads, totals: t };
  }

  // delta skor per ruas (poin persen) terhadap rilis pembanding
  function compareNetworks(cur, prev) {
    var pm = {};
    prev.roads.forEach(function (r) { pm[r.roadName.toLowerCase()] = r; });
    var deltas = {};
    cur.roads.forEach(function (r) {
      var p = pm[r.roadName.toLowerCase()];
      deltas[r.roadName] = p ? { isNew: false, score: r.overallScore - p.overallScore, overgradeM: r.grade.overgradeM - p.grade.overgradeM, nonStdM: r.width.nonStdM - p.width.nonStdM } : { isNew: true };
    });
    return { deltas: deltas, score: cur.totals.score - prev.totals.score, overgradePct: cur.totals.overgradePct - prev.totals.overgradePct };
  }

  var SORTS = {
    score: { label: "Perlu perhatian (skor terendah)", fn: function (a, b) { return a.overallScore - b.overallScore || b.grade.overgradeM - a.grade.overgradeM; } },
    over: { label: "Overgrade terpanjang", fn: function (a, b) { return b.grade.overgradeM - a.grade.overgradeM; } },
    narrow: { label: "Lebar kurang standar terpanjang", fn: function (a, b) { return b.width.nonStdM - a.width.nonStdM; } },
    len: { label: "Terpanjang", fn: function (a, b) { return b.totalLength - a.totalLength; } },
    name: { label: "Nama A-Z", fn: function (a, b) { return a.roadName.localeCompare(b.roadName, "id"); } },
    worse: { label: "Paling memburuk vs pembanding", fn: null }
  };

  function esc(s) { return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function scoreColor(s) { return s >= 85 ? "#22c55e" : s >= 70 ? "#eab308" : "#e11d48"; }
  function fmtNum(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
  function fmtKm(m) { return (m / 1000).toFixed(1).replace(".", ",") + " km"; }
  function signed(n, unit) { var r = Math.round(n * 10) / 10; return (r > 0 ? "+" : r < 0 ? "−" : "±") + String(Math.abs(r)).replace(".", ",") + (unit || ""); }

  // grafik tren: 2 garis (kepatuhan, overgrade). points: [{label, score, over}] urut lama -> baru
  function trendSvg(points) {
    var W = 320, H = 150, L = 30, R = 10, T = 12, B = 28, n = points.length;
    if (n < 2) return "";
    var maxV = 100, minV = 0;
    var vals = points.map(function (p) { return Math.max(p.score, p.over); });
    var top = Math.min(100, Math.ceil((Math.max.apply(null, vals) + 5) / 10) * 10);
    maxV = Math.max(top, 20);
    function x(i) { return L + (W - L - R) * i / (n - 1); }
    function y(v) { return T + (H - T - B) * (1 - (v - minV) / (maxV - minV)); }
    var g = "";
    [0, 0.5, 1].forEach(function (f) {
      var v = Math.round(minV + (maxV - minV) * f);
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#334155" stroke-width="1"/><text x="' + (L - 4) + '" y="' + (y(v) + 3) + '" text-anchor="end" fill="#94a3b8" font-size="9">' + v + "%</text>";
    });
    function line(key, color) {
      var d = points.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p[key]).toFixed(1); }).join(" ");
      var dots = points.map(function (p, i) { return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p[key]).toFixed(1) + '" r="3" fill="' + color + '"/>'; }).join("");
      var last = points[n - 1];
      return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2"/>' + dots +
        '<text x="' + (x(n - 1) - 2).toFixed(1) + '" y="' + (y(last[key]) - 6).toFixed(1) + '" text-anchor="end" fill="' + color + '" font-size="10" font-weight="700">' + last[key] + "%</text>";
    }
    var xl = points.map(function (p, i) { return (n <= 6 || i % 2 === (n - 1) % 2) ? '<text x="' + x(i).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" fill="#94a3b8" font-size="9">' + esc(p.label) + "</text>" : ""; }).join("");
    return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Tren kepatuhan dan overgrade per rilis" style="width:100%;height:auto">' + g + line("score", "#00f0ff") + line("over", "#f43f5e") + xl + "</svg>" +
      '<div class="od-legend"><span style="color:#00f0ff">● Kepatuhan jaringan</span><span style="color:#f43f5e">● Overgrade (% panjang)</span></div>';
  }

  /* ---------------- tampilan ---------------- */
  function createDashboard(d) {
    var doc = d.doc;
    var cache = new Map();     // releaseId -> Promise<network>
    var ui = null, S = null;

    function monitoring(id) {
      if (cache.has(id)) return cache.get(id);
      var p = d.api("/data/releases/" + encodeURIComponent(id) + "/monitoring.json", 40000).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (j) { return buildNetwork(j.monitoring || []); });
      p.catch(function () { cache.delete(id); });
      cache.set(id, p);
      return p;
    }

    function relList() { var ix = d.getState().releaseIndex; return (ix && ix.releases) || []; }

    function open() {
      var g = d.getState();
      if (!g.monitoringData || !g.monitoringData.length) { if (d.toast) d.toast("Data audit belum termuat."); return false; }
      close();
      var net = buildNetwork(g.monitoringData);
      var rel = relList(), act = g.activeReleaseId, idx = rel.findIndex(function (r) { return r.id === act; });
      var older = idx >= 0 ? rel[idx + 1] : null;
      S = { net: net, sort: "score", q: "", cmpId: older ? older.id : "", cmp: null, cmpErr: "", trend: null, trendBusy: false, cmpBusy: false };
      ui = doc.createElement("div"); ui.id = "owDash";
      ui.addEventListener("click", onClick); ui.addEventListener("input", onInput); ui.addEventListener("change", onInput);
      doc.body.appendChild(ui);
      draw();
      if (S.cmpId) loadCompare(S.cmpId);
      return true;
    }
    function close() { if (ui) { ui.remove(); ui = null; } S = null; }

    function loadCompare(id) {
      S.cmpId = id; S.cmp = null; S.cmpErr = "";
      if (!id) { draw(); return; }
      S.cmpBusy = true; draw();
      var my = S;
      monitoring(id).then(function (prev) { if (S !== my || S.cmpId !== id) return; S.cmp = compareNetworks(S.net, prev); S.cmpBusy = false; draw(); })
        .catch(function (e) { if (S !== my) return; S.cmpBusy = false; S.cmpErr = "Rilis pembanding gagal dimuat (" + e.message + ")"; draw(); });
    }

    function loadTrend() {
      var g = d.getState(), rel = relList(), act = g.activeReleaseId;
      var i = rel.findIndex(function (r) { return r.id === act; });
      var list = rel.slice(Math.max(0, i), Math.max(0, i) + 8);       // rilis aktif + 7 sebelumnya
      if (list.length < 2) { S.trend = []; draw(); return; }
      S.trendBusy = true; S.trendDone = 0; S.trendTotal = list.length; draw();
      var my = S, out = [];
      var chain = list.reduce(function (pr, r, k) {
        return pr.then(function () {
          var p = r.id === act ? Promise.resolve(S.net) : monitoring(r.id);
          return p.then(function (net) { out[k] = { label: "W" + (r.week || "?"), score: net.totals.score, over: Math.round(net.totals.overgradePct * 10) / 10 }; })
            .catch(function () { out[k] = null; })
            .then(function () { if (S === my) { S.trendDone++; draw(); } });
        });
      }, Promise.resolve());
      chain.then(function () { if (S !== my) return; S.trend = out.filter(Boolean).reverse(); S.trendBusy = false; draw(); });
    }

    function sortedRoads() {
      var q = S.q.trim().toLowerCase();
      var arr = S.net.roads.filter(function (r) { return !q || r.roadName.toLowerCase().indexOf(q) >= 0; });
      if (S.sort === "worse") {
        var dl = (S.cmp && S.cmp.deltas) || {};
        arr.sort(function (a, b) { var da = dl[a.roadName] && !dl[a.roadName].isNew ? dl[a.roadName].score : 0, db = dl[b.roadName] && !dl[b.roadName].isNew ? dl[b.roadName].score : 0; return da - db; });
      } else arr.sort(SORTS[S.sort].fn);
      return arr;
    }

    function deltaChip(v, goodUp, unit) {
      var rv = Math.round((v || 0) * 10) / 10;
      if (!rv) return '<span class="od-d zero">±0' + (unit || "") + "</span>";
      var good = goodUp ? v > 0 : v < 0;
      return '<span class="od-d ' + (good ? "good" : "bad") + '">' + (v > 0 ? "▲" : "▼") + " " + signed(v, unit).slice(1) + "</span>";
    }

    function draw() {
      if (!ui) return;
      var g = d.getState(), t = S.net.totals, rel = relList();
      var cur = rel.find(function (r) { return r.id === g.activeReleaseId; });
      var cmp = S.cmp;
      var h = '<div class="od-head"><div><b>DASHBOARD JARINGAN JALAN</b><small>' + esc(cur ? cur.label : (g.activeReleaseId || "Data lokal")) + " · " + t.roads + ' ruas</small></div><button type="button" data-act="close" aria-label="Tutup">✕</button></div><div class="od-body">';

      // KPI
      h += '<div class="od-kpis">' +
        kpi("Kepatuhan jaringan", t.score + "%", scoreColor(t.score), cmp ? deltaChip(cmp.score, true, " poin") : "") +
        kpi("Total panjang", fmtKm(t.lengthM), "#38bdf8", t.roads + " ruas") +
        kpi("Overgrade", fmtNum(t.overgradeM) + " m", "#e11d48", t.overgradePct.toFixed(1).replace(".", ",") + "% panjang " + (cmp ? deltaChip(cmp.overgradePct, false, " poin") : "")) +
        kpi("Warning", fmtNum(t.warningM) + " m", "#eab308", t.warningPct.toFixed(1).replace(".", ",") + "% panjang") +
        kpi("Lebar < standar", fmtNum(t.nonStdM) + " m", "#f97316", t.nonStdPct.toFixed(1).replace(".", ",") + "% panjang") +
        kpi("Perlu perhatian", String(t.attention), t.attention ? "#e11d48" : "#22c55e", "ruas berskor < 70%") + "</div>";

      // kontrol
      h += '<div class="od-ctl"><input type="search" data-q placeholder="Cari nama jalan..." value="' + esc(S.q) + '" aria-label="Cari jalan">' +
        '<select data-sort aria-label="Urutkan">' + Object.keys(SORTS).map(function (k) { return '<option value="' + k + '"' + (k === S.sort ? " selected" : "") + ">" + esc(SORTS[k].label) + "</option>"; }).join("") + "</select>" +
        '<select data-cmp aria-label="Bandingkan dengan rilis"><option value="">Tanpa pembanding</option>' +
        rel.filter(function (r) { return r.id !== g.activeReleaseId; }).map(function (r) { return '<option value="' + esc(r.id) + '"' + (r.id === S.cmpId ? " selected" : "") + ">vs " + esc(r.label) + "</option>"; }).join("") + "</select></div>";
      if (S.cmpBusy) h += '<div class="od-note">Memuat rilis pembanding...</div>';
      if (S.cmpErr) h += '<div class="od-note err">' + esc(S.cmpErr) + "</div>";

      // tren
      h += '<div class="od-trend">';
      if (S.trend && S.trend.length >= 2) h += "<h3>Tren per rilis</h3>" + trendSvg(S.trend);
      else if (S.trendBusy) h += '<div class="od-note">Memuat tren ' + S.trendDone + "/" + S.trendTotal + "...</div>";
      else if (S.trend) h += '<div class="od-note">Belum cukup rilis untuk tren.</div>';
      else h += '<button type="button" class="od-btn" data-act="trend">📈 Lihat tren 8 rilis terakhir</button>';
      h += "</div>";

      // daftar ruas
      var list = sortedRoads(), dl = (cmp && cmp.deltas) || {};
      h += '<div class="od-list">';
      if (!list.length) h += '<div class="od-note">Tidak ada ruas yang cocok.</div>';
      list.forEach(function (r) {
        var dd = dl[r.roadName];
        var chip = !cmp ? "" : dd ? (dd.isNew ? '<span class="od-d new">BARU</span>' : deltaChip(dd.score, true, "")) : "";
        h += '<button type="button" class="od-card" data-road="' + esc(r.roadName) + '">' +
          '<div class="od-r1"><b>' + esc(r.roadName) + '</b><span class="od-score" style="background:' + scoreColor(r.overallScore) + '">' + r.overallScore + "%</span>" + chip + "</div>" +
          '<div class="od-r2">' + fmtNum(r.totalLength) + " m · " + esc(r.payloadClass) + " · std " + String(r.standardWidth).replace(".", ",") + " m</div>" +
          '<div class="od-bar" title="Grade: aman / warning / overgrade"><i style="width:' + r.grade.ongradePct + '%;background:#22c55e"></i><i style="width:' + r.grade.warningPct + '%;background:#eab308"></i><i style="width:' + r.grade.overgradePct + '%;background:#e11d48"></i></div>' +
          '<div class="od-r3"><span>Grade ✓ <b>' + r.grade.ongradePct + "%</b></span><span>Lebar ✓ <b>" + r.width.stdPct + "%</b></span><span>Crossfall ✓ <b>" + r.crossfall.normPct + "%</b></span><span>Max grade <b>" + String(r.grade.max).replace(".", ",") + "%</b></span></div></button>";
      });
      h += "</div></div>";
      // pertahankan fokus & posisi gulir saat digambar ulang
      var keepQ = ui.querySelector("[data-q]") === doc.activeElement, sc = ui.querySelector(".od-body"), top = sc ? sc.scrollTop : 0;
      ui.innerHTML = h;
      var nb = ui.querySelector(".od-body"); if (nb) nb.scrollTop = top;
      if (keepQ) { var q = ui.querySelector("[data-q]"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    }
    function kpi(label, value, color, sub) {
      return '<div class="od-kpi" style="border-left-color:' + color + '"><small>' + esc(label) + '</small><b style="color:' + color + '">' + value + "</b><span>" + sub + "</span></div>";
    }

    function onClick(e) {
      var a = e.target.closest("[data-act]"), c = e.target.closest("[data-road]");
      if (a && a.getAttribute("data-act") === "close") return close();
      if (a && a.getAttribute("data-act") === "trend") return loadTrend();
      if (c) { var name = c.getAttribute("data-road"); close(); d.goToRoad(name); }
    }
    function onInput(e) {
      var t = e.target;
      if (t.hasAttribute("data-q")) { S.q = t.value; draw(); }
      else if (t.hasAttribute("data-sort")) { S.sort = t.value; draw(); }
      else if (t.hasAttribute("data-cmp")) { loadCompare(t.value); }
    }

    return { open: open, close: close, toggle: function () { return ui ? (close(), false) : open(); }, active: function () { return !!ui; }, _state: function () { return S; } };
  }

  // ---- pasang otomatis di halaman peta ----
  if (typeof document !== "undefined" && typeof module === "undefined") {
    var boot = function () {
      if (typeof map === "undefined" || typeof owApi !== "function") return;
      function roadBounds(name) {
        var key = String(name).trim().toLowerCase(), b = null;
        [typeof roadGradeLayer !== "undefined" ? roadGradeLayer : null, typeof roadWidthLayer !== "undefined" ? roadWidthLayer : null, typeof roadMapLayer !== "undefined" ? roadMapLayer : null].forEach(function (grp) {
          if (b || !grp || !grp.eachLayer) return;
          grp.eachLayer(function (l) {
            var p = (l.feature && l.feature.properties) || {}, nm = String(p.Nama_Jalan || p["Nama Jalan"] || "").trim().toLowerCase();
            if (nm !== key || !l.getBounds) return;
            var lb = l.getBounds(); if (!lb.isValid()) return;
            if (!b) b = L.latLngBounds(lb.getSouthWest(), lb.getNorthEast()); else b.extend(lb);
          });
        });
        return b;
      }
      root.OwDash = createDashboard({
        doc: document,
        api: function (p, ms) { return owApi(p, ms); },
        toast: function (t) { if (typeof showToastNotification === "function") showToastNotification(t); },
        getState: function () { return { monitoringData: typeof monitoringData !== "undefined" ? monitoringData : [], releaseIndex: typeof releaseIndex !== "undefined" ? releaseIndex : null, activeReleaseId: typeof activeReleaseId !== "undefined" ? activeReleaseId : null }; },
        goToRoad: function (name) {
          if (typeof changeRoad === "function") changeRoad(name);
          var b = roadBounds(name);
          if (b) map.fitBounds(b, { padding: [40, 40], maxZoom: 18 });
        }
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  }

  return { parseMeterSTA: parseMeterSTA, roadMetrics: roadMetrics, buildNetwork: buildNetwork, compareNetworks: compareNetworks, trendSvg: trendSvg, createDashboard: createDashboard, SORTS: SORTS };
});
