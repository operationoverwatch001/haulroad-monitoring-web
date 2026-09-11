let currentTab = 'grade';
let monitoringData = [];
let crossSectionData = [];
let roadNames = [];
let activeRoad = "";
let chartInstance = null;

// Daftarkan plugin Datalabels global untuk Chart.js
Chart.register(ChartDataLabels);

// 1. Inisialisasi Peta Leaflet (Basemap Satelit)
const map = L.map('map', { zoomControl: false }).setView([-2.0, 115.0], 15);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri'
}).addTo(map);

// 2. Load File Excel Overwatch.xlsx
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
  } catch (error) {
    document.getElementById('panel-body').innerHTML = 
      `<p style="color:red; font-size:12px; text-align:center;">Gagal memuat data Excel. Pastikan file Overwatch.xlsx ada di folder data/.</p>`;
  }
}

// 3. Pindah Tab Navigasi
function switchTab(tabName) {
  currentTab = tabName;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
  renderTabContent();
}

// 4. Ganti Jalan Aktif
function changeRoad(roadName) {
  activeRoad = roadName;
  renderTabContent();
}

// 5. Render Konten Panel Bawah Sesuai Tab Aktif
function renderTabContent() {
  const panelBody = document.getElementById('panel-body');
  const panelTitle = document.getElementById('panel-title');

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
        <span style="font-size:11px; color:#1f4e79;"><b>${roadData.length} STA</b></span>
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
        <select id="select-sta-cs" onchange="drawCrossSectionChart(this.value)" style="font-size:11px; padding:2px 6px;">
          ${roadData.map(d => `<option value="${d['STA']}">${d['STA']}</option>`).join('')}
        </select>
      </div>
      <div class="chart-container" style="height:140px;"><canvas id="chartCanvas"></canvas></div>
    `;
    if (roadData.length > 0) drawCrossSectionChart(roadData[0]["STA"]);
  }
}

// 6. Grafik Profil Memanjang (Angka Grade Positif Permanen di Atas Garis)
function drawLongSectionChart(dataSubset) {
  const ctx = document.getElementById('chartCanvas');
  if (!ctx) return;
  if (chartInstance) chartInstance.destroy();

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
      layout: {
        padding: { top: 25 }
      },
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
        x: {
          ticks: { font: { size: 9 }, maxRotation: 45, minRotation: 45 },
          grid: { display: false }
        },
        y: {
          title: { display: true, text: 'Elevasi (m RL)', font: { size: 10 } },
          ticks: { font: { size: 9 } }
        }
      }
    }
  });
}

// 7. Grafik Cross Section 3 Titik (Angka Kemiringan As ke Kiri & As ke Kanan)
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

  const monRow = monitoringData.find(d => (d["Nama Jalan"] || "").trim() === activeRoad && d["STA"] === staTarget);
  const cfL = monRow ? Math.abs(parseFloat(monRow["Crossfall Kiri (%)"]) || 0).toFixed(2) : "0.00";
  const cfR = monRow ? Math.abs(parseFloat(monRow["Crossfall Kanan (%)"]) || 0).toFixed(2) : "0.00";

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: pts.map(p => `${p["Point"]} (${p["Lebar_m"]}m)`),
      datasets: [{
        label: 'Elevasi RL (m)',
        data: pts.map(p => p["Elevasi_RL"]),
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
      layout: {
        padding: { top: 25 }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` Elevasi: ${ctx.parsed.y} m RL`
          }
        },
        datalabels: {
          align: 'top',
          anchor: 'end',
          offset: 6,
          font: { size: 10, weight: 'bold' },
          color: function(context) {
            const idx = context.dataIndex;
            if (idx === 0) {
              const val = parseFloat(cfL);
              return (val < 2.0 || val > 4.0) ? '#c00000' : '#1f4e79';
            }
            if (idx === 2) {
              const val = parseFloat(cfR);
              return (val < 2.0 || val > 4.0) ? '#c00000' : '#1f4e79';
            }
            return '#1f4e79';
          },
          formatter: function(value, context) {
            const idx = context.dataIndex;
            if (idx === 0) return `Kemiringan: ${cfL}%`;
            if (idx === 1) return `Elevasi: ${value}m`;
            if (idx === 2) return `Kemiringan: ${cfR}%`;
            return '';
          }
        }
      },
      scales: {
        x: { ticks: { font: { size: 10 } } },
        y: {
          title: { display: true, text: 'Elevasi (m RL)', font: { size: 10 } },
          ticks: { font: { size: 9 } }
        }
      }
    }
  });
}

// 8. Real-time Live GPS Tracking (Navigasi Lapangan Tanpa Dobel Titik)
let userMarker = null;
let userAccuracyCircle = null;
let isTracking = false;
let watchId = null;

function locateUser() {
  const gpsBtn = document.querySelector('.gps-btn');

  // Toggle on/off
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

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = pos.coords.accuracy;
      const latlng = [lat, lng];

      if (!userMarker) {
        userAccuracyCircle = L.circle(latlng, {
          radius: accuracy,
          color: '#0078d4',
          fillColor: '#2b88d8',
          fillOpacity: 0.15,
          weight: 1
        }).addTo(map);

        userMarker = L.circleMarker(latlng, {
          radius: 9,
          color: '#ffffff',
          fillColor: '#0078d4',
          fillOpacity: 1,
          weight: 3
        }).addTo(map);

        map.setView(latlng, 17);
      } else {
        // Pindahkan posisi yang sudah ada secara realtime
        userMarker.setLatLng(latlng);
        userAccuracyCircle.setLatLng(latlng);
        userAccuracyCircle.setRadius(accuracy);
        map.panTo(latlng);
      }
    },
    (err) => {
      console.warn(`GPS Error: ${err.message}`);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000
    }
  );
}

// Eksekusi Load Data Awal
loadExcelData();
