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

      // Hapus modal login
      const modal = document.getElementById('whitelistModal');
      if (modal) modal.remove();

      // Jalankan animasi loading splash screen & sinkronisasi data
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

  // Ambil dataset Excel di background
  loadExcelData();

  setTimeout(() => {
    if (bar) bar.style.width = '100%';
    if (statusText) statusText.innerText = `WELCOME, ${currentNamaUser.toUpperCase()}`;
    if (titleElement) titleElement.classList.add('glitch-outro');
  }, 2600);

  // Selesai intro: hilangkan total elemen splash dari DOM
  setTimeout(() => {
    if (splash) {
      splash.style.transition = 'opacity 0.4s ease';
      splash.style.opacity = '0';
      setTimeout(() => {
        splash.style.display = 'none';
        splash.remove(); // Dihapus bersih dari halaman
        
        // Paksa peta Leaflet hitung ulang ukuran kontainer
        if (map) {
          map.invalidateSize(true);
        }
      }, 400);
    }
  }, 3200);
}

// 3. Catat Log ke Server (Mode beacon no-cors)
function catatLogKeServer(kegiatan, detailAktivitas) {
  if (!currentNRP) return;
  const targetUrl = `${WEB_APP_URL}?action=LOG_AKTIVITAS&nrp=${encodeURIComponent(currentNRP)}&kegiatan=${encodeURIComponent(kegiatan)}&detail=${encodeURIComponent(detailAktivitas)}`;
  fetch(targetUrl, { mode: "no-cors" }).catch(err => console.error("Log error:", err));
}


// ==========================================
// KODE UTAMA WEBGIS (ELEVASI, TAB, PETA, DLL)
// ==========================================
let currentTab = 'grade';
let monitoringData = [];
let crossSectionData = [];
let roadNames = [];
let activeRoad = "";
let chartInstance = null;
let userYInterval = undefined;

// Daftarkan plugin Datalabels global untuk Chart.js
Chart.register(ChartDataLabels);

// Inisialisasi Peta Leaflet (Basemap Satelit Esri)
const map = L.map('map', { zoomControl: false }).setView([-2.169338, 115.572115], 15);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri'
}).addTo(map);

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
      activeRoad = roadNames[0] || "Jl Bontang";
      renderTabContent();
    }

    if (map) {
      map.invalidateSize(true);
    }

    catatLogKeServer("BUKA APLIKASI", `User ${currentNamaUser} (${currentNRP}) berhasil masuk Dashboard WebGIS.`);

  } catch (error) {
    console.error("Excel load error:", error);
    const panelBody = document.getElementById('panel-body');
    if (panelBody) {
      panelBody.innerHTML = 
        `<p style="color:red; font-size:12px; text-align:center;">Gagal memuat data Excel. Pastikan file Overwatch.xlsx ada di folder data/.</p>`;
    }
  }
}

// Navigasi Tab
function switchTab(tabName) {
  currentTab = tabName;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  if (window.event && window.event.target) {
    window.event.target.classList.add('active');
  }
  renderTabContent();
  catatLogKeServer("PINDAH TAB", `Melihat tab fitur: ${tabName.toUpperCase()}`);
}

// Ubah Pilihan Nama Jalan
function changeRoad(roadName) {
  activeRoad = roadName;
  renderTabContent();
  catatLogKeServer("GANTI JALAN", `Memilih ruas jalan: ${roadName}`);
}

// Ubah Kustomisasi Interval Elevasi Sumbu Y
function changeYInterval(val) {
  userYInterval = val === 'auto' ? undefined : parseFloat(val);
  const roadData = monitoringData.filter(d => (d["Nama Jalan"] || "").trim() === activeRoad);
  drawLongSectionChart(roadData);
}

// Render Panel Bawah Sesuai Tab
function renderTabContent() {
  const panelBody = document.getElementById('panel-body');
  const panelTitle = document.getElementById('panel-title');
  if (!panelBody || !panelTitle) return;

  const roadData = monitoringData.filter(d => (d["Nama Jalan"] || "").trim() === activeRoad);

  const roadSelectHtml = `
    <select onchange="changeRoad(this.value)" style="font-size:11px; font-weight:bold; padding:2px 4px; border-radius:4px;">
      ${roadNames.map(r => `<option value="${r}" ${r === activeRoad ? 'selected' : ''}>${r}</option>`).join('')}
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
    panelTitle.innerHTML = `Audit Lebar Jalan: ${roadSelectHtml}`;
    const nonStd = roadData.filter(d => d["Status Lebar Jalan"] === "Nonstandard");
    let listHtml = nonStd.map(d => `
      <div style="padding:6px 10px; background:#fff0f0; border-left:4px solid #c00000; margin-bottom:4px; font-size:12px; display:flex; justify-content:space-between;">
        <span>STA <b>${d["STA"]}</b>: Aktual <b>${d["Lebar Total (m)"]} m</b> (Std: ${d["Lebar Standar (m)"]} m)</span>
        <span style="color:#c00000; font-weight:bold;">Sempit</span>
      </div>
    `).join('');

    panelBody.innerHTML = nonStd.length ? listHtml : `<p style="font-size:12px; color:green; text-align:center; padding-top:20px;">Semua segmen di ${activeRoad} memenuhi standar lebar.</p>`;

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

  const roadFullData = monitoringData.filter(d => (d["Nama Jalan"] || "").trim() === activeRoad);
  const allElevations = roadFullData.map(d => parseFloat(d["Elevasi As (m)"])).filter(v => !isNaN(v));

  const step = userYInterval || 5;
  const rawMin = Math.min(...allElevations);
  const rawMax = Math.max(...allElevations);

  const globalYMin = Math.floor(rawMin / step) * step;
  const globalYMax = Math.ceil(rawMax / step) * step;

  const pointColors = dataSubset.map(d => {
    const status = d["Status Grade"];
    if (status === "Overgrade") return "#c00000";
    if (status === "Warning") return "#ffc000";
    return "#1f4e79";
  });

  const pointSizes = dataSubset.map(d => {
    return (d["Status Grade"] === "Warning" || d["Status Grade"] === "Overgrade") ? 6 : 3;
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
            if (d["Status Grade"] === "Overgrade") return "#c00000";
            if (d["Status Grade"] === "Warning") return "#b25900";
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
    pts = crossSectionData.filter(d => (d["Nama Jalan"] || "").trim() === activeRoad && d["STA"] === staTarget);
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

  const monRow = monitoringData.find(d => (d["Nama Jalan"] || "").trim() === activeRoad && d["STA"] === staTarget);
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

  const roadData = monitoringData.filter(d => (d["Nama Jalan"] || "").trim() === activeRoad);
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
