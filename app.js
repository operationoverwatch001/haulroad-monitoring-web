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

// Kunci Sesi 30 Hari & Log 48 Jam
const SESSION_STORAGE_KEY = "overwatch_user_session";
const NOTIF_LOGS_KEY = "overwatch_notification_logs";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

let currentNRP = "SUPABASE_USER";
let currentUserRole = "viewer"; 

// Navigasi & Tab State
let currentMainTab = 'map'; // 'map' atau 'parameter'
let currentParam = 'grade'; // 'grade', 'lebar', atau 'crossfall'
let currentTab = 'grade';
let isAnnotationActive = false; // Default Anotasi Label: OFF

// State Data Tanggal & Survey
let calendarFilterDate = null; // Default null = Hari ini WITA
let dataUpdateDate = localStorage.getItem('overwatch_data_update_date') || "17-09-2026";

let monitoringData = [];
let crossSectionData = [];
let roadNames = [];
let activeRoad = "";
let chartInstance = null;
let userYInterval = undefined;

let rawWidthFeatures = [];
let roadWidthLayer = null;        
let roadGradeLayer = null; 
let roadMapLayer = null;
let roadNonSaranaLayer = null;       
let gradeLabelsLayer = L.layerGroup();  
let crossfallVisualLayer = L.layerGroup();
let allStaMarkers = []; 
let allRoadNameMarkers = [];

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

// Variabel Mouse-Drag & Click-to-Point Freehand Draw
let isDrawingActive = false;
let currentDrawPoints = [];
let tempDrawPolyline = null;
let selectedLineForWo = null; 
let lastTouchDownTime = 0;
let finishDrawBtn = null;

// State Antrean Akumulasi Multi-Foto & Update Per-Job
let mainUploadFilesQueue = [];
let jobUpdateFilesQueue = [];
let activeJobUpdateIndex = null;
let currentTimelineHistory = [];
let notificationLogs = [];

let userMarker = null;
let userAccuracyCircle = null;
let isTracking = false;
let watchId = null;

// State Bottom Panel Memory
let isPanelOpen = false;
let lastPanelHeight = 220;
let toastTimeout = null;
let syncStatusTimeout = null;

// Channel Realtime Supabase
let realtimeChannel = null;

Chart.register(ChartDataLabels);

// Engine Canvas Mandiri untuk Optimasi Performa Maksimal
const canvasRenderer = L.canvas({ padding: 0.35 });

// Inisialisasi Peta Leaflet (Canvas Driven)
const map = L.map('map', { 
  zoomControl: false,
  preferCanvas: true,
  renderer: canvasRenderer
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
    }).catch(e => console.warn("Header PMTiles load warn:", e));

  } catch (err) {
    console.error("Gagal mounting layer PMTiles:", err);
  }
}

// ==========================================
// 1B. BADGE NOTIFIKASI SINKRONISASI (FOTO 6)
// ==========================================
function setSyncStatus(status) {
  const badge = document.getElementById('syncStatusBadge');
  const dot = document.getElementById('syncStatusDot');
  const text = document.getElementById('syncStatusText');
  if (!badge || !dot || !text) return;

  clearTimeout(syncStatusTimeout);

  if (!navigator.onLine || status === 'offline') {
    badge.className = "px-2.5 py-0.5 rounded-full shadow-lg border backdrop-blur-md transition-all duration-300 pointer-events-auto flex items-center gap-1.5 sync-offline";
    dot.className = "w-2 h-2 rounded-full bg-white blip-pulsing";
    text.innerText = "Offline !";
    badge.style.display = "flex";
    return;
  }

  if (status === 'updating') {
    badge.className = "px-2.5 py-0.5 rounded-full shadow-lg border backdrop-blur-md transition-all duration-300 pointer-events-auto flex items-center gap-1.5 sync-updating";
    dot.className = "w-2 h-2 rounded-full bg-slate-950 blip-pulsing";
    text.innerText = "Updating !";
    badge.style.display = "flex";
  } else if (status === 'updated') {
    badge.className = "px-2.5 py-0.5 rounded-full shadow-lg border backdrop-blur-md transition-all duration-300 pointer-events-auto flex items-center gap-1.5 sync-updated";
    dot.className = "w-2 h-2 rounded-full bg-slate-950";
    text.innerText = "Updated !";
    badge.style.display = "flex";

    syncStatusTimeout = setTimeout(() => {
      badge.style.display = "none";
    }, 3000);
  } else if (status === 'hide') {
    badge.style.display = "none";
  }
}

window.addEventListener('online', () => {
  setSyncStatus('updating');
  loadCloudWorkOrders();
});

window.addEventListener('offline', () => {
  setSyncStatus('offline');
});

// ==========================================
// 1C. SUPABASE REALTIME BROADCAST & PRESENCE
// ==========================================
function initSupabaseRealtime() {
  if (realtimeChannel) return;

  try {
    realtimeChannel = _supabase.channel('overwatch-live-ops', {
      config: {
        broadcast: { self: false },
        presence: { key: currentNRP }
      }
    });

    realtimeChannel
      .on('broadcast', { event: 'WO_LIVE_SYNC' }, (eventPayload) => {
        handleIncomingRealtimeSync(eventPayload.payload);
      })
      .on('broadcast', { event: 'DATA_UPDATE_SYNC' }, (eventPayload) => {
        if (eventPayload.payload && eventPayload.payload.newDate) {
          updateDataDateUI(eventPayload.payload.newDate, false);
        }
      })
      .on('presence', { event: 'sync' }, () => {
        const state = realtimeChannel.presenceState();
        const onlineCount = Object.keys(state).length || 1;
        const counterElem = document.getElementById('onlineCounterText');
        if (counterElem) counterElem.innerText = `Online: ${onlineCount}`;
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          console.log('⚡ [Realtime] Overwatch Live Sync Connected');
          await realtimeChannel.track({
            user: currentNRP,
            role: currentUserRole,
            online_at: new Date().toISOString()
          });
        }
      });
  } catch (err) {
    console.warn("Realtime standby mode:", err.message);
  }
}

function broadcastWoSync(actionType, dataPayload, notificationMsg = "") {
  if (!realtimeChannel) return;
  try {
    realtimeChannel.send({
      type: 'broadcast',
      event: 'WO_LIVE_SYNC',
      payload: {
        action: actionType,
        data: dataPayload,
        sender: currentNRP,
        message: notificationMsg,
        timestamp: Date.now()
      }
    });
  } catch (e) {}

  if (notificationMsg) {
    recordNotification(notificationMsg);
  }
}

function handleIncomingRealtimeSync(payload) {
  if (!payload || !payload.action) return;
  const { action, data, sender, message } = payload;
  console.log(`⚡ [Realtime Sync] ${action} dari ${sender}:`, data);

  setSyncStatus('updating');

  if (message) {
    showToastNotification(message);
    recordNotification(message);
  }

  switch (action) {
    case 'CREATE_WO':
    case 'EDIT_WO':
      if (data && data.id) {
        allWorkOrders[data.id] = data;
        if (isWorkOrderModeActive) {
          createOrUpdateMarker(data);
          if (data.linkedLineId && allDrawLines[data.linkedLineId]) {
            renderDrawLineOnMap(allDrawLines[data.linkedLineId]);
          }
        }
        renderOutstandingList();
      }
      break;

    case 'UPDATE_WO_STATUS':
      if (data && data.woId && allWorkOrders[data.woId]) {
        const targetWo = allWorkOrders[data.woId];
        targetWo.status = data.status;
        if (targetWo.jobs && targetWo.jobs[0]) {
          targetWo.jobs[0].status = data.status;
        }
        if (isWorkOrderModeActive) {
          createOrUpdateMarker(targetWo);
          if (targetWo.linkedLineId && allDrawLines[targetWo.linkedLineId]) {
            renderDrawLineOnMap(allDrawLines[targetWo.linkedLineId]);
          }
        }
        renderOutstandingList();
      }
      break;

    case 'UPDATE_JOB_STATUS':
      if (data && data.woId && allWorkOrders[data.woId]) {
        const targetWo = allWorkOrders[data.woId];
        if (targetWo.jobs && targetWo.jobs[data.jobIndex]) {
          targetWo.jobs[data.jobIndex].status = data.status;
        }
        targetWo.status = data.parentStatus || calculateParentStatus(targetWo.jobs);
        if (isWorkOrderModeActive) {
          createOrUpdateMarker(targetWo);
          if (targetWo.linkedLineId && allDrawLines[targetWo.linkedLineId]) {
            renderDrawLineOnMap(allDrawLines[targetWo.linkedLineId]);
          }
        }
        renderOutstandingList();
      }
      break;

    case 'DELETE_WO':
      if (data && data.id && allWorkOrders[data.id]) {
        const woItem = allWorkOrders[data.id];
        if (woItem.markerLayer && workOrderMarkersLayer.hasLayer(woItem.markerLayer)) {
          workOrderMarkersLayer.removeLayer(woItem.markerLayer);
        }
        const lineId = woItem.linkedLineId;
        delete allWorkOrders[data.id];
        if (lineId && allDrawLines[lineId]) {
          renderDrawLineOnMap(allDrawLines[lineId]);
        }
        renderOutstandingList();
      }
      break;

    case 'CREATE_DRAW_LINE':
      if (data && data.id) {
        allDrawLines[data.id] = data;
        if (isWorkOrderModeActive) {
          renderDrawLineOnMap(data);
        }
      }
      break;

    case 'DELETE_DRAW_LINE':
      if (data && data.id && allDrawLines[data.id]) {
        const lineItem = allDrawLines[data.id];
        if (lineItem.layer && workOrderDrawingsLayer.hasLayer(lineItem.layer)) {
          workOrderDrawingsLayer.removeLayer(lineItem.layer);
        }
        delete allDrawLines[data.id];
      }
      break;
  }

  setSyncStatus('updated');
}

function showToastNotification(text) {
  const toast = document.getElementById('toastNotification');
  if (!toast) return;
  toast.innerText = text;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

// ==========================================
// 1D. SINKRONISASI LOG 48 JAM MULTI-DEVICE
// ==========================================
function parseTimestampToMs(ts) {
  if (!ts) return null;
  try {
    if (ts.includes('/')) {
      const clean = ts.replace(" WITA", "").trim();
      const parts = clean.split(', ');
      const dateParts = parts[0].split('/');
      const timeParts = (parts[1] || "00:00:00").split(':');
      const d = new Date(parseInt(dateParts[2]), parseInt(dateParts[1]) - 1, parseInt(dateParts[0]), parseInt(timeParts[0]) || 0, parseInt(timeParts[1]) || 0, parseInt(timeParts[2]) || 0);
      return d.getTime();
    }
    return new Date(ts).getTime();
  } catch (e) {
    return null;
  }
}

function loadStoredNotificationLogs() {
  const raw = localStorage.getItem(NOTIF_LOGS_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    const now = Date.now();
    const valid = list.filter(item => (now - item.timestampMs) < FORTY_EIGHT_HOURS_MS);
    localStorage.setItem(NOTIF_LOGS_KEY, JSON.stringify(valid));
    return valid;
  } catch (e) {
    return [];
  }
}

function recordNotification(text) {
  const now = Date.now();
  const timeNow = UtilitiesFormatNowWita().split(', ')[1] || '';
  notificationLogs.unshift({ text: text, time: timeNow, timestampMs: now });
  notificationLogs = notificationLogs.filter(item => (now - item.timestampMs) < FORTY_EIGHT_HOURS_MS);
  localStorage.setItem(NOTIF_LOGS_KEY, JSON.stringify(notificationLogs));
  renderNotificationDrawerList();
  const dot = document.getElementById('notifBadgeDot');
  if (dot) dot.classList.remove('hidden');
}

function syncNotificationLogsFromCloud() {
  const now = Date.now();
  const serverLogs = [];

  Object.values(allWorkOrders).forEach(wo => {
    const woTimeMs = parseTimestampToMs(wo.createdTime);
    if (woTimeMs && (now - woTimeMs) < FORTY_EIGHT_HOURS_MS) {
      serverLogs.push({
        text: `${wo.reporter || 'Pengawas'} menambahkan WO di ${wo.road}`,
        time: wo.createdTime ? (wo.createdTime.split(', ')[1] || '') : '',
        timestampMs: woTimeMs
      });
    }

    if (wo.progressHistory && Array.isArray(wo.progressHistory)) {
      wo.progressHistory.forEach(h => {
        const hTimeMs = parseTimestampToMs(h.timestamp);
        if (hTimeMs && (now - hTimeMs) < FORTY_EIGHT_HOURS_MS) {
          const target = h.jobTarget ? ` [${h.jobTarget}]` : '';
          serverLogs.push({
            text: `${h.reporter || 'Pengawas'} update${target} ${wo.road}. Status : ${h.status || 'PROGRESS'}`,
            time: h.timestamp ? (h.timestamp.split(', ')[1] || '') : '',
            timestampMs: hTimeMs
          });
        }
      });
    }
  });

  const localLogs = loadStoredNotificationLogs();
  const combined = [...serverLogs, ...localLogs];
  const seen = new Set();
  const deduped = [];

  combined.sort((a, b) => b.timestampMs - a.timestampMs);

  combined.forEach(item => {
    const key = `${item.text}_${item.time}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  });

  notificationLogs = deduped.filter(item => (now - item.timestampMs) < FORTY_EIGHT_HOURS_MS);
  localStorage.setItem(NOTIF_LOGS_KEY, JSON.stringify(notificationLogs));
  renderNotificationDrawerList();
}

function renderNotificationDrawerList() {
  const container = document.getElementById('notificationList');
  const empty = document.getElementById('emptyNotifNotice');
  if (!container) return;

  if (notificationLogs.length === 0) {
    if (empty) empty.style.display = 'block';
    container.innerHTML = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  container.innerHTML = notificationLogs.map(item => `
    <div class="bg-slate-900 border border-slate-800 p-2 rounded-lg shadow-sm">
      <div class="flex items-center justify-between text-[9px] text-cyan-400 font-mono mb-1">
        <span>INFO BROADCAST</span>
        <span>${item.time}</span>
      </div>
      <div class="text-[11px] text-slate-200 leading-relaxed">${item.text}</div>
    </div>
  `).join('');
}

function toggleNotificationDrawer() {
  const drawer = document.getElementById('notificationDrawer');
  const dot = document.getElementById('notifBadgeDot');
  if (!drawer) return;

  if (drawer.classList.contains('active-drawer')) {
    drawer.classList.remove('active-drawer');
  } else {
    drawer.classList.add('active-drawer');
    if (dot) dot.classList.add('hidden');
  }
}

// ==========================================
// 1E. OUTSTANDING WO (MURNI NAMA JALAN - FOTO 5)
// ==========================================
function toggleOutstandingDrawer() {
  const drawer = document.getElementById('outstandingDrawer');
  if (!drawer) return;

  if (drawer.classList.contains('active-drawer')) {
    drawer.classList.remove('active-drawer');
  } else {
    renderOutstandingList();
    drawer.classList.add('active-drawer');
  }
}

function renderOutstandingList() {
  const listContainer = document.getElementById('outstandingList');
  const countBadge = document.getElementById('outstandingCountBadge');
  if (!listContainer) return;

  const outstandingWos = Object.values(allWorkOrders).filter(wo => {
    const st = (wo.status || 'OPEN').toUpperCase();
    return st === 'OPEN' || st === 'PROGRESS';
  });

  outstandingWos.sort((a, b) => (b.id || '').localeCompare(a.id || ''));

  if (countBadge) {
    countBadge.innerText = outstandingWos.length;
  }

  if (outstandingWos.length === 0) {
    listContainer.innerHTML = '<p class="text-slate-500 text-center py-4 text-[10px]">Semua pekerjaan sudah CLOSED! Mantap.</p>';
    return;
  }

  listContainer.innerHTML = outstandingWos.map(wo => {
    const st = (wo.status || 'OPEN').toUpperCase();
    const stColor = st === 'PROGRESS' ? '#eab308' : '#e11d48';
    
    // Hilangkan teks dalam tanda kurung (Foto 5)
    let cleanRoad = (wo.road || 'Ruas Tambang').replace(/\s*\(.*?\)/g, '').trim();
    if (!cleanRoad) cleanRoad = 'Ruas Tambang';

    return `
      <div onclick="flyToOutstandingWo('${wo.id}')" class="bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/50 p-2 rounded-lg cursor-pointer transition flex items-center justify-between gap-2">
        <div class="truncate">
          <div class="text-[11px] font-bold text-slate-200 truncate">${cleanRoad}</div>
          <div class="text-[9px] text-slate-400 font-mono">${wo.createdTime ? wo.createdTime.split(',')[0] : '-'}</div>
        </div>
        <span class="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0" style="background:${stColor}; color:#000;">${st}</span>
      </div>
    `;
  }).join('');
}

function flyToOutstandingWo(woId) {
  const wo = allWorkOrders[woId];
  if (!wo || !wo.latlng) return;

  if (!isWorkOrderModeActive) {
    toggleWorkOrderFloating();
  }

  map.flyTo(wo.latlng, 18, { duration: 1.2 });

  setTimeout(() => {
    if (wo.markerLayer) {
      wo.markerLayer.openPopup();
    } else {
      openViewWoModal(woId);
    }
  }, 1300);

  const drawer = document.getElementById('outstandingDrawer');
  if (drawer && window.innerWidth < 768) {
    drawer.classList.remove('active-drawer');
  }
}

// Drawer Legenda Dinamis
function toggleLegendDrawer() {
  const drawer = document.getElementById('legendDrawer');
  if (!drawer) return;
  if (drawer.classList.contains('hidden')) {
    updateLegendUI();
    drawer.classList.remove('hidden');
  } else {
    drawer.classList.add('hidden');
  }
}

function updateLegendUI() {
  const title = document.getElementById('legendTitle');
  const content = document.getElementById('legendContent');
  if (!title || !content) return;

  if (currentMainTab === 'map') {
    title.innerText = 'LEGENDA: MAP';
    content.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="w-5 h-1.5 rounded-sm bg-[#38bdf8]"></span>
        <span>Jalan Hauler 100 Ton</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="w-5 h-1.5 rounded-sm bg-[#eab308]"></span>
        <span>Jalan Hauler 150 Ton</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="w-5 h-1.5 rounded-sm bg-[#f97316]"></span>
        <span>Jalan Hauler 200 Ton</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="w-5 h-1.5 rounded-sm bg-[#ec4899]"></span>
        <span>Jalur Sarana</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="w-5 h-2 rounded-sm border-2 border-[#ef4444] bg-[#ef4444]/40"></span>
        <span>Jalur Khusus Non-Sarana</span>
      </div>
    `;
  } else {
    if (currentParam === 'grade') {
      title.innerText = 'LEGENDA: GRADE JALAN';
      content.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="w-4 h-3 rounded-sm bg-[#22c55e]"></span>
          <span>Ongrade (&lt; 7.9%)</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-4 h-3 rounded-sm bg-[#eab308]"></span>
          <span>Warning (8.0% - 8.9%)</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-4 h-3 rounded-sm bg-[#e11d48]"></span>
          <span>Overgrade (&gt; 9.0%)</span>
        </div>
      `;
    } else if (currentParam === 'lebar') {
      title.innerText = 'LEGENDA: LEBAR JALAN';
      content.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="w-5 h-1.5 rounded-sm bg-[#22c55e]"></span>
          <span>Lebar Sesuai Standar</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-5 h-1.5 rounded-sm bg-[#e11d48]"></span>
          <span>Non-Standar (Sempit)</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-5 h-1.5 rounded-sm bg-[#00f0ff]"></span>
          <span>STA Terpilih (Highlight)</span>
        </div>
      `;
    } else {
      title.innerText = 'LEGENDA: CROSS SECTION';
      content.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="w-5 h-1.5 rounded-sm bg-[#22c55e]"></span>
          <span>Compliant (Normal: 2.0% - 4.0%)</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-5 h-1.5 rounded-sm bg-[#e11d48]"></span>
          <span>Non-Compliant (&lt; 2.0% / &gt; 4.0%)</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-5 h-1.5 rounded-sm bg-[#00f0ff]"></span>
          <span>STA Terpilih (Highlight)</span>
        </div>
        <div class="flex items-center gap-2 mt-2 pt-1 border-t border-slate-700">
          <span class="text-xs font-bold text-cyan-400">➤</span>
          <span>Arah Aliran Air (Tinggi ke Rendah)</span>
        </div>
      `;
    }
  }
}

function sanitizeWoForBroadcast(wo) {
  return {
    id: wo.id,
    createdTime: wo.createdTime,
    road: wo.road,
    sta: wo.sta,
    latlng: wo.latlng,
    jobs: wo.jobs,
    notes: wo.notes,
    reporter: wo.reporter,
    photoUrls: wo.photoUrls || [],
    status: wo.status,
    linkedLineId: wo.linkedLineId || ""
  };
}

function sanitizeDrawLineForBroadcast(line) {
  return {
    id: line.id,
    road: line.road,
    points: line.points,
    reporter: line.reporter
  };
}

// ==========================================
// 2. SESI LOGIN 30 HARI & AUTHENTICATION
// ==========================================
function saveUserSession(nrp, role) {
  const sessionData = {
    nrp: nrp,
    role: role,
    loginTime: Date.now()
  };
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionData));
}

function checkStoredSession() {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const sess = JSON.parse(raw);
    if (Date.now() - sess.loginTime < THIRTY_DAYS_MS) {
      return sess;
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
  } catch (e) {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  initDatePickersMax();
  initMultiPhotoQueueListeners();
  updateDataDateUI(dataUpdateDate, false);
  updateActiveWoDateButtonText();
  
  notificationLogs = loadStoredNotificationLogs();
  renderNotificationDrawerList();

  if (!navigator.onLine) {
    setSyncStatus('offline');
  }

  const savedSession = checkStoredSession();
  if (savedSession) {
    currentNRP = savedSession.nrp;
    currentUserRole = savedSession.role;
    const authOverlay = document.getElementById('auth-overlay');
    if (authOverlay) authOverlay.style.display = 'none';
    mulaiAnimasiIntroDanLoadData();
    return;
  }

  const { data: { session } } = await _supabase.auth.getSession();
  if (session && session.user && session.user.email) {
    currentNRP = session.user.email;
    await checkUserRole(currentNRP);
    saveUserSession(currentNRP, currentUserRole);
    const authOverlay = document.getElementById('auth-overlay');
    if (authOverlay) authOverlay.style.display = 'none';
    mulaiAnimasiIntroDanLoadData();
  } else {
    const authOverlay = document.getElementById('auth-overlay');
    if (authOverlay) authOverlay.style.display = 'flex';
  }
});

function initDatePickersMax() {
  const todayYMD = getTodayYMDWita();
  const pickerIds = ['mapCalendarDateInput', 'exportStartDate', 'exportEndDate', 'adminNewUpdateDateInput'];
  
  pickerIds.forEach(id => {
    const elem = document.getElementById(id);
    if (elem) {
      elem.max = todayYMD;
      const enforceMax = function() {
        if (this.value && this.value > todayYMD) {
          alert("Wkwk gak bisa milih tanggal masa depan bre! Maksimal hari ini.");
          this.value = todayYMD;
        }
      };
      elem.addEventListener('input', enforceMax);
      elem.addEventListener('change', enforceMax);
      elem.addEventListener('focus', function() { this.max = todayYMD; });
      elem.addEventListener('click', function() { this.max = todayYMD; });
    }
  });
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

  if (rawVal === "blackmamba11") {
    statusMsg.innerText = 'Access Granted (Developer Mode)...';
    currentUserRole = "admin";
    currentNRP = "DEVELOPER";
    saveUserSession("DEVELOPER", "admin");
    setTimeout(() => {
      const authOverlay = document.getElementById('auth-overlay');
      if (authOverlay) authOverlay.style.display = 'none';
      mulaiAnimasiIntroDanLoadData();
    }, 500);
    return;
  }

  if (rawVal === "foxhunt88") {
    statusMsg.innerText = 'Access Granted (Viewer Mode)...';
    currentUserRole = "viewer";
    currentNRP = "GUEST_VIEWER";
    saveUserSession("GUEST_VIEWER", "viewer");
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
    saveUserSession(email, currentUserRole);
    setTimeout(() => {
      const authOverlay = document.getElementById('auth-overlay');
      if (authOverlay) authOverlay.style.display = 'none';
      currentNRP = email;
      mulaiAnimasiIntroDanLoadData();
    }, 800);
  }
};

// ==========================================
// 2B. KONTROL HEADER TANGGAL & ROLE ADMIN
// ==========================================
function updateActiveWoDateButtonText() {
  const label = document.getElementById('labelActiveWoDate');
  if (!label) return;
  if (calendarFilterDate) {
    const p = calendarFilterDate.split('-');
    label.innerText = `${p[2]}/${p[1]}/${p[0]}`;
  } else {
    const today = getTodayYMDWita().split('-');
    label.innerText = `${today[2]}/${today[1]}/${today[0]}`;
  }
}

function updateDataDateUI(newDateStr, shouldBroadcast = true) {
  dataUpdateDate = newDateStr;
  localStorage.setItem('overwatch_data_update_date', newDateStr);
  const label = document.getElementById('labelDataUpdateDate');
  if (label) label.innerText = newDateStr;

  if (shouldBroadcast && realtimeChannel) {
    try {
      realtimeChannel.send({
        type: 'broadcast',
        event: 'DATA_UPDATE_SYNC',
        payload: { newDate: newDateStr }
      });
    } catch (e) {}
  }
}

function handleDataUpdateClick() {
  if (currentUserRole !== 'admin') {
    alert("Hanya pengawas dengan hak akses ADMIN yang dapat mengubah tanggal update data audit!");
    return;
  }
  const modal = document.getElementById('adminDataUpdateModal');
  const input = document.getElementById('adminNewUpdateDateInput');
  if (input) {
    input.max = getTodayYMDWita();
    input.value = getTodayYMDWita();
  }
  if (modal) modal.style.display = 'flex';
}

function closeAdminDataUpdateModal() {
  const modal = document.getElementById('adminDataUpdateModal');
  if (modal) modal.style.display = 'none';
}

function saveAdminDataUpdateDate() {
  const input = document.getElementById('adminNewUpdateDateInput');
  if (!input || !input.value) return;
  const val = input.value;
  const p = val.split('-');
  const formatted = `${p[2]}-${p[1]}-${p[0]}`;
  updateDataDateUI(formatted, true);
  catatLogKeServer("UPDATE DATA DATE", `Admin menyetel tanggal update data menjadi: ${formatted}`);
  alert(`Tanggal Update Data berhasil diperbarui menjadi: ${formatted}`);
  closeAdminDataUpdateModal();
}

// ==========================================
// 2C. RESTRUKTURISASI TAB MENU: MAP & PARAMETER (FOTO 4)
// ==========================================
function switchMainTab(tabKey) {
  currentMainTab = tabKey;
  closeParameterDropdown();

  const mapBtn = document.getElementById('tabMapBtn');
  const paramBtn = document.getElementById('tabParamBtn');

  if (tabKey === 'map') {
    if (mapBtn) {
      mapBtn.className = "font-bold text-xs px-3.5 py-1 rounded-md transition duration-150 bg-amber-400 text-slate-950 shadow flex-shrink-0";
    }
    if (paramBtn) {
      paramBtn.className = "font-bold text-xs px-3 py-1 rounded-md transition duration-150 text-slate-300 hover:text-white flex items-center gap-1 flex-shrink-0";
    }
    refreshVisibleLayers();
    updateLegendUI();
    renderMapOverviewSummary();
  }
}

function toggleParameterDropdown() {
  const menu = document.getElementById('paramDropdownMenu');
  if (!menu) return;
  menu.classList.toggle('hidden');
}

function closeParameterDropdown() {
  const menu = document.getElementById('paramDropdownMenu');
  if (menu) menu.classList.add('hidden');
}

function selectParameter(paramKey) {
  currentParam = paramKey;
  currentMainTab = 'parameter';
  currentTab = paramKey;
  closeParameterDropdown();

  const mapBtn = document.getElementById('tabMapBtn');
  const paramBtn = document.getElementById('tabParamBtn');
  const paramLabel = document.getElementById('currentParamLabel');

  if (mapBtn) {
    mapBtn.className = "font-bold text-xs px-3.5 py-1 rounded-md transition duration-150 text-slate-300 hover:text-white flex-shrink-0";
  }
  if (paramBtn) {
    paramBtn.className = "font-bold text-xs px-3 py-1 rounded-md transition duration-150 bg-amber-400 text-slate-950 shadow flex items-center gap-1 flex-shrink-0";
  }

  // Penulisan Parameter Ringkas (Foto 4)
  const nameMap = {
    'grade': 'GRADE',
    'lebar': 'LEBAR JALAN',
    'crossfall': 'CROSS SECTION'
  };
  if (paramLabel) paramLabel.innerText = nameMap[paramKey] || 'PARAMETER';

  resetSegmentSelection();
  refreshVisibleLayers();
  renderTabContent();
  updateLegendUI();

  if (!isPanelOpen) {
    setBottomPanelHeight(lastPanelHeight);
  }
}

function renderMapOverviewSummary() {
  const panelBody = document.getElementById('panel-body');
  const panelTitle = document.getElementById('panel-title');
  if (!panelBody || !panelTitle) return;

  panelTitle.innerHTML = `Peta Operasional Tambang (Live Centerline Map)`;
  panelBody.innerHTML = `
    <div style="font-size:11px; color:#64748b; margin-bottom:6px;">
      💡 <i>Menampilkan garis as jalan haulage operasional, klasifikasi tonase hauler, serta jalur khusus non-sarana.</i>
    </div>
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:6px;">
      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-left:4px solid #38bdf8; padding:6px 10px; border-radius:4px;">
        <div style="font-size:10px; color:#64748b;">Kelas Hauler</div>
        <div style="font-size:12px; font-weight:bold; color:#1e293b;">100, 150 & 200 Ton</div>
      </div>
      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-left:4px solid #ec4899; padding:6px 10px; border-radius:4px;">
        <div style="font-size:10px; color:#64748b;">Jalur Sarana</div>
        <div style="font-size:12px; font-weight:bold; color:#ec4899;">Akses Ringan (Pink)</div>
      </div>
      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-left:4px solid #ef4444; padding:6px 10px; border-radius:4px;">
        <div style="font-size:10px; color:#64748b;">Jalur Non-Sarana</div>
        <div style="font-size:12px; font-weight:bold; color:#ef4444;">Monitoring Aktif</div>
      </div>
    </div>
  `;
}

// ==========================================
// 2D. KONTROL ANOTASI LABEL (DEFAULT: OFF)
// ==========================================
function toggleAnnotationVisibility() {
  isAnnotationActive = !isAnnotationActive;
  const btn = document.getElementById('btnToggleAnnotation');
  if (btn) {
    if (isAnnotationActive) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  }
  updateGradeLabelsVisibility();
}

// ==========================================
// 3. WORK ORDER MODE, DRAW TOOL & HIT-ZONE LINKING
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

    activeWoTool = null;
    document.querySelectorAll('.wo-sub-btn').forEach(b => b.classList.remove('active-tool'));
    selectedLineForWo = null;
    cancelOrFinishDrawing();
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
    cancelOrFinishDrawing();
    map.dragging.enable();
    return;
  }

  activeWoTool = toolName;
  document.querySelectorAll('.wo-sub-btn').forEach(b => b.classList.remove('active-tool'));
  
  const btnTarget = Array.from(document.querySelectorAll('.wo-sub-btn')).find(b => b.innerText.toLowerCase() === toolName);
  if (btnTarget) btnTarget.classList.add('active-tool');

  if (toolName === 'draw') {
    map.dragging.disable();
    createFloatingFinishDrawBtn();
  } else {
    map.dragging.enable();
    cancelOrFinishDrawing();
  }
}

function createFloatingFinishDrawBtn() {
  const existingInDom = document.getElementById('btnFinishDraw');
  if (existingInDom) {
    finishDrawBtn = existingInDom;
    return;
  }

  if (finishDrawBtn) return;
  finishDrawBtn = document.createElement('button');
  finishDrawBtn.id = 'floatingFinishDrawBtn';
  finishDrawBtn.innerText = '✓ Selesai Garis';
  finishDrawBtn.style.cssText = `
    position: fixed;
    right: 70px;
    bottom: 120px;
    z-index: 10000;
    background: #22c55e;
    color: #000;
    font-weight: bold;
    font-size: 11px;
    padding: 7px 14px;
    border-radius: 20px;
    border: 2px solid #fff;
    box-shadow: 0 4px 15px rgba(34,197,94,0.6);
    cursor: pointer;
    display: none;
  `;
  finishDrawBtn.onclick = () => {
    finalizeDrawLine();
  };
  document.body.appendChild(finishDrawBtn);
}

function showFinishDrawBtn() {
  const domBtn = document.getElementById('btnFinishDraw');
  if (domBtn) domBtn.style.display = 'flex';
  if (finishDrawBtn) finishDrawBtn.style.display = 'block';
}

function hideFinishDrawBtn() {
  const domBtn = document.getElementById('btnFinishDraw');
  if (domBtn) domBtn.style.display = 'none';
  if (finishDrawBtn) finishDrawBtn.style.display = 'none';
}

function cancelOrFinishDrawing() {
  hideFinishDrawBtn();
  if (tempDrawPolyline) {
    workOrderDrawingsLayer.removeLayer(tempDrawPolyline);
    tempDrawPolyline = null;
  }
  currentDrawPoints = [];
  isDrawingActive = false;
}

function distToSegment(p, v, w) {
  const l2 = Math.pow(v.x - w.x, 2) + Math.pow(v.y - w.y, 2);
  if (l2 === 0) return Math.sqrt(Math.pow(p.x - v.x, 2) + Math.pow(p.y - v.y, 2));
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt(Math.pow(p.x - (v.x + t * (w.x - v.x)), 2) + Math.pow(p.y - (v.y + t * (w.y - v.y)), 2));
}

function findNearbyDrawLine(latlng, maxPixelDist = 25) {
  const clickPt = map.latLngToContainerPoint(latlng);
  for (const lineId in allDrawLines) {
    const line = allDrawLines[lineId];
    if (!line || !line.points || line.points.length < 2) continue;
    for (let i = 0; i < line.points.length - 1; i++) {
      const p1 = map.latLngToContainerPoint(line.points[i]);
      const p2 = map.latLngToContainerPoint(line.points[i + 1]);
      const dist = distToSegment(clickPt, p1, p2);
      if (dist <= maxPixelDist) {
        return line;
      }
    }
  }
  return null;
}

map.on('mousedown touchstart', (e) => {
  if (!isWorkOrderModeActive || activeWoTool !== 'draw') return;
  if (currentUserRole !== 'admin' && currentUserRole !== 'inspector') return;

  isDrawingActive = true;
  lastTouchDownTime = Date.now();

  if (currentDrawPoints.length >= 3) {
    const firstPt = map.latLngToContainerPoint(currentDrawPoints[0]);
    const currPt = map.latLngToContainerPoint(e.latlng);
    const distFromStart = Math.sqrt(Math.pow(firstPt.x - currPt.x, 2) + Math.pow(firstPt.y - currPt.y, 2));
    if (distFromStart <= 20) {
      currentDrawPoints.push(currentDrawPoints[0]);
      finalizeDrawLine();
      return;
    }
  }

  currentDrawPoints.push(e.latlng);

  if (!tempDrawPolyline) {
    tempDrawPolyline = L.polyline(currentDrawPoints, { color: '#ff2b54', weight: 4 }).addTo(workOrderDrawingsLayer);
  } else {
    tempDrawPolyline.setLatLngs(currentDrawPoints);
  }

  if (currentDrawPoints.length > 1) {
    showFinishDrawBtn();
  }
});

map.on('mousemove touchmove', (e) => {
  if (!isDrawingActive || activeWoTool !== 'draw') return;
  if (Date.now() - lastTouchDownTime > 200) {
    currentDrawPoints.push(e.latlng);
    if (tempDrawPolyline) {
      tempDrawPolyline.setLatLngs(currentDrawPoints);
    }
  }
});

map.on('mouseup touchend', (e) => {
  if (!isDrawingActive || activeWoTool !== 'draw') return;
  isDrawingActive = false;

  const touchDuration = Date.now() - lastTouchDownTime;
  if (currentDrawPoints.length > 5 && touchDuration > 350) {
    finalizeDrawLine();
  }
});

map.on('dblclick', () => {
  if (isWorkOrderModeActive && activeWoTool === 'draw' && currentDrawPoints.length > 1) {
    finalizeDrawLine();
  }
});

function finalizeDrawLine() {
  if (currentDrawPoints.length < 2) {
    cancelOrFinishDrawing();
    return;
  }

  const lineId = 'draw_' + Date.now();
  const lineItem = {
    id: lineId,
    road: activeRoad || 'Area Tambang',
    points: [...currentDrawPoints],
    reporter: currentNRP
  };
  allDrawLines[lineId] = lineItem;
  renderDrawLineOnMap(lineItem);

  syncDrawLineToCloud(lineItem);
  broadcastWoSync('CREATE_DRAW_LINE', sanitizeDrawLineForBroadcast(lineItem));
  catatLogKeServer("DRAW WO", `Inspector membuat sketsa garis di ${lineItem.road}`);

  cancelOrFinishDrawing();
}

function renderDrawLineOnMap(lineItem) {
  if (!lineItem || !lineItem.points) return;

  const linkedWo = Object.values(allWorkOrders).find(wo => wo.linkedLineId === lineItem.id);
  let strokeColor = '#ff2b54'; 
  let strokeWeight = 4;

  if (linkedWo) {
    const st = (linkedWo.status || 'OPEN').toUpperCase();
    if (st === 'CLOSED') {
      strokeColor = '#22c55e';
    } else if (st === 'PROGRESS') {
      strokeColor = '#eab308';
    } else {
      strokeColor = '#e11d48';
    }
    strokeWeight = 5.5;
  }

  if (lineItem.layer && workOrderDrawingsLayer.hasLayer(lineItem.layer)) {
    workOrderDrawingsLayer.removeLayer(lineItem.layer);
  }

  const groupLayer = L.featureGroup();

  const hitZone = L.polyline(lineItem.points, {
    color: 'transparent',
    weight: 24,
    opacity: 0,
    interactive: true
  });

  const visiblePoly = L.polyline(lineItem.points, { 
    color: strokeColor, 
    weight: strokeWeight,
    interactive: false
  });

  hitZone.on('click', function(e) {
    L.DomEvent.stopPropagation(e);

    if (isWorkOrderModeActive && activeWoTool === 'mark' && (currentUserRole === 'admin' || currentUserRole === 'inspector')) {
      selectedLineForWo = lineItem;
      visiblePoly.setStyle({ color: '#00f0ff', weight: 7 });
      const center = visiblePoly.getBounds().getCenter();
      openCreateWoModal("", `Garis Sketsa Terkunci`, center, {}, true, lineItem.id);
      return;
    }

    let popupContent = `
      <div style="font-size:11px; text-align:center; padding:4px; min-width:110px;">
        <b>Sketsa Garis WO</b><br>
        <span style="font-size:10px; color:#64748b;">Oleh: ${lineItem.reporter || '-'}</span>
        ${(currentUserRole === 'admin' || currentUserRole === 'inspector') ? `
          <br><button onclick="hapusGarisDraw('${lineItem.id}')" style="background:#e11d48; color:#fff; border:none; padding:4px 8px; border-radius:4px; font-weight:bold; cursor:pointer; margin-top:6px;">Hapus Garis</button>
        ` : ''}
      </div>
    `;
    visiblePoly.bindPopup(popupContent).openPopup(e.latlng);
  });

  groupLayer.addLayer(visiblePoly);
  groupLayer.addLayer(hitZone);

  lineItem.layer = groupLayer;
  workOrderDrawingsLayer.addLayer(groupLayer);
}

function hapusGarisDraw(lineId) {
  if (!confirm("Yakin ingin menghapus garis sketsa ini?")) return;
  const lineItem = allDrawLines[lineId];
  if (lineItem && lineItem.layer) {
    workOrderDrawingsLayer.removeLayer(lineItem.layer);
  }
  delete allDrawLines[lineId];

  setSyncStatus('updating');
  fetch(WEB_APP_URL, {
    method: 'POST',
    mode: 'no-cors',
    body: JSON.stringify({ action: "DELETE_DRAW_LINE", id: lineId })
  }).then(() => setSyncStatus('updated')).catch(() => setSyncStatus('updated'));

  broadcastWoSync('DELETE_DRAW_LINE', { id: lineId }, `${currentNRP} Menghapus sketsa garis.`);
  catatLogKeServer("DELETE DRAW", `Menghapus sketsa garis ID: ${lineId}`);
}

function syncDrawLineToCloud(lineItem) {
  setSyncStatus('updating');
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
  }).then(() => setSyncStatus('updated')).catch(() => setSyncStatus('updated'));
}

function handleMapClickForWo(latlng) {
  if (!isWorkOrderModeActive) return;
  if (currentUserRole !== 'admin' && currentUserRole !== 'inspector') return;
  if (activeWoTool !== 'mark') return;

  const nearbyLine = findNearbyDrawLine(latlng, 25);
  if (nearbyLine) {
    selectedLineForWo = nearbyLine;
    openCreateWoModal("", `Garis Sketsa Terkunci`, latlng, {}, true, nearbyLine.id);
    return;
  }

  const lat = latlng.lat.toFixed(6);
  const lng = latlng.lng.toFixed(6);
  openCreateWoModal("", `Lat/Lng: ${lat}, ${lng}`, latlng, {}, true);
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

  renderJobsUI(cfg.jobs, cfg.showJobsEdit, currentWoMode === 'view');
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

// Render Jobs UI: Tombol UPDATE hanya muncul bila Multi-Job (Foto 1 Revisi)
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
      // HANYA MUNCUL JIKA LEBIH DARI 1 JOB
      if (isViewMode && jobs.length > 1) {
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

function toDirectDriveUrl(url, size = 600) {
  if (!url) return '';
  if (url.startsWith('data:image')) return url;
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w${size}`;
  }
  return url;
}

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
    img.src = toDirectDriveUrl(u, 240);
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

  let chosenTimeWita = UtilitiesFormatNowWita();
  if (dateInput && dateInput.value) {
    if (dateInput.value > getNowDateTimeLocalWita()) {
      alert("Wkwk jangan milih waktu masa depan bre! Maksimal waktu saat ini.");
      dateInput.value = getNowDateTimeLocalWita();
      return;
    }
    chosenTimeWita = formatDateTimeLocalToWita(dateInput.value);
  }

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

  setSyncStatus('updating');

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

    const notifMsg = `${reporter} menambahkan WO di ${woItem.road}`;
    broadcastWoSync('CREATE_WO', sanitizeWoForBroadcast(woItem), notifMsg);
    catatLogKeServer("CREATE WO", `Pelapor: ${reporter}, Lokasi: ${woItem.road} (${woItem.sta})`);
    renderOutstandingList();
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
    if (woItem.linkedLineId && allDrawLines[woItem.linkedLineId]) {
      renderDrawLineOnMap(allDrawLines[woItem.linkedLineId]);
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
      photoUrls: woItem.photoUrls,
      status: woItem.status,
      linkedLineId: woItem.linkedLineId,
      images: imagesPayload
    });

    const notifMsg = `${reporter} Update WO di ${woItem.road}`;
    broadcastWoSync('EDIT_WO', sanitizeWoForBroadcast(woItem), notifMsg);
    catatLogKeServer("EDIT WO", `Diperbarui oleh: ${reporter}, Lokasi: ${woItem.road}, Status: ${statusBaru}`);
    renderOutstandingList();
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
      if (allWorkOrders[currentActiveWoId].linkedLineId && allDrawLines[allWorkOrders[currentActiveWoId].linkedLineId]) {
        renderDrawLineOnMap(allDrawLines[allWorkOrders[currentActiveWoId].linkedLineId]);
      }
    }

    const hasPhoto = imagesPayload.length > 0;
    const notifMsg = hasPhoto
      ? `${reporter} mengirim evidence ${roadName}. Status : ${statusBaru}`
      : `${reporter} update ${roadName}. Status : ${statusBaru}`;

    broadcastWoSync('UPDATE_WO_STATUS', {
      woId: currentActiveWoId,
      status: statusBaru,
      notes: notes,
      reporter: reporter
    }, notifMsg);

    catatLogKeServer("SUBMIT EVIDENCE", `Pelapor: ${reporter}, Lokasi: ${roadName}, Status: ${statusBaru}`);
    renderOutstandingList();
    alert(`Progress berhasil dikirim oleh ${reporter} dengan status: ${statusBaru}!`);
  }

  closeWoModal();
}

// ==========================================
// 4C. MODAL UPDATE PROGRESS KHUSUS PER-JOB
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

  const jobTargetName = `Job ${activeJobUpdateIndex + 1}`;

  setSyncStatus('updating');

  syncWorkOrderToCloud({
    action: "SUBMIT_EVIDENCE",
    woId: currentActiveWoId,
    jobIndex: activeJobUpdateIndex,
    jobTarget: `${jobTargetName}: ${wo.jobs[activeJobUpdateIndex].category}`,
    road: wo.road,
    status: statusBaru,
    notes: notes,
    reporter: reporter,
    images: imagesPayload
  });

  wo.jobs[activeJobUpdateIndex].status = statusBaru;
  const newParentStatus = calculateParentStatus(wo.jobs);
  wo.status = newParentStatus;

  createOrUpdateMarker(wo);
  if (wo.linkedLineId && allDrawLines[wo.linkedLineId]) {
    renderDrawLineOnMap(allDrawLines[wo.linkedLineId]);
  }

  updateStatusBadgeElement(document.getElementById('woStatusBadge'), newParentStatus);
  renderJobsUI(wo.jobs, false, true);

  const hasPhoto = imagesPayload.length > 0;
  const notifMsg = hasPhoto
    ? `${reporter} mengirim evidence ${jobTargetName} ${wo.road}. Status : ${statusBaru}`
    : `${reporter} update ${jobTargetName} ${wo.road}. Status : ${statusBaru}`;

  broadcastWoSync('UPDATE_JOB_STATUS', {
    woId: currentActiveWoId,
    jobIndex: activeJobUpdateIndex,
    status: statusBaru,
    parentStatus: newParentStatus,
    notes: notes,
    reporter: reporter
  }, notifMsg);

  catatLogKeServer("SUBMIT JOB EVIDENCE", `Pelapor: ${reporter}, Lokasi: ${wo.road}, ${jobTargetName}, Status: ${statusBaru}`);
  renderOutstandingList();
  alert(`Berhasil mengupdate progress ${jobTargetName} menjadi: ${statusBaru}!`);

  closeJobUpdateModal();
}

function syncWorkOrderToCloud(payload) {
  fetch(WEB_APP_URL, {
    method: 'POST',
    mode: 'no-cors',
    body: JSON.stringify(payload)
  }).then(() => setSyncStatus('updated')).catch(err => {
    console.error("Sync error:", err);
    setSyncStatus('updated');
  });
}

function createOrUpdateMarker(woItem) {
  if (!woItem || !woItem.latlng) return;

  if (woItem.markerLayer) {
    workOrderMarkersLayer.removeLayer(woItem.markerLayer);
  }

  const status = (woItem.status || "OPEN").toUpperCase();
  let pinColor = '#e11d48'; 
  if (status === 'PROGRESS') pinColor = '#eab308'; 
  if (status === 'CLOSED') pinColor = '#22c55e'; 

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

  setSyncStatus('updating');
  fetch(WEB_APP_URL, {
    method: 'POST',
    mode: 'no-cors',
    body: JSON.stringify({ action: "DELETE_WORK_ORDER", id: currentActiveWoId })
  }).then(() => setSyncStatus('updated')).catch(() => setSyncStatus('updated'));

  const notifMsg = `${currentNRP} Menghapus WO di ${woItem.road}`;
  broadcastWoSync('DELETE_WO', { id: currentActiveWoId }, notifMsg);
  catatLogKeServer("DELETE WO", `Dihapus oleh: ${currentNRP}, Lokasi: ${woItem.road}`);
  delete allWorkOrders[currentActiveWoId];

  renderOutstandingList();
  alert("Work Order berhasil dihapus!");
  closeWoModal();
}

// ==========================================
// 5. MODAL RIWAYAT PROGRESS TIMELINE
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
// 6. FILTER KALENDER & EXPORT REKAP WO
// ==========================================
function openCalendarFilterModal() {
  const modal = document.getElementById('calendarFilterModal');
  const dateInput = document.getElementById('mapCalendarDateInput');
  const todayYMD = getTodayYMDWita();
  if (dateInput) {
    dateInput.max = todayYMD;
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
  updateActiveWoDateButtonText();
  closeCalendarFilterModal();
  refreshWorkOrderMapDisplay();

  alert(`Menampilkan data WO untuk tanggal: ${calendarFilterDate}`);
}

function resetCalendarToToday() {
  calendarFilterDate = null;
  updateActiveWoDateButtonText();
  closeCalendarFilterModal();
  refreshWorkOrderMapDisplay();

  alert("Peta kembali ke tampilan hari ini (Live Real-Time)!");
}

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
// 6B. HELPER WAKTU WITA
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

async function fetchImageAsBase64(url) {
  if (!url) return null;
  if (url.startsWith('data:image')) return url;
  try {
    const res = await fetch(`${WEB_APP_URL}?action=GET_IMAGE_BASE64&url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.base64 || null;
  } catch (e) {
    console.warn("Gagal konversi foto via backend GAS:", e);
    return null;
  }
}

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

  const originalCursor = document.body.style.cursor;
  document.body.style.cursor = 'wait';

  try {
    const res = await fetch(`${WEB_APP_URL}?action=EXPORT_REKAP`);
    if (!res.ok) throw new Error("Gagal mengambil data dari Google Apps Script");
    const json = await res.json();
    const allData = json.data || [];

    const filtered = allData.filter(wo => {
      const d = parseTimestampToYMD(wo.createdTime);
      return d >= sDate && d <= eDate;
    });

    if (filtered.length === 0) {
      alert("Tidak ada data Work Order pada rentang tanggal tersebut.");
      document.body.style.cursor = originalCursor;
      return;
    }

    const doc = new jsPDF('l', 'mm', 'a4');
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxUsableY = pageHeight - 20;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(`LAPORAN REKAP WORK ORDER & PROGRESS LAPANGAN`, 14, 14);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Periode: ${sDate} s/d ${eDate} | Total: ${filtered.length} Tiket WO`, 14, 20);

    let yPos = 28;

    for (let idx = 0; idx < filtered.length; idx++) {
      const wo = filtered[idx];

      if (yPos > maxUsableY - 20) {
        doc.addPage();
        yPos = 20;
      }

      doc.setFont("helvetica", "bold");
      doc.text(`${idx + 1}. [${(wo.status || 'OPEN').toUpperCase()}] ${wo.road} (${wo.sta}) - Tgl: ${wo.createdTime || '-'} (Oleh: ${wo.reporter})`, 14, yPos);
      yPos += 5;

      doc.setFont("helvetica", "normal");
      const jobText = (wo.jobs && wo.jobs.length > 0)
        ? wo.jobs.map(j => `${j.category} [${j.status || 'OPEN'}]: ${j.notes}`).join(' | ')
        : (wo.notes || '-');
      doc.text(`   Instruksi Pekerjaan: ${jobText}`, 14, yPos);
      yPos += 6;

      const hist = wo.progressHistory || [];
      if (hist.length > 0) {
        for (let hIdx = 0; hIdx < hist.length; hIdx++) {
          const h = hist[hIdx];

          if (yPos > maxUsableY - 15) {
            doc.addPage();
            yPos = 20;
          }

          doc.setFont("helvetica", "italic");
          doc.text(`   - ${h.timestamp} [${h.status}] ${h.jobTarget ? '(' + h.jobTarget + ')' : ''} Oleh ${h.reporter}: ${h.notes}`, 18, yPos);
          yPos += 5;

          const photos = h.photoUrls || [];
          if (photos.length > 0) {
            const thumbWidth = 36;
            const thumbHeight = 24;
            const gap = 4;
            const startX = 22;

            if (yPos + thumbHeight > maxUsableY) {
              doc.addPage();
              yPos = 20;
            }

            let currentX = startX;
            for (let pIdx = 0; pIdx < photos.length; pIdx++) {
              const photoUrl = photos[pIdx];
              if (currentX + thumbWidth > 280) {
                currentX = startX;
                yPos += thumbHeight + 2;
                if (yPos + thumbHeight > maxUsableY) {
                  doc.addPage();
                  yPos = 20;
                }
              }

              const base64Img = await fetchImageAsBase64(photoUrl);
              if (base64Img) {
                try {
                  doc.addImage(base64Img, 'JPEG', currentX, yPos, thumbWidth, thumbHeight);
                  doc.setDrawColor(180, 180, 180);
                  doc.rect(currentX, yPos, thumbWidth, thumbHeight);
                } catch (imgErr) {
                  console.warn("Gagal tempel foto ke PDF:", imgErr);
                }
              }

              doc.setTextColor(2, 132, 199);
              doc.setFontSize(8);
              doc.textWithLink("[Link Drive]", currentX + 6, yPos + thumbHeight + 4, { url: photoUrl });
              doc.setTextColor(0, 0, 0);
              doc.setFontSize(10);

              currentX += thumbWidth + gap;
            }
            yPos += thumbHeight + 6;
          }
        }
      } else {
        doc.setFont("helvetica", "italic");
        doc.text(`   - Belum ada update progress.`, 18, yPos);
        yPos += 5;
      }

      doc.setDrawColor(220, 220, 220);
      doc.line(14, yPos, 283, yPos);
      yPos += 6;
    }

    doc.save(`Rekap_WO_${sDate}_sd_${eDate}.pdf`);
  } catch (err) {
    alert("Gagal mengekspor PDF: " + err.message);
  } finally {
    document.body.style.cursor = originalCursor;
  }
}

// Background Cloud Polling dengan Integrasi Indikator Sync
async function loadCloudWorkOrders() {
  if (!navigator.onLine) {
    setSyncStatus('offline');
    return;
  }

  setSyncStatus('updating');

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
      renderOutstandingList();
      syncNotificationLogsFromCloud();
      setSyncStatus('updated');
    } else {
      setSyncStatus('updated');
    }
  } catch (e) {
    console.warn("Gagal sinkronisasi data cloud:", e);
    if (!navigator.onLine) setSyncStatus('offline');
    else setSyncStatus('updated');
  }
}

// ==========================================
// 7. HELPER WEBGIS & VIEWPORT OPTIMASI TINGGI
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
  initSupabaseRealtime();

  setInterval(loadCloudWorkOrders, 12000);

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
        switchMainTab('map');
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

// Optimasi Panning & Zooming Leaflet (Bebas Lag & CPU Friendly - Foto 3)
let lastZoomLevel = map.getZoom();
let mapUpdateTimer = null;

map.on('zoomend', () => {
  const currentZoom = map.getZoom();
  if (currentZoom !== lastZoomLevel) {
    lastZoomLevel = currentZoom;
    if (roadWidthLayer && map.hasLayer(roadWidthLayer)) roadWidthLayer.setStyle(getWidthSliceStyle);
    if (currentParam === 'crossfall' && currentMainTab === 'parameter') renderCrossfallSplitLayer();
    updateGradeLabelsVisibility();
  }
});

map.on('moveend', () => {
  clearTimeout(mapUpdateTimer);
  mapUpdateTimer = setTimeout(() => {
    if (currentParam === 'crossfall' && currentMainTab === 'parameter') {
      renderCrossfallSplitLayer();
    }
    updateGradeLabelsVisibility();
  }, 80);
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

function getRoadMapStyle(feature) {
  const props = feature.properties || {};
  const payloadStr = (props.Kelas_Jalan || props["Kelas Jalan"] || props.Payload || props.Tipe || props.Nama_Jalan || "").toString().toLowerCase();
  
  let strokeColor = '#38bdf8';
  if (payloadStr.includes('sarana')) {
    strokeColor = '#ec4899';
  } else if (payloadStr.includes('200')) {
    strokeColor = '#f97316';
  } else if (payloadStr.includes('150')) {
    strokeColor = '#eab308';
  }

  return {
    color: strokeColor,
    weight: 5.5,
    opacity: 0.95
  };
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
  let baseWeight = currentZoom >= 18 ? 6 : (currentZoom >= 16 ? 4.5 : (currentZoom >= 14 ? 3.5 : 2.5));

  if (isMeterSelected(meterVal, roadVal)) {
    return { color: "#00f0ff", weight: baseWeight + 3.5, opacity: 1 };
  }

  const lebarAktual = parseFloat(props.Lebar_m !== undefined ? props.Lebar_m : (props.Shape_Leng || 0));
  const lebarStandar = props.Standar_m !== undefined ? parseFloat(props.Standar_m) : getActiveRoadStandardWidth(roadVal);
  let color = "#22c55e"; 
  if (!isNaN(lebarAktual) && lebarAktual > 0 && lebarAktual < lebarStandar) {
    color = "#e11d48"; 
  }
  return { color: color, weight: color === "#e11d48" ? baseWeight + 1.5 : baseWeight, opacity: 0.95 };
}

// ==========================================
// 7C. CROSSFALL SPLIT LAYER (CANVAS & VIEW ALL)
// ==========================================
function renderCrossfallSplitLayer() {
  crossfallVisualLayer.clearLayers();
  if (currentMainTab !== 'parameter' || currentParam !== 'crossfall') return;

  const currentZoom = map ? map.getZoom() : 15;
  if (currentZoom < 14) return;

  const baseWeight = currentZoom >= 18 ? 5.5 : (currentZoom >= 16 ? 4 : 3);
  const bounds = map.getBounds().pad(0.15);

  rawWidthFeatures.forEach(feature => {
    const coords = feature.geometry ? feature.geometry.coordinates : null;
    if (!coords || coords.length < 2) return;

    const pt1 = L.latLng(coords[0][1], coords[0][0]);
    const pt2 = L.latLng(coords[1][1], coords[1][0]);

    if (!bounds.contains(pt1) && !bounds.contains(pt2)) return;

    const props = feature.properties || {};
    const rawSta = props.Station_m !== undefined ? props.Station_m : (props.Station || props.STA || 0);
    const meterVal = parseMeterSTA(rawSta);
    const roadVal = (props.Nama_Jalan || props["Nama Jalan"] || activeRoad).trim();
    const mid = L.latLng((pt1.lat + pt2.lat) / 2, (pt1.lng + pt2.lng) / 2);

    const row = monitoringData.find(d => (d["Nama Jalan"] || "").trim().toLowerCase() === roadVal.toLowerCase() && parseMeterSTA(d["STA"]) === meterVal);
    const cfL = row ? Math.abs(parseFloat(row["Crossfall Kiri (%)"]) || 0) : 0;
    const cfR = row ? Math.abs(parseFloat(row["Crossfall Kanan (%)"]) || 0) : 0;

    const isSelected = isMeterSelected(meterVal, roadVal);
    let colorLeft = (cfL >= 2.0 && cfL <= 4.0) ? "#22c55e" : "#e11d48";
    let colorRight = (cfR >= 2.0 && cfR <= 4.0) ? "#22c55e" : "#e11d48";

    if (isSelected) {
      colorLeft = "#00f0ff";
      colorRight = "#00f0ff";
    }

    const lineLeft = L.polyline([mid, pt1], {
      color: colorLeft,
      weight: isSelected ? baseWeight + 3 : baseWeight,
      opacity: 0.95,
      renderer: canvasRenderer
    });
    const lineRight = L.polyline([mid, pt2], {
      color: colorRight,
      weight: isSelected ? baseWeight + 3 : baseWeight,
      opacity: 0.95,
      renderer: canvasRenderer
    });

    const clickHandler = (e) => {
      L.DomEvent.stopPropagation(e);
      handleFeatureClick(feature);
    };
    lineLeft.on('click', clickHandler);
    lineRight.on('click', clickHandler);

    crossfallVisualLayer.addLayer(lineLeft);
    crossfallVisualLayer.addLayer(lineRight);

    if (currentZoom >= 16) {
      const keyTarget = `${roadVal}_${formatKeSTA(meterVal)}`;
      const pts = crossSectionData.filter(d => (d["Key"] || "").trim() === keyTarget);
      const ptLeftData = pts.find(p => p["Point"] && p["Point"].includes("Kiri"));
      const ptAsData = pts.find(p => p["Point"] && p["Point"].includes("As"));
      const ptRightData = pts.find(p => p["Point"] && p["Point"].includes("Kanan"));

      const elevAs = ptAsData ? parseFloat(ptAsData["Elevasi_RL"]) : (row ? parseFloat(row["Elevasi As (m)"]) : 100);
      const elevLeft = ptLeftData ? parseFloat(ptLeftData["Elevasi_RL"]) : (elevAs - 0.2);
      const elevRight = ptRightData ? parseFloat(ptRightData["Elevasi_RL"]) : (elevAs - 0.2);

      const fromLeft = (elevAs >= elevLeft) ? mid : pt1;
      const toLeft = (elevAs >= elevLeft) ? pt1 : mid;
      const arrowLeftPos = L.latLng((mid.lat + pt1.lat) / 2, (mid.lng + pt1.lng) / 2);

      const fromRight = (elevAs >= elevRight) ? mid : pt2;
      const toRight = (elevAs >= elevRight) ? pt2 : mid;
      const arrowRightPos = L.latLng((mid.lat + pt2.lat) / 2, (mid.lng + pt2.lng) / 2);

      crossfallVisualLayer.addLayer(createCrossfallArrowMarker(arrowLeftPos, fromLeft, toLeft, colorLeft));
      crossfallVisualLayer.addLayer(createCrossfallArrowMarker(arrowRightPos, fromRight, toRight, colorRight));
    }
  });
}

function createCrossfallArrowMarker(pos, from, to, color) {
  const dLng = to.lng - from.lng;
  const y = Math.sin(dLng * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180);
  const x = Math.cos(from.lat * Math.PI / 180) * Math.sin(to.lat * Math.PI / 180) -
            Math.sin(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) * Math.cos(dLng * Math.PI / 180);
  const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

  return L.marker(pos, {
    icon: L.divIcon({
      className: 'crossfall-flow-arrow',
      html: `
        <div style="transform: rotate(${bearing}deg); width:16px; height:16px; display:flex; align-items:center; justify-content:center; pointer-events:none;">
          <svg width="14" height="14" viewBox="0 0 24 24">
            <path d="M12 2L4 16h6v6h4v-6h6z" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>
          </svg>
        </div>
      `,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    }),
    interactive: false
  });
}

function updateGradeLabelsVisibility() {
  if (!isAnnotationActive || map.getZoom() < 16) {
    gradeLabelsLayer.clearLayers();
    if (map.hasLayer(gradeLabelsLayer)) map.removeLayer(gradeLabelsLayer);
    return;
  }

  if (!map.hasLayer(gradeLabelsLayer)) map.addLayer(gradeLabelsLayer);
  const bounds = map.getBounds().pad(0.1);
  gradeLabelsLayer.clearLayers();

  if (currentMainTab === 'map') {
    for (let i = 0; i < allRoadNameMarkers.length; i++) {
      if (bounds.contains(allRoadNameMarkers[i].getLatLng())) {
        gradeLabelsLayer.addLayer(allRoadNameMarkers[i]);
      }
    }
  } else {
    for (let i = 0; i < allStaMarkers.length; i++) {
      if (bounds.contains(allStaMarkers[i].getLatLng())) {
        gradeLabelsLayer.addLayer(allStaMarkers[i]);
      }
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
  if (currentMainTab === 'map') {
    if (roadGradeLayer && map.hasLayer(roadGradeLayer)) map.removeLayer(roadGradeLayer);
    if (roadWidthLayer && map.hasLayer(roadWidthLayer)) map.removeLayer(roadWidthLayer);
    if (crossfallVisualLayer && map.hasLayer(crossfallVisualLayer)) map.removeLayer(crossfallVisualLayer);

    if (roadMapLayer && !map.hasLayer(roadMapLayer)) roadMapLayer.addTo(map);
    if (roadNonSaranaLayer && !map.hasLayer(roadNonSaranaLayer)) roadNonSaranaLayer.addTo(map);
    
    if (roadMapLayer) {
      roadMapLayer.bringToFront();
    }
    if (roadNonSaranaLayer) roadNonSaranaLayer.bringToFront();

  } else {
    if (roadMapLayer && map.hasLayer(roadMapLayer)) map.removeLayer(roadMapLayer);
    if (roadNonSaranaLayer && map.hasLayer(roadNonSaranaLayer)) map.removeLayer(roadNonSaranaLayer);

    if (currentParam === 'grade') {
      if (roadWidthLayer && map.hasLayer(roadWidthLayer)) map.removeLayer(roadWidthLayer);
      if (crossfallVisualLayer && map.hasLayer(crossfallVisualLayer)) map.removeLayer(crossfallVisualLayer);
      if (roadGradeLayer && !map.hasLayer(roadGradeLayer)) roadGradeLayer.addTo(map);
      if (roadGradeLayer) {
        roadGradeLayer.setStyle(getGradePolygonBlockStyle);
        roadGradeLayer.bringToFront();
      }

    } else if (currentParam === 'lebar') {
      if (roadGradeLayer && map.hasLayer(roadGradeLayer)) map.removeLayer(roadGradeLayer);
      if (crossfallVisualLayer && map.hasLayer(crossfallVisualLayer)) map.removeLayer(crossfallVisualLayer);
      if (roadWidthLayer && !map.hasLayer(roadWidthLayer)) roadWidthLayer.addTo(map);
      if (roadWidthLayer) {
        roadWidthLayer.setStyle(getWidthSliceStyle);
        roadWidthLayer.bringToFront();
      }

    } else if (currentParam === 'crossfall') {
      if (roadGradeLayer && map.hasLayer(roadGradeLayer)) map.removeLayer(roadGradeLayer);
      if (roadWidthLayer && map.hasLayer(roadWidthLayer)) map.removeLayer(roadWidthLayer);
      if (crossfallVisualLayer && !map.hasLayer(crossfallVisualLayer)) crossfallVisualLayer.addTo(map);
      renderCrossfallSplitLayer();
    }
  }

  if (map.hasLayer(workOrderDrawingsLayer)) workOrderDrawingsLayer.bringToFront();
  if (map.hasLayer(workOrderMarkersLayer)) workOrderMarkersLayer.bringToFront();

  updateGradeLabelsVisibility();
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

  if (currentMainTab === 'parameter') {
    if (currentParam === 'lebar' || currentParam === 'grade') {
      if (selectedStartMeter === null || (selectedStartMeter !== null && selectedEndMeter !== null)) {
        selectedStartMeter = meterVal;
        selectedEndMeter = null;
      } else {
        selectedEndMeter = meterVal;
      }
      refreshVisibleLayers();
      if (currentParam === 'lebar') renderLebarSummary();
      else if (currentParam === 'grade') renderGradeSummary();
    } else if (currentParam === 'crossfall') {
      selectedStartMeter = meterVal;
      selectedEndMeter = null;
      refreshVisibleLayers();
      
      const sta = formatKeSTA(meterVal);
      const staSelect = document.getElementById('select-sta-cs');
      if (staSelect) staSelect.value = sta;
      drawCrossSectionChart(sta);
    }
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
      allStaMarkers = [];

      roadGradeLayer = L.geoJSON(geojsonGrade, {
        style: getGradePolygonBlockStyle,
        renderer: canvasRenderer,
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
            interactive: false
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
    const resMap = await fetch('data/Road_Map.geojson');
    if (resMap.ok) {
      const geojsonMap = await resMap.json();
      allRoadNameMarkers = [];

      roadMapLayer = L.geoJSON(geojsonMap, {
        style: getRoadMapStyle,
        renderer: canvasRenderer,
        onEachFeature: function(feature, layer) {
          const props = feature.properties || {};
          const road = props.Nama_Jalan || props["Nama Jalan"] || "Ruas Tambang";
          const payload = props.Kelas_Jalan || props["Kelas Jalan"] || props.Payload || "Hauler Road";

          layer.bindTooltip(`<b>${road}</b><br>Kelas: <b>${payload}</b>`, { sticky: true });

          const center = layer.getBounds().getCenter();
          const roadMarker = L.marker(center, {
            icon: L.divIcon({
              className: 'road-name-label',
              html: `${road}`,
              iconSize: [80, 16], iconAnchor: [40, 8]
            }),
            interactive: false
          });
          allRoadNameMarkers.push(roadMarker);

          layer.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            handleFeatureClick(feature);
          });
        }
      });
    }
  } catch (e) {
    console.warn("Layer Road_Map.geojson standby.");
  }

  try {
    const resNonSarana = await fetch('data/Road_Non_Sarana.geojson');
    if (resNonSarana.ok) {
      const geojsonNonSarana = await resNonSarana.json();
      roadNonSaranaLayer = L.geoJSON(geojsonNonSarana, {
        renderer: canvasRenderer,
        style: {
          color: "#ef4444",
          weight: 7.5,
          opacity: 0.9,
          lineCap: "round"
        },
        onEachFeature: function(feature, layer) {
          layer.bindTooltip("<b>JALUR KHUSUS NON-SARANA</b>", { sticky: true });
        }
      });
    }
  } catch (e) {
    console.warn("Layer Road_Non_Sarana.geojson standby.");
  }

  try {
    const resWidth = await fetch('data/Road_Layers.geojson');
    if (resWidth.ok) {
      const geojsonWidth = await resWidth.json();
      rawWidthFeatures = geojsonWidth.features || [];

      if (roadWidthLayer) map.removeLayer(roadWidthLayer);
      roadWidthLayer = L.geoJSON(geojsonWidth, {
        style: getWidthSliceStyle,
        renderer: canvasRenderer,
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
    }
    refreshVisibleLayers();
  } catch (error) {
    console.error("Excel load error:", error);
  }
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

// Render Summary dengan Dropdown Rata Kiri Paten (Foto 2)
function renderGradeSummary() {
  const panelBody = document.getElementById('panel-body');
  const panelTitle = document.getElementById('panel-title');
  if (!panelBody || !panelTitle) return;

  const roadSelectHtml = `
    <select onchange="changeRoad(this.value)" style="font-size:12px; font-weight:bold; padding:4px 8px; border-radius:6px; background:#f1f5f9; border:1px solid #cbd5e1; color:#0f172a; outline:none; cursor:pointer;">
      ${roadNames.map(r => `<option value="${r}" ${r.toLowerCase() === activeRoad.toLowerCase() ? 'selected' : ''}>${r}</option>`).join('')}
    </select>
  `;
  const roadData = getFilteredRoadData();

  panelTitle.innerHTML = roadSelectHtml;
  panelBody.innerHTML = `
    <div style="font-size:11px; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
      <span style="color:#555;">Kuning: <b>Warning (&gt;8%)</b> | Merah: <b>Overgrade (&gt;9%)</b></span>
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

  const roadSelectHtml = `
    <select onchange="changeRoad(this.value)" style="font-size:12px; font-weight:bold; padding:4px 8px; border-radius:6px; background:#f1f5f9; border:1px solid #cbd5e1; color:#0f172a; outline:none; cursor:pointer;">
      ${roadNames.map(r => `<option value="${r}" ${r.toLowerCase() === activeRoad.toLowerCase() ? 'selected' : ''}>${r}</option>`).join('')}
    </select>
  `;
  panelTitle.innerHTML = roadSelectHtml;

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
      💡 <i>Klik garis di peta untuk detail STA, atau klik 2 titik untuk ringkasan segmen.</i>
    </div>
    ${nonStd.length ? listHtml : `<p style="font-size:12px; color:green; text-align:center; padding-top:20px;">Semua segmen di ${activeRoad} memenuhi standar lebar.</p>`}
  `;
}

function renderTabContent() {
  if (currentMainTab === 'map') {
    renderMapOverviewSummary();
    return;
  }

  const panelBody = document.getElementById('panel-body');
  const panelTitle = document.getElementById('panel-title');
  if (!panelBody || !panelTitle) return;

  const roadData = monitoringData.filter(d => (d["Nama Jalan"] || "").trim().toLowerCase() === activeRoad.toLowerCase());

  const roadSelectHtml = `
    <select onchange="changeRoad(this.value)" style="font-size:12px; font-weight:bold; padding:4px 8px; border-radius:6px; background:#f1f5f9; border:1px solid #cbd5e1; color:#0f172a; outline:none; cursor:pointer;">
      ${roadNames.map(r => `<option value="${r}" ${r.toLowerCase() === activeRoad.toLowerCase() ? 'selected' : ''}>${r}</option>`).join('')}
    </select>
  `;

  if (currentParam === 'grade') {
    renderGradeSummary();
  } else if (currentParam === 'lebar') {
    renderLebarSummary();
  } else if (currentParam === 'crossfall') {
    panelTitle.innerHTML = roadSelectHtml;
    panelBody.innerHTML = `
      <div style="font-size:11px; margin-bottom:6px; display:flex; align-items:center; gap:8px;">
        <span>Pilih STA:</span>
        <select id="select-sta-cs" onchange="drawCrossSectionChart(this.value); catatLogKeServer('VIEW_STA', 'Melihat Cross Section ' + activeRoad + ' STA ' + this.value);" style="font-size:11px; padding:2px 6px;">
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
          anchor: 'center',
          align: (context) => {
            const idx = context.dataIndex;
            if (idx === 0) return 'center';
            const meta = context.chart.getDatasetMeta(context.datasetIndex);
            if (!meta.data[idx - 1] || !meta.data[idx]) return 'center';
            const curr = meta.data[idx];
            const prev = meta.data[idx - 1];
            const rad = Math.atan2(prev.y - curr.y, prev.x - curr.x);
            return rad * (180 / Math.PI);
          },
          offset: (context) => {
            const idx = context.dataIndex;
            if (idx === 0) return 0;
            const meta = context.chart.getDatasetMeta(context.datasetIndex);
            if (!meta.data[idx - 1] || !meta.data[idx]) return 0;
            const curr = meta.data[idx];
            const prev = meta.data[idx - 1];
            const dist = Math.sqrt(Math.pow(curr.x - prev.x, 2) + Math.pow(curr.y - prev.y, 2));
            return dist / 2;
          },
          font: { size: 8, weight: 'bold' },
          backgroundColor: 'rgba(255, 255, 255, 0.88)',
          borderRadius: 3,
          padding: { top: 1, bottom: 1, left: 3, right: 3 },
          color: function(context) {
            const idx = context.dataIndex;
            if (idx === 0) return 'transparent';
            const d = dataSubset[idx];
            const status = (d["Status Grade"] || "").toUpperCase();
            if (status.includes("OVERGRADE") || status.includes("NON COMPLIANT")) return "#c00000";
            if (status.includes("WARNING")) return "#b25900";
            return "#1e293b";
          },
          formatter: function(value, context) {
            const idx = context.dataIndex;
            if (idx === 0) return "";
            const d = dataSubset[idx];
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

  const ptLeft = pts.find(p => p["Point"] && p["Point"].includes("Kiri")) || pts[0];
  const ptAs = pts.find(p => p["Point"] && p["Point"].includes("As")) || pts[1];
  const ptRight = pts.find(p => p["Point"] && p["Point"].includes("Kanan")) || pts[2];

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
    gpsBtn.style.background = '#0f172a';
    gpsBtn.style.color = '#38bdf8';
    return;
  }
  if (!navigator.geolocation) {
    alert("Browser HP tidak mendukung fitur GPS.");
    return;
  }

  isTracking = true;
  gpsBtn.style.background = '#00f0ff';
  gpsBtn.style.color = '#000000';
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

// ==========================================================
// 7B. BOTTOM PANEL: AUTO-HIDE, TAP & TOUCH DRAG DENGAN PANAH
// ==========================================================
function setBottomPanelHeight(heightPx, animate = true) {
  const bottomPanel = document.getElementById('bottom-panel');
  const floatingGroup = document.getElementById('floatingActionGroup');
  if (!bottomPanel) return;

  if (!animate) {
    bottomPanel.classList.add('no-transition');
    if (floatingGroup) floatingGroup.classList.add('no-transition');
  } else {
    bottomPanel.classList.remove('no-transition');
    if (floatingGroup) floatingGroup.classList.remove('no-transition');
  }

  bottomPanel.style.height = `${heightPx}px`;

  if (floatingGroup) {
    floatingGroup.style.bottom = `${heightPx + 14}px`;
  }

  isPanelOpen = heightPx > 45;
  if (isPanelOpen) {
    lastPanelHeight = heightPx;
    bottomPanel.classList.add('panel-open');
  } else {
    bottomPanel.classList.remove('panel-open');
  }

  if (chartInstance) {
    setTimeout(() => chartInstance.resize(), 200);
  }
}

function handlePanelHeaderClick(e) {
  if (['SELECT', 'OPTION', 'BUTTON'].includes(e.target.tagName)) return;
  if (isPanelOpen) {
    setBottomPanelHeight(38, true);
  } else {
    const targetH = Math.min(lastPanelHeight || 220, window.innerHeight * 0.5);
    setBottomPanelHeight(targetH, true);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const bottomPanel = document.getElementById('bottom-panel');
  const panelHeader = document.querySelector('.panel-header');
  if (!bottomPanel || !panelHeader) return;

  setBottomPanelHeight(38, false);

  let isDragging = false;
  let startY = 0;
  let startHeight = 0;

  function onDragStart(clientY) {
    isDragging = true;
    startY = clientY;
    startHeight = bottomPanel.getBoundingClientRect().height;
    document.body.style.userSelect = 'none';
    bottomPanel.classList.add('no-transition');
    const floatingGroup = document.getElementById('floatingActionGroup');
    if (floatingGroup) floatingGroup.classList.add('no-transition');
  }

  function onDragMove(clientY) {
    if (!isDragging) return;
    const deltaY = startY - clientY;
    let newHeight = startHeight + deltaY;

    const minHeight = 38;
    const maxHeight = window.innerHeight * 0.5;

    if (newHeight < minHeight) newHeight = minHeight;
    if (newHeight > maxHeight) newHeight = maxHeight;

    setBottomPanelHeight(newHeight, false);
  }

  function onDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    document.body.style.userSelect = '';

    const finalH = bottomPanel.getBoundingClientRect().height;
    if (finalH > 55) {
      setBottomPanelHeight(finalH, true);
    } else {
      setBottomPanelHeight(38, true);
    }
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

// Expose fungsi ke window
window.toggleOutstandingDrawer = toggleOutstandingDrawer;
window.flyToOutstandingWo = flyToOutstandingWo;
window.renderOutstandingList = renderOutstandingList;
window.setSyncStatus = setSyncStatus;
window.toggleWorkOrderFloating = toggleWorkOrderFloating;
window.toggleInspectorSubmenu = toggleInspectorSubmenu;
window.setWoTool = setWoTool;
window.finalizeDrawLine = finalizeDrawLine;
window.hapusGarisDraw = hapusGarisDraw;
window.openCreateWoModal = openCreateWoModal;
window.openEditWoModal = openEditWoModal;
window.openViewWoModal = openViewWoModal;
window.closeWoModal = closeWoModal;
window.submitWorkOrder = submitWorkOrder;
window.deleteCurrentWorkOrder = deleteCurrentWorkOrder;
window.openJobUpdateModal = openJobUpdateModal;
window.closeJobUpdateModal = closeJobUpdateModal;
window.submitJobUpdate = submitJobUpdate;
window.addNewJobItem = addNewJobItem;
window.removeJobItem = removeJobItem;
window.openProgressTimelineModal = openProgressTimelineModal;
window.closeProgressTimelineModal = closeProgressTimelineModal;
window.filterTimelineByJob = filterTimelineByJob;
window.openImageLightbox = openImageLightbox;
window.closeImageLightbox = closeImageLightbox;
window.openCalendarFilterModal = openCalendarFilterModal;
window.closeCalendarFilterModal = closeCalendarFilterModal;
window.applyCalendarDateFilter = applyCalendarDateFilter;
window.resetCalendarToToday = resetCalendarToToday;
window.executeExportRekapRange = executeExportRekapRange;
window.toggleBasemapSatelit = toggleBasemapSatelit;
window.toggleAnnotationVisibility = toggleAnnotationVisibility;
window.toggleNotificationDrawer = toggleNotificationDrawer;
window.toggleLegendDrawer = toggleLegendDrawer;
window.switchMainTab = switchMainTab;
window.toggleParameterDropdown = toggleParameterDropdown;
window.selectParameter = selectParameter;
window.handleDataUpdateClick = handleDataUpdateClick;
window.closeAdminDataUpdateModal = closeAdminDataUpdateModal;
window.saveAdminDataUpdateDate = saveAdminDataUpdateDate;
window.changeRoad = changeRoad;
window.changeYInterval = changeYInterval;
window.resetSegmentSelection = resetSegmentSelection;
window.openPdfModal = openPdfModal;
window.closePdfModal = closePdfModal;
window.executeExportPDF = executeExportPDF;
window.locateUser = locateUser;
window.handlePanelHeaderClick = handlePanelHeaderClick;
window.removeMainQueueFile = removeMainQueueFile;
window.removeJobQueueFile = removeJobQueueFile;

// ==========================================
// 8. DAFTARKAN PWA SERVICE WORKER
// ==========================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      console.log('PWA Service Worker Aktif:', reg.scope);
    }).catch((err) => {
      console.warn('PWA Service Worker Gagal:', err);
    });
  });
}
