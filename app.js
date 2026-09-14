// ==========================================
// KONFIGURASI BACKEND GOOGLE SHEETS (LOG & WHITELIST)
// ==========================================
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyI2mHJu7uy3_hUd5LzMKURS4daDQ_aYGI--abSquAHINiW3XGf07VN5BpRlCYVSCxe5w/exec";
let currentNRP = "";
let currentNamaUser = "";

// 1. Verifikasi Login Whitelist
async function prosesLoginWebGIS() {
  const inputEl = document.getElementById('inputNrpLogin');
  const errorMsg = document.getElementById('loginErrorMsg');
  const btnLogin = document.getElementById('btnVerifikasiNRP');
  const nrpVal = inputEl ? inputEl.value.trim() : "";

  if (!nrpVal) {
    if (errorMsg) {
      errorMsg.style.color = "#ff4d4d";
      errorMsg.innerText = "NRP tidak boleh kosong!";
    }
    return;
  }

  if (errorMsg) {
    errorMsg.style.color = "#38bdf8";
    errorMsg.innerText = "Memverifikasi whitelist server...";
  }
  if (btnLogin) btnLogin.disabled = true;

  try {
    const targetUrl = `${WEB_APP_URL}?action=LOGIN&nrp=${encodeURIComponent(nrpVal)}`;
    const response = await fetch(targetUrl);
    const result = await response.json();

    if (result.status === "success") {
      currentNRP = nrpVal;
      currentNamaUser = result.nama;

      const modal = document.getElementById('whitelistModal');
      if (modal) modal.remove();

      mulaiAnimasiIntroDanLoadData();
    } else {
      if (btnLogin) btnLogin.disabled = false;
      if (errorMsg) {
        errorMsg.style.color = "#ff4d4d";
        errorMsg.innerText = result.pesan || "Akses ditolak!";
      }
    }
  } catch (err) {
    console.error("Login Error:", err);
    if (btnLogin) btnLogin.disabled = false;
    if (errorMsg) {
      errorMsg.style.color = "#ff4d4d";
      errorMsg.innerText = "Gagal terhubung ke database server!";
    }
  }
}

// 2. Timeline Animasi Intro Loading & Fetch Data
function mulaiAnimasiIntroDanLoadData() {
  const splash = document.getElementById('intro-splash');
  const bar = document.getElementById('loading-bar');
  const statusText = document.getElementById('status-text');
  const titleElement = document.querySelector('.glitch-title');

  if (splash) {
    splash.style.display = 'flex';
    splash.style.opacity = '1';
  }

  setTimeout(() => {
    if (bar) bar.style.width = '45%';
    if (statusText) statusText.innerText = 'READING AUDIT DATABASE...';
  }, 600);

  setTimeout(() => {
    if (bar) bar.style.width = '85%';
    if (statusText) statusText.innerText = 'SYNCHRONIZING TELEMETRY...';
  }, 1600);

  loadExcelData();
  loadRoadLayersGeoJSON();

  setTimeout(() => {
    if (bar) bar.style.width = '100%';
    if (statusText) statusText.innerText = `WELCOME, ${currentNamaUser.toUpperCase()}`;
    if (titleElement) titleElement.classList.add('glitch-outro');
  }, 2600);

  setTimeout(() => {
    if (splash) {
      splash.style.transition = 'opacity 0.4s ease';
      splash.style.opacity = '0';
      setTimeout(() => {
        splash.style.display = 'none';
        splash.remove();
        if (map) map.invalidateSize(true);
      }, 400);
    }
  }, 3200);
}

// 3. Catat Log ke Server
function catatLogKeServer(kegiatan, detailAktivitas) {
  if (!currentNRP) return;
  const targetUrl = `${WEB_APP_URL}?action=LOG_AKTIVITAS&nrp=${encodeURIComponent(currentNRP)}&kegiatan=${encodeURIComponent(kegiatan)}&detail=${encodeURIComponent(detailAktivitas)}`;
  fetch(targetUrl, { mode: "no-cors" }).catch(err => console.error("Log error:", err));
}

// ==========================================
// KODE UTAMA WEBGIS (PETA, PMTILES, GEOJSON)
// ==========================================
let currentTab = 'grade';
let monitoringData = [];
let crossSectionData = [];
let roadNames = [];
let activeRoad = "";
let chartInstance = null;
let userYInterval = undefined;
let roadGeoJsonLayer = null;

// State Seleksi Range STA di Peta
let selectedStartFeature = null;
let selectedEndFeature = null;

Chart.register(ChartDataLabels);

const map = L.map('map', { zoomControl: false }).setView([-2.169338, 115.572115], 15);

// 1. Layer Satelit Global Esri
const esriSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri'
}).addTo(map);

// 2. Drone Orthophoto (PMTiles via Worker)
const PMTILES_URL = "https://ortho-tiles.operationoverwatch001.workers.dev/Ortho_Update.pmtiles";
let orthoLayer = null;

const pmtilesLib = window.pmtiles;
if (pmtilesLib) {
  try {
    const protocol = new pmtilesLib.Protocol();
    if (L.TileLayer.addInitHook) {
      L.TileLayer.addInitHook(function() {
        this.options.pmtilesProtocol = protocol;
      });
    }

    const p = new pmtilesLib.PMTiles(PMTILES_URL);
    protocol.add(p);

    orthoLayer = pmtilesLib.leafletRasterLayer(p, {
      maxZoom: 22,
      maxNativeZoom: 20,
      attribution: 'Drone Orthophoto'
    }).addTo(map);

    p.getHeader().then(header => {
      if (header && header.minLon && header.minLat) {
        map.fitBounds([
          [header.minLat, header.minLon],
          [header.maxLat, header.maxLon]
        ]);
      }
    }).catch(e => console.warn("Tidak dapat membaca header PMTiles:", e));

  } catch (err) {
    console.error("Gagal mounting layer PMTiles:", err);
  }
}

// 3. Toggle Basemap Satelit Luar
let isBasemapActive = true;
function toggleBasemapSatelit() {
  const btn = document.getElementById('btnToggleBasemap');
  if (!btn) return;

  if (isBasemapActive) {
    map.removeLayer(esriSatellite);
    btn.innerHTML = '🌑 Satelit: <b>OFF</b>';
    btn.style.color = '#94a3b8';
    btn.style.borderColor = '#334155';
    isBasemapActive = false;
    catatLogKeServer("TOGGLE MAP", "Mematikan satelit luar (hanya orthophoto drone).");
  } else {
    esriSatellite.addTo(map);
    if (orthoLayer) orthoLayer.bringToFront();
    btn.innerHTML = '🌍 Satelit: <b>ON</b>';
    btn.style.color = '#38bdf8';
    btn.style.borderColor = '#1e293b';
    isBasemapActive = true;
    catatLogKeServer("TOGGLE MAP", "Menyalakan satelit luar global.");
  }
}

// Helper: Konversi angka meteran atau string ke format standar STA (280 -> 0+280)
function formatKeSTA(val) {
  if (val === undefined || val === null || val === "") return "-";
  const str = val.toString().trim();
  if (str.includes("+")) return str;
  const num = parseFloat(str);
  if (isNaN(num)) return str;
  const km = Math.floor(num / 1000);
  const m = Math.round(num % 1000).toString().padStart(3, '0');
  return `${km}+${m}`;
}

// Helper: Parsing nilai numerik meteran dari STA (misal: "0+280" -> 280, 280 -> 280)
function parseMeterSTA(val) {
  if (val === undefined || val === null || val === "") return 0;
  const str = val.toString().trim();
  if (str.includes("+")) {
    const parts = str.split("+");
    return (parseFloat(parts[0]) || 0) * 1000 + (parseFloat(parts[1]) || 0);
  }
  return parseFloat(str) || 0;
}

// Helper: Penentuan Gaya Warna Garis Jalan di Peta
function getRoadFeatureStyle(feature) {
  const props = feature.properties || {};
  const rawStation = props.Station_m !== undefined ? props.Station_m : (props.Station || props.station || props.STA || props.sta || props.ID || 0);
  const meterVal = parseMeterSTA(rawStation);
  const roadVal = (props.Nama_Jalan || props["Nama Jalan"] || activeRoad).trim();

  // Highlight Range Seleksi: Wajib cocok nama jalannya juga
  if (selectedStartFeature) {
    const startProps = selectedStartFeature.properties || {};
    const startRoad = (startProps.Nama_Jalan || startProps["Nama Jalan"] || activeRoad).trim();

    if (roadVal === startRoad) {
      const startM = parseMeterSTA(startProps.Station_m !== undefined ? startProps.Station_m : startProps.STA);
      
      if (selectedEndFeature) {
        const endProps = selectedEndFeature.properties || {};
        const endM = parseMeterSTA(endProps.Station_m !== undefined ? endProps.Station_m : endProps.STA);
        const minM = Math.min(startM, endM);
        const maxM = Math.max(startM, endM);

        if (meterVal >= minM && meterVal <= maxM) {
          return { color: "#00f0ff", weight: 7, opacity: 1 }; // Highlight Biru Neon Tebal untuk segmen terpilih
        }
      } else if (meterVal === startM) {
        return { color: "#00f0ff", weight: 7, opacity: 1 }; // Highlight Klik Pertama
      }
    }
  }

  const staFormatted = formatKeSTA(rawStation);
  const rawStatus = (props.Status || props["Status Grade"] || props.status || "").toString().toUpperCase();

  let isNonCompliant = rawStatus.includes("NON COMPLIANT") || rawStatus.includes("NONSTANDARD") || rawStatus.includes("OVERGRADE") || rawStatus.includes("SEMPIT");
  let isWarning = rawStatus.includes("WARNING");

  if (monitoringData && monitoringData.length > 0 && staFormatted !== "-") {
    const matchedRow = monitoringData.find(d => {
      const matchRoad = roadVal ? (d["Nama Jalan"] || "").trim().toLowerCase() === roadVal.toLowerCase() : true;
      const dSta = (d["STA"] || "").toString().trim();
      return matchRoad && (dSta === staFormatted || dSta === rawStation.toString());
    });

    if (matchedRow) {
      if (currentTab === 'lebar') {
        const sLebar = (matchedRow["Status Lebar Jalan"] || "").toUpperCase();
        if (sLebar.includes("NONSTANDARD") || sLebar.includes("SEMPIT") || sLebar.includes("NON COMPLIANT")) isNonCompliant = true;
      } else if (currentTab === 'grade') {
        const sGrade = (matchedRow["Status Grade"] || "").toUpperCase();
        if (sGrade.includes("OVERGRADE") || sGrade.includes("NONSTANDARD") || sGrade.includes("NON COMPLIANT")) isNonCompliant = true;
        if (sGrade.includes("WARNING")) isWarning = true;
      }
    }
  }

  if (currentTab === 'lebar') {
    if (isNonCompliant) return { color: "#e11d48", weight: 5, opacity: 0.95 }; // Merah
    return { color: "#22c55e", weight: 3.5, opacity: 0.85 }; // Hijau
  }

  if (currentTab === 'grade') {
    if (isNonCompliant) return { color: "#e11d48", weight: 5, opacity: 0.95 };
    if (isWarning) return { color: "#eab308", weight: 4.5, opacity: 0.95 };
    return { color: "#22c55e", weight: 3.5, opacity: 0.85 };
  }

  return { color: "#00e5ff", weight: 3.5, opacity: 0.85 };
}

// Reset Seleksi Segmen Jalan
function resetSegmentSelection() {
  if (!selectedStartFeature && !selectedEndFeature) return;
  selectedStartFeature = null;
  selectedEndFeature = null;
  if (roadGeoJsonLayer) roadGeoJsonLayer.setStyle(getRoadFeatureStyle);
  renderTabContent();
}

// Handler Klik Segmen Jalan
function handleFeatureClick(feature) {
  const props = feature.properties || {};
  const clickedRoad = (props.Nama_Jalan || props["Nama Jalan"] || activeRoad).trim();

  // Jika klik jalan berbeda, reset seleksi dan ganti jalan aktif
  if (clickedRoad && clickedRoad !== activeRoad) {
    selectedStartFeature = null;
    selectedEndFeature = null;
    changeRoad(clickedRoad);
  }

  if (currentTab === 'lebar') {
    if (!selectedStartFeature || (selectedStartFeature && selectedEndFeature)) {
      // Klik ke-1: Titik awal
      selectedStartFeature = feature;
      selectedEndFeature = null;
    } else {
      // Klik ke-2: Titik akhir
      selectedEndFeature = feature;
    }

    if (roadGeoJsonLayer) roadGeoJsonLayer.setStyle(getRoadFeatureStyle);
    renderLebarSummary();

    const staAwal = formatKeSTA(selectedStartFeature.properties.Station_m !== undefined ? selectedStartFeature.properties.Station_m : selectedStartFeature.properties.STA);
    const staAkhir = selectedEndFeature ? formatKeSTA(selectedEndFeature.properties.Station_m !== undefined ? selectedEndFeature.properties.Station_m : selectedEndFeature.properties.STA) : "-";
    catatLogKeServer("PILIH SEGMEN", `Inspeksi Lebar: ${activeRoad} (${staAwal} s/d ${staAkhir})`);
  } else if (currentTab === 'crossfall') {
    const sta = formatKeSTA(props.Station_m !== undefined ? props.Station_m : props.STA);
    const staSelect = document.getElementById('select-sta-cs');
    if (staSelect) staSelect.value = sta;
    drawCrossSectionChart(sta);
  }
}

// Event Peta: Klik di area bebas untuk membatalkan seleksi segmen
map.on('click', () => {
  if (selectedStartFeature || selectedEndFeature) {
    resetSegmentSelection();
  }
});

// Muat Vektor Spasial Garis Jalan (Road_Layers.geojson)
async function loadRoadLayersGeoJSON() {
  try {
    const res = await fetch('data/Road_Layers.geojson');
    if (!res.ok) return;

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("json") && !contentType.includes("octet-stream")) return;

    const geojsonData = await res.json();

    if (roadGeoJsonLayer) map.removeLayer(roadGeoJsonLayer);

    roadGeoJsonLayer = L.geoJSON(geojsonData, {
      style: getRoadFeatureStyle,
      onEachFeature: function(feature, layer) {
        const props = feature.properties || {};
        const rawStation = props.Station_m !== undefined ? props.Station_m : (props.Station || props.STA || props.sta || "-");
        const sta = formatKeSTA(rawStation);
        const road = props.Nama_Jalan || props["Nama Jalan"] || activeRoad;
        const lebarAktual = props.Lebar_m ? `<br>Lebar: <b>${parseFloat(props.Lebar_m).toFixed(1)} m</b>` : "";
        const payloadInfo = props.Kelas_Jala ? `<br>Kelas: <b>${props.Kelas_Jala}</b>` : "";

        layer.bindTooltip(`<b>${road}</b><br>STA: <b>${sta}</b>${lebarAktual}${payloadInfo}`, { sticky: true });

        layer.on('click', (e) => {
          L.DomEvent.stopPropagation(e); // Cegah trigger map.on('click') reset
          handleFeatureClick(feature);
        });
      }
    }).addTo(map);

    if (roadGeoJsonLayer.getLayers().length > 0) {
      map.fitBounds(roadGeoJsonLayer.getBounds(), { padding: [30, 30] });
    }
  } catch (err) {
    console.warn("Info GeoJSON Road Layers:", err.message);
  }
}

// Muat File Excel Overwatch.xlsx
async function loadExcelData() {
  try {
    const response = await fetch('data/Overwatch.xlsx');
    const arrayBuffer = await response.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });

    monitoringData = XLSX.utils.sheet_to_json(workbook.Sheets["Data_Monitoring"]);
    crossSectionData = XLSX.utils.sheet_to_json(workbook.Sheets["CrossSection_3Pts"]);

    if (monitoringData.length > 0) {
      roadNames = [...new Set(monitoringData.map(d => (d["Nama Jalan"] || "").trim()))].filter(n => n.length > 0);
      activeRoad = roadNames[0] || "Jl Sumba";
      renderTabContent();
    }

    if (roadGeoJsonLayer) roadGeoJsonLayer.setStyle(getRoadFeatureStyle);
    if (map) map.invalidateSize(true);

    catatLogKeServer("BUKA APLIKASI", `User ${currentNamaUser} (${currentNRP}) berhasil masuk Dashboard WebGIS.`);

  } catch (error) {
    console.error("Excel load error:", error);
    const panelBody = document.getElementById('panel-body');
    if (panelBody) {
      panelBody.innerHTML = `<p style="color:red; font-size:12px; text-align:center;">Gagal memuat data Excel. Pastikan file Overwatch.xlsx ada di folder data/.</p>`;
    }
  }
}

// Navigasi Tab
function switchTab(tabName) {
  currentTab = tabName;
  resetSegmentSelection();

  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  if (window.event && window.event.target) {
    window.event.target.classList.add('active');
  }

  if (roadGeoJsonLayer) roadGeoJsonLayer.setStyle(getRoadFeatureStyle);

  renderTabContent();
  catatLogKeServer("PINDAH TAB", `Melihat tab fitur: ${tabName.toUpperCase()}`);
}

// Ubah Pilihan Nama Jalan
function changeRoad(roadName) {
  activeRoad = roadName.trim();
  resetSegmentSelection();

  if (roadGeoJsonLayer) roadGeoJsonLayer.setStyle(getRoadFeatureStyle);

  renderTabContent();
  catatLogKeServer("GANTI JALAN", `Memilih ruas jalan: ${roadName}`);
}

// Ubah Kustomisasi Interval Elevasi Sumbu Y
function changeYInterval(val) {
  userYInterval = val === 'auto' ? undefined : parseFloat(val);
  const roadData = monitoringData.filter(d => (d["Nama Jalan"] || "").trim() === activeRoad);
  drawLongSectionChart(roadData);
}

// Render Panel Audit Lebar Jalan (Mendukung Single STA & Range 2 Klik)
function renderLebarSummary() {
  const panelBody = document.getElementById('panel-body');
  const panelTitle = document.getElementById('panel-title');
  if (!panelBody || !panelTitle) return;

  const roadSelectHtml = `
    <select onchange="changeRoad(this.value)" style="font-size:11px; font-weight:bold; padding:2px 4px; border-radius:4px;">
      ${roadNames.map(r => `<option value="${r}" ${r === activeRoad ? 'selected' : ''}>${r}</option>`).join('')}
    </select>
  `;
  panelTitle.innerHTML = `Audit Lebar Jalan: ${roadSelectHtml}`;

  // JIKA ADA SELEKSI DARI PETA
  if (selectedStartFeature) {
    const pStart = selectedStartFeature.properties || {};
    const mStart = parseMeterSTA(pStart.Station_m !== undefined ? pStart.Station_m : pStart.STA);
    const staStartFormatted = formatKeSTA(mStart);

    // KASUS A: KLIK 1 KALI (Single STA Terpilih)
    if (!selectedEndFeature) {
      const lebarAktual = parseFloat(pStart.Lebar_m || 0).toFixed(2);
      const lebarStandar = parseFloat(pStart.Standar_m || 30.8).toFixed(2);
      const statusText = (pStart.Status || "NON COMPLIANT").toUpperCase();
      const isSempit = statusText.includes("NON") || parseFloat(lebarAktual) < parseFloat(lebarStandar);
      const kelasJalan = pStart.Kelas_Jala || (pStart.Payload ? `Class ${pStart.Payload}` : "Class 200");
      const payloadTon = pStart.Payload || "200";

      panelBody.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; color:#fff; padding:6px 12px; border-radius:6px; margin-bottom:8px;">
          <div>
            <span style="font-size:11px; color:#94a3b8;">SELEKSI STA TUNGGAL:</span>
            <span style="font-size:14px; font-weight:bold; color:#00f0ff; margin-left:6px;">STA ${staStartFormatted}</span>
          </div>
          <button onclick="resetSegmentSelection()" style="background:#334155; color:#fff; border:none; padding:3px 8px; border-radius:4px; font-size:11px; cursor:pointer;">✕ Reset Peta</button>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:8px; margin-bottom:6px;">
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-left:4px solid ${isSempit ? '#e11d48' : '#22c55e'}; padding:6px 10px; border-radius:4px;">
            <div style="font-size:10px; color:#64748b;">Lebar Aktual</div>
            <div style="font-size:14px; font-weight:bold; color:${isSempit ? '#e11d48' : '#1e293b'};">${lebarAktual} m</div>
          </div>
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-left:4px solid #3b82f6; padding:6px 10px; border-radius:4px;">
            <div style="font-size:10px; color:#64748b;">Standar Desain</div>
            <div style="font-size:14px; font-weight:bold; color:#1e293b;">${lebarStandar} m</div>
          </div>
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-left:4px solid #f59e0b; padding:6px 10px; border-radius:4px;">
            <div style="font-size:10px; color:#64748b;">Payload Target</div>
            <div style="font-size:14px; font-weight:bold; color:#b45309;">${kelasJalan} (${payloadTon} Ton)</div>
          </div>
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-left:4px solid ${isSempit ? '#e11d48' : '#22c55e'}; padding:6px 10px; border-radius:4px;">
            <div style="font-size:10px; color:#64748b;">Kondisi Ruas</div>
            <div style="font-size:14px; font-weight:bold; color:${isSempit ? '#e11d48' : '#15803d'};">${isSempit ? 'Sempit / Non-Compliant' : 'Compliant (Standar)'}</div>
          </div>
        </div>
        <p style="font-size:10px; color:#64748b; margin:0; text-align:right;">*Klik di luar jalan untuk cancel seleksi, atau klik 1 titik lagi untuk rentang segmen.</p>
      `;
      return;
    }

    // KASUS B: KLIK 2 KALI (Rentang Segmen Terpilih)
    const pEnd = selectedEndFeature.properties || {};
    const mEnd = parseMeterSTA(pEnd.Station_m !== undefined ? pEnd.Station_m : pEnd.STA);

    const minM = Math.min(mStart, mEnd);
    const maxM = Math.max(mStart, mEnd);
    const staAwal = formatKeSTA(minM);
    const staAkhir = formatKeSTA(maxM);
    const totalPanjang = maxM - minM;

    // Filter fitur hanya pada jalan aktif dan di dalam range meteran
    let featuresInRange = [];
    if (roadGeoJsonLayer) {
      roadGeoJsonLayer.eachLayer(l => {
        const fp = l.feature.properties || {};
        const fRoad = (fp.Nama_Jalan || fp["Nama Jalan"] || activeRoad).trim();
        if (fRoad.toLowerCase() === activeRoad.toLowerCase()) {
          const fm = parseMeterSTA(fp.Station_m !== undefined ? fp.Station_m : fp.STA);
          if (fm >= minM && fm <= maxM) {
            featuresInRange.push(fp);
          }
        }
      });
    }

    let avgLebar = 0;
    let minLebar = 999;
    let maxLebar = 0;
    let countNonCompliant = 0;
    const stdLebar = parseFloat(pStart.Standar_m || 30.8).toFixed(2);
    const kelasJalan = pStart.Kelas_Jala || (pStart.Payload ? `Class ${pStart.Payload}` : "Class 200");
    const payloadTon = pStart.Payload || "200";

    if (featuresInRange.length > 0) {
      let totalW = 0;
      featuresInRange.forEach(f => {
        const w = parseFloat(f.Lebar_m || f.Shape_Leng || 0);
        totalW += w;
        if (w < minLebar) minLebar = w;
        if (w > maxLebar) maxLebar = w;
        const st = (f.Status || "").toUpperCase();
        if (st.includes("NON") || w < parseFloat(stdLebar)) countNonCompliant++;
      });
      avgLebar = (totalW / featuresInRange.length).toFixed(2);
      minLebar = minLebar.toFixed(2);
      maxLebar = maxLebar.toFixed(2);
    } else {
      avgLebar = parseFloat(pStart.Lebar_m || 0).toFixed(2);
      minLebar = avgLebar;
      maxLebar = avgLebar;
    }

    panelBody.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; color:#fff; padding:6px 12px; border-radius:6px; margin-bottom:8px;">
        <div>
          <span style="font-size:11px; color:#94a3b8;">SEGMEN TERPILIH:</span>
          <span style="font-size:14px; font-weight:bold; color:#00f0ff; margin-left:6px;">STA ${staAwal} s/d ${staAkhir}</span>
        </div>
        <button onclick="resetSegmentSelection()" style="background:#334155; color:#fff; border:none; padding:3px 8px; border-radius:4px; font-size:11px; cursor:pointer;">✕ Reset Peta</button>
      </div>

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:8px;">
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-left:4px solid #3b82f6; padding:6px 10px; border-radius:4px;">
          <div style="font-size:10px; color:#64748b;">Total Panjang Segmen</div>
          <div style="font-size:14px; font-weight:bold; color:#1e293b;">${totalPanjang} Meter</div>
        </div>

        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-left:4px solid #e11d48; padding:6px 10px; border-radius:4px;">
          <div style="font-size:10px; color:#64748b;">Rata-rata Lebar (Aktual)</div>
          <div style="font-size:14px; font-weight:bold; color:#e11d48;">${avgLebar} m</div>
          <div style="font-size:9px; color:#64748b;">Min: ${minLebar}m | Max: ${maxLebar}m</div>
        </div>

        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-left:4px solid #22c55e; padding:6px 10px; border-radius:4px;">
          <div style="font-size:10px; color:#64748b;">Standar Desain</div>
          <div style="font-size:14px; font-weight:bold; color:#1e293b;">${stdLebar} Meter</div>
          <div style="font-size:9px; color:#64748b;">Defisit: -${(parseFloat(stdLebar) - parseFloat(avgLebar)).toFixed(2)} m</div>
        </div>

        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-left:4px solid #f59e0b; padding:6px 10px; border-radius:4px;">
          <div style="font-size:10px; color:#64748b;">Payload Kelas Hauler</div>
          <div style="font-size:14px; font-weight:bold; color:#b45309;">${kelasJalan}</div>
          <div style="font-size:9px; color:#64748b;">Kapasitas: ${payloadTon} Ton</div>
        </div>

        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-left:4px solid #e11d48; padding:6px 10px; border-radius:4px;">
          <div style="font-size:10px; color:#64748b;">Kesesuaian Standar</div>
          <div style="font-size:14px; font-weight:bold; color:#e11d48;">${countNonCompliant} Slice Sempit</div>
          <div style="font-size:9px; color:#e11d48;">Perlu pelebaran roadway</div>
        </div>
      </div>
    `;
    return;
  }

  // TAMPILAN DEFAULT JIKA TIDAK ADA YANG TERPILIH
  const roadData = monitoringData.filter(d => (d["Nama Jalan"] || "").trim().toLowerCase() === activeRoad.toLowerCase());
  const nonStd = roadData.filter(d => {
    const s = (d["Status Lebar Jalan"] || "").toUpperCase();
    return s.includes("NONSTANDARD") || s.includes("SEMPIT") || s.includes("NON COMPLIANT");
  });

  let listHtml = nonStd.map(d => `
    <div style="padding:6px 10px; background:#fff0f0; border-left:4px solid #c00000; margin-bottom:4px; font-size:12px; display:flex; justify-content:space-between; align-items:center;">
      <span>STA <b>${d["STA"]}</b>: Aktual <b>${d["Lebar Total (m)"]} m</b> (Std: ${d["Lebar Standar (m)"]} m)</span>
      <span style="color:#c00000; font-weight:bold;">Sempit</span>
    </div>
  `).join('');

  panelBody.innerHTML = `
    <div style="font-size:11px; color:#64748b; margin-bottom:6px;">
      💡 <i>Klik salah satu garis di peta untuk detail STA, atau klik 2 titik untuk ringkasan segmen. Klik area peta kosong untuk reset.</i>
    </div>
    ${nonStd.length ? listHtml : `<p style="font-size:12px; color:green; text-align:center; padding-top:20px;">Semua segmen di ${activeRoad} memenuhi standar lebar.</p>`}
  `;
}

// Render Konten Tab Panel Bawah
function renderTabContent() {
  const panelBody = document.getElementById('panel-body');
  const panelTitle = document.getElementById('panel-title');
  if (!panelBody || !panelTitle) return;

  const roadData = monitoringData.filter(d => (d["Nama Jalan"] || "").trim().toLowerCase() === activeRoad.toLowerCase());

  const roadSelectHtml = `
    <select onchange="changeRoad(this.value)" style="font-size:11px; font-weight:bold; padding:2px 4px; border-radius:4px;">
      ${roadNames.map(r => `<option value="${r}" ${r.toLowerCase() === activeRoad.toLowerCase() ? 'selected' : ''}>${r}</option>`).join('')}
    </select>
  `;

  if (currentTab === 'grade') {
    panelTitle.innerHTML = `Profil Memanjang: ${roadSelectHtml}`;
    panelBody.innerHTML = `
      <div style="font-size:11px; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
        <span style="color:#555;">Kuning: <b>Warning (>8%)</b> | Merah: <b>Overgrade (>10%)</b></span>
        <div style="display:flex; gap:4px; align-items:center;">
          <select id="yIntervalSelect" onchange="changeYInterval(this.value)" style="font-size:10px; padding:2px; border-radius:3px;">
            <option value="auto" ${userYInterval === undefined ? 'selected' : ''}>Interval: Auto</option>
            <option value="1" ${userYInterval === 1 ? 'selected' : ''}>Step: 1m</option>
            <option value="2" ${userYInterval === 2 ? 'selected' : ''}>Step: 2m</option>
            <option value="5" ${userYInterval === 5 ? 'selected' : ''}>Step: 5m</option>
            <option value="10" ${userYInterval === 10 ? 'selected' : ''}>Step: 10m</option>
          </select>
          <button onclick="openPdfModal()" style="background:#1f4e79; color:#fff; border:none; padding:2px 6px; border-radius:3px; font-size:10px; cursor:pointer; font-weight:bold;">📥 PDF</button>
          <span style="font-size:11px; color:#1f4e79;"><b>${roadData.length} STA</b></span>
        </div>
      </div>
      <div class="chart-container" style="height:150px;"><canvas id="chartCanvas"></canvas></div>
    `;
    drawLongSectionChart(roadData);

  } else if (currentTab === 'lebar') {
    renderLebarSummary();

  } else if (currentTab === 'crossfall') {
    panelTitle.innerHTML = `Cross Section 3 Titik: ${roadSelectHtml}`;
    panelBody.innerHTML = `
      <div style="font-size:11px; margin-bottom:6px; display:flex; align-items:center; gap:8px;">
        <span>Pilih STA:</span>
        <select id="select-sta-cs" onchange="drawCrossSectionChart(this.value); catatLogKeServer('VIEW_STA', 'Melihat Cross Section ${activeRoad} STA ' + this.value);" style="font-size:11px; padding:2px 6px;">
          ${roadData.map(d => `<option value="${d['STA']}">${d['STA']}</option>`).join('')}
        </select>
      </div>
      <div class="chart-container" style="height:140px;"><canvas id="chartCanvas"></canvas></div>
    `;
    if (roadData.length > 0) drawCrossSectionChart(roadData[0]["STA"]);
  }
}

// Grafik Profil Memanjang
function drawLongSectionChart(dataSubset) {
  const ctx = document.getElementById('chartCanvas');
  if (!ctx) return;
  if (chartInstance) chartInstance.destroy();

  const roadFullData = monitoringData.filter(d => (d["Nama Jalan"] || "").trim().toLowerCase() === activeRoad.toLowerCase());
  const allElevations = roadFullData.map(d => parseFloat(d["Elevasi As (m)"])).filter(v => !isNaN(v));

  const step = userYInterval || 5;
  const rawMin = Math.min(...allElevations);
  const rawMax = Math.max(...allElevations);

  const globalYMin = Math.floor(rawMin / step) * step;
  const globalYMax = Math.ceil(rawMax / step) * step;

  const pointColors = dataSubset.map(d => {
    const status = (d["Status Grade"] || "").toUpperCase();
    if (status.includes("OVERGRADE") || status.includes("NON COMPLIANT")) return "#c00000";
    if (status.includes("WARNING")) return "#ffc000";
    return "#1f4e79";
  });

  const pointSizes = dataSubset.map(d => {
    const status = (d["Status Grade"] || "").toUpperCase();
    return (status.includes("WARNING") || status.includes("OVERGRADE") || status.includes("NON COMPLIANT")) ? 6 : 3;
  });

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dataSubset.map(d => d["STA"]),
      datasets: [{
        label: 'Elevasi As (m)',
        data: dataSubset.map(d => d["Elevasi As (m)"]),
        borderColor: '#2e75b6',
        backgroundColor: 'rgba(46, 117, 182, 0.08)',
        borderWidth: 2,
        fill: true,
        pointBackgroundColor: pointColors,
        pointBorderColor: pointColors,
        pointRadius: pointSizes,
        tension: 0.1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 25 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (c) => `STA ${dataSubset[c[0].dataIndex]["STA"]} (${activeRoad})`,
            label: (c) => {
              const d = dataSubset[c.dataIndex];
              const g = d["Grade Longitudinal (%)"];
              const gVal = (g !== undefined && g !== null && !isNaN(g)) ? Math.abs(g).toFixed(2) + "%" : "-";
              return [` Elevasi: ${d["Elevasi As (m)"]} m RL`, ` Grade: ${gVal} (${d["Status Grade"] || "-"})`];
            }
          }
        },
        datalabels: {
          align: 'top',
          anchor: 'end',
          offset: 4,
          font: { size: 8, weight: 'bold' },
          color: function(context) {
            const d = dataSubset[context.dataIndex];
            const status = (d["Status Grade"] || "").toUpperCase();
            if (status.includes("OVERGRADE") || status.includes("NON COMPLIANT")) return "#c00000";
            if (status.includes("WARNING")) return "#b25900";
            return "#444444";
          },
          formatter: function(value, context) {
            const d = dataSubset[context.dataIndex];
            const g = d["Grade Longitudinal (%)"];
            if (g === undefined || g === null || isNaN(g)) return "";
            return Math.abs(g).toFixed(1) + "%";
          }
        }
      },
      scales: {
        x: { ticks: { font: { size: 9 }, maxRotation: 45, minRotation: 45 }, grid: { display: false } },
        y: {
          min: globalYMin,
          max: globalYMax,
          ticks: { stepSize: userYInterval, font: { size: 9 } },
          title: { display: true, text: 'Elevasi (m RL)', font: { size: 10 } }
        }
      }
    }
  });
}

// Grafik Cross Section 3 Titik
function drawCrossSectionChart(staTarget) {
  const ctx = document.getElementById('chartCanvas');
  if (!ctx) return;
  if (chartInstance) chartInstance.destroy();

  const keyTarget = `${activeRoad}_${staTarget}`;
  let pts = crossSectionData.filter(d => (d["Key"] || "").trim() === keyTarget);
  if (pts.length < 3) {
    pts = crossSectionData.filter(d => (d["Nama Jalan"] || "").trim().toLowerCase() === activeRoad.toLowerCase() && d["STA"] === staTarget);
  }
  if (pts.length < 3) return;

  const ptLeft = pts.find(p => p["Point"].includes("Kiri")) || pts[0];
  const ptAs = pts.find(p => p["Point"].includes("As")) || pts[1];
  const ptRight = pts.find(p => p["Point"].includes("Kanan")) || pts[2];

  const elevAs = parseFloat(ptAs["Elevasi_RL"]);
  const distAs = parseFloat(ptAs["Lebar_m"]);
  const distLeft = parseFloat(ptLeft["Lebar_m"]);
  const distRight = parseFloat(ptRight["Lebar_m"]);

  const offsetLeft = -(distAs - distLeft);
  const offsetRight = distRight - distAs;
  const maxSpan = Math.max(Math.abs(offsetLeft), Math.abs(offsetRight), 15) + 2;

  const scatterData = [
    { x: offsetLeft, y: parseFloat(ptLeft["Elevasi_RL"]), label: `Tepi Kiri (${offsetLeft.toFixed(1)}m)` },
    { x: 0, y: elevAs, label: `As Jalan (0.0m)` },
    { x: offsetRight, y: parseFloat(ptRight["Elevasi_RL"]), label: `Tepi Kanan (+${offsetRight.toFixed(1)}m)` }
  ];

  const monRow = monitoringData.find(d => (d["Nama Jalan"] || "").trim().toLowerCase() === activeRoad.toLowerCase() && d["STA"] === staTarget);
  const cfL = monRow ? Math.abs(parseFloat(monRow["Crossfall Kiri (%)"]) || 0).toFixed(2) : "0.00";
  const cfR = monRow ? Math.abs(parseFloat(monRow["Crossfall Kanan (%)"]) || 0).toFixed(2) : "0.00";

  const yMin = parseFloat((elevAs - 2.0).toFixed(2));
  const yMax = parseFloat((elevAs + 2.0).toFixed(2));

  chartInstance = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Cross Section',
        data: scatterData,
        showLine: true,
        borderColor: '#2e75b6',
        backgroundColor: '#ffc000',
        borderWidth: 2.5,
        pointRadius: 6,
        pointBackgroundColor: '#ffc000',
        pointBorderColor: '#1f4e79',
        tension: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 25, bottom: 5, left: 10, right: 10 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${scatterData[c.dataIndex].label} | RL: ${c.parsed.y.toFixed(2)}m` } },
        datalabels: {
          align: 'top',
          anchor: 'end',
          offset: 6,
          font: { size: 10, weight: 'bold' },
          color: function(context) {
            const idx = context.dataIndex;
            if (idx === 0) { const val = parseFloat(cfL); return (val < 2.0 || val > 4.0) ? '#c00000' : '#1f4e79'; }
            if (idx === 2) { const val = parseFloat(cfR); return (val < 2.0 || val > 4.0) ? '#c00000' : '#1f4e79'; }
            return '#1f4e79';
          },
          formatter: function(value, context) {
            const idx = context.dataIndex;
            if (idx === 0) return `Kemiringan: ${cfL}%`;
            if (idx === 1) return `Elevasi: ${elevAs.toFixed(2)}m`;
            if (idx === 2) return `Kemiringan: ${cfR}%`;
            return '';
          }
        }
      },
      scales: {
        x: {
          type: 'linear', position: 'bottom', min: -maxSpan, max: maxSpan,
          grid: { color: (ctx) => (ctx.tick.value === 0 ? '#1f4e79' : '#e0e0e0'), lineWidth: (ctx) => (ctx.tick.value === 0 ? 2 : 1) },
          ticks: { font: { size: 9 }, callback: (val) => (val === 0 ? 'As Jalan (0m)' : val < 0 ? `Kiri ${Math.abs(val)}m` : `Kanan +${val}m`) }
        },
        y: { min: yMin, max: yMax, ticks: { stepSize: 0.5, font: { size: 9 }, callback: (val) => `${val.toFixed(2)}` }, title: { display: true, text: 'Elevasi (m RL)', font: { size: 10 } } }
      }
    }
  });
}

// Real-time Live GPS Tracking
let userMarker = null;
let userAccuracyCircle = null;
let isTracking = false;
let watchId = null;

function locateUser() {
  const gpsBtn = document.querySelector('.gps-btn');
  if (isTracking) {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (userMarker) map.removeLayer(userMarker);
    if (userAccuracyCircle) map.removeLayer(userAccuracyCircle);
    userMarker = null;
    userAccuracyCircle = null;
    isTracking = false;
    gpsBtn.style.background = '#ffffff';
    gpsBtn.style.color = '#000000';
    return;
  }
  if (!navigator.geolocation) {
    alert("Browser HP tidak mendukung fitur GPS.");
    return;
  }

  isTracking = true;
  gpsBtn.style.background = '#0078d4';
  gpsBtn.style.color = '#ffffff';
  catatLogKeServer("GPS LIVE", "Menyalakan live tracking GPS di lapangan.");

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = pos.coords.accuracy;
      const latlng = [lat, lng];

      if (!userMarker) {
        userAccuracyCircle = L.circle(latlng, { radius: accuracy, color: '#0078d4', fillColor: '#2b88d8', fillOpacity: 0.15, weight: 1 }).addTo(map);
        userMarker = L.circleMarker(latlng, { radius: 9, color: '#ffffff', fillColor: '#0078d4', fillOpacity: 1, weight: 3 }).addTo(map);
        map.setView(latlng, 17);
      } else {
        userMarker.setLatLng(latlng);
        userAccuracyCircle.setLatLng(latlng);
        userAccuracyCircle.setRadius(accuracy);
        map.panTo(latlng);
      }
    },
    (err) => { console.warn(`GPS Error: ${err.message}`); },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
  );
}

// Toggle Show/Hide Panel Bawah
document.addEventListener("DOMContentLoaded", () => {
  const bottomPanel = document.getElementById('bottom-panel');
  const panelHeader = document.querySelector('.panel-header');
  if (bottomPanel && panelHeader) {
    let startY = 0, currentY = 0, isDragging = false;
    panelHeader.addEventListener('click', (e) => {
      if (['SELECT', 'OPTION', 'BUTTON'].includes(e.target.tagName)) return;
      bottomPanel.classList.toggle('minimized');
    });
    panelHeader.addEventListener('touchstart', (e) => {
      if (['SELECT', 'BUTTON'].includes(e.target.tagName)) return;
      startY = e.touches[0].clientY; isDragging = true;
    }, { passive: true });
    panelHeader.addEventListener('touchmove', (e) => { if (!isDragging) return; currentY = e.touches[0].clientY; }, { passive: true });
    panelHeader.addEventListener('touchend', () => {
      if (!isDragging) return; isDragging = false;
      const diffY = currentY - startY;
      if (diffY > 30) bottomPanel.classList.add('minimized');
      else if (diffY < -30) bottomPanel.classList.remove('minimized');
    });
  }
});

// Modal & Export PDF
function openPdfModal() {
  document.getElementById('pdfModalOverlay').style.display = 'flex';
}

function closePdfModal() {
  document.getElementById('pdfModalOverlay').style.display = 'none';
}

async function executeExportPDF() {
  closePdfModal();
  const selectedOpt = document.querySelector('input[name="pdfExportOpt"]:checked').value;

  const { jsPDF } = window.jspdf;
  if (!jsPDF) {
    alert("Library jsPDF belum dimuat dengan benar.");
    return;
  }

  const chartCtx = document.getElementById('chartCanvas');
  const chartContainer = chartCtx ? chartCtx.closest('.chart-container') : null;
  if (!chartInstance || !chartContainer) {
    alert("Grafik tidak ditemukan atau belum dirender!");
    return;
  }

  const roadData = monitoringData.filter(d => (d["Nama Jalan"] || "").trim().toLowerCase() === activeRoad.toLowerCase());
  catatLogKeServer("EXPORT PDF", `Mengekspor laporan PDF profil jalan ${activeRoad} (${selectedOpt}).`);

  if (selectedOpt === 'single') {
    const originalWidth = chartContainer.style.width;
    const totalLabels = chartInstance.data.labels.length;

    chartContainer.style.width = `${Math.max(totalLabels * 45, 1400)}px`;
    chartInstance.resize();

    setTimeout(async () => {
      try {
        const canvas = await html2canvas(chartContainer, { scale: 2, useCORS: true });
        const imgData = canvas.toDataURL('image/png');

        const pdf = new jsPDF('l', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(12);
        pdf.text(`OPERATION OVERWATCH - PROFIL MEMANJANG JALAN: ${activeRoad.toUpperCase()}`, 10, 10);

        pdf.addImage(imgData, 'PNG', 10, 15, pdfWidth - 20, pdfHeight);
        pdf.save(`Profil_Memanjang_${activeRoad.replace(/\s+/g, '_')}_Full.pdf`);
      } catch (err) {
        console.error(err);
        alert("Gagal mengexport PDF.");
      } finally {
        chartContainer.style.width = originalWidth;
        chartInstance.resize();
        drawLongSectionChart(roadData);
      }
    }, 400);

  } else {
    const originalLabels = [...chartInstance.data.labels];
    const originalDatasets = chartInstance.data.datasets.map(d => [...d.data]);

    const chunkSize = 25;
    const pdf = new jsPDF('l', 'mm', 'a4');

    const originalWidth = chartContainer.style.width;
    chartContainer.style.width = `1100px`;
    chartInstance.resize();

    try {
      for (let i = 0; i < originalLabels.length; i += chunkSize) {
        const chunkLabels = originalLabels.slice(i, i + chunkSize);
        const chunkDatasets = originalDatasets.map(d => d.slice(i, i + chunkSize));

        chartInstance.data.labels = chunkLabels;
        chartInstance.data.datasets.forEach((dataset, idx) => {
          dataset.data = chunkDatasets[idx];
        });
        chartInstance.update();

        await new Promise(resolve => setTimeout(resolve, 300));

        const canvas = await html2canvas(chartContainer, { scale: 2, useCORS: true });
        const imgData = canvas.toDataURL('image/png');

        if (i > 0) pdf.addPage();

        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * (pdfWidth - 20)) / canvas.width;

        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(11);
        pdf.text(`OVERWATCH ROAD INSPECTOR - ${activeRoad.toUpperCase()} (STA: ${originalLabels[i]} s/d ${originalLabels[Math.min(i + chunkSize - 1, originalLabels.length - 1)]})`, 10, 10);

        pdf.addImage(imgData, 'PNG', 10, 15, pdfWidth - 20, pdfHeight);
      }

      pdf.save(`Profil_Memanjang_${activeRoad.replace(/\s+/g, '_')}_Section.pdf`);
    } catch (err) {
      console.error(err);
      alert("Gagal melakukan proses multi-page PDF.");
    } finally {
      chartContainer.style.width = originalWidth;
      chartInstance.data.labels = originalLabels;
      chartInstance.data.datasets.forEach((dataset, idx) => {
        dataset.data = originalDatasets[idx];
      });
      chartInstance.update();
      drawLongSectionChart(roadData);
    }
  }
}
