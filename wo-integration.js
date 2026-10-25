/* =====================================================================
   OVERWATCH - wo-integration.js  (dimuat SETELAH app.js)
   Menyambungkan editor area (wo-poly.js) dan klien Apps Script ke alur WO yang ada:
     - tombol + > AREA: tap titik, undo/redo, geser titik, Selesai -> form WO terisi
     - area WO digambar sebagai poligon berwarna sesuai status (OPEN/PROGRESS/CLOSED)
     - ketuk area: Lihat WO / Ubah area / Hapus (tanpa harus mematikan mode apa pun)
     - foto geotag: deteksi WO dari poligon, peringatan akurasi GPS, pilih WO manual
   ===================================================================== */
(function () {
  "use strict";
  if (typeof L === "undefined" || typeof map === "undefined") return;

  const Poly = window.OverwatchPoly;
  const tool = Poly.WoPolyTool(L, map, document);
  const isEditor = () => currentUserRole === "admin" || currentUserRole === "inspector";
  const layerByLine = new Map();   // lineId -> L.Layer (supaya siaran dari perangkat lain mengganti, bukan menumpuk)
  let pendingAreaId = null;

  /* ---------------- gambar area baru ---------------- */
  window.startWoAreaDraw = function () {
    if (!isEditor()) { showToastNotification("Hanya inspector/admin yang bisa membuat WO."); return; }
    if (tool.active()) return;
    if (!isWorkOrderModeActive) toggleWorkOrderFloating();
    const sub = document.getElementById("woSubmenu"); if (sub) sub.style.display = "none";
    activeWoTool = "area";
    document.body.classList.add("ow-drawing");
    tool.start({
      onDone: (pts, info) => {
        document.body.classList.remove("ow-drawing"); activeWoTool = null;
        const id = "area_" + Date.now();
        const item = { id, road: activeRoad || "Area Tambang", points: pts, reporter: currentNRP, kind: "polygon", pending: true };
        allDrawLines[id] = item;
        pendingAreaId = id;
        renderDrawLineOnMap(item);
        openCreateWoModal("", "Area " + Poly.fmtArea(info.areaM2), L.latLng(info.center.lat, info.center.lng), {}, true, id);
      },
      onCancel: () => { document.body.classList.remove("ow-drawing"); activeWoTool = null; }
    });
  };

  // dipanggil app.js saat WO benar-benar dikirim
  window.commitPendingArea = function (lineId) {
    const it = lineId && allDrawLines[lineId];
    if (!it || !it.pending) return;
    delete it.pending;
    pendingAreaId = null;
    syncDrawLineToCloud(it);
    broadcastWoSync("CREATE_DRAW_LINE", sanitizeDrawLineForBroadcast(it));
    renderDrawLineOnMap(it);
  };

  // dipanggil app.js saat form WO ditutup: area yang belum jadi WO dibuang
  window.discardPendingAreaIfAny = function () {
    if (!pendingAreaId) return;
    const it = allDrawLines[pendingAreaId];
    if (it && it.pending) removeAreaLayer(pendingAreaId), delete allDrawLines[pendingAreaId];
    pendingAreaId = null;
  };

  function removeAreaLayer(id) {
    const l = layerByLine.get(id);
    if (l && workOrderDrawingsLayer.hasLayer(l)) workOrderDrawingsLayer.removeLayer(l);
    layerByLine.delete(id);
    const it = allDrawLines[id]; if (it) it.layer = null;
  }

  /* ---------------- tampilan area (poligon) ---------------- */
  const origRender = window.renderDrawLineOnMap;
  window.renderDrawLineOnMap = function (item) {
    if (!item || item.kind !== "polygon") return origRender(item);
    removeAreaLayer(item.id);
    if (item.layer && workOrderDrawingsLayer.hasLayer(item.layer)) workOrderDrawingsLayer.removeLayer(item.layer);

    const wo = Object.values(allWorkOrders).find(w => w.linkedLineId === item.id);
    const st = wo ? String(wo.status || "OPEN").toUpperCase() : "OPEN";
    const color = item.pending ? "#00f0ff" : st === "CLOSED" ? "#22c55e" : st === "PROGRESS" ? "#eab308" : "#e11d48";
    const ll = item.points.map(p => [p.lat, p.lng]);
    const poly = L.polygon(ll, {
      color, weight: 3, fillColor: color, fillOpacity: item.pending ? 0.12 : 0.22,
      dashArray: item.pending ? "6 6" : null, interactive: !item.pending
    });
    if (!item.pending) {
      poly.on("click", (e) => { if (window.owPassThroughClick(e)) return; L.DomEvent.stopPropagation(e); openAreaPopup(item, e.latlng); });
    }
    layerByLine.set(item.id, poly);
    item.layer = poly;
    workOrderDrawingsLayer.addLayer(poly);
  };

  function openAreaPopup(item, latlng) {
    const wo = Object.values(allWorkOrders).find(w => w.linkedLineId === item.id);
    const st = wo ? String(wo.status || "OPEN").toUpperCase() : "";
    const btn = (label, fn, bg) => `<button onclick="${fn}" style="flex:1;min-height:40px;background:${bg};color:#fff;border:none;border-radius:8px;font:700 12px system-ui;cursor:pointer">${label}</button>`;
    let rows = `<div style="font:600 12px system-ui;margin-bottom:2px">${wo ? (wo.road || "Work Order") : "Area WO"}${st ? ` · <span>${st}</span>` : ""}</div>` +
               `<div style="font:11px system-ui;color:#64748b;margin-bottom:8px">${Poly.fmtArea(Poly.areaM2(item.points))} · oleh ${item.reporter || "-"}</div>`;
    const acts = [];
    if (wo) acts.push(btn("Lihat WO", `owViewWoByArea('${item.id}')`, "#0284c7"));
    if (isEditor()) {
      acts.push(btn("Ubah area", `owEditArea('${item.id}')`, "#475569"));
      acts.push(btn("Hapus", `owDeleteArea('${item.id}')`, "#e11d48"));
    }
    L.popup({ minWidth: 210, closeButton: true }).setLatLng(latlng).setContent(rows + `<div style="display:flex;gap:6px">${acts.join("")}</div>`).openOn(map);
  }

  window.owViewWoByArea = function (lineId) {
    map.closePopup();
    const wo = Object.values(allWorkOrders).find(w => w.linkedLineId === lineId);
    if (wo) openViewWoModal(wo.id);
  };

  window.owEditArea = function (lineId) {
    map.closePopup();
    const item = allDrawLines[lineId]; if (!item || !isEditor() || tool.active()) return;
    removeAreaLayer(lineId);                        // sembunyikan versi lama selama diedit
    document.body.classList.add("ow-drawing");
    const backup = JSON.parse(JSON.stringify(item.points));
    tool.start({
      points: item.points,
      onDone: (pts, info) => {
        document.body.classList.remove("ow-drawing");
        item.points = pts;
        const wo = Object.values(allWorkOrders).find(w => w.linkedLineId === lineId);
        if (wo) {
          wo.latlng = L.latLng(info.center.lat, info.center.lng);   // pin ikut ke tengah area baru
          createOrUpdateMarker(wo);
          syncWorkOrderToCloud({
            action: "SAVE_WORK_ORDER", id: wo.id, createdTime: wo.createdTime, road: wo.road, cluster: wo.cluster, lokasi: wo.lokasi,
            sta: wo.sta, latlng: wo.latlng, jobs: wo.jobs, notes: wo.notes, reporter: wo.reporter, photoUrls: wo.photoUrls,
            status: wo.status, linkedLineId: wo.linkedLineId
          });
          broadcastWoSync("EDIT_WO", sanitizeWoForBroadcast(wo), `${currentNRP} mengubah area WO di ${wo.road}`);
        }
        syncDrawLineToCloud(item);
        broadcastWoSync("CREATE_DRAW_LINE", sanitizeDrawLineForBroadcast(item));
        renderDrawLineOnMap(item);
        catatLogKeServer("EDIT AREA WO", `Area ${lineId} diubah oleh ${currentNRP}`);
      },
      onCancel: () => { document.body.classList.remove("ow-drawing"); item.points = backup; renderDrawLineOnMap(item); }
    });
  };

  window.owDeleteArea = function (lineId) {
    map.closePopup();
    if (!isEditor()) return;
    const wo = Object.values(allWorkOrders).find(w => w.linkedLineId === lineId);
    if (wo) { currentActiveWoId = wo.id; deleteCurrentWorkOrder(); }      // hapus WO + area (konfirmasi ada di dalamnya)
    else hapusGarisDraw(lineId);
  };

  // simpan jenis area ke server (versi lama tidak mengirim 'kind')
  window.syncDrawLineToCloud = function (item) {
    setSyncStatus("updating", "Menyimpan area...");
    return GAS.write({ action: "SAVE_DRAW_LINE", id: item.id, road: item.road, points: item.points, reporter: item.reporter, kind: item.kind || "line" })
      .then(() => setSyncStatus("updated")).catch(() => setSyncStatus("updated"));
  };

  // Saat menggambar area WO / mengukur / memilih titik foto manual, ketukan HARUS sampai ke peta walau jatuh di atas
  // poligon jalan, poligon WO lain, atau desain infra. Layer yang interaktif menelan klik (stopPropagation), jadi mereka
  // bertanya dulu ke fungsi ini.
  window.owPassThroughClick = function () {
    const c = document.body.classList;
    return c.contains("ow-drawing") || c.contains("ow-measuring") || window.owMapPicking === true;
  };

  // ketuk ruas jalan di mode WO tidak lagi membuat WO (area digambar bebas, bisa di CSA/infra yang tak punya STA)
  window.handleWorkOrderClick = function () { /* sengaja kosong */ };

  /* ---------------- deteksi WO dari posisi (foto geotag) ---------------- */
  const origFind = window.findNearestActiveWo;
  window.findNearestActiveWo = function (latlng, maxMeterDist) {
    if (window.geoForcedWoId && allWorkOrders[window.geoForcedWoId]) return allWorkOrders[window.geoForcedWoId];
    const inside = [];
    Object.values(allWorkOrders).forEach(wo => {
      if (String(wo.status || "OPEN").toUpperCase() === "CLOSED") return;
      const ln = wo.linkedLineId && allDrawLines[wo.linkedLineId];
      if (ln && ln.points && ln.points.length >= 3 && Poly.pointInPolygon(latlng, ln.points)) {
        const c = Poly.centroid(ln.points);
        inside.push({ wo, d: L.latLng(latlng.lat, latlng.lng).distanceTo(L.latLng(c.lat, c.lng)) });
      }
    });
    if (inside.length) { inside.sort((a, b) => a.d - b.d); return inside[0].wo; }
    return origFind(latlng, maxMeterDist);
  };

  function outstandingByDistance(latlng, limit) {
    const here = L.latLng(latlng.lat, latlng.lng);
    return Object.values(allWorkOrders)
      .filter(w => String(w.status || "OPEN").toUpperCase() !== "CLOSED" && w.latlng)
      .map(w => ({ w, d: here.distanceTo(L.latLng(w.latlng.lat, w.latlng.lng)) }))
      .sort((a, b) => a.d - b.d).slice(0, limit);
  }

  const origProceed = window.proceedWithPhotoLocation;
  window.proceedWithPhotoLocation = async function (lat, lng, takenTime, img) {
    await origProceed(lat, lng, takenTime, img);
    try {
      const box = document.getElementById("geoDetectedWoBox");
      const meta = window.geoLocMeta || {};
      if (box) {
        let extra = "";
        if (meta.mode === "gps" && meta.accuracy != null) {
          const bad = meta.accuracy > 25;
          extra += `<div style="margin-top:6px;color:${bad ? "#f59e0b" : "#94a3b8"};font-size:10px">${bad ? "⚠ " : ""}Akurasi GPS ±${Math.round(meta.accuracy)} m${bad ? ". Kurang akurat: tunggu sebentar lalu foto ulang, atau pilih WO manual di bawah." : "."}</div>`;
        } else if (meta.mode === "map") {
          extra += `<div style="margin-top:6px;color:#94a3b8;font-size:10px">Lokasi ditandai manual di peta.</div>`;
        }
        const list = outstandingByDistance({ lat, lng }, 15);
        if (list.length) {
          const cur = window.geoForcedWoId || "";
          extra += `<div style="margin-top:8px"><label style="font-size:10px;color:#cbd5e1;display:block;margin-bottom:3px;font-weight:bold">Salah deteksi? Pilih WO manual:</label>` +
                   `<select id="geoManualWoSelect" style="width:100%;background:#090d16;border:1px solid #475569;padding:6px;border-radius:4px;color:#fff;font-size:11px"><option value="">Otomatis (berdasarkan lokasi)</option>` +
                   list.map(x => `<option value="${x.w.id}" ${cur === x.w.id ? "selected" : ""}>${(x.w.road || "WO")} · ${Math.round(x.d)} m · ${x.w.status || "OPEN"}</option>`).join("") + `</select></div>`;
        }
        box.insertAdjacentHTML("beforeend", extra);
        const sel = document.getElementById("geoManualWoSelect");
        if (sel) sel.onchange = () => {
          window.geoForcedWoId = sel.value || null;
          window.proceedWithPhotoLocation(lat, lng, takenTime, img);
        };
      }
      if (currentUserRole === "viewer") {
        const st = document.getElementById("geoReportStatus");
        if (st) Array.from(st.options).forEach(o => { if (o.value === "CLOSED") o.remove(); });
      }
    } catch (e) { console.warn("wo-integration:", e); }
  };

  const origOpenStatus = window.openEvidenceStatusModal;
  window.openEvidenceStatusModal = function (target) {
    origOpenStatus(target);
    const r = document.querySelector('input[name="evidenceFinalStatus"][value="CLOSED"]');
    const wrap = r && (r.closest("label") || r.parentElement);
    if (wrap) wrap.style.display = currentUserRole === "viewer" ? "none" : "";
    if (currentUserRole === "viewer" && r && r.checked) { const p = document.querySelector('input[name="evidenceFinalStatus"][value="PROGRESS"]'); if (p) p.checked = true; }
  };
})();
