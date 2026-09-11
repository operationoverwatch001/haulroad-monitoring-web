let currentTab = 'grade';
let monitoringData = [];
let crossSectionData = [];
let activeRoad = "";
let chartInstance = null;

// 1. Inisialisasi Peta Leaflet (Sementara Basemap Satelit)
const map = L.map('map', { zoomControl: false }).setView([-2.0, 115.0], 15);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri'
}).addTo(map);

// 2. Fungsi Load Langsung File Excel Overwatch.xlsx
async function loadExcelData() {
  try {
    const response = await fetch('data/Overwatch.xlsx');
    const arrayBuffer = await response.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });

    // Baca Sheet Data_Monitoring & CrossSection_3Pts
    monitoringData = XLSX.utils.sheet_to_json(workbook.Sheets["Data_Monitoring"]);
    crossSectionData = XLSX.utils.sheet_to_json(workbook.Sheets["CrossSection_3Pts"]);

    if (monitoringData.length > 0) {
      activeRoad = monitoringData[0]["Nama Jalan"];
      renderTabContent();
    }
  } catch (error) {
    document.getElementById('panel-body').innerHTML = 
      `<p style="color:red; font-size:12px; text-align:center;">Gagal memuat file Overwatch.xlsx. Pastikan file ada di folder data/.</p>`;
  }
}

// 3. Perpindahan 3 Tab
function switchTab(tabName) {
  currentTab = tabName;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
  renderTabContent();
}

// 4. Render Konten Sesuai Tab
function renderTabContent() {
  const panelBody = document.getElementById('panel-body');
  const panelTitle = document.getElementById('panel-title');

  if (currentTab === 'grade') {
    panelTitle.innerText = `Profil Memanjang: ${activeRoad}`;
    panelBody.innerHTML = `
      <div style="font-size:11px; margin-bottom:4px; display:flex; justify-content:space-between;">
        <span>Filter Range STA:</span>
        <select id="sta-filter" onchange="updateGradeChart(this.value)" style="font-size:11px;">
          <option value="all">Semua STA</option>
          <option value="0+000-0+200">0+000 s/d 0+200</option>
          <option value="0+200-0+500">0+200 s/d 0+500</option>
          <option value="0+500-1+000">0+500 s/d 1+000</option>
        </select>
      </div>
      <div class="chart-container"><canvas id="chartCanvas"></canvas></div>
    `;
    drawLongSectionChart(monitoringData);

  } else if (currentTab === 'lebar') {
    panelTitle.innerText = `Audit Lebar Jalan: ${activeRoad}`;
    const nonStd = monitoringData.filter(d => d["Status Lebar Jalan"] === "Nonstandard");
    let listHtml = nonStd.map(d => `
      <div style="padding:6px; background:#fff0f0; border-left:4px solid #c00000; margin-bottom:6px; font-size:12px;">
        <b>STA ${d["STA"]}</b>: Aktual <b>${d["Lebar Total (m)"]} m</b> (Standar: ${d["Lebar Standar (m)"]} m)
        <span style="color:#c00000; float:right;">Sempit</span>
      </div>
    `).join('');

    panelBody.innerHTML = nonStd.length ? listHtml : `<p style="font-size:12px; color:green;">Semua segmen memenuhi standar.</p>`;

  } else if (currentTab === 'crossfall') {
    panelTitle.innerText = `Cross Section 3 Titik: ${activeRoad}`;
    panelBody.innerHTML = `
      <div style="font-size:11px; margin-bottom:4px;">
        Pilih STA: 
        <select id="select-sta-cs" onchange="drawCrossSectionChart(this.value)" style="font-size:11px;">
          ${monitoringData.map(d => `<option value="${d['STA']}">${d['STA']}</option>`).join('')}
        </select>
      </div>
      <div class="chart-container"><canvas id="chartCanvas"></canvas></div>
    `;
    drawCrossSectionChart(monitoringData[0]["STA"]);
  }
}

// 5. Render Grafik Profil Memanjang (Tab Grade)
function drawLongSectionChart(dataSubset) {
  const ctx = document.getElementById('chartCanvas');
  if (!ctx) return;
  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dataSubset.map(d => d["STA"]),
      datasets: [{
        label: 'Elevasi As (m)',
        data: dataSubset.map(d => d["Elevasi As (m)"]),
        borderColor: '#1f4e79',
        backgroundColor: '#2e75b6',
        borderWidth: 2,
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { font: { size: 9 } } },
        y: { ticks: { font: { size: 9 } } }
      },
      plugins: { legend: { display: false } }
    }
  });
}

// 6. Render Grafik 3 Titik (Tab Crossfall)
function drawCrossSectionChart(staTarget) {
  const ctx = document.getElementById('chartCanvas');
  if (!ctx) return;
  if (chartInstance) chartInstance.destroy();

  const pts = crossSectionData.filter(d => d["STA"] === staTarget);
  if (pts.length < 3) return;

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: pts.map(p => `${p["Point"]} (${p["Lebar_m"]}m)`),
      datasets: [{
        label: 'Elevasi RL',
        data: pts.map(p => p["Elevasi_RL"]),
        borderColor: '#c00000',
        backgroundColor: '#ffc000',
        borderWidth: 2,
        pointRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { ticks: { font: { size: 9 } } },
        x: { ticks: { font: { size: 9 } } }
      },
      plugins: { legend: { display: false } }
    }
  });
}

// 7. Deteksi GPS Lapangan
function locateUser() {
  map.locate({ setView: true, maxZoom: 17 });
  map.on('locationfound', (e) => {
    L.circleMarker(e.latlng, { radius: 8, color: '#0078d4', fillColor: '#2b88d8', fillOpacity: 0.8 }).addTo(map);
  });
}

// Eksekusi Muat Data
loadExcelData();