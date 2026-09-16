// ==========================================
// 1. DEKLARASI STATE GLOBAL & INISIALISASI PETA
// ==========================================
const SUPABASE_URL = 'https://bjgojyazemlrwnqpxoqp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mUqC6rBWoHL-5IjW44uhfA_TL7YB1Zg';

const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// URL Web App Google Apps Script Akun Kantor
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycby59dwiJ6H78OiXH_NIIvLj6mS6qwGH0zKa-7Pf70XYAoiQEXoeTK37Hav6zLkVIxUH/exec";

let currentNRP = "SUPABASE_USER";
let currentUserRole = "viewer"; 

let currentTab = 'grade';
let monitoringData = [];
let crossSectionData = [];
let roadNames = [];
let activeRoad = "";
let chartInstance = null;
let userYInterval = undefined;

let rawWidthFeatures = [];
let roadWidthLayer = null;        
let roadGradeLayer = null;        
let gradeLabelsLayer = L.layerGroup();  
let allStaMarkers = []; // Cache marker STA untuk optimasi Viewport Culling

let selectedStartMeter = null;
let selectedEndMeter = null;
let selectedRoadTarget = "";

// State Mode Work Order & Multi-User Cloud Storage
let isWorkOrderModeActive = false;
let activeWoTool = null; // 'mark' atau 'draw'
let activeWoFeatureData = null;
let currentWoMode = 'create'; // 'create', 'edit', atau 'view'
let currentActiveWoId = null;
let allWorkOrders = {}; 
let allDrawLines = {};

let workOrderMarkersLayer = L.layerGroup(); 
let workOrderDrawingsLayer = L.layerGroup(); 

// Variabel Mouse-Drag / Touch Freehand Draw
let isDrawingActive = false;
let currentDrawPoints = [];
let tempDrawPolyline = null;
let selectedLineForWo = null; 

// State Filter Tanggal Kalender (Default: null = Real-time Hari Ini)
let calendarFilterDate = null; 

// State Antrean Akumulasi Multi-Foto & Update Per-Job
let mainUploadFilesQueue = [];
let jobUpdateFilesQueue = [];
let activeJobUpdateIndex = null;
let currentTimelineHistory = [];

let userMarker = null;
let userAccuracyCircle = null;
let isTracking = false;
let watchId = null;

Chart.register(ChartDataLabels);

// Inisialisasi Peta Leaflet
const map = L.map('map', { 
  zoomControl: false,
  preferCanvas: true 
}).setView([-2.169338, 115.572115], 15);

const esriSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri'
}).addTo(map);

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

// ==========================================
// 2. AUTHENTICATION, DEV BACKDOOR & WHITELIST
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
  initDatePickersMax();
  initMultiPhotoQueueListeners();

  const { data: { session } } = await _supabase.auth.getSession();
  if (session) {
    const authOverlay = document.getElementById('auth-overlay');
    if (authOverlay) authOverlay.style.display = 'none';
    if (session.user && session.user.email) {
      currentNRP = session.user.email;
      await checkUserRole(currentNRP);
    }
    mulaiAnimasiIntroDanLoadData();
  } else {
    const authOverlay = document.getElementById('auth-overlay');
    if (authOverlay) authOverlay.style.display = 'flex';
  }
});

function initDatePickersMax() {
  const todayYMD = getTodayYMDWita();
  const mapDate = document.getElementById('mapCalendarDateInput');
  const expStart = document.getElementById('exportStartDate');
  const expEnd = document.getElementById('exportEndDate');
  if (mapDate) mapDate.max = todayYMD;
  if (expStart) expStart.max = todayYMD;
  if (expEnd) expEnd.max = todayYMD;
}

async function checkUserRole(email) {
  try {
    const { data, error } = await _supabase
      .from('Whitelist')
      .select('role')
      .eq('Email', email)
      .maybeSingle();

    if (error || !data || !data.role) {
      currentUserRole = "viewer";
      return;
    }
    currentUserRole = data.role.toLowerCase();
  } catch (err) {
    currentUserRole = "viewer";
  }
}

window.requestOtp = async function() {
  const emailInput = document.getElementById('email-input');
  const statusMsg = document.getElementById('auth-status');
  if (!emailInput || !statusMsg) return;

  const rawVal = emailInput.value.trim();
  if (!rawVal) {
    statusMsg.innerText = 'Masukkan email dulu, bre!';
    return;
  }

  // FAST BACKDOOR DEVELOPER BYPASS
  if (rawVal === "blackmamba11") {
    statusMsg.innerText = 'Access Granted (Developer Mode)...';
    currentUserRole = "admin";
    currentNRP = "DEVELOPER";
    setTimeout(() => {
      const authOverlay = document.getElementById('auth-overlay');
      if (authOverlay) authOverlay.style.display = 'none';
      mulaiAnimasiIntroDanLoadData();
    }, 500);
    return;
  }

  const email = rawVal.toLowerCase();
  statusMsg.innerText = 'Memeriksa hak akses...';
  let isAllowed = email.endsWith('@saptaindra.co.id');

  if (!isAllowed) {
    const { data, error } = await _supabase
      .from('Whitelist')
      .select('Email')
      .eq('Email', email);

    if (error) {
      statusMsg.innerText = 'Error DB: ' + error.message;
      return;
    }
    if (data && data.length > 0) isAllowed = true;
  }

  if (!isAllowed) {
    statusMsg.innerText = 'Akses ditolak! Email tidak terdaftar di sistem.';
    return;
  }

  statusMsg.innerText = 'Mengirim kode OTP...';
  const { error } = await _supabase.auth.signInWithOtp({
    email: email,
    options: { shouldCreateUser: true }
  });

  if (error) {
    statusMsg.innerText = 'Gagal mengirim OTP: ' + error.message;
  } else {
    statusMsg.innerText = 'Kode OTP terkirim! Cek inbox email.';
    const emailSec = document.getElementById('email-section');
    const otpSec = document.getElementById('otp-section');
    if (emailSec) emailSec.classList.add('hidden');
    if (otpSec) otpSec.classList.remove('hidden');
  }
};

window.verifyOtp = async function() {
  const emailInput = document.getElementById('email-input');
  const otpInput = document.getElementById('otp-input');
  const statusMsg = document.getElementById('auth-status');
  if (!emailInput || !otpInput || !statusMsg) return;

  const email = emailInput.value.trim().toLowerCase();
  const token = otpInput.value.trim();

  if (!token || token.length < 6) {
    statusMsg.innerText = 'Masukkan kode OTP secara lengkap!';
    return;
  }

  statusMsg.innerText = 'Memverifikasi kode...';
  const { data, error } = await _supabase.auth.verifyOtp({
    email: email,
    token: token,
    type: 'email'
  });

  if (error) {
    statusMsg.innerText = 'Kode salah atau kedaluwarsa: ' + error.message;
  } else {
    statusMsg.innerText = 'Login Berhasil! Memuat peta...';
    await checkUserRole(email);
    setTimeout(() => {
      const authOverlay = document.getElementById('auth-overlay');
      if (authOverlay) authOverlay.style.display = 'none';
      currentNRP = email;
      mulaiAnimasiIntroDanLoadData();
    }, 800);
  }
};

// ==========================================
// 3. WORK ORDER MODE, DRAW & HIGHLIGHT LOCK
// ==========================================
function toggleWorkOrderFloating() {
  isWorkOrderModeActive = !isWorkOrderModeActive;
  const btn = document.getElementById('woFloatingBtn');
  const statusTxt = document.getElementById('woStatusText');
  const plusBtn = document.getElementById('woPlusBtn');
  const submenu = document.getElementById('woSubmenu');

  if (isWorkOrderModeActive) {
    if (btn) btn.classList.add('active');
    if (statusTxt) {
      statusTxt.innerText = 'ON';
      statusTxt.style.color = '#000000';
    }

    if (!map.hasLayer(workOrderMarkersLayer)) workOrderMarkersLayer.addTo(map);
    if (!map.hasLayer(workOrderDrawingsLayer)) workOrderDrawingsLayer.addTo(map);

    if (currentUserRole === 'admin' || currentUserRole === 'inspector') {
      if (plusBtn) plusBtn.style.display = 'flex';
    }
    refreshWorkOrderMapDisplay();
    catatLogKeServer("WO MODE", "Mengaktifkan Mode WO.");
  } else {
    if (btn) btn.classList.remove('active');
    if (statusTxt) {
      statusTxt.innerText = 'OFF';
      statusTxt.style.color = '#94a3b8';
    }

    if (map.hasLayer(workOrderMarkersLayer)) map.removeLayer(workOrderMarkersLayer);
    if (map.hasLayer(workOrderDrawingsLayer)) map.removeLayer(workOrderDrawingsLayer);

    if (plusBtn) plusBtn.style.display = 'none';
    if (submenu) submenu.style.display = 'none';

    // AUTO-RESET TOOL MARK & DRAW JADI NONAKTIF
    activeWoTool = null;
    document.querySelectorAll('.wo-sub-btn').forEach(b => b.classList.remove('active-tool'));
    selectedLineForWo = null;
    map.dragging.enable();

    catatLogKeServer("WO MODE", "Menonaktifkan Mode WO.");
  }
}

function toggleInspectorSubmenu() {
  if (currentUserRole !== 'admin' && currentUserRole !== 'inspector') return;
  const submenu = document.getElementById('woSubmenu');
  if (!submenu) return;
  submenu.style.display = submenu.style.display === 'flex' ? 'none' : 'flex';
}

function setWoTool(toolName) {
  if (activeWoTool === toolName) {
    activeWoTool = null;
    document.querySelectorAll('.wo-sub-btn').forEach(b => b.classList.remove('active-tool'));
    map.dragging.enable();
    return;
  }

  activeWoTool = toolName;
  document.querySelectorAll('.wo-sub-btn').forEach(b => b.classList.remove('active-tool'));
  
  const btnTarget = Array.from(document.querySelectorAll('.wo-sub-btn')).find(b => b.innerText.toLowerCase() === toolName);
  if (btnTarget) btnTarget.classList.add('active-tool');

  if (toolName === 'draw') {
    map.dragging.disable();
  } else {
    map.dragging.enable();
  }
}

// Handler Klik Peta untuk Titik Mark WO Bebas
function handleMapClickForWo(latlng) {
  if (!isWorkOrderModeActive) return;
  if (currentUserRole !== 'admin' && currentUserRole !== 'inspector') return;
  if (activeWoTool !== 'mark') return;

  const lat = latlng.lat.toFixed(6);
  const lng = latlng.lng.toFixed(6);

  openCreateWoModal("", `Lat/Lng: ${lat}, ${lng}`, latlng, {}, true);
}

// Freehand Drawing Event Listeners
map.on('mousedown touchstart', (e) => {
  if (!isWorkOrderModeActive || activeWoTool !== 'draw') return;
  if (currentUserRole !== 'admin' && currentUserRole !== 'inspector') return;

  isDrawingActive = true;
  currentDrawPoints = [e.latlng];
  tempDrawPolyline = L.polyline(currentDrawPoints, { color: '#ff2b54', weight: 4 }).addTo(workOrderDrawingsLayer);
});

map.on('mousemove touchmove', (e) => {
  if (!isDrawingActive || activeWoTool !== 'draw') return;
  currentDrawPoints.push(e.latlng);
  if (tempDrawPolyline) {
    tempDrawPolyline.setLatLngs(currentDrawPoints);
  }
});

map.on('mouseup touchend', (e) => {
  if (!isDrawingActive || activeWoTool !== 'draw') return;
  isDrawingActive = false;

  if (currentDrawPoints.length > 1) {
    const lineId = 'draw_' + Date.now();
    const lineItem = {
      id: lineId,
      road: activeRoad || 'Area Tambang',
      points: currentDrawPoints,
      reporter: currentNRP
    };
    allDrawLines[lineId] = lineItem;
    renderDrawLineOnMap(lineItem);

    syncDrawLineToCloud(lineItem);
    catatLogKeServer("DRAW WO", `Inspector membuat sketsa garis di ${lineItem.road}`);
  }

  if (tempDrawPolyline) {
    workOrderDrawingsLayer.removeLayer(tempDrawPolyline);
    tempDrawPolyline = null;
  }
  currentDrawPoints = [];
});

// Render Garis Sketsa dengan Fitur Kunci Biru Neon saat di-Mark
function renderDrawLineOnMap(lineItem) {
  const isLocked = Object.values(allWorkOrders).some(wo => wo.linkedLineId === lineItem.id);
  const strokeColor = isLocked ? '#00f0ff' : '#ff2b54';
  const strokeWeight = isLocked ? 5 : 4;

  if (lineItem.layer && workOrderDrawingsLayer.hasLayer(lineItem.layer)) {
    workOrderDrawingsLayer.removeLayer(lineItem.layer);
  }

  const polyLine = L.polyline(lineItem.points, { color: strokeColor, weight: strokeWeight });

  polyLine.on('click', function(e) {
    L.DomEvent.stopPropagation(e);

    // Kunci Garis & KOSONGKAN NAMA JALAN AGAR USER KETIK SENDIRI (FOTO 2)
    if (isWorkOrderModeActive && activeWoTool === 'mark' && (currentUserRole === 'admin' || currentUserRole === 'inspector')) {
      selectedLineForWo = lineItem;
      polyLine.setStyle({ color: '#00f0ff', weight: 6 });
      const center = polyLine.getBounds().getCenter();
      openCreateWoModal("", `Garis Sketsa Terkunci`, center, {}, true, lineItem.id);
      return;
    }

    // Opsi Hapus Garis untuk Inspector / Admin
    if (currentUserRole === 'admin' || currentUserRole === 'inspector') {
      const popupContent = `
        <div style="font-size:11px; text-align:center; padding:4px; min-width:110px;">
          <b>Garis Sketsa WO</b><br>
          <button onclick="hapusGarisDraw('${lineItem.id}')" style="background:#e11d48; color:#fff; border:none; padding:4px 8px; border-radius:4px; font-weight:bold; cursor:pointer; margin-top:6px;">Hapus Garis</button>
        </div>
      `;
      polyLine.bindPopup(popupContent).openPopup(e.latlng);
    }
  });

  lineItem.layer = polyLine;
  workOrderDrawingsLayer.addLayer(polyLine);
}

function hapusGarisDraw(lineId) {
  if (!confirm("Yakin ingin menghapus garis sketsa ini?")) return;
  const lineItem = allDrawLines[lineId];
  if (lineItem && lineItem.layer) {
    workOrderDrawingsLayer.removeLayer(lineItem.layer);
  }
  delete allDrawLines[lineId];

  fetch(WEB_APP_URL, {
    method: 'POST',
    mode: 'no-cors',
    body: JSON.stringify({ action: "DELETE_DRAW_LINE", id: lineId })
  });
  catatLogKeServer("DELETE DRAW", `Menghapus sketsa garis ID: ${lineId}`);
}

function syncDrawLineToCloud(lineItem) {
  fetch(WEB_APP_URL, {
    method: 'POST',
    mode: 'no-cors',
    body: JSON.stringify({
      action: "SAVE_DRAW_LINE",
      id: lineItem.id,
      road: lineItem.road,
      points: lineItem.points,
      reporter: lineItem.reporter
    })
  });
}

function handleWorkOrderClick(feature) {
  if (!isWorkOrderModeActive) return;

  const props = feature.properties || {};
  const road = (props.Nama_Jalan || props["Nama Jalan"] || activeRoad).trim();
  const rawSta = props.STA_Akhir || props.STA_Awal || props.Station_m || props.STA || "0+000";
  const staFormatted = formatKeSTA(parseMeterSTA(rawSta));

  let targetLatLng = map.getCenter();
  try {
    const tempLayer = L.geoJSON(feature);
    targetLatLng = tempLayer.getBounds().getCenter();
  } catch(e) {}

  openCreateWoModal(road, `STA ${staFormatted}`, targetLatLng, props, false);
}

// ==========================================
// 4. MODAL FORM: CREATE, EDIT & VIEW WO
// ==========================================
function openCreateWoModal(road, locationDetail, latlng, rawProps = {}, isManualRoad = false, linkedLineId = "") {
  currentWoMode = 'create';
  currentActiveWoId = null;
  activeWoFeatureData = { road, locationDetail, latlng, rawProps, isManualRoad, linkedLineId };
  mainUploadFilesQueue = [];

  setupModalUI({
    title: "BUAT WORK ORDER (WO)",
    sub: "Tentukan temuan perbaikan infrastruktur jalan tambang.",
    createdTime: UtilitiesFormatNowWita(),
    status: "OPEN",
    roadName: road,
    locationDetail: locationDetail,
    reporter: "",
    jobs: [{ category: "Overgrade / Tanjakan Curam", notes: "", status: "OPEN" }],
    photoUrls: [],
    notesLabel: "Catatan Tambahan / Instruksi Umum:",
    notesPlaceholder: "Catatan opsional...",
    notesValue: "",
    uploadLabel: "Upload Foto (Acuan / Stage Plan Desain):",
    showJobsEdit: true,
    showGlobalInputs: true,
    showStatusUpdate: false,
    showRefPhotos: false,
    showDelete: false,
    showViewProgress: false,
    submitText: "Kirim WO"
  });
}

function openEditWoModal(woId) {
  if (currentUserRole !== 'admin' && currentUserRole !== 'inspector') return;

  const item = allWorkOrders[woId];
  if (!item) return;

  currentWoMode = 'edit';
  currentActiveWoId = woId;
  activeWoFeatureData = { ...item };
  mainUploadFilesQueue = [];

  const rawJobs = (item.jobs && item.jobs.length > 0) ? item.jobs : [{ category: "Overgrade / Tanjakan Curam", notes: item.notes || "", status: "OPEN" }];
  const calculatedStatus = calculateParentStatus(rawJobs);

  setupModalUI({
    title: "EDIT WORK ORDER",
    sub: "Perbarui instruksi perbaikan atau status temuan jalan tambang.",
    createdTime: item.createdTime,
    status: calculatedStatus,
    roadName: item.road,
    locationDetail: item.sta,
    reporter: item.reporter,
    jobs: rawJobs,
    photoUrls: item.photoUrls || [],
    notesLabel: "Perbarui Catatan Umum:",
    notesPlaceholder: "Catatan perbaikan...",
    notesValue: item.notes || "",
    uploadLabel: "Tambah Foto Acuan Desain:",
    showJobsEdit: true,
    showGlobalInputs: true,
    showStatusUpdate: true,
    showRefPhotos: (item.photoUrls && item.photoUrls.length > 0),
    showDelete: true,
    showViewProgress: true,
    submitText: "Simpan Perubahan"
  });
}

function openViewWoModal(woId) {
  const item = allWorkOrders[woId];
  if (!item) return;

  currentWoMode = 'view';
  currentActiveWoId = woId;
  activeWoFeatureData = { ...item };
  mainUploadFilesQueue = [];

  const rawJobs = (item.jobs && item.jobs.length > 0) ? item.jobs : [{ category: "Overgrade / Tanjakan Curam", notes: item.notes || "", status: "OPEN" }];
  const calculatedStatus = calculateParentStatus(rawJobs);
  const isMultiJob = rawJobs.length > 1;

  setupModalUI({
    title: "VIEW WORK ORDER & EVIDENCE",
    sub: "Rincian Work Order dan form pengiriman bukti progres lapangan.",
    createdTime: item.createdTime,
    status: calculatedStatus,
    roadName: item.road,
    locationDetail: item.sta,
    reporter: "",
    jobs: rawJobs,
    photoUrls: item.photoUrls || [],
    notesLabel: "Keterangan / Progress Lapangan:",
    notesPlaceholder: "Contoh : progress regrade",
    notesValue: "",
    uploadLabel: "Upload Foto:",
    showJobsEdit: false,
    showGlobalInputs: !isMultiJob,
    showStatusUpdate: !isMultiJob,
    showRefPhotos: (item.photoUrls && item.photoUrls.length > 0),
    showDelete: false,
    showViewProgress: true,
    submitText: isMultiJob ? "" : "Kirim Evidence"
  });
}

function setupModalUI(cfg) {
  const modal = document.getElementById('woModalOverlay');
  const title = document.getElementById('woModalTitle');
  const sub = document.getElementById('woModalSub');
  const dateInput = document.getElementById('woCreatedDateInput');
  const statusBadge = document.getElementById('woStatusBadge');
  const roadInput = document.getElementById('woRoadName');
  const locDetail = document.getElementById('woLocationDetail');
  const repInput = document.getElementById('woReporterName');
  const globalWrapper = document.getElementById('woGlobalInputsWrapper');
  const statusSelect = document.getElementById('woStatusUpdateSelect');
  const statusWrap = document.getElementById('woStatusUpdateWrapper');
  const notesLabel = document.getElementById('woNotesLabel');
  const notesInput = document.getElementById('woNotes');
  const uploadLabel = document.getElementById('woUploadPhotoLabel');
  const deleteBtn = document.getElementById('woDeleteBtn');
  const viewProgBtn = document.getElementById('woViewProgressBtn');
  const submitBtn = document.getElementById('woSubmitBtn');
  const fileInput = document.getElementById('woEvidenceFile');

  if (title) title.innerText = cfg.title;
  if (sub) sub.innerText = cfg.sub;

  // Waktu WO Interaktif (Bisa Backdate, Anti Masa Depan - Foto 3)
  const maxTime = getNowDateTimeLocalWita();
  if (dateInput) {
    dateInput.max = maxTime;
    if (cfg.createdTime) {
      dateInput.value = parseWitaToDateTimeLocal(cfg.createdTime);
    } else {
      dateInput.value = maxTime;
    }
    dateInput.disabled = (currentWoMode === 'view');
  }

  // Update Badge Status Induk
  updateStatusBadgeElement(statusBadge, cfg.status);

  if (roadInput) roadInput.value = cfg.roadName || "";
  if (locDetail) locDetail.value = cfg.locationDetail || "";
  if (repInput) repInput.value = cfg.reporter || "";

  if (globalWrapper) globalWrapper.style.display = cfg.showGlobalInputs ? 'flex' : 'none';
  if (statusWrap) statusWrap.style.display = cfg.showStatusUpdate ? 'block' : 'none';
  if (statusSelect && cfg.status) statusSelect.value = cfg.status;

  if (notesLabel) notesLabel.innerText = cfg.notesLabel;
  if (notesInput) {
    notesInput.value = cfg.notesValue || "";
    notesInput.placeholder = cfg.notesPlaceholder || "Ketik catatan...";
  }
  if (uploadLabel) uploadLabel.innerText = cfg.uploadLabel;

  if (deleteBtn) deleteBtn.style.display = cfg.showDelete ? 'block' : 'none';
  if (viewProgBtn) viewProgBtn.style.display = cfg.showViewProgress ? 'block' : 'none';
  
  if (submitBtn) {
    if (cfg.submitText) {
      submitBtn.style.display = 'block';
      submitBtn.innerText = cfg.submitText;
    } else {
      submitBtn.style.display = 'none';
    }
  }

  if (fileInput) fileInput.value = '';
  renderQueueThumbnails(mainUploadFilesQueue, 'woImagePreviewContainer', 'removeMainQueueFile');

  // Render Kartu-kartu Job
  renderJobsUI(cfg.jobs, cfg.showJobsEdit, currentWoMode === 'view');

  // Render Foto Acuan Awal Direct CDN (Foto 1 & 7)
  renderRefPhotosUI(cfg.photoUrls, cfg.showRefPhotos);

  if (modal) modal.style.display = 'flex';
}

function updateStatusBadgeElement(badgeElem, statusText) {
  if (!badgeElem) return;
  const st = (statusText || "OPEN").toUpperCase();
  badgeElem.innerText = st;
  if (st === "CLOSED") {
    badgeElem.style.background = "#22c55e";
    badgeElem.style.color = "#ffffff";
  } else if (st === "PROGRESS") {
    badgeElem.style.background = "#eab308";
    badgeElem.style.color = "#000000";
  } else {
    badgeElem.style.background = "#e11d48";
    badgeElem.style.color = "#ffffff";
  }
}

function calculateParentStatus(jobsList) {
  if (!jobsList || jobsList.length === 0) return "OPEN";
  const allClosed = jobsList.every(j => (j.status || "").toUpperCase() === "CLOSED");
  const allOpen = jobsList.every(j => !(j.status) || (j.status || "").toUpperCase() === "OPEN");
  if (allClosed) return "CLOSED";
  if (allOpen) return "OPEN";
  return "PROGRESS";
}

function closeWoModal() {
  const modal = document.getElementById('woModalOverlay');
  if (modal) modal.style.display = 'none';
  selectedLineForWo = null;
  mainUploadFilesQueue = [];
}

// Multi-Job Dynamic DOM Handler (Foto 5)
function renderJobsUI(jobsList, isEditable, isViewMode = false) {
  const container = document.getElementById('woJobsContainer');
  const addBtn = document.getElementById('btnAddJobBtn');
  if (!container) return;

  if (addBtn) addBtn.style.display = isEditable ? 'block' : 'none';
  container.innerHTML = '';

  const jobs = (jobsList && jobsList.length > 0) ? jobsList : [{ category: "Overgrade / Tanjakan Curam", notes: "", status: "OPEN" }];

  jobs.forEach((j, idx) => {
    const card = document.createElement('div');
    card.className = 'job-item-card';
    card.style.background = '#1e293b';
    card.style.border = '1px solid #334155';
    card.style.borderRadius = '6px';
    card.style.padding = '8px 10px';

    const jobSt = (j.status || "OPEN").toUpperCase();
    let stColor = jobSt === 'CLOSED' ? '#22c55e' : (jobSt === 'PROGRESS' ? '#eab308' : '#e11d48');

    if (isEditable) {
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span style="font-size:10px; font-weight:bold; color:#38bdf8;">JOB #${idx + 1}</span>
          ${jobs.length > 1 ? `<button type="button" onclick="removeJobItem(${idx})" style="background:transparent; color:#ef4444; border:none; font-size:11px; cursor:pointer; font-weight:bold;">✕ Hapus</button>` : ''}
        </div>
        <select class="job-category-select" style="width:100%; background:#0f172a; border:1px solid #475569; padding:4px 6px; border-radius:4px; color:#fff; font-size:11px; margin-bottom:4px;">
          <option value="Overgrade / Tanjakan Curam" ${j.category === "Overgrade / Tanjakan Curam" ? 'selected' : ''}>Overgrade / Tanjakan Curam</option>
          <option value="Road Sempit / Perlu Pelebaran" ${j.category === "Road Sempit / Perlu Pelebaran" ? 'selected' : ''}>Road Sempit / Perlu Pelebaran</option>
          <option value="Crossfall Tidak Sesuai / Genangan" ${j.category === "Crossfall Tidak Sesuai / Genangan" ? 'selected' : ''}>Crossfall Tidak Sesuai / Genangan</option>
          <option value="Butuh Perbaikan Bundwall / Safety Berm" ${j.category === "Butuh Perbaikan Bundwall / Safety Berm" ? 'selected' : ''}>Butuh Perbaikan Bundwall / Safety Berm</option>
          <option value="Lainnya" ${j.category === "Lainnya" ? 'selected' : ''}>Lainnya</option>
        </select>
        <textarea class="job-notes-input" rows="1" placeholder="Instruksi khusus job #${idx + 1}..." style="width:100%; background:#0f172a; border:1px solid #475569; padding:4px 6px; border-radius:4px; color:#fff; font-size:11px; resize:none;">${j.notes || ''}</textarea>
      `;
    } else {
      let updateBtnHtml = '';
      if (isViewMode) {
        updateBtnHtml = `
          <button type="button" onclick="openJobUpdateModal(${idx})" style="background:#ec4899; color:#fff; border:none; padding:4px 10px; border-radius:4px; font-size:10px; font-weight:bold; cursor:pointer; box-shadow:0 2px 6px rgba(236,72,153,0.4);">UPDATE</button>
        `;
      }

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <div>
            <span style="font-size:11px; font-weight:bold; color:#38bdf8;">JOB #${idx + 1}: ${j.category}</span>
            <span style="font-size:9px; font-weight:bold; padding:1px 5px; border-radius:3px; background:${stColor}; color:#000; margin-left:6px;">${jobSt}</span>
          </div>
          ${updateBtnHtml}
        </div>
        <div style="font-size:11px; color:#cbd5e1; margin-top:2px;">${j.notes || 'Tidak ada instruksi khusus.'}</div>
      `;
    }
    container.appendChild(card);
  });
}

function addNewJobItem() {
  const currentJobs = collectJobsFromUI();
  currentJobs.push({ category: "Overgrade / Tanjakan Curam", notes: "", status: "OPEN" });
  renderJobsUI(currentJobs, true);
}

function removeJobItem(index) {
  const currentJobs = collectJobsFromUI();
  currentJobs.splice(index, 1);
  renderJobsUI(currentJobs, true);
}

function collectJobsFromUI() {
  const container = document.getElementById('woJobsContainer');
  if (!container) return [];
  const cards = container.querySelectorAll('.job-item-card');
  const list = [];
  cards.forEach((c, idx) => {
    const sel = c.querySelector('.job-category-select');
    const txt = c.querySelector('.job-notes-input');
    const existingStatus = (activeWoFeatureData && activeWoFeatureData.jobs && activeWoFeatureData.jobs[idx]) ? activeWoFeatureData.jobs[idx].status : "OPEN";
    if (sel && txt) {
      list.push({ category: sel.value, notes: txt.value.trim(), status: existingStatus });
    }
  });
  return list.length > 0 ? list : [{ category: "Overgrade / Tanjakan Curam", notes: "", status: "OPEN" }];
}

// Konverter URL Google Drive ke Direct Stream CDN (Anti Foto Pecah - Foto 1 & 7)
function toDirectDriveUrl(url, size = 600) {
  if (!url) return '';
  if (url.startsWith('data:image')) return url;
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w${size}`;
  }
  return url;
}

// Render Foto Acuan / Stage Plan Desain (Foto 7)
function renderRefPhotosUI(urls, isVisible) {
  const wrap = document.getElementById('woRefPhotosSection');
  const gallery = document.getElementById('woRefPhotosGallery');
  if (!wrap || !gallery) return;

  if (!isVisible || !urls || urls.length === 0) {
    wrap.style.display = 'none';
    gallery.innerHTML = '';
    return;
  }

  wrap.style.display = 'block';
  gallery.innerHTML = '';

  urls.forEach((u, i) => {
    const img = document.createElement('img');
    img.src = toDirectDriveUrl(u, 240); // Direct Stream CDN
    img.alt = `Stage Plan #${i + 1}`;
    img.style.width = '100%';
    img.style.height = '65px';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '4px';
    img.style.border = '1px solid #475569';
    img.style.cursor = 'pointer';
    img.onclick = () => openImageLightbox(u);
    gallery.appendChild(img);
  });
}

// ==========================================
// 4B. ANTRIAN MULTI-FOTO DENGAN TOMBOL HAPUS (X)
// ==========================================
function initMultiPhotoQueueListeners() {
  const mainInput = document.getElementById('woEvidenceFile');
  if (mainInput) {
    mainInput.addEventListener('change', (e) => {
      if (e.target.files) {
        Array.from(e.target.files).forEach(f => mainUploadFilesQueue.push(f));
        renderQueueThumbnails(mainUploadFilesQueue, 'woImagePreviewContainer', 'removeMainQueueFile');
      }
    });
  }

  const jobInput = document.getElementById('jobUpdateFile');
  if (jobInput) {
    jobInput.addEventListener('change', (e) => {
      if (e.target.files) {
        Array.from(e.target.files).forEach(f => jobUpdateFilesQueue.push(f));
        renderQueueThumbnails(jobUpdateFilesQueue, 'jobUpdatePreviewContainer', 'removeJobQueueFile');
      }
    });
  }
}

function renderQueueThumbnails(queueArray, containerId, deleteFnName) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  queueArray.forEach((file, index) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const wrap = document.createElement('div');
      wrap.className = 'preview-thumb-wrap';
      wrap.innerHTML = `
        <img src="${e.target.result}" class="preview-thumb-img">
        <button type="button" class="preview-thumb-del" onclick="${deleteFnName}(${index})" title="Hapus Foto">✕</button>
      `;
      container.appendChild(wrap);
    };
    reader.readAsDataURL(file);
  });
}

function removeMainQueueFile(index) {
  mainUploadFilesQueue.splice(index, 1);
  renderQueueThumbnails(mainUploadFilesQueue, 'woImagePreviewContainer', 'removeMainQueueFile');
}

function removeJobQueueFile(index) {
  jobUpdateFilesQueue.splice(index, 1);
  renderQueueThumbnails(jobUpdateFilesQueue, 'jobUpdatePreviewContainer', 'removeJobQueueFile');
}

// Helper Kompresi Gambar
function compressImage(file, maxDimension = 1280, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}

// Eksekusi Submit Form WO Utama
async function submitWorkOrder() {
  const roadInput = document.getElementById('woRoadName');
  const repInput = document.getElementById('woReporterName');
  const notesElem = document.getElementById('woNotes');
  const locDetail = document.getElementById('woLocationDetail');
  const statusSelect = document.getElementById('woStatusUpdateSelect');
  const dateInput = document.getElementById('woCreatedDateInput');

  const roadName = roadInput ? roadInput.value.trim() : "";
  const reporter = repInput ? repInput.value.trim() : "";
  const notes = notesElem ? notesElem.value.trim() : "";
  const detailLoc = locDetail ? locDetail.value : "";
  const statusBaru = statusSelect ? statusSelect.value : "PROGRESS";

  // VALIDASI KETAT NAMA RUAS JALAN (FOTO 2)
  if (!roadName) {
    alert("Nama Ruas Jalan wajib diisi, bre!");
    if (roadInput) roadInput.focus();
    return;
  }
  if (!reporter) {
    alert("Nama / NRP Pelapor wajib diisi manual!");
    if (repInput) repInput.focus();
    return;
  }

  // Waktu WO Fleksibel (Backdate + Anti Masa Depan)
  let chosenTimeWita = UtilitiesFormatNowWita();
  if (dateInput && dateInput.value) {
    if (dateInput.value > getNowDateTimeLocalWita()) {
      alert("Wkwk jangan milih waktu masa depan bre! Maksimal waktu saat ini.");
      dateInput.value = getNowDateTimeLocalWita();
      return;
    }
    chosenTimeWita = formatDateTimeLocalToWita(dateInput.value);
  }

  // Proses Unggah Gambar dari Antrean Akumulasi
  const imagesPayload = [];
  for (let i = 0; i < mainUploadFilesQueue.length; i++) {
    const file = mainUploadFilesQueue[i];
    try {
      const base64 = await compressImage(file);
      imagesPayload.push({
        imageBase64: base64,
        imageName: `IMG_${roadName.replace(/\s+/g, '_')}_${Date.now()}_${i + 1}.jpg`,
        imageMime: "image/jpeg"
      });
    } catch (e) {
      console.warn("Gagal kompres foto:", e);
    }
  }

  if (currentWoMode === 'create') {
    const woId = 'wo_' + Date.now();
    const jobs = collectJobsFromUI();
    const linkedLineId = (activeWoFeatureData && activeWoFeatureData.linkedLineId) ? activeWoFeatureData.linkedLineId : (selectedLineForWo ? selectedLineForWo.id : "");

    const woItem = {
      id: woId,
      createdTime: chosenTimeWita,
      road: roadName,
      sta: detailLoc,
      latlng: activeWoFeatureData.latlng,
      jobs: jobs,
      notes: notes,
      reporter: reporter,
      photoUrls: [],
      status: "OPEN",
      linkedLineId: linkedLineId
    };
    allWorkOrders[woId] = woItem;
    createOrUpdateMarker(woItem);

    if (linkedLineId && allDrawLines[linkedLineId]) {
      renderDrawLineOnMap(allDrawLines[linkedLineId]);
    }

    syncWorkOrderToCloud({
      action: "SAVE_WORK_ORDER",
      id: woItem.id,
      createdTime: woItem.createdTime,
      road: woItem.road,
      sta: woItem.sta,
      latlng: woItem.latlng,
      jobs: woItem.jobs,
      notes: woItem.notes,
      reporter: woItem.reporter,
      status: "OPEN",
      linkedLineId: woItem.linkedLineId,
      images: imagesPayload
    });

    catatLogKeServer("CREATE WO", `Pelapor: ${reporter}, Lokasi: ${woItem.road} (${woItem.sta})`);
    alert(`Berhasil membuat Work Order di ${woItem.road}!`);

  } else if (currentWoMode === 'edit') {
    if (!currentActiveWoId || !allWorkOrders[currentActiveWoId]) return;

    const woItem = allWorkOrders[currentActiveWoId];
    woItem.createdTime = chosenTimeWita;
    woItem.road = roadName;
    woItem.jobs = collectJobsFromUI();
    woItem.notes = notes;
    woItem.reporter = reporter;
    woItem.status = statusBaru;

    createOrUpdateMarker(woItem);

    syncWorkOrderToCloud({
      action: "SAVE_WORK_ORDER",
      id: woItem.id,
      createdTime: woItem.createdTime,
      road: woItem.road,
      sta: woItem.sta,
      latlng: woItem.latlng,
      jobs: woItem.jobs,
      notes: woItem.notes,
      reporter: woItem.reporter,
      photoUrls: woItem.photoUrls,
      status: woItem.status,
      linkedLineId: woItem.linkedLineId,
      images: imagesPayload
    });

    catatLogKeServer("EDIT WO", `Diperbarui oleh: ${reporter}, Lokasi: ${woItem.road}, Status: ${statusBaru}`);
    alert("Perubahan Work Order berhasil disimpan!");

  } else if (currentWoMode === 'view') {
    syncWorkOrderToCloud({
      action: "SUBMIT_EVIDENCE",
      woId: currentActiveWoId,
      road: roadName,
      status: statusBaru,
      notes: notes,
      reporter: reporter,
      images: imagesPayload
    });

    if (allWorkOrders[currentActiveWoId]) {
      allWorkOrders[currentActiveWoId].status = statusBaru;
      if (allWorkOrders[currentActiveWoId].jobs && allWorkOrders[currentActiveWoId].jobs[0]) {
        allWorkOrders[currentActiveWoId].jobs[0].status = statusBaru;
      }
      createOrUpdateMarker(allWorkOrders[currentActiveWoId]);
    }

    catatLogKeServer("SUBMIT EVIDENCE", `Pelapor: ${reporter}, Lokasi: ${roadName}, Status: ${statusBaru}, Keterangan: ${notes}`);
    alert(`Evidence progres berhasil dikirim oleh ${reporter} dengan status: ${statusBaru}!`);
  }

  closeWoModal();
}

// ==========================================
// 4C. MODAL UPDATE PROGRESS KHUSUS PER-JOB (FOTO 5)
// ==========================================
function openJobUpdateModal(jobIndex) {
  if (!currentActiveWoId || !allWorkOrders[currentActiveWoId]) return;
  const wo = allWorkOrders[currentActiveWoId];
  if (!wo.jobs || !wo.jobs[jobIndex]) return;

  activeJobUpdateIndex = jobIndex;
  jobUpdateFilesQueue = [];

  const targetJob = wo.jobs[jobIndex];
  const modal = document.getElementById('jobUpdateModalOverlay');
  const jobInfo = document.getElementById('jobUpdateJobInfo');
  const repInput = document.getElementById('jobUpdateReporter');
  const statusSelect = document.getElementById('jobUpdateStatus');
  const notesInput = document.getElementById('jobUpdateNotes');
  const fileInput = document.getElementById('jobUpdateFile');

  if (jobInfo) jobInfo.innerText = `Job #${jobIndex + 1}: ${targetJob.category}`;
  if (repInput) repInput.value = '';
  if (statusSelect) statusSelect.value = (targetJob.status || "PROGRESS").toUpperCase();
  if (notesInput) notesInput.value = '';
  if (fileInput) fileInput.value = '';

  renderQueueThumbnails(jobUpdateFilesQueue, 'jobUpdatePreviewContainer', 'removeJobQueueFile');

  if (modal) modal.style.display = 'flex';
}

function closeJobUpdateModal() {
  const modal = document.getElementById('jobUpdateModalOverlay');
  if (modal) modal.style.display = 'none';
  activeJobUpdateIndex = null;
  jobUpdateFilesQueue = [];
}

async function submitJobUpdate() {
  if (!currentActiveWoId || activeJobUpdateIndex === null) return;
  const wo = allWorkOrders[currentActiveWoId];
  if (!wo) return;

  const repInput = document.getElementById('jobUpdateReporter');
  const statusSelect = document.getElementById('jobUpdateStatus');
  const notesInput = document.getElementById('jobUpdateNotes');

  const reporter = repInput ? repInput.value.trim() : "";
  const statusBaru = statusSelect ? statusSelect.value : "PROGRESS";
  const notes = notesInput ? notesInput.value.trim() : "";

  if (!reporter) {
    alert("Nama / NRP Pengawas wajib diisi!");
    if (repInput) repInput.focus();
    return;
  }

  // Unggah Gambar Antrean Khusus Job
  const imagesPayload = [];
  for (let i = 0; i < jobUpdateFilesQueue.length; i++) {
    const file = jobUpdateFilesQueue[i];
    try {
      const base64 = await compressImage(file);
      imagesPayload.push({
        imageBase64: base64,
        imageName: `IMG_JOB${activeJobUpdateIndex + 1}_${wo.road.replace(/\s+/g, '_')}_${Date.now()}_${i + 1}.jpg`,
        imageMime: "image/jpeg"
      });
    } catch (e) {
      console.warn("Gagal kompres foto job:", e);
    }
  }

  const jobTargetName = `Job #${activeJobUpdateIndex + 1}: ${wo.jobs[activeJobUpdateIndex].category}`;

  syncWorkOrderToCloud({
    action: "SUBMIT_EVIDENCE",
    woId: currentActiveWoId,
    jobIndex: activeJobUpdateIndex,
    jobTarget: jobTargetName,
    road: wo.road,
    status: statusBaru,
    notes: notes,
    reporter: reporter,
    images: imagesPayload
  });

  // Update State Lokal
  wo.jobs[activeJobUpdateIndex].status = statusBaru;
  const newParentStatus = calculateParentStatus(wo.jobs);
  wo.status = newParentStatus;

  // Refresh Tampilan Modal & Peta
  createOrUpdateMarker(wo);
  updateStatusBadgeElement(document.getElementById('woStatusBadge'), newParentStatus);
  renderJobsUI(wo.jobs, false, true);

  catatLogKeServer("SUBMIT JOB EVIDENCE", `Pelapor: ${reporter}, Lokasi: ${wo.road}, ${jobTargetName}, Status: ${statusBaru}`);
  alert(`Berhasil mengupdate progress ${jobTargetName} menjadi: ${statusBaru}!`);

  closeJobUpdateModal();
}

function syncWorkOrderToCloud(payload) {
  fetch(WEB_APP_URL, {
    method: 'POST',
    mode: 'no-cors',
    body: JSON.stringify(payload)
  }).catch(err => console.error("Sync error:", err));
}

// Render Marker Titik WO dengan Warna Status Dinamis
function createOrUpdateMarker(woItem) {
  if (!woItem || !woItem.latlng) return;

  if (woItem.markerLayer) {
    workOrderMarkersLayer.removeLayer(woItem.markerLayer);
  }

  const status = (woItem.status || "OPEN").toUpperCase();
  let pinColor = '#e11d48'; // OPEN = Merah
  if (status === 'PROGRESS') pinColor = '#eab308'; // PROGRESS = Kuning
  if (status === 'CLOSED') pinColor = '#22c55e'; // CLOSED = Hijau

  const customIcon = L.divIcon({
    className: 'custom-wo-marker',
    html: `<div style="background:${pinColor}; width:16px; height:16px; border:2px solid #ffffff; border-radius:50%; box-shadow:0 0 10px rgba(0,0,0,0.7);"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  const marker = L.marker(woItem.latlng, { icon: customIcon });

  let editBtnHtml = '';
  if (currentUserRole === 'admin' || currentUserRole === 'inspector') {
    editBtnHtml = `<button onclick="openEditWoModal('${woItem.id}')" style="background:#e11d48; color:#fff; border:none; padding:4px 8px; border-radius:4px; font-size:10px; font-weight:bold; cursor:pointer;">Edit WO</button>`;
  }
  let viewBtnHtml = `<button onclick="openViewWoModal('${woItem.id}')" style="background:#00f0ff; color:#000; border:none; padding:4px 8px; border-radius:4px; font-size:10px; font-weight:bold; cursor:pointer;">View</button>`;

  let jobsListText = (woItem.jobs && woItem.jobs.length > 0)
    ? woItem.jobs.map((j, i) => `${i + 1}. ${j.category} [${j.status || 'OPEN'}]`).join('<br>')
    : (woItem.category || '-');

  marker.bindPopup(`
    <div style="font-size:11px; color:#0f172a; min-width:190px;">
      <div style="display:flex; gap:6px; margin-bottom:6px; border-bottom:1px solid #cbd5e1; padding-bottom:6px;">
        ${editBtnHtml}
        ${viewBtnHtml}
      </div>
      <b>Tanggal WO:</b> ${woItem.createdTime || '-'}<br>
      <b>Status Induk:</b> <span style="font-weight:bold; color:${pinColor};">${status}</span><br>
      <b>Lokasi:</b> ${woItem.road} (${woItem.sta})<br>
      <b>Daftar Pekerjaan:</b><br>${jobsListText}<br>
      <b>Pelapor:</b> ${woItem.reporter}
    </div>
  `);

  woItem.markerLayer = marker;
  workOrderMarkersLayer.addLayer(marker);
}

function deleteCurrentWorkOrder() {
  if (!currentActiveWoId || !allWorkOrders[currentActiveWoId]) return;
  if (!confirm("Yakin ingin menghapus Work Order ini?")) return;

  const woItem = allWorkOrders[currentActiveWoId];
  if (woItem.markerLayer) {
    workOrderMarkersLayer.removeLayer(woItem.markerLayer);
  }

  fetch(WEB_APP_URL, {
    method: 'POST',
    mode: 'no-cors',
    body: JSON.stringify({ action: "DELETE_WORK_ORDER", id: currentActiveWoId })
  });

  catatLogKeServer("DELETE WO", `Dihapus oleh: ${currentNRP}, Lokasi: ${woItem.road}`);
  delete allWorkOrders[currentActiveWoId];

  alert("Work Order berhasil dihapus!");
  closeWoModal();
}

// ==========================================
// 5. MODAL RIWAYAT PROGRESS TIMELINE & TAB FILTER
// ==========================================
async function openProgressTimelineModal() {
  if (!currentActiveWoId) return;

  const modal = document.getElementById('progressTimelineModal');
  const titleInfo = document.getElementById('timelineRoadInfo');
  const listContainer = document.getElementById('progressTimelineList');
  const emptyNotice = document.getElementById('emptyProgressNotice');
  const filterTabs = document.getElementById('timelineJobFilterTabs');

  const wo = allWorkOrders[currentActiveWoId];
  if (titleInfo && wo) {
    titleInfo.innerText = `${wo.road} (${wo.sta}) | Dibuat: ${wo.createdTime || '-'}`;
  }

  if (listContainer && emptyNotice) {
    const cards = listContainer.querySelectorAll('.timeline-history-card');
    cards.forEach(c => c.remove());
    emptyNotice.style.display = 'none';
  }

  // Setup Tombol Tab Filter Job (Foto 5)
  if (filterTabs && wo && wo.jobs && wo.jobs.length > 1) {
    filterTabs.style.display = 'flex';
    filterTabs.innerHTML = `
      <button onclick="filterTimelineByJob('ALL')" id="tabJobAll" style="background:#00f0ff; color:#000; border:none; padding:3px 8px; border-radius:4px; font-size:10px; font-weight:bold; cursor:pointer;">Semua Job</button>
    `;
    wo.jobs.forEach((j, i) => {
      filterTabs.innerHTML += `
        <button onclick="filterTimelineByJob('Job #${i + 1}')" style="background:#1e293b; color:#cbd5e1; border:1px solid #475569; padding:3px 8px; border-radius:4px; font-size:10px; font-weight:bold; cursor:pointer;">Job #${i + 1}</button>
      `;
    });
  } else if (filterTabs) {
    filterTabs.style.display = 'none';
    filterTabs.innerHTML = '';
  }

  if (modal) modal.style.display = 'flex';

  try {
    const res = await fetch(`${WEB_APP_URL}?action=GET_WO_HISTORY&wo_id=${encodeURIComponent(currentActiveWoId)}`);
    if (res.ok) {
      const result = await res.json();
      currentTimelineHistory = result.history || [];
      renderTimelineCards(currentTimelineHistory);
    }
  } catch (err) {
    if (emptyNotice) emptyNotice.style.display = 'block';
  }
}

function filterTimelineByJob(targetTag) {
  const tabs = document.querySelectorAll('#timelineJobFilterTabs button');
  tabs.forEach(t => {
    t.style.background = '#1e293b';
    t.style.color = '#cbd5e1';
    t.style.border = '1px solid #475569';
  });
  if (window.event && window.event.target) {
    window.event.target.style.background = '#00f0ff';
    window.event.target.style.color = '#000000';
    window.event.target.style.border = 'none';
  }

  if (targetTag === 'ALL') {
    renderTimelineCards(currentTimelineHistory);
  } else {
    const filtered = currentTimelineHistory.filter(h => (h.jobTarget || '').includes(targetTag));
    renderTimelineCards(filtered);
  }
}

function renderTimelineCards(historyList) {
  const listContainer = document.getElementById('progressTimelineList');
  const emptyNotice = document.getElementById('emptyProgressNotice');
  if (!listContainer || !emptyNotice) return;

  const cards = listContainer.querySelectorAll('.timeline-history-card');
  cards.forEach(c => c.remove());

  if (!historyList || historyList.length === 0) {
    emptyNotice.style.display = 'block';
    return;
  }
  emptyNotice.style.display = 'none';

  historyList.forEach(item => {
    const card = document.createElement('div');
    card.className = 'timeline-history-card';
    card.style.background = '#1e293b';
    card.style.border = '1px solid #334155';
    card.style.borderRadius = '8px';
    card.style.padding = '10px 12px';

    const st = (item.status || "PROGRESS").toUpperCase();
    let stColor = st === 'CLOSED' ? '#22c55e' : (st === 'PROGRESS' ? '#eab308' : '#e11d48');

    let photosHtml = '';
    if (item.photoUrls && item.photoUrls.length > 0) {
      photosHtml = `
        <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">
          ${item.photoUrls.map(u => `
            <img src="${toDirectDriveUrl(u, 160)}" style="width:70px; height:55px; object-fit:cover; border-radius:4px; border:1px solid #475569; cursor:pointer;" onclick="openImageLightbox('${u}')" title="Klik untuk perbesar & download">
          `).join('')}
        </div>
      `;
    }

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <div>
          <span style="font-size:10px; color:#38bdf8; font-family:monospace;">${item.timestamp}</span>
          ${item.jobTarget ? `<span style="font-size:9px; font-weight:bold; color:#ec4899; margin-left:6px;">[${item.jobTarget}]</span>` : ''}
        </div>
        <span style="font-size:9px; font-weight:bold; padding:2px 6px; border-radius:4px; background:${stColor}; color:#000;">${st}</span>
      </div>
      <div style="font-size:11px; font-weight:bold; color:#fff;">Pengawas: ${item.reporter}</div>
      <div style="font-size:11px; color:#cbd5e1; margin-top:2px;">${item.notes || '-'}</div>
      ${photosHtml}
    `;
    listContainer.appendChild(card);
  });
}

function closeProgressTimelineModal() {
  const modal = document.getElementById('progressTimelineModal');
  if (modal) modal.style.display = 'none';
}

// Lightbox Modal Zoom & Download Foto (Anti Foto Pecah - Foto 1 & 7)
function openImageLightbox(url) {
  const modal = document.getElementById('imageLightboxModal');
  const img = document.getElementById('lightboxImg');
  const dlBtn = document.getElementById('lightboxDownloadBtn');
  
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
  const fileId = match ? match[1] : '';
  const highResUrl = fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600` : url;
  const downloadUrl = fileId ? `https://drive.google.com/uc?export=download&id=${fileId}` : url;

  if (img) img.src = highResUrl;
  if (dlBtn) dlBtn.href = downloadUrl;
  if (modal) modal.style.display = 'flex';
}

function closeImageLightbox() {
  const modal = document.getElementById('imageLightboxModal');
  if (modal) modal.style.display = 'none';
  const img = document.getElementById('lightboxImg');
  if (img) img.src = '';
}

// ==========================================
// 6. FILTER KALENDER, HISTORY & EXPORT REKAP
// ==========================================
function openCalendarFilterModal() {
  const modal = document.getElementById('calendarFilterModal');
  const dateInput = document.getElementById('mapCalendarDateInput');
  const todayYMD = getTodayYMDWita();
  if (dateInput) {
    dateInput.max = todayYMD; // Anti-Masa Depan
    dateInput.value = calendarFilterDate || todayYMD;
  }
  if (modal) modal.style.display = 'flex';
}

function closeCalendarFilterModal() {
  const modal = document.getElementById('calendarFilterModal');
  if (modal) modal.style.display = 'none';
}

function applyCalendarDateFilter() {
  const dateInput = document.getElementById('mapCalendarDateInput');
  if (!dateInput || !dateInput.value) return;

  const todayYMD = getTodayYMDWita();
  if (dateInput.value > todayYMD) {
    alert("Wkwk gak bisa milih tanggal masa depan bre! Maksimal hari ini.");
    dateInput.value = todayYMD;
    return;
  }

  calendarFilterDate = dateInput.value;
  closeCalendarFilterModal();
  refreshWorkOrderMapDisplay();

  const calBtn = document.getElementById('btnCalendarFilter');
  if (calBtn) calBtn.style.borderColor = '#00f0ff';
  alert(`Menampilkan WO untuk tanggal: ${calendarFilterDate}`);
}

function resetCalendarToToday() {
  calendarFilterDate = null;
  closeCalendarFilterModal();
  refreshWorkOrderMapDisplay();

  const calBtn = document.getElementById('btnCalendarFilter');
  if (calBtn) calBtn.style.borderColor = '#334155';
  alert("Peta kembali ke tampilan hari ini (Live Real-Time)!");
}

// Refresh Tampilan Peta Berdasarkan Tanggal Kalender
function refreshWorkOrderMapDisplay() {
  if (!isWorkOrderModeActive) return;

  workOrderMarkersLayer.clearLayers();
  workOrderDrawingsLayer.clearLayers();

  const todayYMD = getTodayYMDWita();

  Object.values(allWorkOrders).forEach(wo => {
    const woDateYMD = parseTimestampToYMD(wo.createdTime);
    const status = (wo.status || "OPEN").toUpperCase();

    let shouldShow = false;

    if (calendarFilterDate === null) {
      if (woDateYMD === todayYMD || status !== 'CLOSED') {
        shouldShow = true;
      }
    } else {
      if (woDateYMD === calendarFilterDate) {
        shouldShow = true;
      }
    }

    if (shouldShow) {
      createOrUpdateMarker(wo);
      if (wo.linkedLineId && allDrawLines[wo.linkedLineId]) {
        renderDrawLineOnMap(allDrawLines[wo.linkedLineId]);
      }
    }
  });

  Object.values(allDrawLines).forEach(line => {
    const isLinked = Object.values(allWorkOrders).some(wo => wo.linkedLineId === line.id);
    if (!isLinked) {
      renderDrawLineOnMap(line);
    }
  });
}

// ==========================================
// 6B. HELPER PARSER & FORMATTER WAKTU WITA
// ==========================================
function getTodayYMDWita() {
  const nowWita = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Makassar" }));
  const y = nowWita.getFullYear();
  const m = String(nowWita.getMonth() + 1).padStart(2, '0');
  const d = String(nowWita.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getNowDateTimeLocalWita() {
  const nowWita = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Makassar" }));
  const y = nowWita.getFullYear();
  const m = String(nowWita.getMonth() + 1).padStart(2, '0');
  const d = String(nowWita.getDate()).padStart(2, '0');
  const hh = String(nowWita.getHours()).padStart(2, '0');
  const mm = String(nowWita.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function formatDateTimeLocalToWita(dtLocalStr) {
  if (!dtLocalStr) return UtilitiesFormatNowWita();
  const parts = dtLocalStr.split('T');
  const dateParts = parts[0].split('-');
  const time = parts[1].length === 5 ? `${parts[1]}:00` : parts[1];
  return `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}, ${time} WITA`;
}

function parseWitaToDateTimeLocal(ts) {
  if (!ts) return getNowDateTimeLocalWita();
  try {
    const clean = ts.replace(" WITA", "").trim();
    const parts = clean.split(', ');
    const dateParts = parts[0].split('/');
    const timeParts = parts[1].split(':');
    return `${dateParts[2]}-${dateParts[1].padStart(2, '0')}-${dateParts[0].padStart(2, '0')}T${timeParts[0].padStart(2, '0')}:${timeParts[1].padStart(2, '0')}`;
  } catch(e) {
    return getNowDateTimeLocalWita();
  }
}

function parseTimestampToYMD(ts) {
  if (!ts) return "";
  if (ts.includes('/')) {
    const parts = ts.split(',')[0].split('/');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
  }
  try {
    return new Date(ts).toISOString().split('T')[0];
  } catch(e) {
    return "";
  }
}

function UtilitiesFormatNowWita() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Makassar" }));
  const tgl = String(d.getDate()).padStart(2, '0');
  const bln = String(d.getMonth() + 1).padStart(2, '0');
  const thn = d.getFullYear();
  const jam = String(d.getHours()).padStart(2, '0');
  const mnt = String(d.getMinutes()).padStart(2, '0');
  const dtk = String(d.getSeconds()).padStart(2, '0');
  return `${tgl}/${bln}/${thn}, ${jam}:${mnt}:${dtk} WITA`;
}

// Ekspor Rekap Rentang Tanggal ke PDF
async function executeExportRekapRange() {
  const startInput = document.getElementById('exportStartDate');
  const endInput = document.getElementById('exportEndDate');
  if (!startInput || !endInput || !startInput.value || !endInput.value) {
    alert("Pilih tanggal awal dan tanggal akhir rekap!");
    return;
  }

  const sDate = startInput.value;
  const eDate = endInput.value;
  closeCalendarFilterModal();

  const { jsPDF } = window.jspdf;
  if (!jsPDF) {
    alert("Library jsPDF belum termuat.");
    return;
  }

  alert("Mengambil database rekap dari cloud...");
  try {
    const res = await fetch(`${WEB_APP_URL}?action=EXPORT_REKAP`);
    if (!res.ok) throw new Error("Gagal mengambil data");
    const json = await res.json();
    const allData = json.data || [];

    const filtered = allData.filter(wo => {
      const d = parseTimestampToYMD(wo.createdTime);
      return d >= sDate && d <= eDate;
    });

    if (filtered.length === 0) {
      alert("Tidak ada data Work Order pada rentang tanggal tersebut.");
      return;
    }

    const doc = new jsPDF('l', 'mm', 'a4');
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(`LAPORAN REKAP WORK ORDER & PROGRESS LAPANGAN`, 14, 14);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Periode: ${sDate} s/d ${eDate} | Total: ${filtered.length} Tiket WO`, 14, 20);

    let yPos = 28;
    filtered.forEach((wo, idx) => {
      if (yPos > 175) {
        doc.addPage();
        yPos = 20;
      }

      doc.setFont("helvetica", "bold");
      doc.text(`${idx + 1}. [${(wo.status || 'OPEN').toUpperCase()}] ${wo.road} (${wo.sta}) - Tgl: ${wo.createdTime || '-'} (Oleh: ${wo.reporter})`, 14, yPos);
      yPos += 5;

      doc.setFont("helvetica", "normal");
      const jobText = (wo.jobs && wo.jobs.length > 0) ? wo.jobs.map(j => `${j.category} [${j.status || 'OPEN'}]: ${j.notes}`).join(' | ') : (wo.notes || '-');
      doc.text(`   Instruksi Pekerjaan: ${jobText}`, 14, yPos);
      yPos += 5;

      const hist = wo.progressHistory || [];
      if (hist.length > 0) {
        doc.setFont("helvetica", "italic");
        hist.forEach(h => {
          doc.text(`   - ${h.timestamp} [${h.status}] ${h.jobTarget ? '(' + h.jobTarget + ')' : ''} Oleh ${h.reporter}: ${h.notes} (${h.photoUrls.length} Foto)`, 18, yPos);
          yPos += 4;
        });
      } else {
        doc.setFont("helvetica", "italic");
        doc.text(`   - Belum ada update progress.`, 18, yPos);
        yPos += 4;
      }
      yPos += 4;
    });

    doc.save(`Rekap_WO_${sDate}_sd_${eDate}.pdf`);
  } catch (err) {
    alert("Gagal mengekspor PDF: " + err.message);
  }
}

// Sinkronisasi WO & Sketsa Draw dari Cloud saat Buka WebGIS
async function loadCloudWorkOrders() {
  try {
    const res = await fetch(`${WEB_APP_URL}?action=GET_CLOUD_WO`);
    if (res.ok) {
      const data = await res.json();
      if (data.workOrders && data.workOrders.length > 0) {
        data.workOrders.forEach(wo => {
          allWorkOrders[wo.id] = wo;
        });
      }
      if (data.drawLines && data.drawLines.length > 0) {
        data.drawLines.forEach(line => {
          allDrawLines[line.id] = line;
        });
      }
      refreshWorkOrderMapDisplay();
    }
  } catch (e) {
    console.warn("Gagal sinkronisasi data cloud:", e);
  }
}

// ==========================================
// 7. HELPER WEBGIS, CHART & VIEWPORT OPTIMASI
// ==========================================
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
  loadAllVectorLayers();
  loadCloudWorkOrders();

  setTimeout(() => {
    if (bar) bar.style.width = '100%';
    if (statusText) statusText.innerText = `WELCOME TO OVERWATCH`;
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

function catatLogKeServer(kegiatan, detailAktivitas) {
  const targetUrl = `${WEB_APP_URL}?action=LOG_AKTIVITAS&nrp=${encodeURIComponent(currentNRP)}&kegiatan=${encodeURIComponent(kegiatan)}&detail=${encodeURIComponent(detailAktivitas)}`;
  fetch(targetUrl, { mode: "no-cors" }).catch(err => console.error("Log error:", err));
}

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
    catatLogKeServer("TOGGLE MAP", "Mematikan satelit luar.");
  } else {
    esriSatellite.addTo(map);
    if (orthoLayer) orthoLayer.bringToFront();
    btn.innerHTML = '🌍 Satelit: <b>ON</b>';
    btn.style.color = '#38bdf8';
    btn.style.borderColor = '#1e293b';
    isBasemapActive = true;
    catatLogKeServer("TOGGLE MAP", "Menyalakan satelit luar.");
  }
}

// OPTIMASI EVENT PETA: DEBOUNCED UPDATE
let mapUpdateTimer = null;
map.on('zoomend moveend', () => {
  clearTimeout(mapUpdateTimer);
  mapUpdateTimer = setTimeout(() => {
    if (roadWidthLayer) roadWidthLayer.setStyle(getWidthSliceStyle);
    if (roadGradeLayer) roadGradeLayer.setStyle(getGradePolygonBlockStyle);
    updateGradeLabelsVisibility();
  }, 75);
});

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

function parseMeterSTA(val) {
  if (val === undefined || val === null || val === "") return 0;
  const str = val.toString().trim();
  if (str.includes("+")) {
    const parts = str.split("+");
    return (parseFloat(parts[0]) || 0) * 1000 + (parseFloat(parts[1]) || 0);
  }
  return parseFloat(str) || 0;
}

function getActiveRoadStandardWidth(roadTarget) {
  const target = (roadTarget || activeRoad).trim().toLowerCase();
  if (monitoringData && monitoringData.length > 0) {
    const row = monitoringData.find(d => (d["Nama Jalan"] || "").trim().toLowerCase() === target);
    if (row && row["Lebar Standar (m)"]) {
      const std = parseFloat(row["Lebar Standar (m)"]);
      if (!isNaN(std) && std > 0) return std;
    }
  }
  return 30.8;
}

function isMeterSelected(meterVal, roadName) {
  if (selectedStartMeter === null || !selectedRoadTarget) return false;
  if (roadName.toLowerCase() !== selectedRoadTarget.toLowerCase()) return false;

  if (selectedEndMeter !== null) {
    const minM = Math.min(selectedStartMeter, selectedEndMeter);
    const maxM = Math.max(selectedStartMeter, selectedEndMeter);
    return meterVal >= minM && meterVal <= maxM;
  }
  return meterVal === selectedStartMeter;
}

function calculatePolygonAngle(layer) {
  try {
    const latlngs = layer.getLatLngs();
    const ring = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
    if (ring && ring.length >= 4) {
      const mid1 = { lat: (ring[0].lat + ring[3].lat) / 2, lng: (ring[0].lng + ring[3].lng) / 2 };
      const mid2 = { lat: (ring[1].lat + ring[2].lat) / 2, lng: (ring[1].lng + ring[2].lng) / 2 };
      const p1 = map.latLngToContainerPoint(mid1);
      const p2 = map.latLngToContainerPoint(mid2);
      let angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI);
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      return Math.round(angle);
    }
  } catch (e) {}
  return 0;
}

function getGradePolygonBlockStyle(feature) {
  const props = feature.properties || {};
  const staVal = props.STA_Akhir || props.STA_Awal || props.STA || props.Station_m || 0;
  const meterVal = parseMeterSTA(staVal);
  const roadVal = (props.Nama_Jalan || props["Nama Jalan"] || activeRoad).trim();

  if (isMeterSelected(meterVal, roadVal)) {
    return { color: "#00f0ff", weight: 3.5, fillColor: "#00f0ff", fillOpacity: 0.95 };
  }

  let statusGrade = (props.Status_Gra || props["Status Grade"] || props.Status || "").toString().toUpperCase();
  let fillColor = "#22c55e"; 
  if (statusGrade.includes("OVERGRADE") || statusGrade.includes("NON COMPLIANT")) {
    fillColor = "#e11d48";   
  } else if (statusGrade.includes("WARNING")) {
    fillColor = "#eab308";   
  }

  return { color: "#000000", weight: 1.2, fillColor: fillColor, fillOpacity: 0.88 };
}

function getWidthSliceStyle(feature) {
  const props = feature.properties || {};
  const meterVal = parseMeterSTA(props.Station_m !== undefined ? props.Station_m : (props.Station || props.STA || 0));
  const roadVal = (props.Nama_Jalan || props["Nama Jalan"] || activeRoad).trim();
  const currentZoom = map ? map.getZoom() : 15;
  let baseWeight = currentZoom >= 18 ? 6 : (currentZoom >= 16 ? 4 : (currentZoom >= 14 ? 2.5 : 1.2));

  if (isMeterSelected(meterVal, roadVal)) {
    return { color: "#00f0ff", weight: baseWeight + 3, opacity: 1 };
  }

  if (currentTab === 'lebar') {
    const lebarAktual = parseFloat(props.Lebar_m !== undefined ? props.Lebar_m : (props.Shape_Leng || 0));
    const lebarStandar = props.Standar_m !== undefined ? parseFloat(props.Standar_m) : getActiveRoadStandardWidth(roadVal);
    let color = "#22c55e";
    if (!isNaN(lebarAktual) && lebarAktual > 0 && lebarAktual < lebarStandar) color = "#e11d48";
    return { color: color, weight: color === "#e11d48" ? baseWeight + 1.5 : baseWeight, opacity: 0.9 };
  }
  return { color: "#00e5ff", weight: baseWeight, opacity: 0.85 };
}

// OPTIMASI RINGAN: VIEWPORT CULLING LABEL STA
function updateGradeLabelsVisibility() {
  if (currentTab !== 'grade' || map.getZoom() < 16) {
    gradeLabelsLayer.clearLayers();
    if (map.hasLayer(gradeLabelsLayer)) map.removeLayer(gradeLabelsLayer);
    return;
  }
  if (!map.hasLayer(gradeLabelsLayer)) map.addLayer(gradeLabelsLayer);

  // Hanya render label STA yang berada dalam area pandang layar
  const bounds = map.getBounds().pad(0.1);
  gradeLabelsLayer.clearLayers();
  for (let i = 0; i < allStaMarkers.length; i++) {
    if (bounds.contains(allStaMarkers[i].getLatLng())) {
      gradeLabelsLayer.addLayer(allStaMarkers[i]);
    }
  }
}

function resetSegmentSelection() {
  if (selectedStartMeter === null && selectedEndMeter === null) return;
  selectedStartMeter = null;
  selectedEndMeter = null;
  selectedRoadTarget = "";
  refreshVisibleLayers();
  renderTabContent();
}

function refreshVisibleLayers() {
  if (currentTab === 'grade') {
    if (roadWidthLayer && map.hasLayer(roadWidthLayer)) map.removeLayer(roadWidthLayer);
    if (roadGradeLayer && !map.hasLayer(roadGradeLayer)) roadGradeLayer.addTo(map);
    if (gradeLabelsLayer && !map.hasLayer(gradeLabelsLayer)) gradeLabelsLayer.addTo(map);
    if (roadGradeLayer) roadGradeLayer.setStyle(getGradePolygonBlockStyle);
    updateGradeLabelsVisibility();
  } else {
    if (roadGradeLayer && map.hasLayer(roadGradeLayer)) map.removeLayer(roadGradeLayer);
    if (gradeLabelsLayer && map.hasLayer(gradeLabelsLayer)) map.removeLayer(gradeLabelsLayer);
    if (roadWidthLayer && !map.hasLayer(roadWidthLayer)) roadWidthLayer.addTo(map);
    if (roadWidthLayer) roadWidthLayer.setStyle(getWidthSliceStyle);
  }
}

function handleFeatureClick(feature) {
  if (isWorkOrderModeActive) {
    handleWorkOrderClick(feature);
    return;
  }

  const props = feature.properties || {};
  const clickedRoad = (props.Nama_Jalan || props["Nama Jalan"] || activeRoad).trim();
  const rawSta = props.STA_Akhir || props.STA_Awal || props.Station_m || props.STA || 0;
  const meterVal = parseMeterSTA(rawSta);

  if (clickedRoad && clickedRoad.toLowerCase() !== activeRoad.toLowerCase()) {
    selectedStartMeter = null;
    selectedEndMeter = null;
    selectedRoadTarget = clickedRoad;
    changeRoad(clickedRoad);
  } else {
    selectedRoadTarget = activeRoad;
  }

  if (currentTab === 'lebar' || currentTab === 'grade') {
    if (selectedStartMeter === null || (selectedStartMeter !== null && selectedEndMeter !== null)) {
      selectedStartMeter = meterVal;
      selectedEndMeter = null;
    } else {
      selectedEndMeter = meterVal;
    }
    refreshVisibleLayers();
    if (currentTab === 'lebar') renderLebarSummary();
    else if (currentTab === 'grade') renderGradeSummary();
  } else if (currentTab === 'crossfall') {
    const sta = formatKeSTA(meterVal);
    const staSelect = document.getElementById('select-sta-cs');
    if (staSelect) staSelect.value = sta;
    drawCrossSectionChart(sta);
  }
}

map.on('click', (e) => {
  if (isWorkOrderModeActive) {
    handleMapClickForWo(e.latlng);
    return;
  }
  if (selectedStartMeter !== null || selectedEndMeter !== null) {
    resetSegmentSelection();
  }
});

async function loadAllVectorLayers() {
  try {
    const resGrade = await fetch('data/Road_Grade_Polygons.geojson');
    if (resGrade.ok) {
      const geojsonGrade = await resGrade.json();
      if (roadGradeLayer) map.removeLayer(roadGradeLayer);
      gradeLabelsLayer.clearLayers();
      allStaMarkers = [];

      roadGradeLayer = L.geoJSON(geojsonGrade, {
        style: getGradePolygonBlockStyle,
        onEachFeature: function(feature, layer) {
          const props = feature.properties || {};
          const sta = props.STA_Akhir || formatKeSTA(props.Station_m || props.STA_Awal || 0);
          const road = props.Nama_Jalan || props["Nama Jalan"] || activeRoad;
          
          let gVal = "";
          if (props.Grade_Pct !== undefined && props.Grade_Pct !== null && props.Grade_Pct !== "") {
            const parsedG = parseFloat(props.Grade_Pct);
            if (!isNaN(parsedG)) gVal = parsedG.toFixed(2) + "%";
          } else if (props.Label_Grad) {
            gVal = props.Label_Grad.toString().trim();
          }

          layer.bindTooltip(`<b>${road}</b><br>STA: <b>${sta}</b><br>Grade: <b>${gVal || "-"}</b>`, { sticky: true });

          const center = layer.getBounds().getCenter();
          const angle = calculatePolygonAngle(layer);

          const staMarker = L.marker(center, {
            icon: L.divIcon({
              className: 'sta-rotated-label',
              html: `<span class="sta-text-box" style="transform: rotate(${angle}deg);">${sta}</span>`,
              iconSize: [40, 12], iconAnchor: [20, 6]
            }),
            interactive: false, isSTA: true
          });
          allStaMarkers.push(staMarker);

          layer.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            handleFeatureClick(feature);
          });
        }
      });
    }
  } catch (err) {
    console.warn("Info Layer Grade:", err.message);
  }

  try {
    const resWidth = await fetch('data/Road_Layers.geojson');
    if (resWidth.ok) {
      const geojsonWidth = await resWidth.json();
      rawWidthFeatures = geojsonWidth.features || [];

      if (roadWidthLayer) map.removeLayer(roadWidthLayer);
      roadWidthLayer = L.geoJSON(geojsonWidth, {
        style: getWidthSliceStyle,
        onEachFeature: function(feature, layer) {
          layer.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            handleFeatureClick(feature);
          });
        }
      });
    }
  } catch (err) {
    console.warn("Info Layer Road Layers:", err.message);
  }

  refreshVisibleLayers();
}

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
    refreshVisibleLayers();
  } catch (error) {
    console.error("Excel load error:", error);
  }
}

function switchTab(tabName) {
  currentTab = tabName;
  resetSegmentSelection();
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  if (window.event && window.event.target) window.event.target.classList.add('active');
  refreshVisibleLayers();
  renderTabContent();
}

function changeRoad(roadName) {
  activeRoad = roadName.trim();
  resetSegmentSelection();
  refreshVisibleLayers();
  renderTabContent();
}

function changeYInterval(val) {
  userYInterval = val === 'auto' ? undefined : parseFloat(val);
  drawLongSectionChart(getFilteredRoadData());
}

function getFilteredRoadData() {
  let roadData = monitoringData.filter(d => (d["Nama Jalan"] || "").trim().toLowerCase() === activeRoad.toLowerCase());
  if (currentTab === 'grade' && selectedStartMeter !== null) {
    if (selectedEndMeter !== null) {
      const minM = Math.min(selectedStartMeter, selectedEndMeter);
      const maxM = Math.max(selectedStartMeter, selectedEndMeter);
      roadData = roadData.filter(d => {
        const dm = parseMeterSTA(d["STA"]);
        return dm >= minM && dm <= maxM;
      });
    } else {
      roadData = roadData.filter(d => parseMeterSTA(d["STA"]) === selectedStartMeter);
    }
  }
  return roadData;
}

function renderGradeSummary() {
  const panelBody = document.getElementById('panel-body');
  const panelTitle = document.getElementById('panel-title');
  if (!panelBody || !panelTitle) return;

  const roadSelectHtml = `<select onchange="changeRoad(this.value)" style="font-size:11px; font-weight:bold; padding:2px 4px; border-radius:4px;">${roadNames.map(r => `<option value="${r}" ${r.toLowerCase() === activeRoad.toLowerCase() ? 'selected' : ''}>${r}</option>`).join('')}</select>`;
  const roadData = getFilteredRoadData();

  panelTitle.innerHTML = `Profil Memanjang: ${roadSelectHtml}`;
  panelBody.innerHTML = `
    <div style="font-size:11px; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
      <span style="color:#555;">Kuning: <b>Warning (>8%)</b> | Merah: <b>Overgrade (>10%)</b></span>
      <div style="display:flex; gap:4px; align-items:center;">
        <button onclick="openPdfModal()" style="background:#1f4e79; color:#fff; border:none; padding:2px 6px; border-radius:3px; font-size:10px; cursor:pointer; font-weight:bold;">📥 PDF</button>
        <span style="font-size:11px; color:#1f4e79;"><b>${roadData.length} STA</b></span>
      </div>
    </div>
    <div class="chart-container"><canvas id="chartCanvas"></canvas></div>
  `;
  drawLongSectionChart(roadData);
}

function renderLebarSummary() {
  const panelBody = document.getElementById('panel-body');
  const panelTitle = document.getElementById('panel-title');
  if (!panelBody || !panelTitle) return;

  const roadSelectHtml = `<select onchange="changeRoad(this.value)" style="font-size:11px; font-weight:bold; padding:2px 4px; border-radius:4px;">${roadNames.map(r => `<option value="${r}" ${r.toLowerCase() === activeRoad.toLowerCase() ? 'selected' : ''}>${r}</option>`).join('')}</select>`;
  panelTitle.innerHTML = `Audit Lebar Jalan: ${roadSelectHtml}`;

  const activeStdLebar = getActiveRoadStandardWidth(activeRoad);

  if (selectedStartMeter !== null) {
    const staStartFormatted = formatKeSTA(selectedStartMeter);

    if (selectedEndMeter === null) {
      const matchFeature = rawWidthFeatures.find(f => {
        const fp = f.properties || {};
        const r = (fp.Nama_Jalan || fp["Nama Jalan"] || activeRoad).trim();
        const m = parseMeterSTA(fp.Station_m !== undefined ? fp.Station_m : fp.STA);
        return r.toLowerCase() === activeRoad.toLowerCase() && m === selectedStartMeter;
      });

      const pStart = matchFeature ? matchFeature.properties : {};
      const lebarAktual = parseFloat(pStart.Lebar_m || 0).toFixed(2);
      
      const lebarStandarNum = pStart.Standar_m !== undefined ? parseFloat(pStart.Standar_m) : activeStdLebar;
      const lebarStandar = lebarStandarNum.toFixed(2);
      const isSempit = parseFloat(lebarAktual) < lebarStandarNum;

      let kelasJalan = pStart.Kelas_Jala || "";
      let payloadTon = pStart.Payload || "";
      if (!kelasJalan) {
        kelasJalan = lebarStandarNum <= 25 ? "Class 100" : "Class 200";
        payloadTon = lebarStandarNum <= 25 ? "100" : "200";
      }

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

    const minM = Math.min(selectedStartMeter, selectedEndMeter);
    const maxM = Math.max(selectedStartMeter, selectedEndMeter);
    const staAwal = formatKeSTA(minM);
    const staAkhir = formatKeSTA(maxM);
    const totalPanjang = maxM - minM;

    let featuresInRange = rawWidthFeatures.filter(f => {
      const fp = f.properties || {};
      const fRoad = (fp.Nama_Jalan || fp["Nama Jalan"] || activeRoad).trim();
      if (fRoad.toLowerCase() === activeRoad.toLowerCase()) {
        const fm = parseMeterSTA(fp.Station_m !== undefined ? fp.Station_m : fp.STA);
        return fm >= minM && fm <= maxM;
      }
      return false;
    });

    let avgLebar = 0;
    let minLebar = 999;
    let maxLebar = 0;
    let countNonCompliant = 0;
    
    const stdLebarNum = activeStdLebar;
    const stdLebar = stdLebarNum.toFixed(2);

    let kelasJalan = stdLebarNum <= 25 ? "Class 100" : "Class 200";
    let payloadTon = stdLebarNum <= 25 ? "100" : "200";

    if (featuresInRange.length > 0) {
      let totalW = 0;
      featuresInRange.forEach(f => {
        const w = parseFloat(f.properties.Lebar_m || f.properties.Shape_Leng || 0);
        totalW += w;
        if (w < minLebar) minLebar = w;
        if (w > maxLebar) maxLebar = w;
        if (w < stdLebarNum) countNonCompliant++;
      });
      avgLebar = (totalW / featuresInRange.length).toFixed(2);
      minLebar = minLebar.toFixed(2);
      maxLebar = maxLebar.toFixed(2);
      kelasJalan = featuresInRange[0].properties.Kelas_Jala || kelasJalan;
      payloadTon = featuresInRange[0].properties.Payload || payloadTon;
    }

    const defisit = (stdLebarNum - parseFloat(avgLebar)).toFixed(2);

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
          <div style="font-size:9px; color:#64748b;">Defisit: -${defisit} m</div>
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

  const roadData = monitoringData.filter(d => (d["Nama Jalan"] || "").trim().toLowerCase() === activeRoad.toLowerCase());
  const nonStd = roadData.filter(d => {
    const s = (d["Status Lebar Jalan"] || "").toUpperCase();
    const act = parseFloat(d["Lebar Total (m)"] || 0);
    const std = parseFloat(d["Lebar Standar (m)"] || activeStdLebar);
    return s.includes("NONSTANDARD") || s.includes("SEMPIT") || s.includes("NON COMPLIANT") || act < std;
  });

  let listHtml = nonStd.map(d => `
    <div style="padding:6px 10px; background:#fff0f0; border-left:4px solid #c00000; margin-bottom:4px; font-size:12px; display:flex; justify-content:space-between; align-items:center;">
      <span>STA <b>${d["STA"]}</b>: Aktual <b>${d["Lebar Total (m)"]} m</b> (Std: ${d["Lebar Standar (m)"] || activeStdLebar} m)</span>
      <span style="color:#c00000; font-weight:bold;">Sempit</span>
    </div>
  `).join('');

  panelBody.innerHTML = `
    <div style="font-size:11px; color:#64748b; margin-bottom:6px;">
      💡 <i>Klik garis di peta untuk detail STA, atau klik 2 titik untuk ringkasan segmen. Klik area peta kosong untuk reset.</i>
    </div>
    ${nonStd.length ? listHtml : `<p style="font-size:12px; color:green; text-align:center; padding-top:20px;">Semua segmen di ${activeRoad} memenuhi standar lebar.</p>`}
  `;
}

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
    renderGradeSummary();
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
      <div class="chart-container"><canvas id="chartCanvas"></canvas></div>
    `;
    if (roadData.length > 0) drawCrossSectionChart(roadData[0]["STA"]);
  }
}

function drawLongSectionChart(dataSubset) {
  const ctx = document.getElementById('chartCanvas');
  if (!ctx) return;
  if (chartInstance) chartInstance.destroy();

  const allElevations = dataSubset.map(d => parseFloat(d["Elevasi As (m)"])).filter(v => !isNaN(v));
  if (allElevations.length === 0) return;

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
    return (status.includes("WARNING") || status.includes("OVERGRADE") || status.includes("NON COMPLIANT")) ? 6 : 3.5;
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

document.addEventListener("DOMContentLoaded", () => {
  const bottomPanel = document.getElementById('bottom-panel');
  const panelHeader = document.querySelector('.panel-header');
  if (!bottomPanel || !panelHeader) return;

  let isDragging = false;
  let startY = 0;
  let startHeight = 0;

  function onDragStart(clientY) {
    isDragging = true;
    startY = clientY;
    startHeight = bottomPanel.getBoundingClientRect().height;
    document.body.style.userSelect = 'none';
  }

  function onDragMove(clientY) {
    if (!isDragging) return;
    const deltaY = startY - clientY;
    let newHeight = startHeight + deltaY;

    const minHeight = 44;
    const maxHeight = window.innerHeight * 0.75;

    if (newHeight < minHeight) newHeight = minHeight;
    if (newHeight > maxHeight) newHeight = maxHeight;

    bottomPanel.style.height = `${newHeight}px`;

    if (chartInstance) {
      chartInstance.resize();
    }
  }

  function onDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    document.body.style.userSelect = '';
    if (map) map.invalidateSize();
  }

  panelHeader.addEventListener('mousedown', (e) => {
    if (['SELECT', 'OPTION', 'BUTTON'].includes(e.target.tagName)) return;
    onDragStart(e.clientY);
  });

  window.addEventListener('mousemove', (e) => {
    onDragMove(e.clientY);
  });

  window.addEventListener('mouseup', () => {
    onDragEnd();
  });

  panelHeader.addEventListener('touchstart', (e) => {
    if (['SELECT', 'OPTION', 'BUTTON'].includes(e.target.tagName)) return;
    onDragStart(e.touches[0].clientY);
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (isDragging) {
      onDragMove(e.touches[0].clientY);
    }
  }, { passive: true });

  window.addEventListener('touchend', () => {
    onDragEnd();
  });
});

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

  const roadData = getFilteredRoadData();
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
