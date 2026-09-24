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

const WEB_APP_URL = "https://script.google.com/macros/s/AKfycby59dwiJ6H78OiXH_NIIvLj6mS6qwGH0zKa-7Pf70XYAoiQEXoeTK37Hav6zLkVIxUH/exec";

const SESSION_STORAGE_KEY = "overwatch_user_session";
const NOTIF_LOGS_KEY = "overwatch_notification_logs";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

let currentNRP = "SUPABASE_USER";
let currentUserRole = "viewer"; 
// --- STATE MODE APLIKASI (PORTAL ROAD vs BLASTMAP) ---
let currentAppMode = 'road';
let blastmapLayerGroup = L.layerGroup();
let currentLoadedBlastDate = null;

let currentMainTab = 'map';
let currentParam = 'grade';
let currentTab = 'grade';
let isAnnotationActive = false;

let calendarFilterDate = null;
let dataUpdateDate = localStorage.getItem('overwatch_data_update_date') || "19-09-2026";

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
let isRadarActive = false;
let radarMarkersLayer = L.layerGroup();
let allStaMarkers = [];
let allRoadNameMarkers = [];

let clusterFeatures = [];
let clusterGeoJsonLayer = null;

let selectedStartMeter = null;
let selectedEndMeter = null;
let selectedRoadTarget = "";
let isGradeRangeActive = false;

let isWorkOrderModeActive = false;
let activeWoTool = null;
let activeWoFeatureData = null;
let currentWoMode = 'create';
let currentActiveWoId = null;
let allWorkOrders = {}; 
let allDrawLines = {};

let workOrderMarkersLayer = L.layerGroup(); 
let workOrderDrawingsLayer = L.layerGroup(); 

let isDrawingActive = false;
let currentDrawPoints = [];
let tempDrawPolyline = null;
let selectedLineForWo = null; 
let lastTouchDownTime = 0;
let finishDrawBtn = null;
const drawSvgRenderer = L.svg();

let mainUploadFilesQueue = [];
let jobUpdateFilesQueue = [];
let activeJobUpdateIndex = null;
let currentTimelineHistory = [];
let notificationLogs = [];

let pendingStatusTarget = null; // 'WO_EVIDENCE' atau 'JOB_UPDATE'

let userMarker = null;
let userAccuracyCircle = null;
let currentUserLatLng = null;
let watchId = null;

let isPanelOpen = false;
let lastPanelHeight = 220;
let toastTimeout = null;
let syncStatusTimeout = null;
let realtimeChannel = null;

Chart.register(ChartDataLabels);

const canvasRenderer = L.canvas({ padding: 0.35 });

const map = L.map('map', { 
  zoomControl: false,
  preferCanvas: true,
  renderer: canvasRenderer
}).setView([-2.169338, 115.572115], 15);
blastmapLayerGroup.addTo(map);

const esriSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  zIndex: 1,
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
      maxNativeZoom: 19,
      zIndex: 10,
      updateWhenZooming: false,
      updateWhenIdle: true,
      keepBuffer: 8,
      attribution: 'Drone Orthophoto'
    }).addTo(map);

    p.getHeader().then(header => {
      if (header) {
        if (header.minZoom) orthoLayer.options.minZoom = header.minZoom;
        if (header.maxZoom) orthoLayer.options.maxNativeZoom = Math.min(header.maxZoom, 19);

        if (header.minLon && header.minLat) {
          map.fitBounds([
            [header.minLat, header.minLon],
            [header.maxLat, header.maxLon]
          ]);
        }
      }
    }).catch(e => console.warn("Header PMTiles load warn:", e));

  } catch (err) {
    console.error("Gagal mounting layer PMTiles:", err);
  }
}
// ==========================================
// 1B. LOGIKA SWITCHING DUA PORTAL (ROAD vs BLASTMAP)
// ==========================================
function openModulePortal() {
  const portal = document.getElementById('modulePortalOverlay');
  if (portal) portal.style.display = 'flex';
}

function closeModulePortal() {
  const portal = document.getElementById('modulePortalOverlay');
  if (portal) portal.style.display = 'none';
}

function selectAppMode(mode) {
  currentAppMode = mode;
  closeModulePortal();

  const iconElem = document.getElementById('labelCurrentModuleIcon');
  const nameElem = document.getElementById('labelCurrentModuleName');
  const centerTabs = document.getElementById('centerTabsContainer');
  const rightSidebar = document.getElementById('rightSidebarContainer');
  const bottomPanel = document.getElementById('bottom-panel');
  const floatingGroup = document.getElementById('floatingActionGroup');
  const dataUpdateBtn = document.getElementById('btnDataUpdateStatus');

  if (mode === 'road') {
    if (iconElem) iconElem.innerText = '🛣️';
    if (nameElem) nameElem.innerText = 'ROAD';

    if (centerTabs) centerTabs.style.display = 'flex';
    if (rightSidebar) rightSidebar.style.display = 'flex';
    if (bottomPanel) bottomPanel.style.display = 'flex';
    if (dataUpdateBtn) dataUpdateBtn.style.display = 'flex';

    if (floatingGroup) {
      floatingGroup.style.display = 'flex';
      floatingGroup.style.bottom = `${(bottomPanel ? bottomPanel.getBoundingClientRect().height : 38) + 14}px`;
    }

    blastmapLayerGroup.clearLayers();
    if (map.hasLayer(blastmapLayerGroup)) map.removeLayer(blastmapLayerGroup);

    refreshVisibleLayers();
    updateLegendUI();
    showToastNotification("🛣️ Modul Haul Road Aktif");

  } else if (mode === 'blastmap') {
    if (iconElem) iconElem.innerText = '💣';
    if (nameElem) nameElem.innerText = 'BLASTMAP';

    if (centerTabs) centerTabs.style.display = 'none';
    if (rightSidebar) rightSidebar.style.display = 'none';
    if (bottomPanel) bottomPanel.style.display = 'none';
    if (dataUpdateBtn) dataUpdateBtn.style.display = 'none';

    if (floatingGroup) {
      floatingGroup.style.bottom = '16px';
    }

    if (isWorkOrderModeActive) {
      toggleWorkOrderFloating();
    }

    // Bersihkan seluruh layer vektor jalan dari peta
    if (roadGradeLayer && map.hasLayer(roadGradeLayer)) map.removeLayer(roadGradeLayer);
    if (roadWidthLayer && map.hasLayer(roadWidthLayer)) map.removeLayer(roadWidthLayer);
    if (roadMapLayer && map.hasLayer(roadMapLayer)) map.removeLayer(roadMapLayer);
    if (roadNonSaranaLayer && map.hasLayer(roadNonSaranaLayer)) map.removeLayer(roadNonSaranaLayer);
    if (crossfallVisualLayer && map.hasLayer(crossfallVisualLayer)) map.removeLayer(crossfallVisualLayer);
    if (gradeLabelsLayer && map.hasLayer(gradeLabelsLayer)) map.removeLayer(gradeLabelsLayer);

    if (!map.hasLayer(blastmapLayerGroup)) blastmapLayerGroup.addTo(map);

    const activeDate = calendarFilterDate || getTodayYMDWita();
    loadBlastmapData(activeDate);

    updateLegendUI();
    showToastNotification("💣 Modul Blastmap Monitoring Aktif");
  }
}

// ==========================================
// 1C. LOADER BLASTMAP GEOJSON
// ==========================================
async function loadBlastmapData(dateStr) {
  if (!dateStr) dateStr = getTodayYMDWita();
  currentLoadedBlastDate = dateStr;
  blastmapLayerGroup.clearLayers();

  setSyncStatus('updating', `Memuat blastmap ${dateStr}...`);

  const targetFile = `data/blastmaps/blast_${dateStr}.geojson`;
  const fallbackFile = `data/blastmaps/overwatch.geojson`;

  let geojsonData = null;

  try {
    let res = await fetch(targetFile);
    if (!res.ok) {
      res = await fetch(fallbackFile);
    }

    if (!res.ok) {
      setSyncStatus('updated');
      showToastNotification(`⚠️ Belum ada blastmap untuk tanggal ${dateStr}`);
      return;
    }

    geojsonData = await res.json();
  } catch (err) {
    setSyncStatus('updated');
    showToastNotification(`Gagal memuat file blastmap (${err.message})`);
    return;
  }

  try {
    const blastGeoLayer = L.geoJSON(geojsonData, {
      style: function(feature) {
        const p = feature.properties || {};
        const isBendera = (p.tipe && p.tipe.includes("Bendera")) || p.fillOpacity === 1.0;
        const isBlastArea = p.tipe === "Blast Area";

        if (isBlastArea) {
          return {
            color: p.color || "#00ffff",
            fillColor: p.fillColor || "#00ffff",
            fillOpacity: p.fillOpacity !== undefined ? p.fillOpacity : 0.6,
            weight: p.weight || 2
          };
        }

        if (isBendera) {
          return {
            color: p.color || "#ffffff",
            fillColor: p.fillColor || p.color,
            fillOpacity: 1.0,
            weight: 1
          };
        }

        // Garis kawat lingkaran radius & tiang bendera
        return {
          color: p.color || "#ffffff",
          weight: p.weight || 2.5,
          fill: false,
          opacity: 0.95
        };
      },
      pointToLayer: function(feature, latlng) {
        const p = feature.properties || {};
        const blockerText = p.kode || p.name || p.Teks || "B";
        const textColor = p.color || "#ff00ff";

        const marker = L.marker(latlng, {
          icon: L.divIcon({
            className: 'custom-text-blocker',
            html: `<span style="color:${textColor};">${blockerText}</span>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13]
          }),
          zIndexOffset: 3000
        });

        marker.bindPopup(`
          <div style="font-size:11px; font-family:monospace; padding:2px;">
            <b style="color:#ff00ff; font-size:13px;">TITIK BLOCKER: ${blockerText}</b><br>
            <span style="color:#64748b;">Tanggal: ${currentLoadedBlastDate}</span><br>
            <span>Koordinat: ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}</span>
          </div>
        `);

        return marker;
      },
      onEachFeature: function(feature, layer) {
        const p = feature.properties || {};
        if (p.tipe && !layer.getPopup()) {
          layer.bindTooltip(`<b>${p.tipe}</b>`, { sticky: true });
        }
      }
    });

    blastmapLayerGroup.addLayer(blastGeoLayer);

    if (blastGeoLayer.getBounds().isValid()) {
      map.fitBounds(blastGeoLayer.getBounds(), { padding: [50, 50], maxZoom: 18 });
    }

    setSyncStatus('updated');
    showToastNotification(`💣 Blastmap ${dateStr} berhasil dimuat!`);
  } catch (renderErr) {
    console.error("Error rendering blastmap:", renderErr);
    setSyncStatus('updated');
  }
}
// ==========================================
// 1B. BADGE NOTIFIKASI SINKRONISASI PINTAR
// ==========================================
function setSyncStatus(status, detailText = "") {
  const badge = document.getElementById('syncStatusBadge');
  const dot = document.getElementById('syncStatusDot');
  const text = document.getElementById('syncStatusText');
  const sub = document.getElementById('syncStatusSub');
  if (!badge || !dot || !text) return;

  clearTimeout(syncStatusTimeout);

  if (!navigator.onLine || status === 'offline') {
    badge.className = "px-2.5 py-1 rounded-xl shadow-lg border backdrop-blur-md transition-all duration-300 pointer-events-auto flex items-center gap-2 bg-rose-950/90 border-rose-600 text-white";
    dot.className = "w-2 h-2 rounded-full bg-rose-400 animate-pulse";
    text.innerText = "OFFLINE";
    if (sub) sub.innerText = "Koneksi terputus";
    badge.style.display = "flex";
    return;
  }

  if (status === 'updating') {
    badge.className = "px-2.5 py-1 rounded-xl shadow-lg border backdrop-blur-md transition-all duration-300 pointer-events-auto flex items-center gap-2 bg-amber-950/90 border-amber-500 text-amber-300";
    dot.className = "w-2 h-2 rounded-full bg-amber-400 animate-ping";
    text.innerText = "UPDATING !";
    if (sub) sub.innerText = detailText || "Sinkronisasi data...";
    badge.style.display = "flex";
  } else if (status === 'updated') {
    const timeNow = UtilitiesFormatNowWita().split(', ')[1] || '';
    badge.className = "px-2.5 py-1 rounded-xl shadow-lg border backdrop-blur-md transition-all duration-300 pointer-events-auto flex items-center gap-2 bg-emerald-950/90 border-emerald-500 text-emerald-300";
    dot.className = "w-2 h-2 rounded-full bg-emerald-400";
    text.innerText = "UPDATED !";
    if (sub) sub.innerText = detailText || `Pukul ${timeNow}`;
    badge.style.display = "flex";

    syncStatusTimeout = setTimeout(() => {
      badge.style.display = "none";
    }, 3500);
  } else if (status === 'hide') {
    badge.style.display = "none";
  }
}

window.addEventListener('online', () => {
  setSyncStatus('updating', 'Menghubungkan kembali...');
  loadCloudWorkOrders();
});

window.addEventListener('offline', () => {
  setSyncStatus('offline');
});

// ==========================================
// 1C. SUPABASE REALTIME & HEARTBEAT SYNC
// ==========================================
let presenceHeartbeatInterval = null;
let selfRadarMarker = null;

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
        updateRadarMarkers(state);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          const sendPresence = async () => {
            if (!realtimeChannel) return;
            const payload = {
              user: currentNRP,
              role: currentUserRole,
              online_at: new Date().toISOString()
            };
            if (currentUserLatLng) {
              payload.latlng = { lat: currentUserLatLng[0], lng: currentUserLatLng[1] };
            }
            await realtimeChannel.track(payload);
          };

          await sendPresence();

          // HEARTBEAT 15 DETIK: Jaga koneksi HP tetap aktif agar laptop tidak membaca status offline
          if (presenceHeartbeatInterval) clearInterval(presenceHeartbeatInterval);
          presenceHeartbeatInterval = setInterval(sendPresence, 15000);
        }
      });
  } catch (err) {
    console.warn("Realtime standby mode:", err.message);
  }
}

// Re-assert koneksi saat layar HP dibuka kembali
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && realtimeChannel && currentNRP) {
    const payload = {
      user: currentNRP,
      role: currentUserRole,
      online_at: new Date().toISOString()
    };
    if (currentUserLatLng) {
      payload.latlng = { lat: currentUserLatLng[0], lng: currentUserLatLng[1] };
    }
    realtimeChannel.track(payload);
  }
});

// FUNGSI UPDATE BLIP PINK SENDIRI SECARA LOKAL & INSTAN DARI GPS HP
function updateSelfRadarBlip(latlng) {
  if (!map.hasLayer(radarMarkersLayer)) radarMarkersLayer.addTo(map);

  const shortName = currentNRP.split('@')[0];
  const iconHtml = `
    <div style="display:flex; flex-direction:column; align-items:center;">
      <div style="background:#ec4899; width:15px; height:15px; border-radius:50%; border:2px solid #ffffff; box-shadow:0 0 14px #ec4899;"></div>
      <div style="background:rgba(15,23,42,0.92); border:1px solid #ec4899; color:#f472b6; font-size:9px; font-weight:bold; font-family:monospace; padding:1px 6px; border-radius:4px; margin-top:2px; white-space:nowrap; box-shadow:0 2px 6px rgba(0,0,0,0.8);">
        ★ ${shortName} (Saya)
      </div>
    </div>
  `;

  if (!selfRadarMarker) {
    selfRadarMarker = L.marker(latlng, {
      icon: L.divIcon({
        className: 'radar-user-blip-self',
        html: iconHtml,
        iconSize: [90, 32],
        iconAnchor: [45, 7]
      }),
      zIndexOffset: 3500
    }).bindPopup(`<b>Pengawas:</b> ${currentNRP} <b>(Anda Sendiri)</b><br><b>Role:</b> ${currentUserRole}<br><b>Posisi GPS Real-Time</b>`);
    radarMarkersLayer.addLayer(selfRadarMarker);
  } else {
    if (!radarMarkersLayer.hasLayer(selfRadarMarker)) {
      radarMarkersLayer.addLayer(selfRadarMarker);
    }
    selfRadarMarker.setLatLng(latlng);
  }
}

// RENDER HANYA USER LAIN DARI SUPABASE (WARNA CYAN)
function updateRadarMarkers(presenceState) {
  radarMarkersLayer.eachLayer(layer => {
    if (layer !== selfRadarMarker) {
      radarMarkersLayer.removeLayer(layer);
    }
  });

  if (!presenceState) return;

  Object.values(presenceState).forEach(presences => {
    presences.forEach(p => {
      if (!p.latlng || !p.latlng.lat || !p.latlng.lng) return;
      if (p.user === currentNRP) return; // Diri sendiri di-handle GPS lokal agar 0 ms delay!

      const shortName = p.user.split('@')[0];
      const blipColor = '#00f0ff';

      const iconHtml = `
        <div style="display:flex; flex-direction:column; align-items:center;">
          <div style="background:${blipColor}; width:12px; height:12px; border-radius:50%; border:2px solid #ffffff; box-shadow:0 0 8px #00f0ff;"></div>
          <div style="background:rgba(15,23,42,0.92); border:1px solid ${blipColor}; color:#ffffff; font-size:9px; font-weight:bold; font-family:monospace; padding:1px 6px; border-radius:4px; margin-top:2px; white-space:nowrap; box-shadow:0 2px 6px rgba(0,0,0,0.8);">
            ${shortName}
          </div>
        </div>
      `;

      const marker = L.marker([p.latlng.lat, p.latlng.lng], {
        icon: L.divIcon({
          className: 'radar-user-blip-other',
          html: iconHtml,
          iconSize: [90, 32],
          iconAnchor: [45, 7]
        }),
        zIndexOffset: 1500
      }).bindPopup(`<b>Pengawas:</b> ${p.user}<br><b>Role:</b> ${p.role || 'viewer'}<br><b>Posisi GPS Aktif</b>`);

      radarMarkersLayer.addLayer(marker);
    });
  });
}

// TOGGLE RADAR: BERSIH & TANPA TUMPANG TINDIH
function toggleRadarUserOnline() {
  isRadarActive = !isRadarActive;
  const btn = document.getElementById('btnToggleRadar');
  if (isRadarActive) {
    if (!map.hasLayer(radarMarkersLayer)) radarMarkersLayer.addTo(map);

    // Sembunyikan titik biru lokal bawaan
    if (userMarker && map.hasLayer(userMarker)) map.removeLayer(userMarker);
    if (userAccuracyCircle && map.hasLayer(userAccuracyCircle)) map.removeLayer(userAccuracyCircle);

    // Langsung gambar blip pink di posisi HP terkini
    if (currentUserLatLng) {
      updateSelfRadarBlip(currentUserLatLng);
    }

    if (btn) {
      btn.style.background = '#00f0ff';
      btn.style.color = '#000000';
      btn.style.borderColor = '#ffffff';
    }
    if (realtimeChannel) {
      updateRadarMarkers(realtimeChannel.presenceState());
    }
    showToastNotification("📡 Radar Aktif: Menampilkan posisi user online");
  } else {
    if (map.hasLayer(radarMarkersLayer)) map.removeLayer(radarMarkersLayer);

    // Munculkan kembali titik biru bawaan saat radar off
    if (userMarker && !map.hasLayer(userMarker)) map.addLayer(userMarker);
    if (userAccuracyCircle && !map.hasLayer(userAccuracyCircle)) map.addLayer(userAccuracyCircle);

    if (btn) {
      btn.style.background = '';
      btn.style.color = '';
      btn.style.borderColor = '';
    }
    showToastNotification("📡 Radar Nonaktif");
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
  const { action, data, message } = payload;

  setSyncStatus('updating', 'Data baru masuk');

  if (message) {
    showToastNotification(message);
    recordNotification(message);
  }

  switch (action) {
    case 'CREATE_WO':
    case 'EDIT_WO':
      if (data && data.id) {
        allWorkOrders[data.id] = data;
        refreshWorkOrderMapDisplay();
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
        refreshWorkOrderMapDisplay();
        renderOutstandingList();
      }
      break;

    case 'UPDATE_JOB_STATUS':
      if (data && data.woId && allWorkOrders[data.woId]) {
        const targetWo = allWorkOrders[data.woId];
        if (targetWo.jobs && targetWo.jobs[data.jobIndex]) {
          targetWo.jobs[data.jobIndex].status = data.status;
          if (data.toolType) targetWo.jobs[data.jobIndex].toolType = data.toolType;
          if (data.egi) targetWo.jobs[data.jobIndex].egi = data.egi;
        }
        targetWo.status = data.parentStatus || calculateParentStatus(targetWo.jobs);
        refreshWorkOrderMapDisplay();
        renderOutstandingList();
      }
      break;

    case 'DELETE_WO':
      if (data && data.id && allWorkOrders[data.id]) {
        const woItem = allWorkOrders[data.id];
        if (woItem.markerLayer && workOrderMarkersLayer.hasLayer(woItem.markerLayer)) {
          workOrderMarkersLayer.removeLayer(woItem.markerLayer);
        }
        const lineId = data.linkedLineId || woItem.linkedLineId;
        delete allWorkOrders[data.id];

        if (lineId && allDrawLines[lineId]) {
          const lineItem = allDrawLines[lineId];
          if (lineItem.layer && workOrderDrawingsLayer.hasLayer(lineItem.layer)) {
            workOrderDrawingsLayer.removeLayer(lineItem.layer);
          }
          delete allDrawLines[lineId];
        }
        refreshWorkOrderMapDisplay();
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
// 1D. NORMALISASI RUAS JALAN & CLUSTER SPATIAL
// ==========================================
function getGroupedRoadName(rawRoad) {
  if (!rawRoad) return "Ruas Tambang Umum";
  const lower = rawRoad.toLowerCase();

  const masterRoads = [
    { keyword: 'lampung', group: 'Jl Lampung' },
    { keyword: 'subang', group: 'Jl Subang' },
    { keyword: 'bontang', group: 'Jl Bontang' },
    { keyword: 'banjarbaru', group: 'Jl Banjarbaru' },
    { keyword: 'bjb', group: 'Jl Banjarbaru' },
    { keyword: 'jakarta', group: 'Jl Jakarta' },
    { keyword: 'pontianak', group: 'Jl Pontianak' },
    { keyword: 'sibolga', group: 'Jl Sibolga' },
    { keyword: 'ipd', group: 'IPD' },
    { keyword: 'hw', group: 'HW' },
    { keyword: 'ob', group: 'OB' },
    { keyword: 'makasar', group: 'Jl Makasar' },
    { keyword: 'gorontalo', group: 'Jl Gorontalo' },
    { keyword: 'palu', group: 'Jl Palu' },
    { keyword: 'sangata', group: 'Jl Sangata' }
  ];

  for (let item of masterRoads) {
    if (lower.includes(item.keyword)) {
      return item.group;
    }
  }

  return rawRoad.trim();
}

function detectClusterForLatLng(latlng) {
  if (!clusterFeatures || clusterFeatures.length === 0) return { cluster: "", lokasi: "Central" };
  for (let f of clusterFeatures) {
    const geom = f.geometry;
    if (!geom) continue;
    const props = f.properties || {};
    const clusterName = props.Cluster || props.Nama_Cluster || props.Name || props.CLUSTER || "";
    const lokasiName = props.Lokasi || props.Location || props.LOKASI || "Central";

    if (geom.type === 'Polygon') {
      const ring = geom.coordinates[0].map(c => ({ lat: c[1], lng: c[0] }));
      if (isPointInPolygon(latlng, ring)) {
        return { cluster: clusterName, lokasi: lokasiName };
      }
    } else if (geom.type === 'MultiPolygon') {
      for (let poly of geom.coordinates) {
        const ring = poly[0].map(c => ({ lat: c[1], lng: c[0] }));
        if (isPointInPolygon(latlng, ring)) {
          return { cluster: clusterName, lokasi: lokasiName };
        }
      }
    }
  }
  return { cluster: "", lokasi: "Central" };
}

// ==========================================
// 1E. SINKRONISASI LOG 48 JAM & OUTSTANDING
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

  if (currentAppMode === 'blastmap') {
    title.innerText = 'LEGENDA: BLASTMAP MONITORING';
    content.innerHTML = `
      <div class="legend-blastmap-item">
        <span class="flex items-center gap-2"><span class="legend-color-box bg-[#00ffff]"></span><span>Blast Area (Solid)</span></span>
        <span class="text-[9px] font-mono text-cyan-400 font-bold">PELEDAKAN</span>
      </div>
      <div class="legend-blastmap-item">
        <span class="flex items-center gap-2"><span class="legend-line-sample bg-[#ff00ff]"></span><span>Radius 100 Meter</span></span>
        <span class="text-[9px] font-mono text-fuchsia-400 font-bold">100m</span>
      </div>
      <div class="legend-blastmap-item">
        <span class="flex items-center gap-2"><span class="legend-line-sample bg-[#ffff00]"></span><span>Radius 150 Meter</span></span>
        <span class="text-[9px] font-mono text-yellow-400 font-bold">150m</span>
      </div>
      <div class="legend-blastmap-item">
        <span class="flex items-center gap-2"><span class="legend-line-sample bg-[#ff0000]"></span><span>Radius 300 Meter</span></span>
        <span class="text-[9px] font-mono text-rose-500 font-bold">300m</span>
      </div>
      <div class="legend-blastmap-item">
        <span class="flex items-center gap-2"><span class="legend-line-sample bg-[#00ff00]"></span><span>Radius 500 Meter (Aman)</span></span>
        <span class="text-[9px] font-mono text-emerald-400 font-bold">500m</span>
      </div>
      <div class="legend-blastmap-item mt-1 pt-1.5 border-t border-slate-700/80">
        <span class="flex items-center gap-2"><b class="text-[#ff00ff] font-mono text-xs">[A]</b><span>Titik Blocker Pengawas</span></span>
        <span class="text-[9px] font-mono text-slate-400">POINT</span>
      </div>
    `;
    return;
  }

  if (currentMainTab === 'map') {
    title.innerText = 'LEGENDA: MAP';
    content.innerHTML = `
      <div class="flex items-center gap-2"><span class="w-5 h-1.5 rounded-sm bg-[#38bdf8]"></span><span>Jalan Hauler 100 Ton</span></div>
      <div class="flex items-center gap-2"><span class="w-5 h-1.5 rounded-sm bg-[#eab308]"></span><span>Jalan Hauler 150 Ton</span></div>
      <div class="flex items-center gap-2"><span class="w-5 h-1.5 rounded-sm bg-[#f97316]"></span><span>Jalan Hauler 200 Ton</span></div>
      <div class="flex items-center gap-2"><span class="w-5 h-1.5 rounded-sm bg-[#ec4899]"></span><span>Jalur Sarana</span></div>
      <div class="flex items-center gap-2"><span class="w-5 h-2 rounded-sm border-2 border-[#ef4444] bg-[#ef4444]/40"></span><span>Jalur Khusus Non-Sarana</span></div>
    `;
  } else {
    if (currentParam === 'grade') {
      title.innerText = 'LEGENDA: GRADE JALAN';
      content.innerHTML = `
        <div class="flex items-center gap-2"><span class="w-4 h-3 rounded-sm bg-[#22c55e]"></span><span>Ongrade (&lt; 7.9%)</span></div>
        <div class="flex items-center gap-2"><span class="w-4 h-3 rounded-sm bg-[#eab308]"></span><span>Warning (8.0% - 8.9%)</span></div>
        <div class="flex items-center gap-2"><span class="w-4 h-3 rounded-sm bg-[#e11d48]"></span><span>Overgrade (&gt; 9.0%)</span></div>
      `;
    } else if (currentParam === 'lebar') {
      title.innerText = 'LEGENDA: LEBAR JALAN';
      content.innerHTML = `
        <div class="flex items-center gap-2"><span class="w-5 h-1.5 rounded-sm bg-[#22c55e]"></span><span>Lebar Sesuai Standar</span></div>
        <div class="flex items-center gap-2"><span class="w-5 h-1.5 rounded-sm bg-[#e11d48]"></span><span>Non-Standar (Sempit)</span></div>
        <div class="flex items-center gap-2"><span class="w-5 h-1.5 rounded-sm bg-[#00f0ff]"></span><span>STA Terpilih</span></div>
      `;
    } else {
      title.innerText = 'LEGENDA: CROSSFALL';
      content.innerHTML = `
        <div class="flex items-center gap-2"><span class="w-5 h-1.5 rounded-sm bg-[#22c55e]"></span><span>Compliant (Normal: 2.0% - 4.0%)</span></div>
        <div class="flex items-center gap-2"><span class="w-5 h-1.5 rounded-sm bg-[#e11d48]"></span><span>Non-Compliant (&lt; 2.0% / &gt; 4.0%)</span></div>
        <div class="flex items-center gap-2 mt-2 pt-1 border-t border-slate-700"><span class="text-xs font-bold text-cyan-400">➤</span><span>Arah Aliran Air</span></div>
      `;
    }
  }
}

function sanitizeWoForBroadcast(wo) {
  return {
    id: wo.id,
    createdTime: wo.createdTime,
    road: wo.road,
    cluster: wo.cluster || "",
    lokasi: wo.lokasi || "Central",
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
// 2. SESI LOGIN, AUTH & LOGOUT
// ==========================================
function saveUserSession(nrp, role) {
  const sessionData = { nrp: nrp, role: role, loginTime: Date.now() };
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

async function logoutUser() {
  if (!confirm("Yakin ingin logout dari Overwatch? Sesi 30 hari akan direset.")) return;
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    await _supabase.auth.signOut();
  } catch (err) {
    console.warn("Logout auth err:", err);
  }

  const notifDrawer = document.getElementById('notificationDrawer');
  if (notifDrawer) notifDrawer.classList.remove('active-drawer');

  const emailSec = document.getElementById('email-section');
  const otpSec = document.getElementById('otp-section');
  const emailInput = document.getElementById('email-input');
  const otpInput = document.getElementById('otp-input');
  const statusMsg = document.getElementById('auth-status');

  if (emailSec) emailSec.classList.remove('hidden');
  if (otpSec) otpSec.classList.add('hidden');
  if (emailInput) emailInput.value = '';
  if (otpInput) otpInput.value = '';
  if (statusMsg) statusMsg.innerText = '';

  const authOverlay = document.getElementById('auth-overlay');
  if (authOverlay) authOverlay.style.display = 'flex';

  catatLogKeServer("LOGOUT", `User ${currentNRP} logout dari aplikasi.`);
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

  initGeotaggingCameraModule();

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
  const pickerIds = ['mapCalendarDateInput', 'exportStartDate', 'exportEndDate', 'adminNewUpdateDateInput', 'woCreatedDateInput'];
  
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
    const { data, error } = await _supabase.from('Whitelist').select('Email').eq('Email', email);
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
  const { error } = await _supabase.auth.verifyOtp({
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
// 2C. RESTRUKTURISASI TAB MENU: MAP & PARAMETER
// ==========================================
function switchMainTab(tabKey) {
  currentMainTab = tabKey;
  closeParameterDropdown();

  const mapBtn = document.getElementById('tabMapBtn');
  const paramBtn = document.getElementById('tabParamBtn');

  if (tabKey === 'map') {
    if (mapBtn) mapBtn.className = "font-bold text-xs px-3 sm:px-3.5 py-1 rounded-md transition duration-150 bg-amber-400 text-slate-950 shadow shrink-0 whitespace-nowrap";
    if (paramBtn) paramBtn.className = "font-bold text-xs px-2.5 sm:px-3 py-1 rounded-md transition duration-150 text-slate-300 hover:text-white flex items-center gap-1 shrink-0 whitespace-nowrap";
    refreshVisibleLayers();
    updateLegendUI();
    renderMapOverviewSummary();
  }
}

function toggleParameterDropdown() {
  const menu = document.getElementById('paramDropdownMenu');
  if (menu) menu.classList.toggle('hidden');
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

  if (mapBtn) mapBtn.className = "font-bold text-xs px-3 sm:px-3.5 py-1 rounded-md transition duration-150 text-slate-300 hover:text-white shrink-0 whitespace-nowrap";
  if (paramBtn) paramBtn.className = "font-bold text-xs px-2.5 sm:px-3 py-1 rounded-md transition duration-150 bg-amber-400 text-slate-950 shadow flex items-center gap-1 shrink-0 whitespace-nowrap";

  const nameMap = { 'grade': 'GRADE', 'lebar': 'LEBAR JALAN', 'crossfall': 'CROSSFALL' };
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

function toggleAnnotationVisibility() {
  isAnnotationActive = !isAnnotationActive;
  const btn = document.getElementById('btnToggleAnnotation');
  if (btn) {
    if (isAnnotationActive) btn.classList.add('active');
    else btn.classList.remove('active');
  }
  updateGradeLabelsVisibility();
}

// ==========================================
// 3. WORK ORDER MODE & DRAW TOOL
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
}

function showFinishDrawBtn() {
  const domBtn = document.getElementById('btnFinishDraw');
  if (domBtn) domBtn.style.display = 'flex';
}

function hideFinishDrawBtn() {
  const domBtn = document.getElementById('btnFinishDraw');
  if (domBtn) domBtn.style.display = 'none';
}

function cancelOrFinishDrawing() {
  hideFinishDrawBtn();
  if (tempDrawPolyline) {
    map.removeLayer(tempDrawPolyline);
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

// FIX BUG KOTAK HIJAU: HANYA DETEKSI GARIS YANG BENAR-BENAR SEDANG AKTIF DI LAYER PETA
function findNearbyDrawLine(latlng, maxPixelDist = 25) {
  const clickPt = map.latLngToContainerPoint(latlng);
  for (const lineId in allDrawLines) {
    const line = allDrawLines[lineId];
    if (!line || !line.points || line.points.length < 2) continue;
    // JIKA GARIS TIDAK TAMPIL DI MAP KARENA WO MASA LALU CLOSED, JANGAN DETEKSI!
    if (!line.layer || !workOrderDrawingsLayer.hasLayer(line.layer)) continue;

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
    if (distFromStart <= 25) {
      currentDrawPoints.push(currentDrawPoints[0]);
      finalizeDrawLine();
      return;
    }
  }

  if (currentDrawPoints.length > 0) {
    const lastPt = map.latLngToContainerPoint(currentDrawPoints[currentDrawPoints.length - 1]);
    const currPt = map.latLngToContainerPoint(e.latlng);
    if (Math.sqrt(Math.pow(lastPt.x - currPt.x, 2) + Math.pow(lastPt.y - currPt.y, 2)) < 5) return;
  }

  currentDrawPoints.push(e.latlng);

  if (!tempDrawPolyline) {
    tempDrawPolyline = L.polyline(currentDrawPoints, { 
      color: '#ff2b54', 
      weight: 4, 
      renderer: drawSvgRenderer 
    }).addTo(map);
    tempDrawPolyline.bringToFront();
  } else {
    tempDrawPolyline.setLatLngs(currentDrawPoints);
    tempDrawPolyline.redraw();
    tempDrawPolyline.bringToFront();
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
      tempDrawPolyline.redraw();
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
    if (st === 'CLOSED') strokeColor = '#22c55e';
    else if (st === 'PROGRESS') strokeColor = '#eab308';
    else strokeColor = '#e11d48';
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

  setSyncStatus('updating', 'Menghapus garis...');
  fetch(WEB_APP_URL, {
    method: 'POST',
    mode: 'no-cors',
    body: JSON.stringify({ action: "DELETE_DRAW_LINE", id: lineId })
  }).then(() => setSyncStatus('updated')).catch(() => setSyncStatus('updated'));

  broadcastWoSync('DELETE_DRAW_LINE', { id: lineId }, `${currentNRP} Menghapus sketsa garis.`);
  catatLogKeServer("DELETE DRAW", `Menghapus sketsa garis ID: ${lineId}`);
}

function syncDrawLineToCloud(lineItem) {
  setSyncStatus('updating', 'Menyimpan sketsa garis...');
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
// 4. MODAL FORM: CREATE, EDIT & VIEW WO (REVISI BESAR)
// ==========================================
function openCreateWoModal(road, locationDetail, latlng, rawProps = {}, isManualRoad = false, linkedLineId = "") {
  currentWoMode = 'create';
  currentActiveWoId = null;
  activeWoFeatureData = { road, locationDetail, latlng, rawProps, isManualRoad, linkedLineId };
  mainUploadFilesQueue = [];

  const spatialCluster = detectClusterForLatLng(latlng);

  setupModalUI({
    title: "BUAT WORK ORDER (WO)",
    sub: "Tentukan temuan perbaikan infrastruktur jalan tambang.",
    woDate: getTodayYMDWita(),
    status: "OPEN",
    roadName: road,
    clusterName: spatialCluster.cluster,
    locationDetail: locationDetail,
    reporter: "",
    jobs: [{ toolType: "", customTool: "", egi: "", detail: "", status: "OPEN" }],
    photoUrls: [],
    notesValue: "",
    showJobsEdit: true,
    showGlobalInputs: true,
    showEvidenceToolSection: false,
    showNotes: false,
    showUploadPhoto: true,
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

  const rawJobs = (item.jobs && item.jobs.length > 0) ? item.jobs : [{ toolType: "", customTool: "", egi: "", detail: item.notes || "", status: "OPEN" }];
  const calculatedStatus = calculateParentStatus(rawJobs);

  setupModalUI({
    title: "EDIT WORK ORDER",
    sub: "Perbarui instruksi perbaikan atau detail temuan jalan.",
    woDate: parseTimestampToYMD(item.createdTime) || getTodayYMDWita(),
    status: calculatedStatus,
    roadName: item.road,
    clusterName: item.cluster || "",
    locationDetail: item.sta,
    reporter: item.reporter,
    jobs: rawJobs,
    photoUrls: item.photoUrls || [],
    notesValue: item.notes || "",
    showJobsEdit: true,
    showGlobalInputs: true,
    showEvidenceToolSection: false,
    showNotes: false,
    showUploadPhoto: true,
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

  const rawJobs = (item.jobs && item.jobs.length > 0) ? item.jobs : [{ toolType: "", customTool: "", egi: "", detail: item.notes || "", status: "OPEN" }];
  const calculatedStatus = calculateParentStatus(rawJobs);
  const isMultiJob = rawJobs.length > 1;

  setupModalUI({
    title: "VIEW WORK ORDER & EVIDENCE",
    sub: "Rincian Work Order dan form pengiriman bukti progres lapangan.",
    woDate: parseTimestampToYMD(item.createdTime) || getTodayYMDWita(),
    evidenceTime: getNowDateTimeLocalWita(),
    status: calculatedStatus,
    roadName: item.road,
    clusterName: item.cluster || "",
    locationDetail: item.sta,
    reporter: "",
    jobs: rawJobs,
    photoUrls: item.photoUrls || [],
    notesValue: "",
    showJobsEdit: false,
    showGlobalInputs: !isMultiJob,
    showEvidenceToolSection: !isMultiJob,
    showNotes: !isMultiJob,
    showUploadPhoto: !isMultiJob,
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
  const dateEvidenceInput = document.getElementById('woEvidenceDateTimeInput');
  const dateLabel = document.getElementById('woDateLabel');
  const statusBadge = document.getElementById('woStatusBadge');
  const roadInput = document.getElementById('woRoadName');
  const clusterInput = document.getElementById('woClusterName');
  const locDetail = document.getElementById('woLocationDetail');
  const repWrap = document.getElementById('woReporterWrapper');
  const repInput = document.getElementById('woReporterName');
  const globalWrapper = document.getElementById('woGlobalInputsWrapper');
  const evidenceToolSec = document.getElementById('woEvidenceToolSection');
  const notesContainer = document.getElementById('woNotesContainer');
  const notesInput = document.getElementById('woNotes');
  const evidencePhotoWrap = document.getElementById('woEvidenceWrapper');
  const deleteBtn = document.getElementById('woDeleteBtn');
  const viewProgBtn = document.getElementById('woViewProgressBtn');
  const submitBtn = document.getElementById('woSubmitBtn');
  const fileInput = document.getElementById('woEvidenceFile');

  if (title) title.innerText = cfg.title;
  if (sub) sub.innerText = cfg.sub;

  if (currentWoMode === 'view') {
    if (dateLabel) dateLabel.innerText = "Waktu Evidence:";
    if (dateInput) dateInput.style.display = 'none';
    if (dateEvidenceInput) {
      dateEvidenceInput.style.display = 'block';
      dateEvidenceInput.value = cfg.evidenceTime || getNowDateTimeLocalWita();
    }
  } else {
    if (dateLabel) dateLabel.innerText = "Tanggal WO:";
    if (dateEvidenceInput) dateEvidenceInput.style.display = 'none';
    if (dateInput) {
      dateInput.style.display = 'block';
      dateInput.value = cfg.woDate || getTodayYMDWita();
      dateInput.disabled = false;
    }
  }

  updateStatusBadgeElement(statusBadge, cfg.status);

  if (roadInput) roadInput.value = cfg.roadName || "";
  if (clusterInput) clusterInput.value = cfg.clusterName || "";
  if (locDetail) locDetail.value = cfg.locationDetail || "";
  if (repInput) repInput.value = cfg.reporter || "";

  // HILANGKAN NAMA DI VIEW MULTI-JOB KARENA TER-COVER DI MODAL JOB UPDATE
  if (repWrap) repWrap.style.display = (currentWoMode === 'view' && cfg.jobs && cfg.jobs.length > 1) ? 'none' : 'block';

  if (globalWrapper) globalWrapper.style.display = cfg.showGlobalInputs ? 'flex' : 'none';
  if (evidenceToolSec) evidenceToolSec.style.display = cfg.showEvidenceToolSection ? 'block' : 'none';
  if (notesContainer) notesContainer.style.display = cfg.showNotes ? 'block' : 'none';
  if (notesInput) notesInput.value = cfg.notesValue || "";
  if (evidencePhotoWrap) evidencePhotoWrap.style.display = cfg.showUploadPhoto ? 'block' : 'none';

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

function renderJobsUI(jobsList, isEditable, isViewMode = false) {
  const container = document.getElementById('woJobsContainer');
  const addBtn = document.getElementById('btnAddJobBtn');
  if (!container) return;

  if (addBtn) addBtn.style.display = isEditable ? 'block' : 'none';
  container.innerHTML = '';

  const jobs = (jobsList && jobsList.length > 0) ? jobsList : [{ toolType: "", customTool: "", egi: "", detail: "", status: "OPEN" }];

  jobs.forEach((j, idx) => {
    const card = document.createElement('div');
    card.className = 'job-item-card';
    card.style.background = '#1e293b';
    card.style.border = '1px solid #334155';
    card.style.borderRadius = '6px';
    card.style.padding = '8px 10px';
    card.style.marginBottom = '6px';

    const jobSt = (j.status || "OPEN").toUpperCase();
    let stColor = jobSt === 'CLOSED' ? '#22c55e' : (jobSt === 'PROGRESS' ? '#eab308' : '#e11d48');

    if (isEditable) {
      const isCustomTool = (j.toolType === "CUSTOM" || (j.toolType && !['Ex','Cp','Dz',''].includes(j.toolType)));
      const selectVal = isCustomTool ? 'CUSTOM' : (j.toolType || '');

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="font-size:10px; font-weight:bold; color:#38bdf8;">JOB #${idx + 1}</span>
          ${jobs.length > 1 ? `<button type="button" onclick="removeJobItem(${idx})" style="background:transparent; color:#ef4444; border:none; font-size:11px; cursor:pointer; font-weight:bold;">✕ Hapus</button>` : ''}
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; margin-bottom:6px;">
          <div>
            <select class="job-tool-select" onchange="handleJobToolSelectChange(this, ${idx})" style="width:100%; background:#0f172a; border:1px solid #475569; padding:4px 6px; border-radius:4px; color:#fff; font-size:11px;">
              <option value="">-- Jenis Alat (Opsional) --</option>
              <option value="Ex" ${selectVal === 'Ex' ? 'selected' : ''}>Ex (Excavator)</option>
              <option value="Cp" ${selectVal === 'Cp' ? 'selected' : ''}>Cp (Compactor)</option>
              <option value="Dz" ${selectVal === 'Dz' ? 'selected' : ''}>Dz (Dozer)</option>
              <option value="CUSTOM" ${selectVal === 'CUSTOM' ? 'selected' : ''}>Lainnya (Ketik Manual)</option>
            </select>
            <input type="text" class="job-tool-custom-input" placeholder="Ketik jenis alat..." value="${isCustomTool ? (j.customTool || j.toolType) : ''}" style="display:${selectVal === 'CUSTOM' ? 'block' : 'none'}; width:100%; margin-top:4px; background:#0f172a; border:1px solid #475569; padding:4px 6px; border-radius:4px; color:#fff; font-size:11px;">
          </div>
          <div>
            <input type="text" class="job-egi-input" placeholder="EGI (cth: 126)" value="${j.egi || ''}" style="width:100%; background:#0f172a; border:1px solid #475569; padding:4px 6px; border-radius:4px; color:#fff; font-size:11px;">
          </div>
        </div>
        <div>
          <textarea class="job-detail-input" rows="2" placeholder="Detail Pekerjaan (Wajib diisi)..." style="width:100%; background:#0f172a; border:1px solid #475569; padding:4px 6px; border-radius:4px; color:#fff; font-size:11px; resize:none;">${j.detail || j.notes || ''}</textarea>
        </div>
      `;
    } else {
      let updateBtnHtml = '';
      if (isViewMode && jobs.length > 1) {
        updateBtnHtml = `
          <button type="button" onclick="openJobUpdateModal(${idx})" style="background:#ec4899; color:#fff; border:none; padding:4px 10px; border-radius:4px; font-size:10px; font-weight:bold; cursor:pointer; box-shadow:0 2px 6px rgba(236,72,153,0.4);">UPDATE</button>
        `;
      }

      let toolHeader = "";
      const toolName = j.toolType === "CUSTOM" ? (j.customTool || "") : (j.toolType || "");
      if (toolName || j.egi) {
        toolHeader = `<span style="color:#facc15; font-size:10px; font-weight:bold; margin-right:6px;">[${toolName} ${j.egi || ''}]</span>`;
      }

      card.innerHTML = 
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">' +
          '<div>' +
            '<span style="font-size:11px; font-weight:bold; color:#38bdf8;">JOB #' + (idx + 1) + '</span> ' +
            toolHeader +
            '<span style="font-size:9px; font-weight:bold; padding:1px 5px; border-radius:3px; background:' + stColor + '; color:#000; margin-left:6px;">' + jobSt + '</span>' +
          '</div>' +
          updateBtnHtml +
        '</div>' +
        '<div style="font-size:11px; color:#cbd5e1; margin-top:2px;">' + (j.detail || j.notes || j.category || 'Tidak ada uraian.') + '</div>';
    }

    // WAJIB DI SINI: Ditaruh di luar if-else supaya nempel di mode edit maupun view
    container.appendChild(card);
  });
}

function handleJobToolSelectChange(selectElem) {
  const customInput = selectElem.parentElement.querySelector('.job-tool-custom-input');
  if (customInput) {
    customInput.style.display = selectElem.value === 'CUSTOM' ? 'block' : 'none';
    if (selectElem.value === 'CUSTOM') customInput.focus();
  }
}

function addNewJobItem() {
  const currentJobs = collectJobsFromUI();
  currentJobs.push({ toolType: "", customTool: "", egi: "", detail: "", status: "OPEN" });
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
    const sel = c.querySelector('.job-tool-select');
    const customTxt = c.querySelector('.job-tool-custom-input');
    const egiTxt = c.querySelector('.job-egi-input');
    const detailTxt = c.querySelector('.job-detail-input');

    const existingStatus = (activeWoFeatureData && activeWoFeatureData.jobs && activeWoFeatureData.jobs[idx]) ? activeWoFeatureData.jobs[idx].status : "OPEN";
    
    if (detailTxt) {
      list.push({
        toolType: sel ? sel.value : "",
        customTool: customTxt ? customTxt.value.trim() : "",
        egi: egiTxt ? egiTxt.value.trim() : "",
        detail: detailTxt.value.trim(),
        status: existingStatus
      });
    }
  });
  return list.length > 0 ? list : [{ toolType: "", customTool: "", egi: "", detail: "", status: "OPEN" }];
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

function toggleEvidenceCustomToolInput() {
  const sel = document.getElementById('woEvidenceToolType');
  const input = document.getElementById('woEvidenceToolCustom');
  if (sel && input) {
    input.style.display = sel.value === 'CUSTOM' ? 'block' : 'none';
    if (sel.value === 'CUSTOM') input.focus();
  }
}

function toggleJobUpdateCustomToolInput() {
  const sel = document.getElementById('jobUpdateToolType');
  const input = document.getElementById('jobUpdateToolCustom');
  if (sel && input) {
    input.style.display = sel.value === 'CUSTOM' ? 'block' : 'none';
    if (sel.value === 'CUSTOM') input.focus();
  }
}

// ==========================================
// 4B. ANTRIAN MULTI-FOTO
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

// ==========================================
// 4C. PROSES SUBMIT WORK ORDER & POPUP STATUS
// ==========================================
function handleWoSubmitButtonClick() {
  if (currentWoMode === 'view') {
    // MODAL EVIDENCE SINGLE JOB: BUKA POPUP KONFIRMASI STATUS
    const repInput = document.getElementById('woReporterName');
    if (!repInput || !repInput.value.trim()) {
      alert("Nama / NRP Pengawas wajib diisi!");
      if (repInput) repInput.focus();
      return;
    }
    openEvidenceStatusModal('WO_EVIDENCE');
  } else {
    submitWorkOrder();
  }
}

function openEvidenceStatusModal(target) {
  pendingStatusTarget = target;
  const modal = document.getElementById('evidenceStatusModalOverlay');
  if (modal) modal.style.display = 'flex';
}

function closeEvidenceStatusModal() {
  const modal = document.getElementById('evidenceStatusModalOverlay');
  if (modal) modal.style.display = 'none';
  pendingStatusTarget = null;
}

function confirmEvidenceStatusAndSubmit() {
  const selectedRadio = document.querySelector('input[name="evidenceFinalStatus"]:checked');
  const chosenStatus = selectedRadio ? selectedRadio.value : "PROGRESS";

  // 1. Jalankan proses simpan data & kirim evidence dengan status pilihan dulu!
  if (pendingStatusTarget === 'WO_EVIDENCE') {
    executeSubmitWoEvidenceWithStatus(chosenStatus);
  } else if (pendingStatusTarget === 'JOB_UPDATE') {
    executeSubmitJobUpdateWithStatus(chosenStatus);
  }

  // 2. Baru tutup modal pop-up statusnya di akhir
  closeEvidenceStatusModal();
}

async function submitWorkOrder() {
  const roadInput = document.getElementById('woRoadName');
  const clusterInput = document.getElementById('woClusterName');
  const repInput = document.getElementById('woReporterName');
  const locDetail = document.getElementById('woLocationDetail');
  const dateInput = document.getElementById('woCreatedDateInput');

  const roadName = roadInput ? roadInput.value.trim() : "";
  const clusterName = clusterInput ? clusterInput.value.trim() : "";
  const reporter = repInput ? repInput.value.trim() : "";
  const detailLoc = locDetail ? locDetail.value : "";
  const chosenDate = dateInput && dateInput.value ? dateInput.value : getTodayYMDWita();

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

  const jobs = collectJobsFromUI();
  const hasEmptyDetail = jobs.some(j => !j.detail);
  if (hasEmptyDetail) {
    alert("Setiap job wajib memiliki Detail Pekerjaan!");
    return;
  }

  const p = chosenDate.split('-');
  const chosenTimeWita = `${p[2]}/${p[1]}/${p[0]}, 07:00:00 WITA`;

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
    } catch (e) {}
  }

  setSyncStatus('updating', 'Menyimpan Work Order...');

  if (currentWoMode === 'create') {
    const woId = 'wo_' + Date.now();
    const linkedLineId = (activeWoFeatureData && activeWoFeatureData.linkedLineId) ? activeWoFeatureData.linkedLineId : (selectedLineForWo ? selectedLineForWo.id : "");

    const woItem = {
      id: woId,
      createdTime: chosenTimeWita,
      road: roadName,
      cluster: clusterName,
      lokasi: (activeWoFeatureData && activeWoFeatureData.latlng) ? detectClusterForLatLng(activeWoFeatureData.latlng).lokasi : "Central",
      sta: detailLoc,
      latlng: activeWoFeatureData.latlng,
      jobs: jobs,
      notes: jobs.map(j => j.detail).join(' | '),
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
      cluster: woItem.cluster,
      lokasi: woItem.lokasi,
      sta: woItem.sta,
      latlng: woItem.latlng,
      jobs: woItem.jobs,
      notes: woItem.notes,
      reporter: woItem.reporter,
      status: "OPEN",
      linkedLineId: woItem.linkedLineId,
      images: imagesPayload
    });

    const notifMsg = `${reporter} membuat WO di ${woItem.road}`;
    broadcastWoSync('CREATE_WO', sanitizeWoForBroadcast(woItem), notifMsg);
    catatLogKeServer("CREATE WO", `Pelapor: ${reporter}, Lokasi: ${woItem.road} (${woItem.sta})`);
    renderOutstandingList();
    alert(`Berhasil membuat Work Order di ${woItem.road}!`);

  } else if (currentWoMode === 'edit') {
    if (!currentActiveWoId || !allWorkOrders[currentActiveWoId]) return;
    const woItem = allWorkOrders[currentActiveWoId];
    woItem.createdTime = chosenTimeWita;
    woItem.road = roadName;
    woItem.cluster = clusterName;
    woItem.jobs = jobs;
    woItem.notes = jobs.map(j => j.detail).join(' | ');
    woItem.reporter = reporter;

    createOrUpdateMarker(woItem);
    if (woItem.linkedLineId && allDrawLines[woItem.linkedLineId]) {
      renderDrawLineOnMap(allDrawLines[woItem.linkedLineId]);
    }

    syncWorkOrderToCloud({
      action: "SAVE_WORK_ORDER",
      id: woItem.id,
      createdTime: woItem.createdTime,
      road: woItem.road,
      cluster: woItem.cluster,
      lokasi: woItem.lokasi,
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

    const notifMsg = `${reporter} memperbarui WO di ${woItem.road}`;
    broadcastWoSync('EDIT_WO', sanitizeWoForBroadcast(woItem), notifMsg);
    catatLogKeServer("EDIT WO", `Diperbarui oleh: ${reporter}, Lokasi: ${woItem.road}`);
    renderOutstandingList();
    alert("Perubahan Work Order berhasil disimpan!");
  }

  closeWoModal();
}
async function executeSubmitWoEvidenceWithStatus(statusBaru) {
  if (!currentActiveWoId || !allWorkOrders[currentActiveWoId]) return;
  const targetWo = allWorkOrders[currentActiveWoId];

  const repInput = document.getElementById('woReporterName');
  const notesElem = document.getElementById('woNotes');
  const roadInput = document.getElementById('woRoadName');
  const toolTypeSelect = document.getElementById('woEvidenceToolType');
  const toolCustomInput = document.getElementById('woEvidenceToolCustom');
  const egiInput = document.getElementById('woEvidenceEgi');
  const dtInput = document.getElementById('woEvidenceDateTimeInput');

  const reporter = repInput ? repInput.value.trim() : currentNRP;
  const notes = notesElem ? notesElem.value.trim() : "";
  const roadName = roadInput ? roadInput.value.trim() : targetWo.road;

  let toolType = toolTypeSelect ? toolTypeSelect.value : "";
  if (toolType === "CUSTOM") {
    toolType = toolCustomInput ? toolCustomInput.value.trim() : "";
  }
  const egi = egiInput ? egiInput.value.trim() : "";

  const chosenTimestamp = dtInput && dtInput.value ? formatDateTimeLocalToWita(dtInput.value) : UtilitiesFormatNowWita();

  const imagesPayload = [];
  for (let i = 0; i < mainUploadFilesQueue.length; i++) {
    const file = mainUploadFilesQueue[i];
    try {
      const base64 = await compressImage(file);
      imagesPayload.push({
        imageBase64: base64,
        imageName: `IMG_EV_${roadName.replace(/\s+/g, '_')}_${Date.now()}_${i + 1}.jpg`,
        imageMime: "image/jpeg"
      });
    } catch (e) {}
  }

  setSyncStatus('updating', 'Mengirim bukti evidence...');

  const firstJobCat = (targetWo.jobs && targetWo.jobs[0]) ? (targetWo.jobs[0].detail || "Job 1") : "Pekerjaan Lapangan";
  const jobTargetText = `Job 1: ${firstJobCat}`;

  syncWorkOrderToCloud({
    action: "SUBMIT_EVIDENCE",
    woId: currentActiveWoId,
    jobIndex: 0,
    jobTarget: jobTargetText,
    road: roadName,
    status: statusBaru,
    notes: notes,
    reporter: reporter,
    timestamp: chosenTimestamp,
    toolType: toolType,
    egi: egi,
    images: imagesPayload
  });

  targetWo.status = statusBaru;
  if (targetWo.jobs && targetWo.jobs[0]) {
    targetWo.jobs[0].status = statusBaru;
    if (toolType) targetWo.jobs[0].toolType = toolType;
    if (egi) targetWo.jobs[0].egi = egi;
  }

  createOrUpdateMarker(targetWo);
  if (targetWo.linkedLineId && allDrawLines[targetWo.linkedLineId]) {
    renderDrawLineOnMap(allDrawLines[targetWo.linkedLineId]);
  }

  const notifMsg = `${reporter} update ${jobTargetText} ${roadName}. Status : ${statusBaru}`;
  broadcastWoSync('UPDATE_JOB_STATUS', {
    woId: currentActiveWoId,
    jobIndex: 0,
    status: statusBaru,
    parentStatus: statusBaru,
    notes: notes,
    reporter: reporter,
    toolType: toolType,
    egi: egi
  }, notifMsg);

  catatLogKeServer("SUBMIT EVIDENCE", `Pelapor: ${reporter}, Lokasi: ${roadName}, Status: ${statusBaru}`);
  renderOutstandingList();
  alert(`Progress berhasil dikirim oleh ${reporter} dengan status: ${statusBaru}!`);
  closeWoModal();
}

// ==========================================
// 4D. MODAL UPDATE PROGRESS PER-JOB (MULTI-JOB)
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
  const dtInput = document.getElementById('jobUpdateDateTime');
  const toolSelect = document.getElementById('jobUpdateToolType');
  const toolCustom = document.getElementById('jobUpdateToolCustom');
  const egiInput = document.getElementById('jobUpdateEgi');
  const notesInput = document.getElementById('jobUpdateNotes');
  const fileInput = document.getElementById('jobUpdateFile');

  if (jobInfo) jobInfo.innerText = `Job #${jobIndex + 1}: ${targetJob.detail || targetJob.category || 'Detail Job'}`;
  if (dtInput) dtInput.value = getNowDateTimeLocalWita();

  const isCustom = targetJob.toolType === 'CUSTOM' || (targetJob.toolType && !['Ex','Cp','Dz',''].includes(targetJob.toolType));
  if (toolSelect) toolSelect.value = isCustom ? 'CUSTOM' : (targetJob.toolType || '');
  if (toolCustom) {
    toolCustom.style.display = isCustom ? 'block' : 'none';
    toolCustom.value = isCustom ? (targetJob.customTool || targetJob.toolType) : '';
  }
  if (egiInput) egiInput.value = targetJob.egi || '';
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

function triggerJobUpdateStatusPrompt() {
  openEvidenceStatusModal('JOB_UPDATE');
}

async function executeSubmitJobUpdateWithStatus(statusBaru) {
  if (!currentActiveWoId || activeJobUpdateIndex === null) return;
  const wo = allWorkOrders[currentActiveWoId];
  if (!wo) return;

  const dtInput = document.getElementById('jobUpdateDateTime');
  const toolSelect = document.getElementById('jobUpdateToolType');
  const toolCustom = document.getElementById('jobUpdateToolCustom');
  const egiInput = document.getElementById('jobUpdateEgi');
  const notesInput = document.getElementById('jobUpdateNotes');

  const reporter = currentNRP;
  const notes = notesInput ? notesInput.value.trim() : "";
  const timestamp = dtInput && dtInput.value ? formatDateTimeLocalToWita(dtInput.value) : UtilitiesFormatNowWita();

  let toolType = toolSelect ? toolSelect.value : "";
  if (toolType === "CUSTOM") {
    toolType = toolCustom ? toolCustom.value.trim() : "";
  }
  const egi = egiInput ? egiInput.value.trim() : "";

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
    } catch (e) {}
  }

  const jobTargetName = `Job ${activeJobUpdateIndex + 1}`;

  setSyncStatus('updating', `Menyimpan ${jobTargetName}...`);

  syncWorkOrderToCloud({
    action: "SUBMIT_EVIDENCE",
    woId: currentActiveWoId,
    jobIndex: activeJobUpdateIndex,
    jobTarget: `${jobTargetName}: ${wo.jobs[activeJobUpdateIndex].detail || wo.jobs[activeJobUpdateIndex].category}`,
    road: wo.road,
    status: statusBaru,
    notes: notes,
    reporter: reporter,
    timestamp: timestamp,
    toolType: toolType,
    egi: egi,
    images: imagesPayload
  });

  wo.jobs[activeJobUpdateIndex].status = statusBaru;
  if (toolType) wo.jobs[activeJobUpdateIndex].toolType = toolType;
  if (egi) wo.jobs[activeJobUpdateIndex].egi = egi;

  const newParentStatus = calculateParentStatus(wo.jobs);
  wo.status = newParentStatus;

  createOrUpdateMarker(wo);
  if (wo.linkedLineId && allDrawLines[wo.linkedLineId]) {
    renderDrawLineOnMap(allDrawLines[wo.linkedLineId]);
  }

  updateStatusBadgeElement(document.getElementById('woStatusBadge'), newParentStatus);
  renderJobsUI(wo.jobs, false, true);

  const notifMsg = `${reporter} update ${jobTargetName} ${wo.road}. Status : ${statusBaru}`;
  broadcastWoSync('UPDATE_JOB_STATUS', {
    woId: currentActiveWoId,
    jobIndex: activeJobUpdateIndex,
    status: statusBaru,
    parentStatus: newParentStatus,
    notes: notes,
    reporter: reporter,
    toolType: toolType,
    egi: egi
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

let jobsListText = (woItem.jobs && Array.isArray(woItem.jobs) && woItem.jobs.length > 0)
  ? woItem.jobs.map((j, i) => {
      const toolStr = (j.toolType || j.egi) ? ('[' + (j.toolType || '') + ' ' + (j.egi || '') + '] ') : '';
      const textUraian = j.detail || j.notes || j.uraian || j.category || woItem.notes || '-';
      return (i + 1) + '. ' + toolStr + textUraian + ' [' + (j.status || 'OPEN') + ']';
    }).join('<br>')
  : (woItem.notes || '-');

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
  if (!confirm("Yakin ingin menghapus Work Order ini? Garis sketsa yang terikat juga akan otomatis ikut dihapus.")) return;

  const woItem = allWorkOrders[currentActiveWoId];
  const linkedLineId = woItem.linkedLineId;

  if (woItem.markerLayer) {
    workOrderMarkersLayer.removeLayer(woItem.markerLayer);
  }

  if (linkedLineId && allDrawLines[linkedLineId]) {
    const lineItem = allDrawLines[linkedLineId];
    if (lineItem.layer && workOrderDrawingsLayer.hasLayer(lineItem.layer)) {
      workOrderDrawingsLayer.removeLayer(lineItem.layer);
    }
    delete allDrawLines[linkedLineId];

    fetch(WEB_APP_URL, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify({ action: "DELETE_DRAW_LINE", id: linkedLineId })
    }).catch(err => console.warn("Sync delete draw err:", err));

    broadcastWoSync('DELETE_DRAW_LINE', { id: linkedLineId });
  }

  setSyncStatus('updating', 'Menghapus Work Order...');
  fetch(WEB_APP_URL, {
    method: 'POST',
    mode: 'no-cors',
    body: JSON.stringify({ action: "DELETE_WORK_ORDER", id: currentActiveWoId })
  }).then(() => setSyncStatus('updated')).catch(() => setSyncStatus('updated'));

  const notifMsg = `${currentNRP} Menghapus WO di ${woItem.road}`;
  broadcastWoSync('DELETE_WO', { id: currentActiveWoId, linkedLineId: linkedLineId }, notifMsg);
  catatLogKeServer("DELETE WO", `Dihapus oleh: ${currentNRP}, Lokasi: ${woItem.road}`);
  delete allWorkOrders[currentActiveWoId];

  renderOutstandingList();
  alert("Work Order beserta garis sketsanya berhasil dihapus!");
  closeWoModal();
}

// ==========================================
// 5. PROGRESS TIMELINE & LIGHTBOX
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

    let toolBadge = '';
    if (item.toolType || item.egi) {
      toolBadge = `<span style="font-size:9px; font-weight:bold; color:#facc15; margin-left:6px;">[${item.toolType || ''} ${item.egi || ''}]</span>`;
    }

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
          ${toolBadge}
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
// 6. FILTER KALENDER & OPTIMASI QUERY (LAZY LOAD)
// ==========================================
function openCalendarFilterModal() {
  const modal = document.getElementById('calendarFilterModal');
  const dateInput = document.getElementById('mapCalendarDateInput');
  const heading = document.getElementById('calendarModalHeading');
  const targetLabel = document.getElementById('calendarTargetLabel');
  const exportSec = document.getElementById('calendarExportSection');
  const todayYMD = getTodayYMDWita();

  if (dateInput) {
    dateInput.max = todayYMD;
    dateInput.value = calendarFilterDate || todayYMD;
  }

  if (currentAppMode === 'blastmap') {
    if (heading) heading.innerText = '📅 FILTER TANGGAL BLASTMAP';
    if (targetLabel) targetLabel.innerText = 'Tampilkan Peta Peledakan Tanggal:';
    if (exportSec) exportSec.style.display = 'none';
  } else {
    if (heading) heading.innerText = '📅 FILTER KALENDER & HISTORY WO';
    if (targetLabel) targetLabel.innerText = 'Tampilkan Data WO Tanggal:';
    if (exportSec) exportSec.style.display = 'block';
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
if (currentAppMode === 'blastmap') {
    loadBlastmapData(calendarFilterDate);
  } else {
    refreshWorkOrderMapDisplay();
    alert(`Menampilkan data WO untuk tanggal: ${calendarFilterDate}`);
  }
}

function resetCalendarToToday() {
  calendarFilterDate = null;
  updateActiveWoDateButtonText();
  closeCalendarFilterModal();
if (currentAppMode === 'blastmap') {
    loadBlastmapData(getTodayYMDWita());
  } else {
    refreshWorkOrderMapDisplay();
    alert("Peta kembali ke tampilan hari ini (Live Real-Time)!");
  }
}

// LOGIKA OPTIMASI & PERBAIKAN BUG ANOMALI KOTAK CLOSED
function refreshWorkOrderMapDisplay() {
  if (!isWorkOrderModeActive) return;

  workOrderMarkersLayer.clearLayers();
  workOrderDrawingsLayer.clearLayers();

  const activeQueryDate = calendarFilterDate || getTodayYMDWita();
  const visibleLineIds = new Set();

  Object.values(allWorkOrders).forEach(wo => {
    const woDateYMD = parseTimestampToYMD(wo.createdTime);
    const status = (wo.status || "OPEN").toUpperCase();

    let shouldShow = false;

    // SKEMA CERDAS:
    // 1. Data tanggal terpilih SELALU muncul (termasuk yang closed pada tanggal tersebut).
    // 2. Data hari-hari sebelumnya HANYA muncul jika BELUM CLOSED (Open / Progress).
    if (woDateYMD === activeQueryDate) {
      shouldShow = true;
    } else if (woDateYMD < activeQueryDate && status !== 'CLOSED') {
      shouldShow = true;
    }

    if (shouldShow) {
      createOrUpdateMarker(wo);
      if (wo.linkedLineId && allDrawLines[wo.linkedLineId]) {
        renderDrawLineOnMap(allDrawLines[wo.linkedLineId]);
        visibleLineIds.add(wo.linkedLineId);
      }
    } else {
      // JIKA CLOSED DARI HARI SEBELUMNYA, PASTIKAN GARISNYA BENAR-BENAR DIHAPUS DARI PETA
      if (wo.linkedLineId && allDrawLines[wo.linkedLineId]) {
        const lineItem = allDrawLines[wo.linkedLineId];
        if (lineItem.layer && workOrderDrawingsLayer.hasLayer(lineItem.layer)) {
          workOrderDrawingsLayer.removeLayer(lineItem.layer);
        }
      }
    }
  });

  // Sketsa garis bebas yang belum terikat WO
  Object.values(allDrawLines).forEach(line => {
    const isLinked = Object.values(allWorkOrders).some(wo => wo.linkedLineId === line.id);
    if (!isLinked) {
      renderDrawLineOnMap(line);
    }
  });
}

// ==========================================
// 6B. DUA OPSI EKSPOR REKAP PDF
// ==========================================

// EKSPOR 1: FORMAT PERINTAH KERJA HARIAN ROAD (DENGAN LABEL STATUS BERWARNA DI UJUNG KANAN)
async function executeExportRekapWO() {
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
  setSyncStatus('updating', 'Menyusun Form PKH SIS...');

  try {
    const res = await fetch(`${WEB_APP_URL}?action=EXPORT_REKAP`);
    if (!res.ok) throw new Error("Gagal mengambil data dari cloud backend.");
    const json = await res.json();
    const allData = json.data || [];

    const filtered = allData.filter(wo => {
      const rawTime = wo.createdTime || wo.CreatedTime || wo.timestamp || wo.Timestamp || "";
      const d = parseTimestampToYMD(rawTime);
      return d >= sDate && d <= eDate;
    });

    if (filtered.length === 0) {
      alert("Tidak ada data Work Order pada rentang tanggal tersebut.");
      document.body.style.cursor = originalCursor;
      setSyncStatus('updated');
      return;
    }

    // Helper pencocokan nama jalan resmi dari master Excel (roadNames)
    const matchMasterRoadName = (rawInput) => {
      if (!rawInput) return "Ruas Tambang";
      const cleanInput = rawInput.trim().toLowerCase();
      if (typeof roadNames !== 'undefined' && Array.isArray(roadNames) && roadNames.length > 0) {
        for (let r of roadNames) {
          const coreName = r.replace(/^jl\s+/i, '').trim().toLowerCase();
          if (cleanInput.includes(coreName) || cleanInput.includes(r.toLowerCase())) {
            return r;
          }
        }
      }
      return getGroupedRoadName(rawInput);
    };

    // Helper muat Base64 gambar lokal dengan dimensi aslinya
    const loadLocalImageBase64 = (srcPath) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve({
              base64: canvas.toDataURL('image/png'),
              width: canvas.width,
              height: canvas.height
            });
          } catch(e) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = srcPath;
      });
    };

    // Helper hitung skala proporsional agar gambar tidak gepeng/kegencet
    const calculateFitDimension = (imgData, maxW, maxH, boxX, boxY) => {
      if (!imgData || !imgData.width || !imgData.height) return null;
      const ratio = Math.min(maxW / imgData.width, maxH / imgData.height);
      const w = imgData.width * ratio;
      const h = imgData.height * ratio;
      const x = boxX + (maxW - w) / 2;
      const y = boxY + (maxH - h) / 2;
      return { w, h, x, y, base64: imgData.base64 };
    };

    // 1. Muat Logo AlamTri dan Promise dari folder data/
    const [logoAlamtriObj, logoPromiseObj] = await Promise.all([
      loadLocalImageBase64('data/Logo_Alamtri.png'),
      loadLocalImageBase64('data/Promise.png')
    ]);

    // 2. Kelompokkan data strict per: [Tanggal Hari Itu] + [Lokasi]
    const pageGroups = {};

    filtered.forEach(item => {
      const rawTime = item.createdTime || item.CreatedTime || item.timestamp || "";
      const dateYMD = parseTimestampToYMD(rawTime) || sDate;
      const rawRoad = item.road || item.Road || item.Nama_Jalan || "Ruas Tambang";
      const officialRoad = matchMasterRoadName(rawRoad);
      const clusterName = item.cluster || item.Cluster || getGroupedRoadName(rawRoad);
      const lokasiName = (item.lokasi || item.Lokasi || "Central").toUpperCase();

      const groupKey = `${dateYMD}___${lokasiName}`;
      if (!pageGroups[groupKey]) {
        pageGroups[groupKey] = {
          dateYMD: dateYMD,
          lokasi: lokasiName,
          cardsMap: {}
        };
      }

      const cardKey = `${clusterName}___${officialRoad}`;
      if (!pageGroups[groupKey].cardsMap[cardKey]) {
        pageGroups[groupKey].cardsMap[cardKey] = {
          cluster: clusterName,
          road: officialRoad,
          toolsSet: new Set(),
          jobItems: [] // Menyimpan objek teks & status per job
        };
      }

      let rawJobs = item.jobs;
      if (typeof rawJobs === 'string') {
        try { rawJobs = JSON.parse(rawJobs); } catch(e) { rawJobs = null; }
      }
      let rawHist = item.progressHistory;
      if (typeof rawHist === 'string') {
        try { rawHist = JSON.parse(rawHist); } catch(e) { rawHist = []; }
      }

      const jobs = (rawJobs && Array.isArray(rawJobs) && rawJobs.length > 0)
        ? rawJobs
        : [{ toolType: item.toolType || "", egi: item.egi || "", detail: item.notes || item.detail || "-", status: item.status || "OPEN" }];

      jobs.forEach((j, jIdx) => {
        let toolType = j.toolType || "";
        let egi = j.egi || "";
        let detail = j.detail || j.notes || item.notes || "-";
        let jobStatus = (j.status || item.status || "OPEN").toUpperCase();

        if (rawHist && Array.isArray(rawHist) && rawHist.length > 0) {
          const matchH = rawHist.filter(h => h.jobIndex === jIdx || (h.jobTarget || '').includes(`Job ${jIdx + 1}`));
          const targetH = matchH.length > 0 ? matchH[matchH.length - 1] : rawHist[rawHist.length - 1];
          if (targetH) {
            if (targetH.toolType) toolType = targetH.toolType;
            if (targetH.egi) egi = targetH.egi;
            if (targetH.status) jobStatus = targetH.status.toUpperCase();
          }
        }

        const toolEgi = `${toolType} ${egi}`.trim();
        if (toolEgi) pageGroups[groupKey].cardsMap[cardKey].toolsSet.add(toolEgi);

        const prefix = toolEgi ? `${toolEgi} ` : '';
        pageGroups[groupKey].cardsMap[cardKey].jobItems.push({
          text: `- ${prefix}${detail}`.trim(),
          status: jobStatus
        });
      });
    });

    // 3. Render PDF
    const doc = new jsPDF('l', 'mm', 'a4');
    let isFirstPage = true;
    const sortedGroupKeys = Object.keys(pageGroups).sort();

    sortedGroupKeys.forEach(gKey => {
      const grp = pageGroups[gKey];
      const cardsList = Object.values(grp.cardsMap).map(c => ({
        cluster: c.cluster,
        road: c.road,
        tools: c.toolsSet.size > 0 ? Array.from(c.toolsSet).join(', ') : '-',
        jobs: c.jobItems
      }));

      const dateParts = grp.dateYMD.split('-');
      const singleDateFormatted = (dateParts.length === 3) 
        ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` 
        : grp.dateYMD;

      const CARDS_PER_PAGE = 4;
      const totalSubPages = Math.max(1, Math.ceil(cardsList.length / CARDS_PER_PAGE));

      for (let subP = 0; subP < totalSubPages; subP++) {
        if (!isFirstPage) {
          doc.addPage();
        }
        isFirstPage = false;

        // Form No
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(0, 0, 0);
        doc.text("Form No. : ADMO/PR2/20/F-012", 287, 6.5, { align: "right" });

        // Bingkai Luar
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.4);
        doc.rect(10, 8, 277, 194);

        // Header Lines
        doc.line(10, 32, 287, 32);
        doc.line(44, 8, 44, 32);
        doc.line(185, 8, 185, 32);
        doc.line(242, 8, 242, 32);

        // Logo AlamTri (Kiri Atas)
        if (logoAlamtriObj) {
          const fitLogo = calculateFitDimension(logoAlamtriObj, 30, 20, 12, 10);
          if (fitLogo) {
            doc.addImage(fitLogo.base64, 'PNG', fitLogo.x, fitLogo.y, fitLogo.w, fitLogo.h, undefined, 'FAST');
          }
        } else {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(14);
          doc.setTextColor(2, 132, 199);
          doc.text("AlamTri", 14, 20);
          doc.setTextColor(0, 0, 0);
          doc.setFontSize(8);
          doc.text("geo", 34, 20);
        }

        // Header Tengah
        doc.line(44, 16, 185, 16);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(0, 0, 0);
        doc.text("PT. SAPTAINDRA SEJATI", 114.5, 13.5, { align: "center" });

        doc.line(44, 24, 185, 24);
        doc.line(66, 16, 66, 32);
        doc.line(114.5, 16, 114.5, 32);
        doc.line(138, 16, 138, 32);

        doc.setFontSize(8);
        doc.text("JOBSITE", 46, 21.2);
        doc.text("ADMO", 70, 21.2);

        doc.text("LOKASI", 46, 29.2);
        doc.text(grp.lokasi, 70, 29.2);

        doc.text("TANGGAL", 116.5, 21.2);
        doc.text(singleDateFormatted, 140, 21.2);

        doc.text("SECTION", 116.5, 29.2);
        doc.text("ROAD", 140, 29.2);

        // Judul Form
        doc.setFontSize(12);
        doc.text("PERINTAH KERJA", 213.5, 18, { align: "center" });
        doc.setFontSize(13);
        doc.text("HARIAN ROAD", 213.5, 25, { align: "center" });

        // Logo Promise (Kanan Atas)
        if (logoPromiseObj) {
          const fitPromise = calculateFitDimension(logoPromiseObj, 41, 20, 244, 10);
          if (fitPromise) {
            doc.addImage(fitPromise.base64, 'PNG', fitPromise.x, fitPromise.y, fitPromise.w, fitPromise.h, undefined, 'FAST');
          }
        } else {
          doc.setFontSize(13);
          doc.setTextColor(202, 138, 4);
          doc.text("QPROMISE", 264.5, 18, { align: "center" });
          doc.setTextColor(0, 0, 0);
          doc.setFontSize(6.5);
          doc.setFont("helvetica", "normal");
          doc.text("Production Management System", 264.5, 24, { align: "center" });
        }

        // Sub-Header (DARI, KEPADA, TEMBUSAN)
        doc.line(10, 38, 287, 38);
        doc.line(102, 32, 102, 38);
        doc.line(195, 32, 195, 38);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(0, 0, 0);
        doc.text("DARI :", 13, 36.2);
        doc.text("KEPADA :", 105, 36.2);
        doc.text("TEMBUSAN :", 198, 36.2);

        // Grid 4 Kotak (2x2)
        doc.line(148.5, 38, 148.5, 202);
        doc.line(10, 120, 287, 120);

        const cardPositions = [
          { x: 10, y: 38 },
          { x: 148.5, y: 38 },
          { x: 10, y: 120 },
          { x: 148.5, y: 120 }
        ];

        for (let i = 0; i < CARDS_PER_PAGE; i++) {
          const pos = cardPositions[i];
          const cardW = 138.5;
          const cardH = 82;
          const subX = pos.x + 10;
          const subW = cardW - 10;

          doc.line(pos.x, pos.y + 6, pos.x + cardW, pos.y + 6);
          doc.line(pos.x + 10, pos.y, pos.x + 10, pos.y + cardH);

          doc.line(subX, pos.y + 11, pos.x + cardW, pos.y + 11);
          doc.line(subX, pos.y + 16, pos.x + cardW, pos.y + 16);
          doc.line(subX, pos.y + 21, pos.x + cardW, pos.y + 21);
          doc.line(subX, pos.y + 26, pos.x + cardW, pos.y + 26);
          doc.line(subX + 54, pos.y + 6, subX + 54, pos.y + 16);

          doc.setFont("helvetica", "bold");
          doc.setFontSize(7.5);
          doc.text("NO", pos.x + 5, pos.y + 4.2, { align: "center" });
          doc.text("INSTRUKSI KERJA", subX + (subW / 2), pos.y + 4.2, { align: "center" });

          doc.setFont("helvetica", "normal");
          doc.setFontSize(7);
          doc.text("Jalur", subX + 2, pos.y + 9.5);
          doc.text(":", subX + 18, pos.y + 9.5);

          doc.text("Segmen", subX + 56, pos.y + 9.5);
          doc.text(":", subX + 74, pos.y + 9.5);

          doc.text("Fleet Ex", subX + 2, pos.y + 14.5);
          doc.text(":", subX + 18, pos.y + 14.5);

          doc.text("Kondisi", subX + 56, pos.y + 14.5);
          doc.text(":", subX + 74, pos.y + 14.5);

          doc.text("Alat Support", subX + 2, pos.y + 19.5);
          doc.text(":", subX + 18, pos.y + 19.5);

          doc.text("Note", subX + 2, pos.y + 24.5);
          doc.text(":", subX + 18, pos.y + 24.5);

          const currentCardIdx = (subP * CARDS_PER_PAGE) + i;
          if (currentCardIdx < cardsList.length) {
            const cardData = cardsList[currentCardIdx];

            doc.setFont("helvetica", "bold");
            doc.setFontSize(9);
            doc.text(String(currentCardIdx + 1), pos.x + 5, pos.y + 13, { align: "center" });

            doc.setFontSize(7.2);
            doc.text(cardData.cluster, subX + 20, pos.y + 9.5, { maxWidth: 33 });
            doc.text(cardData.road, subX + 76, pos.y + 9.5, { maxWidth: 50 });
            doc.text(cardData.tools, subX + 20, pos.y + 19.5, { maxWidth: 105 });

            let currentLineY = pos.y + 32;

            cardData.jobs.forEach(jobObj => {
              if (currentLineY > pos.y + cardH - 4) return;

              const statusText = ` [${jobObj.status}]`;
              // Tentukan warna status: OPEN (Merah), PROGRESS (Orange), CLOSED (Hijau)
              let statusRGB = [220, 38, 38]; // Merah default
              if (jobObj.status === 'PROGRESS') statusRGB = [217, 119, 6]; // Orange
              else if (jobObj.status === 'CLOSED') statusRGB = [22, 163, 74]; // Hijau

              // Cetak teks instruksi kerja (Hitam)
              doc.setFont("helvetica", "bold");
              doc.setFontSize(7.5);
              doc.setTextColor(0, 0, 0);

              const maxTextWidth = subW - 6 - doc.getTextWidth(statusText);
              const splitLines = doc.splitTextToSize(jobObj.text, maxTextWidth);

              splitLines.forEach((ln, idx) => {
                if (currentLineY <= pos.y + cardH - 4) {
                  doc.text(ln, subX + 3, currentLineY);

                  // Jika baris terakhir dari job tersebut, tempel label status berwarna di kanannya
                  if (idx === splitLines.length - 1) {
                    const textWidth = doc.getTextWidth(ln);
                    doc.setTextColor(statusRGB[0], statusRGB[1], statusRGB[2]);
                    doc.text(statusText, subX + 3 + textWidth, currentLineY);
                    doc.setTextColor(0, 0, 0); // Kembalikan ke hitam
                  }

                  currentLineY += 4.5;
                }
              });
            });
          }
        }
      }
    });

    doc.save(`Perintah_Kerja_Harian_Road_${sDate}_sd_${eDate}.pdf`);
    alert("Formulir PKH Road (Format Resmi PT SIS) berhasil diekspor!");
  } catch (err) {
    alert("Gagal mengekspor Formulir PKH: " + err.message);
  } finally {
    document.body.style.cursor = originalCursor;
    setSyncStatus('updated');
  }
}

// EKSPOR 2: FORMAT REKAP EVIDENCE & PROGRESS (DOKUMENTASI VISUAL)
async function executeExportRekapEvidence() {
  const startInput = document.getElementById('exportStartDate');
  const endInput = document.getElementById('exportEndDate');
  if (!startInput || !endInput || !startInput.value || !endInput.value) {
    alert("Pilih rentang tanggal rekap evidence!");
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
  setSyncStatus('updating', 'Menyusun katalog foto...');

  try {
    const res = await fetch(`${WEB_APP_URL}?action=EXPORT_REKAP`);
    if (!res.ok) throw new Error("Gagal mengambil data dari cloud backend.");
    const json = await res.json();
    const allData = json.data || [];

    const filtered = allData.filter(wo => {
      const d = parseTimestampToYMD(wo.createdTime);
      return d >= sDate && d <= eDate;
    });

    // Kumpulkan seluruh foto progress
    const evidencePhotosList = [];

    filtered.forEach(wo => {
      if (typeof wo.progressHistory === 'string') {
        try { wo.progressHistory = JSON.parse(wo.progressHistory); } catch (e) { wo.progressHistory = []; }
      }
      if (wo.progressHistory && Array.isArray(wo.progressHistory)) {
        wo.progressHistory.forEach(h => {
          if (h.photoUrls && h.photoUrls.length > 0) {
            h.photoUrls.forEach(url => {
              evidencePhotosList.push({
                url: url,
                road: wo.road,
                cluster: wo.cluster || getGroupedRoadName(wo.road),
                sta: wo.sta,
                status: h.status || wo.status,
                reporter: h.reporter || wo.reporter,
                timestamp: h.timestamp || wo.createdTime,
                jobTarget: h.jobTarget || "Progress",
                notes: h.notes || wo.notes || "-",
                tool: (h.toolType || h.egi) ? `${h.toolType || ''} ${h.egi || ''}`.trim() : ""
              });
            });
          }
        });
      }
    });

    if (evidencePhotosList.length === 0) {
      alert("Tidak ditemukan dokumentasi foto evidence pada rentang tanggal tersebut.");
      document.body.style.cursor = originalCursor;
      setSyncStatus('updated');
      return;
    }

    const doc = new jsPDF('p', 'mm', 'a4'); // Potret A4

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("REKAPITULASI DOKUMENTASI EVIDENCE LAPANGAN", 14, 15);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.text(`Periode: ${sDate} s/d ${eDate} | Total Foto: ${evidencePhotosList.length}`, 14, 21);

    const colWidth = 86;
    const colHeight = 84;
    const marginX = 14;
    const gapX = 10;
    const gapY = 8;
    let startY = 26;

    let currentX = marginX;
    let currentY = startY;

    for (let i = 0; i < evidencePhotosList.length; i++) {
      const item = evidencePhotosList[i];

      if (currentY + colHeight > 280) {
        doc.addPage();
        currentY = 15;
      }

      // Card border
      doc.setDrawColor(200, 200, 200);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(currentX, currentY, colWidth, colHeight, 2, 2, 'FD');

      // Add image
      const base64Img = await fetchImageAsBase64(item.url);
      if (base64Img) {
        try {
          doc.addImage(base64Img, 'JPEG', currentX + 3, currentY + 3, colWidth - 6, 48);
        } catch (e) {
          doc.setFontSize(7);
          doc.text("[ Gagal render foto ]", currentX + 25, currentY + 25);
        }
      }

      // Keterangan foto
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text(`${item.road} (${item.sta})`, currentX + 3, currentY + 56);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.text(`Waktu: ${item.timestamp}`, currentX + 3, currentY + 61);
      doc.text(`Pengawas: ${item.reporter} | Status: [${item.status}]`, currentX + 3, currentY + 65);
      if (item.tool) doc.text(`Unit Alat: ${item.tool}`, currentX + 3, currentY + 69);
      
      const cleanNote = item.notes.length > 55 ? item.notes.substring(0, 52) + '...' : item.notes;
      doc.text(`Catatan: ${cleanNote}`, currentX + 3, currentY + 73, { maxWidth: colWidth - 6 });

      // Grid 2 Kolom
      if (i % 2 === 0) {
        currentX += colWidth + gapX;
      } else {
        currentX = marginX;
        currentY += colHeight + gapY;
      }
    }

    doc.save(`Rekap_Evidence_Foto_${sDate}_sd_${eDate}.pdf`);
    alert("Katalog Rekap Evidence berhasil diekspor!");
  } catch (err) {
    alert("Gagal mengekspor Rekap Evidence: " + err.message);
  } finally {
    document.body.style.cursor = originalCursor;
    setSyncStatus('updated');
  }
}

// ==========================================
// 6C. HELPER WAKTU WITA
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
    return null;
  }
}

// Background Cloud Polling
async function loadCloudWorkOrders() {
  if (!navigator.onLine) {
    setSyncStatus('offline');
    return;
  }

  setSyncStatus('updating', 'Memeriksa update...');

  try {
    const res = await fetch(`${WEB_APP_URL}?action=GET_CLOUD_WO`);
    if (res.ok) {
      const data = await res.json();
      if (data.workOrders && data.workOrders.length > 0) {
        data.workOrders.forEach(wo => {
          // 1. Parse jika jobs atau progressHistory dikirim sebagai string JSON
          if (typeof wo.jobs === 'string') {
            try { wo.jobs = JSON.parse(wo.jobs); } catch (e) { wo.jobs = null; }
          }
          if (typeof wo.progressHistory === 'string') {
            try { wo.progressHistory = JSON.parse(wo.progressHistory); } catch (e) { wo.progressHistory = []; }
          }

          // 2. Normalisasi properti jobs dan fallback ke notes induk
          if (wo.jobs && Array.isArray(wo.jobs) && wo.jobs.length > 0) {
            wo.jobs.forEach(j => {
              j.detail = j.detail || j.notes || j.uraian || j.deskripsi || j.category || '';
            });
            if (!wo.jobs[0].detail && wo.notes) {
              wo.jobs[0].detail = wo.notes;
            }
          } else if (wo.notes) {
            wo.jobs = [{ toolType: wo.toolType || "", customTool: "", egi: wo.egi || "", detail: wo.notes, status: wo.status || "OPEN" }];
          }

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
    if (!navigator.onLine) setSyncStatus('offline');
    else setSyncStatus('updated');
  }
}

// ==========================================
// 7. SILENT GPS TRACKER (SMOOTH & RESPONSIVE)
// ==========================================
let lastSentRadarLatLng = null;

function startSilentGpsTracking() {
  if (!navigator.geolocation) return;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = pos.coords.accuracy;

      if (accuracy > 30) {
        console.warn("Akurasi sinyal rendah (" + Math.round(accuracy) + "m), update posisi ditahan.");
        return;
      }

      const latlng = [lat, lng];
      currentUserLatLng = latlng;

      // JIKA RADAR SEDANG AKTIF: Gerakkan blip pink seketika mengikuti langkah kaki!
      if (isRadarActive) {
        updateSelfRadarBlip(latlng);
        if (userMarker && map.hasLayer(userMarker)) map.removeLayer(userMarker);
        if (userAccuracyCircle && map.hasLayer(userAccuracyCircle)) map.removeLayer(userAccuracyCircle);
      } else {
        // JIKA RADAR OFF: Tampilkan titik biru biasa
        if (!userMarker) {
          userAccuracyCircle = L.circle(latlng, { radius: accuracy, color: '#0078d4', fillColor: '#2b88d8', fillOpacity: 0.15, weight: 1 }).addTo(map);
          userMarker = L.circleMarker(latlng, { radius: 9, color: '#ffffff', fillColor: '#0078d4', fillOpacity: 1, weight: 3 }).addTo(map);
        } else {
          if (!map.hasLayer(userMarker)) userMarker.addTo(map);
          if (!map.hasLayer(userAccuracyCircle)) userAccuracyCircle.addTo(map);
          userMarker.setLatLng(latlng);
          userAccuracyCircle.setLatLng(latlng);
          userAccuracyCircle.setRadius(accuracy);
        }
      }

      // Siarkan posisi ke Supabase jika berpindah minimal 2.5 meter
      let shouldBroadcast = false;
      const currentPoint = L.latLng(lat, lng);

      if (!lastSentRadarLatLng) {
        shouldBroadcast = true;
        lastSentRadarLatLng = currentPoint;
      } else {
        const distanceMoved = lastSentRadarLatLng.distanceTo(currentPoint);
        if (distanceMoved >= 2.5) {
          shouldBroadcast = true;
          lastSentRadarLatLng = currentPoint;
        }
      }

      if (shouldBroadcast && realtimeChannel && currentNRP) {
        realtimeChannel.track({
          user: currentNRP,
          role: currentUserRole,
          latlng: { lat: lat, lng: lng },
          online_at: new Date().toISOString()
        });
      }
    },
    (err) => { console.warn(`GPS Silent Error: ${err.message}`); },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
  );
}

function locateUser() {
  const gpsBtn = document.querySelector('.gps-btn');
  if (gpsBtn) {
    gpsBtn.style.transform = 'scale(0.88)';
    gpsBtn.style.background = '#00f0ff';
    gpsBtn.style.color = '#000000';
    setTimeout(() => {
      gpsBtn.style.transform = '';
      gpsBtn.style.background = '#0f172a';
      gpsBtn.style.color = '#38bdf8';
    }, 280);
  }

  if (currentUserLatLng) {
    map.flyTo(currentUserLatLng, 17, { duration: 1 });
    catatLogKeServer("LOCATE ME", "Pengawas re-center peta ke posisi aktual.");
  } else if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const latlng = [pos.coords.latitude, pos.coords.longitude];
        currentUserLatLng = latlng;
        map.flyTo(latlng, 17, { duration: 1 });
        catatLogKeServer("LOCATE ME", "Pengawas re-center peta.");
      },
      (err) => { alert("Sinyal GPS belum terkunci di HP lu: " + err.message); },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }
}

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
  startSilentGpsTracking();

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
// TAMPILKAN PORTAL 2 KOTAK (ROAD vs BLASTMAP) DI AWAL
openModulePortal();
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
  } else {
    esriSatellite.addTo(map);
    if (orthoLayer) {
      orthoLayer.setZIndex(10);
      if (typeof orthoLayer.bringToFront === 'function') orthoLayer.bringToFront();
    }
    btn.innerHTML = '🌍 Satelit: <b>ON</b>';
    btn.style.color = '#38bdf8';
    btn.style.borderColor = '#1e293b';
    isBasemapActive = true;
  }
}

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
    // KHUSUS PARAMETER GRADE:
    if (currentParam === 'grade') {
      const minM = Math.min(selectedStartMeter, selectedEndMeter);
      const maxM = Math.max(selectedStartMeter, selectedEndMeter);
      
      // Jika mode 1 kotak (bukan rentang panjang), HANYA nyalakan 1 kotak yang diklik
      if (!isGradeRangeActive) {
        return meterVal === maxM;
      }
      // Jika mode rentang (klik A ke B), nyalakan seluruh kotak di dalam rentang
      return meterVal > minM && meterVal <= maxM;
    }

    // PARAMETER LAIN (LEBAR & CROSSFALL)
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

  // 1. KOTAK AKTIF TERPILIH: Nyala Cyan Terang
  if (isMeterSelected(meterVal, roadVal)) {
    return { 
      color: "#00f0ff", 
      weight: 3.5, 
      fillColor: "#00f0ff", 
      fillOpacity: 0.95 
    };
  }

  // 2. STATUS GRADE (Bisa baca dari teks status atau angka persen langsung)
  let statusGrade = (props.Status_Gra || props["Status Grade"] || props.Status || "").toString().toUpperCase();
  const rawGrade = parseFloat(props.Grade_Pct || props["Grade Longitudinal (%)"] || props.Grade || 0);
  const absGrade = Math.abs(rawGrade);

  let fillColor = "#22c55e"; // Hijau (Ongrade < 8%)
  if (statusGrade.includes("OVERGRADE") || statusGrade.includes("NON COMPLIANT") || absGrade >= 9.0) {
    fillColor = "#e11d48";   // Merah (Overgrade >= 9%)
  } else if (statusGrade.includes("WARNING") || absGrade >= 8.0) {
    fillColor = "#eab308";   // Kuning (Warning 8% - 8.9%)
  }

  return { 
    color: "#0f172a",        // GARIS SEKAT FISIK STA: Garis gelap tegas pemisah antar-patok STA!
    weight: 1.8,             // Ketebalan garis batas
    fillColor: fillColor,    // Warna status kemiringan
    fillOpacity: 0.88 
  };
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

function createCrossfallAbMarker(latlng, letter) {
  return L.marker(latlng, {
    icon: L.divIcon({
      className: 'crossfall-ab-marker',
      html: `<div style="background:#e11d48; color:#ffffff; font-weight:900; font-family:monospace; font-size:13px; width:22px; height:22px; border-radius:50%; border:2px solid #ffffff; box-shadow:0 0 10px rgba(225, 29, 72, 0.9); display:flex; align-items:center; justify-content:center;">${letter}</div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    }),
    interactive: false,
    zIndexOffset: 2500
  });
}

// ==========================================
// 7C. CROSSFALL SPLIT LAYER & PANAH ALIRAN PRESISI (FOTO 1 OPTIMIZED)
// ==========================================
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

function renderCrossfallSplitLayer() {
  crossfallVisualLayer.clearLayers();
  if (currentMainTab !== 'parameter' || currentParam !== 'crossfall') return;

  const currentZoom = map ? map.getZoom() : 15;
  if (currentZoom < 14) return;

  const baseWeight = currentZoom >= 18 ? 5.5 : (currentZoom >= 16 ? 4 : 3);
  const bounds = map.getBounds().pad(0.1);

  const cleanRoadName = (r) => (r || '').toLowerCase().replace(/^jl\.?\s*/i, '').trim();

  rawWidthFeatures.forEach(feature => {
    const coords = feature.geometry ? feature.geometry.coordinates : null;
    if (!coords || coords.length < 2) return;

    let lineCoords = coords;
    if (feature.geometry.type === 'MultiLineString') {
      lineCoords = coords[0];
    }
    if (!lineCoords || lineCoords.length < 2) return;

    const pt1 = L.latLng(lineCoords[0][1], lineCoords[0][0]);
    const pt2 = L.latLng(lineCoords[lineCoords.length - 1][1], lineCoords[lineCoords.length - 1][0]);

    const props = feature.properties || {};
    const rawSta = props.Station_m !== undefined ? props.Station_m : (props.Station || props.STA || 0);
    const meterVal = parseMeterSTA(rawSta);
    const roadVal = (props.Nama_Jalan || props["Nama Jalan"] || activeRoad).trim();
    const isSelected = isMeterSelected(meterVal, roadVal);

    if (!isSelected && !bounds.contains(pt1) && !bounds.contains(pt2)) return;

    const mid = L.latLng((pt1.lat + pt2.lat) / 2, (pt1.lng + pt2.lng) / 2);

    const row = monitoringData.find(d => cleanRoadName(d["Nama Jalan"]) === cleanRoadName(roadVal) && Math.abs(parseMeterSTA(d["STA"]) - meterVal) <= 1);
    const cfL = row ? Math.abs(parseFloat(row["Crossfall Kiri (%)"]) || 0) : 0;
    const cfR = row ? Math.abs(parseFloat(row["Crossfall Kanan (%)"]) || 0) : 0;

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

    if (isSelected) {
      const markerA = createCrossfallAbMarker(pt1, 'A');
      const markerB = createCrossfallAbMarker(pt2, 'B');
      crossfallVisualLayer.addLayer(markerA);
      crossfallVisualLayer.addLayer(markerB);
    }

    // PANAH ALIRAN PERSIS FOTO 1: HANYA MUNCUL DI ZOOM INSPEKSI (>=16) ATAU SAAT STA DIKLIK
    if (currentZoom >= 16 || isSelected) {
      const keyTarget = `${roadVal}_${formatKeSTA(meterVal)}`;
      let pts = crossSectionData.filter(d => (d["Key"] || "").trim() === keyTarget);
      if (pts.length < 3) {
        pts = crossSectionData.filter(d => cleanRoadName(d["Nama Jalan"]) === cleanRoadName(roadVal) && Math.abs(parseMeterSTA(d["STA"]) - meterVal) <= 1);
      }

      let elevAs = null, elevLeft = null, elevRight = null;
      if (pts.length >= 3) {
        const ptLeftData = pts.find(p => p["Point"] && p["Point"].includes("Kiri")) || pts[0];
        const ptAsData = pts.find(p => p["Point"] && p["Point"].includes("As")) || pts[1];
        const ptRightData = pts.find(p => p["Point"] && p["Point"].includes("Kanan")) || pts[2];
        elevLeft = parseFloat(ptLeftData["Elevasi_RL"]);
        elevAs = parseFloat(ptAsData["Elevasi_RL"]);
        elevRight = parseFloat(ptRightData["Elevasi_RL"]);
      } else if (row) {
        elevAs = parseFloat(row["Elevasi As (m)"] || 100);
        elevLeft = elevAs - 0.2;
        elevRight = elevAs - 0.2;
      }

      if (elevAs !== null) {
        // Sisi Kiri (As vs A): Aliran dari elevasi tinggi ke rendah
        const arrowLeftPos = L.latLng((mid.lat + pt1.lat) / 2, (mid.lng + pt1.lng) / 2);
        if (bounds.contains(arrowLeftPos)) {
          const fromLeft = (elevAs >= elevLeft) ? mid : pt1;
          const toLeft = (elevAs >= elevLeft) ? pt1 : mid;
          crossfallVisualLayer.addLayer(createCrossfallArrowMarker(arrowLeftPos, fromLeft, toLeft, colorLeft));
        }

        // Sisi Kanan (As vs B): Aliran dari elevasi tinggi ke rendah
        const arrowRightPos = L.latLng((mid.lat + pt2.lat) / 2, (mid.lng + pt2.lng) / 2);
        if (bounds.contains(arrowRightPos)) {
          const fromRight = (elevAs >= elevRight) ? mid : pt2;
          const toRight = (elevAs >= elevRight) ? pt2 : mid;
          crossfallVisualLayer.addLayer(createCrossfallArrowMarker(arrowRightPos, fromRight, toRight, colorRight));
        }
      }
    }
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
  isGradeRangeActive = false; // <-- TAMBAHKAN INI
  refreshVisibleLayers();
  renderTabContent();
}

function refreshVisibleLayers() {
  if (currentAppMode === 'blastmap') return;
  if (currentMainTab === 'map') {
    if (roadGradeLayer && map.hasLayer(roadGradeLayer)) map.removeLayer(roadGradeLayer);
    if (roadWidthLayer && map.hasLayer(roadWidthLayer)) map.removeLayer(roadWidthLayer);
    if (crossfallVisualLayer && map.hasLayer(crossfallVisualLayer)) map.removeLayer(crossfallVisualLayer);

    if (roadMapLayer && !map.hasLayer(roadMapLayer)) roadMapLayer.addTo(map);
    if (roadNonSaranaLayer && !map.hasLayer(roadNonSaranaLayer)) roadNonSaranaLayer.addTo(map);
    
    if (roadMapLayer) roadMapLayer.bringToFront();
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
    if (currentParam === 'grade') {
      if (selectedStartMeter === null || isGradeRangeActive) {
        // KLIK PERTAMA: Pilih 1 kotak tunggal (bentang 20 meter)
        selectedEndMeter = meterVal;
        selectedStartMeter = Math.max(0, meterVal - 20);
        isGradeRangeActive = false;
      } else {
        // KLIK KEDUA: Klik kotak lain -> Kunci rentang dari Kotak A ke Kotak B!
        if (meterVal === selectedEndMeter) return;

        const box1Start = selectedStartMeter;
        const box1End = selectedEndMeter;
        const box2Start = Math.max(0, meterVal - 20);
        const box2End = meterVal;

        // Ambil batas meter terluar (bisa klik maju maupun mundur)
        selectedStartMeter = Math.min(box1Start, box2Start);
        selectedEndMeter = Math.max(box1End, box2End);
        isGradeRangeActive = true;
      }
      
      refreshVisibleLayers();
      renderGradeSummary();
    } else if (currentParam === 'lebar') {
      if (selectedStartMeter === null || (selectedStartMeter !== null && selectedEndMeter !== null)) {
        selectedStartMeter = meterVal;
        selectedEndMeter = null;
      } else {
        selectedEndMeter = meterVal;
      }
      refreshVisibleLayers();
      renderLebarSummary();
   } else if (currentParam === 'crossfall') {
      selectedStartMeter = meterVal;
      selectedEndMeter = null;
      selectedRoadTarget = activeRoad;
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
  // Load Poligon Cluster GeoJSON jika tersedia
  try {
    const resCluster = await fetch('data/clusters.geojson');
    if (resCluster.ok) {
      const geojsonClusters = await resCluster.json();
      clusterFeatures = geojsonClusters.features || [];
      console.log(`Loaded ${clusterFeatures.length} Cluster Polygons.`);
    }
  } catch (e) {
    console.warn("Layer clusters.geojson standby.");
  }

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
          
          // 1. Ambil STA Akhir & Hitung STA Awal Segmen
          const endM = parseMeterSTA(props.STA_Akhir || props.STA || props.Station_m || 0);
          const startM = Math.max(0, endM - 20);
          const road = props.Nama_Jalan || props["Nama Jalan"] || activeRoad;
          
          // 2. Format Grade Jadi Positif Absolut
          let gVal = "-";
          if (props.Grade_Pct !== undefined && props.Grade_Pct !== null && props.Grade_Pct !== "") {
            const parsedG = parseFloat(props.Grade_Pct);
            if (!isNaN(parsedG)) gVal = Math.abs(parsedG).toFixed(2) + "%";
          } else if (props.Label_Grad) {
            const numOnly = parseFloat(props.Label_Grad.toString().replace(/[^0-9.-]/g, ''));
            gVal = !isNaN(numOnly) ? Math.abs(numOnly).toFixed(2) + "%" : props.Label_Grad.toString().trim();
          }

          // 3. Tooltip Tampilkan Rentang Segmen 20m (misal: 0+000 s/d 0+020)
          layer.bindTooltip(`<b>${road}</b><br>Segmen: <b>${formatKeSTA(startM)} s/d ${formatKeSTA(endM)}</b><br>Grade: <b>${gVal}</b>`, { sticky: true });

          const center = layer.getBounds().getCenter();
          const angle = calculatePolygonAngle(layer);

          const staMarker = L.marker(center, {
            icon: L.divIcon({
              className: 'sta-rotated-label',
              html: `<span class="sta-text-box" style="transform: rotate(${angle}deg);">${formatKeSTA(endM)}</span>`,
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
        style: { color: "#ef4444", weight: 7.5, opacity: 0.9, lineCap: "round" },
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

function renderGradeSummary() {
  const panelBody = document.getElementById('panel-body');
  const panelTitle = document.getElementById('panel-title');
  if (!panelBody || !panelTitle) return;

  const roadSelectHtml = `
    <div style="display:flex; align-items:center; gap:6px;">
      <select onchange="changeRoad(this.value)" style="font-size:12px; font-weight:bold; padding:4px 8px; border-radius:6px; background:#f1f5f9; border:1px solid #cbd5e1; color:#0f172a; outline:none; cursor:pointer;">
        ${roadNames.map(r => `<option value="${r}" ${r.toLowerCase() === activeRoad.toLowerCase() ? 'selected' : ''}>${r}</option>`).join('')}
      </select>
      <button type="button" onclick="openRoadSummaryModal()" style="background:#0284c7; color:#ffffff; border:none; padding:4px 9px; border-radius:6px; font-size:10px; font-weight:bold; cursor:pointer; display:flex; align-items:center; gap:4px; box-shadow:0 1px 3px rgba(0,0,0,0.2);">
        📊 Summary
      </button>
    </div>
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
    <div style="display:flex; align-items:center; gap:6px;">
      <select onchange="changeRoad(this.value)" style="font-size:12px; font-weight:bold; padding:4px 8px; border-radius:6px; background:#f1f5f9; border:1px solid #cbd5e1; color:#0f172a; outline:none; cursor:pointer;">
        ${roadNames.map(r => `<option value="${r}" ${r.toLowerCase() === activeRoad.toLowerCase() ? 'selected' : ''}>${r}</option>`).join('')}
      </select>
      <button type="button" onclick="openRoadSummaryModal()" style="background:#0284c7; color:#ffffff; border:none; padding:4px 9px; border-radius:6px; font-size:10px; font-weight:bold; cursor:pointer; display:flex; align-items:center; gap:4px; box-shadow:0 1px 3px rgba(0,0,0,0.2);">
        📊 Summary
      </button>
    </div>
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

      let kelasJalan = pStart.Kelas_Jala || (lebarStandarNum <= 25 ? "Class 100" : "Class 200");
      let payloadTon = pStart.Payload || (lebarStandarNum <= 25 ? "100" : "200");

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

function onCrossSectionStaChange(staVal) {
  const meterVal = parseMeterSTA(staVal);
  selectedStartMeter = meterVal;
  selectedEndMeter = null;
  selectedRoadTarget = activeRoad;
  refreshVisibleLayers();
  drawCrossSectionChart(staVal);
  catatLogKeServer('VIEW_STA', 'Melihat Cross Section ' + activeRoad + ' STA ' + staVal);
}

function renderTabContent() {
  if (currentAppMode === 'blastmap') return;
  if (currentMainTab === 'map') {
    renderMapOverviewSummary();
    return;
  }

  const panelBody = document.getElementById('panel-body');
  const panelTitle = document.getElementById('panel-title');
  if (!panelBody || !panelTitle) return;

  const roadData = monitoringData.filter(d => (d["Nama Jalan"] || "").trim().toLowerCase() === activeRoad.toLowerCase());

  const roadSelectHtml = `
    <div style="display:flex; align-items:center; gap:6px;">
      <select onchange="changeRoad(this.value)" style="font-size:12px; font-weight:bold; padding:4px 8px; border-radius:6px; background:#f1f5f9; border:1px solid #cbd5e1; color:#0f172a; outline:none; cursor:pointer;">
        ${roadNames.map(r => `<option value="${r}" ${r.toLowerCase() === activeRoad.toLowerCase() ? 'selected' : ''}>${r}</option>`).join('')}
      </select>
      <button type="button" onclick="openRoadSummaryModal()" style="background:#0284c7; color:#ffffff; border:none; padding:4px 9px; border-radius:6px; font-size:10px; font-weight:bold; cursor:pointer; display:flex; align-items:center; gap:4px; box-shadow:0 1px 3px rgba(0,0,0,0.2);">
        📊 Summary
      </button>
    </div>
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
        <select id="select-sta-cs" onchange="onCrossSectionStaChange(this.value);" style="font-size:11px; padding:2px 6px;">
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
    { x: offsetLeft, y: parseFloat(ptLeft["Elevasi_RL"]), label: `[A] Tepi Kiri (${offsetLeft.toFixed(1)}m)` },
    { x: 0, y: elevAs, label: `As Jalan (0.0m)` },
    { x: offsetRight, y: parseFloat(ptRight["Elevasi_RL"]), label: `[B] Tepi Kanan (+${offsetRight.toFixed(1)}m)` }
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
            if (idx === 0) { const val = parseFloat(cfL); return (val < 2.0 || val > 4.0) ? '#e11d48' : '#1f4e79'; }
            if (idx === 2) { const val = parseFloat(cfR); return (val < 2.0 || val > 4.0) ? '#e11d48' : '#1f4e79'; }
            return '#1f4e79';
          },
          formatter: function(value, context) {
            const idx = context.dataIndex;
            if (idx === 0) return ['[ A ]', `Kemiringan: ${cfL}%`];
            if (idx === 1) return [`Elevasi: ${elevAs.toFixed(2)}m`];
            if (idx === 2) return ['[ B ]', `Kemiringan: ${cfR}%`];
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
// ==========================================
// 7A-2. AUDIT SUMMARY METRICS & EXECUTIVE MODAL
// ==========================================
function calculateRoadAuditMetrics(roadName) {
  const target = (roadName || activeRoad).trim().toLowerCase();
  const roadRows = monitoringData.filter(d => (d["Nama Jalan"] || "").trim().toLowerCase() === target);
  
  if (roadRows.length === 0) return null;

  // Urutkan berdasarkan STA
  roadRows.sort((a, b) => parseMeterSTA(a["STA"]) - parseMeterSTA(b["STA"]));

  const minMeter = parseMeterSTA(roadRows[0]["STA"]);
  const maxMeter = parseMeterSTA(roadRows[roadRows.length - 1]["STA"]);
  const totalLength = Math.max(0, maxMeter - minMeter) || (roadRows.length * 20);
  const stepPerSlice = totalLength / Math.max(1, roadRows.length);

  const stdLebar = getActiveRoadStandardWidth(roadName);
  const payloadClass = stdLebar <= 25 ? "Class 100 Ton" : (stdLebar <= 30 ? "Class 150 Ton" : "Class 200 Ton");

  // 1. Metrik Grade Longitudinal
  let flatCount = 0, slopeCount = 0;
  let ongradeCount = 0, warningCount = 0, overgradeCount = 0;
  let maxGradeVal = 0;
  const gradeVals = [];

  roadRows.forEach(r => {
    const g = Math.abs(parseFloat(r["Grade Longitudinal (%)"]) || 0);
    gradeVals.push(g);
    if (g > maxGradeVal) maxGradeVal = g;

    if (g < 2.0) flatCount++;
    else slopeCount++;

    if (g < 7.9) ongradeCount++;
    else if (g <= 8.9) warningCount++;
    else overgradeCount++;
  });

  const avgGrade = gradeVals.length ? (gradeVals.reduce((a, b) => a + b, 0) / gradeVals.length).toFixed(1) : "0.0";

  // 2. Metrik Lebar Jalan
  const stdWidths = [], nonStdWidths = [];
  roadRows.forEach(r => {
    const w = parseFloat(r["Lebar Total (m)"] || 0);
    if (w >= stdLebar) stdWidths.push(w);
    else if (w > 0) nonStdWidths.push(w);
  });

  const calcStats = (arr) => {
    if (!arr.length) return { min: 0, max: 0, avg: 0 };
    const min = Math.min(...arr).toFixed(1);
    const max = Math.max(...arr).toFixed(1);
    const avg = (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1);
    return { min, max, avg };
  };

  const stdWidthStats = calcStats(stdWidths);
  const nonStdWidthStats = calcStats(nonStdWidths);

  // 3. Metrik Crossfall (Kiri & Kanan dimasukkan ke pool evaluasi)
  const normCf = [], underCf = [], overCf = [];
  roadRows.forEach(r => {
    const cfL = Math.abs(parseFloat(r["Crossfall Kiri (%)"]) || 0);
    const cfR = Math.abs(parseFloat(r["Crossfall Kanan (%)"]) || 0);

    [cfL, cfR].forEach(cf => {
      if (cf >= 2.0 && cf <= 4.0) normCf.push(cf);
      else if (cf < 2.0) underCf.push(cf);
      else overCf.push(cf);
    });
  });

  const normCfStats = calcStats(normCf);
  const underCfStats = calcStats(underCf);
  const overCfStats = calcStats(overCf);

  const totalCfSamples = normCf.length + underCf.length + overCf.length || 1;
  const cfNormLen = Math.round((normCf.length / totalCfSamples) * totalLength);
  const cfUnderLen = Math.round((underCf.length / totalCfSamples) * totalLength);
  const cfOverLen = Math.round((overCf.length / totalCfSamples) * totalLength);

  // Overall Road Compliance Index (Rata-rata kepatuhan grade, lebar, crossfall)
  const gradeComp = (ongradeCount / roadRows.length) * 100;
  const widthComp = (stdWidths.length / roadRows.length) * 100;
  const cfComp = (normCf.length / totalCfSamples) * 100;
  const overallScore = Math.round((gradeComp + widthComp + cfComp) / 3);

  return {
    roadName,
    payloadClass,
    totalLength,
    flatLength: Math.round(flatCount * stepPerSlice),
    slopeLength: Math.round(slopeCount * stepPerSlice),
    grade: {
      ongradeM: Math.round(ongradeCount * stepPerSlice),
      warningM: Math.round(warningCount * stepPerSlice),
      overgradeM: Math.round(overgradeCount * stepPerSlice),
      ongradePct: Math.round((ongradeCount / roadRows.length) * 100),
      warningPct: Math.round((warningCount / roadRows.length) * 100),
      overgradePct: Math.round((overgradeCount / roadRows.length) * 100),
      avg: avgGrade,
      max: maxGradeVal.toFixed(1)
    },
    width: {
      stdM: Math.round(stdWidths.length * stepPerSlice),
      nonStdM: Math.round(nonStdWidths.length * stepPerSlice),
      stdPct: Math.round((stdWidths.length / roadRows.length) * 100),
      nonStdPct: Math.round((nonStdWidths.length / roadRows.length) * 100),
      standardVal: stdLebar,
      stdStats: stdWidthStats,
      nonStdStats: nonStdWidthStats
    },
    crossfall: {
      normM: cfNormLen,
      underM: cfUnderLen,
      overM: cfOverLen,
      normPct: Math.round((normCf.length / totalCfSamples) * 100),
      underPct: Math.round((underCf.length / totalCfSamples) * 100),
      overPct: Math.round((overCf.length / totalCfSamples) * 100),
      normStats: normCfStats,
      underStats: underCfStats,
      overStats: overCfStats
    },
    overallScore
  };
}

function openRoadSummaryModal() {
  const metrics = calculateRoadAuditMetrics(activeRoad);
  if (!metrics) {
    alert("Data audit untuk ruas " + activeRoad + " belum termuat.");
    return;
  }

  let modal = document.getElementById('roadSummaryModalOverlay');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'roadSummaryModalOverlay';
    modal.style.cssText = `
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(10, 15, 29, 0.82); backdrop-filter: blur(6px);
      display: flex; align-items: center; justify-content: center; padding: 12px;
    `;
    document.body.appendChild(modal);
  }

  const scoreColor = metrics.overallScore >= 85 ? '#22c55e' : (metrics.overallScore >= 70 ? '#eab308' : '#e11d48');

  modal.innerHTML = `
    <div style="background: #0f172a; border: 1px solid #334155; border-radius: 12px; width: 100%; max-width: 680px; max-height: 90vh; overflow-y: auto; color: #f8fafc; font-family: sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,0.8);">
      
      <!-- Header -->
      <div style="padding: 12px 16px; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; background: #0f172a; z-index: 10;">
        <div>
          <div style="font-size: 15px; font-weight: 900; color: #00f0ff; letter-spacing: 0.5px;">SUMMARY PARAMETERS</div>
          <div style="font-size: 11px; color: #94a3b8; font-family: monospace;">${metrics.roadName.toUpperCase()} • ${metrics.payloadClass}</div>
        </div>
        <button onclick="closeRoadSummaryModal()" style="background: #1e293b; color: #cbd5e1; border: none; font-size: 14px; font-weight: bold; width: 28px; height: 28px; border-radius: 50%; cursor: pointer;">✕</button>
      </div>

      <div style="padding: 14px 16px; display: flex; flex-direction: column; gap: 12px;">
        
        <!-- Score & Overview Card -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px;">
          <div style="background: #1e293b; padding: 10px; border-radius: 8px; border-left: 4px solid ${scoreColor};">
            <div style="font-size: 9px; color: #94a3b8;">Tingkat Kepatuhan Ruas</div>
            <div style="font-size: 20px; font-weight: 900; color: ${scoreColor};">${metrics.overallScore}%</div>
            <div style="font-size: 9px; color: #cbd5e1;">Standar Operasional</div>
          </div>
          <div style="background: #1e293b; padding: 10px; border-radius: 8px; border-left: 4px solid #38bdf8;">
            <div style="font-size: 9px; color: #94a3b8;">Total Panjang</div>
            <div style="font-size: 18px; font-weight: 900; color: #f8fafc;">${metrics.totalLength} m</div>
            <div style="font-size: 9px; color: #cbd5e1;">Flat: ${metrics.flatLength}m | Tanjakan/Turunan: ${metrics.slopeLength}m</div>
          </div>
        </div>

        <!-- 1. PARAMETER GRADE -->
        <div style="background: #1e293b; padding: 12px; border-radius: 8px; border: 1px solid #334155;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 11px; font-weight: bold; color: #facc15;">1. GRADE</span>
            <span style="font-size: 10px; color: #cbd5e1; font-family: monospace;">Avg: ${metrics.grade.avg}% | Max: <b style="color:#ef4444;">${metrics.grade.max}%</b></span>
          </div>
          <!-- Stacked Bar -->
          <div style="height: 10px; width: 100%; display: flex; border-radius: 5px; overflow: hidden; background: #0f172a; margin-bottom: 8px;">
            <div style="width: ${metrics.grade.ongradePct}%; background: #22c55e;" title="Ongrade: ${metrics.grade.ongradeM}m"></div>
            <div style="width: ${metrics.grade.warningPct}%; background: #eab308;" title="Warning: ${metrics.grade.warningM}m"></div>
            <div style="width: ${metrics.grade.overgradePct}%; background: #e11d48;" title="Overgrade: ${metrics.grade.overgradeM}m"></div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; font-size: 10px;">
            <div style="color: #22c55e;">• Ongrade: <b>${metrics.grade.ongradeM}m</b> (${metrics.grade.ongradePct}%)</div>
            <div style="color: #eab308;">• Warning: <b>${metrics.grade.warningM}m</b> (${metrics.grade.warningPct}%)</div>
            <div style="color: #e11d48;">• Overgrade: <b>${metrics.grade.overgradeM}m</b> (${metrics.grade.overgradePct}%)</div>
          </div>
        </div>

        <!-- 2. PARAMETER LEBAR JALAN -->
        <div style="background: #1e293b; padding: 12px; border-radius: 8px; border: 1px solid #334155;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 11px; font-weight: bold; color: #38bdf8;">2. LEBAR JALAN</span>
            <span style="font-size: 10px; color: #cbd5e1; font-family: monospace;">Std Desain: <b>${metrics.width.standardVal} m</b></span>
          </div>
          <!-- Stacked Bar -->
          <div style="height: 10px; width: 100%; display: flex; border-radius: 5px; overflow: hidden; background: #0f172a; margin-bottom: 8px;">
            <div style="width: ${metrics.width.stdPct}%; background: #22c55e;" title="Standar: ${metrics.width.stdM}m"></div>
            <div style="width: ${metrics.width.nonStdPct}%; background: #e11d48;" title="Sempit: ${metrics.width.nonStdM}m"></div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px; font-size: 10px;">
            <div style="color: #22c55e;">
              • Standar (≥${metrics.width.standardVal}m): <b>${metrics.width.stdM}m</b> (${metrics.width.stdPct}%) — <span style="color:#94a3b8;">Min: ${metrics.width.stdStats.min}m, Max: ${metrics.width.stdStats.max}m, Avg: ${metrics.width.stdStats.avg}m</span>
            </div>
            <div style="color: #e11d48;">
              • Sempit (&lt;${metrics.width.standardVal}m): <b>${metrics.width.nonStdM}m</b> (${metrics.width.nonStdPct}%) — <span style="color:#fca5a5;">Min: <b>${metrics.width.nonStdStats.min}m</b>, Max: ${metrics.width.nonStdStats.max}m, Avg: ${metrics.width.nonStdStats.avg}m</span>
            </div>
          </div>
        </div>

        <!-- 3. PARAMETER CROSSFALL -->
        <div style="background: #1e293b; padding: 12px; border-radius: 8px; border: 1px solid #334155;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 11px; font-weight: bold; color: #ec4899;">3. CROSSFALL</span>
            <span style="font-size: 10px; color: #cbd5e1; font-family: monospace;">Standar: <b>2.0% - 4.0%</b></span>
          </div>
          <!-- Stacked Bar -->
          <div style="height: 10px; width: 100%; display: flex; border-radius: 5px; overflow: hidden; background: #0f172a; margin-bottom: 8px;">
            <div style="width: ${metrics.crossfall.normPct}%; background: #22c55e;" title="Normal: ${metrics.crossfall.normM}m"></div>
            <div style="width: ${metrics.crossfall.underPct}%; background: #38bdf8;" title="Datar: ${metrics.crossfall.underM}m"></div>
            <div style="width: ${metrics.crossfall.overPct}%; background: #e11d48;" title="Miring: ${metrics.crossfall.overM}m"></div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px; font-size: 10px;">
            <div style="color: #22c55e;">
              • Normal (2.0 - 4.0%): <b>${metrics.crossfall.normM}m</b> (${metrics.crossfall.normPct}%) — <span style="color:#94a3b8;">Avg: ${metrics.crossfall.normStats.avg}%</span>
            </div>
            <div style="color: #38bdf8;">
              • Datar (&lt;2.0%): <b>${metrics.crossfall.underM}m</b> (${metrics.crossfall.underPct}%) — <span style="color:#bae6fd;">Min: <b>${metrics.crossfall.underStats.min}%</b>, Avg: ${metrics.crossfall.underStats.avg}% (Risiko Genangan)</span>
            </div>
            <div style="color: #e11d48;">
              • Miring (&gt;4.0%): <b>${metrics.crossfall.overM}m</b> (${metrics.crossfall.overPct}%) — <span style="color:#fecdd3;">Max: <b>${metrics.crossfall.overStats.max}%</b>, Avg: ${metrics.crossfall.overStats.avg}% (Risiko Rollover)</span>
            </div>
          </div>
        </div>

      </div>

      <!-- Footer Action -->
      <div style="padding: 10px 16px; border-top: 1px solid #1e293b; display: flex; justify-content: flex-end;">
        <button onclick="closeRoadSummaryModal()" style="background: #334155; color: #fff; border: none; padding: 6px 14px; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer;">Tutup</button>
      </div>

    </div>
  `;

  modal.style.display = 'flex';
}

function closeRoadSummaryModal() {
  const modal = document.getElementById('roadSummaryModalOverlay');
  if (modal) modal.style.display = 'none';
}
// ==========================================
// 7B. BOTTOM PANEL: SLIDE & TOUCH DRAG
// ==========================================
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

// ==========================================
// 8. MODUL GEOTAGGING KAMERA & WATERMARK
// ==========================================
let currentCapturedMetadata = null;
let currentWatermarkedBase64 = null;
let currentPendingPhotoFile = null;
let currentRawImageElement = null;

function generatePhotoId() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Makassar" }));
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `OW-${yy}${mm}${dd}-${rand}`;
}

function isPointInPolygon(point, vs) {
  const x = point.lng, y = point.lat;
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i].lng, yi = vs[i].lat;
    const xj = vs[j].lng, yj = vs[j].lat;
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function findNearestActiveWo(latlng, maxMeterDist = 60) {
  let matchedWo = null;
  let minDist = Infinity;
  const targetLatLng = L.latLng(latlng.lat, latlng.lng);

  Object.values(allWorkOrders).forEach(wo => {
    const st = (wo.status || 'OPEN').toUpperCase();
    if (st === 'CLOSED') return;

    if (wo.linkedLineId && allDrawLines[wo.linkedLineId]) {
      const line = allDrawLines[wo.linkedLineId];
      if (line.points && line.points.length >= 3) {
        if (isPointInPolygon(latlng, line.points)) {
          matchedWo = wo;
          minDist = 0;
          return;
        }
      }
      if (line.points) {
        for (let i = 0; i < line.points.length; i++) {
          const d = targetLatLng.distanceTo(line.points[i]);
          if (d < minDist) {
            minDist = d;
            if (d <= maxMeterDist) matchedWo = wo;
          }
        }
      }
    }

    if (wo.latlng) {
      const d = targetLatLng.distanceTo(wo.latlng);
      if (d < minDist) {
        minDist = d;
        if (d <= maxMeterDist) matchedWo = wo;
      }
    }
  });

  return matchedWo;
}

function downloadBase64Image(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename || `OVERWATCH_${Date.now()}.jpg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function loadImageAsync(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

// ==========================================
// HELPER: GENERATE TILE SATELIT MINI-MAP WATERMARK
// ==========================================
async function getSatelliteMiniMap(lat, lng, targetSize) {
  try {
    const zoom = 17;
    const n = Math.pow(2, zoom);
    const xFloat = ((lng + 180) / 360) * n;
    const latRad = (lat * Math.PI) / 180;
    const yFloat = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

    const xTile = Math.floor(xFloat);
    const yTile = Math.floor(yFloat);
    const pxX = (xFloat - xTile) * 256;
    const pxY = (yFloat - yTile) * 256;

    const nextX = pxX > 128 ? xTile + 1 : xTile - 1;
    const nextY = pxY > 128 ? yTile + 1 : yTile - 1;
    const minX = Math.min(xTile, nextX);
    const minY = Math.min(yTile, nextY);

    const stitchCanvas = document.createElement('canvas');
    stitchCanvas.width = 512;
    stitchCanvas.height = 512;
    const sCtx = stitchCanvas.getContext('2d');

    const tilePromises = [];
    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < 2; dy++) {
        const curX = minX + dx;
        const curY = minY + dy;
        const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${curY}/${curX}`;
        tilePromises.push(
          loadImageAsync(url).then(img => {
            sCtx.drawImage(img, dx * 256, dy * 256, 256, 256);
          }).catch(() => {})
        );
      }
    }
    await Promise.all(tilePromises);

    const centerX = (xFloat - minX) * 256;
    const centerY = (yFloat - minY) * 256;
    const cropSize = 256;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = targetSize;
    outCanvas.height = targetSize;
    const outCtx = outCanvas.getContext('2d');
    outCtx.drawImage(
      stitchCanvas,
      centerX - cropSize / 2,
      centerY - cropSize / 2,
      cropSize,
      cropSize,
      0,
      0,
      targetSize,
      targetSize
    );
    return outCanvas;
  } catch (e) {
    return null;
  }
}

// ==========================================
// RENDER EVIDENCE BER-WATERMARK DENGAN MINI-MAP NYATA
// ==========================================
async function renderWatermarkedEvidence(imgElement, meta) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  const w = imgElement.naturalWidth || imgElement.width || 1280;
  const h = imgElement.naturalHeight || imgElement.height || 720;
  canvas.width = w;
  canvas.height = h;

  ctx.drawImage(imgElement, 0, 0, w, h);

  const isPortrait = h > w;

  try {
    const logoImg = await loadImageAsync('./Logo_Alamtri.png');
    const logoW = Math.round(w * (isPortrait ? 0.20 : 0.15));
    const logoH = Math.round(logoImg.naturalHeight * (logoW / logoImg.naturalWidth));
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = Math.round(w * 0.008);
    ctx.drawImage(logoImg, w - logoW - Math.round(w * 0.025), Math.round(h * 0.02), logoW, logoH);
    ctx.restore();
  } catch (err) {}

  const mapBoxX = Math.round(w * 0.025);
  const mapBoxSize = Math.max(120, Math.round(w * (isPortrait ? 0.26 : 0.20)));
  const textX = mapBoxX + mapBoxSize + Math.round(w * 0.025);
  const availTextWidth = w - textX - Math.round(w * 0.03);

  let baseFontSize = Math.floor(availTextWidth / 24);
  baseFontSize = Math.max(12, Math.min(baseFontSize, Math.round(w * 0.027)));
  const lineHeight = Math.round(baseFontSize * 1.45);

  const requiredTextHeight = lineHeight * 5 + Math.round(baseFontSize * 1.2);
  const ribbonH = Math.max(mapBoxSize + 28, requiredTextHeight + 28);
  const ribbonY = h - ribbonH;
  const mapBoxY = ribbonY + Math.round((ribbonH - mapBoxSize) / 2);

  ctx.fillStyle = 'rgba(10, 15, 29, 0.92)';
  ctx.fillRect(0, ribbonY, w, ribbonH);

  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = Math.max(2, Math.round(w * 0.0025));
  ctx.beginPath();
  ctx.moveTo(0, ribbonY);
  ctx.lineTo(w, ribbonY);
  ctx.stroke();

  // CUPLIKAN SATELIT DI KOTAK RADAR
  let satCanvas = null;
  if (meta.latlng && meta.latlng.lat && meta.latlng.lng) {
    satCanvas = await getSatelliteMiniMap(meta.latlng.lat, meta.latlng.lng, mapBoxSize);
  }

  if (satCanvas) {
    ctx.drawImage(satCanvas, mapBoxX, mapBoxY, mapBoxSize, mapBoxSize);
    ctx.fillStyle = 'rgba(5, 10, 20, 0.40)';
    ctx.fillRect(mapBoxX, mapBoxY, mapBoxSize, mapBoxSize);
  } else {
    ctx.fillStyle = '#050a14';
    ctx.fillRect(mapBoxX, mapBoxY, mapBoxSize, mapBoxSize);
  }

  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = Math.max(1.5, Math.round(mapBoxSize * 0.012));
  ctx.strokeRect(mapBoxX, mapBoxY, mapBoxSize, mapBoxSize);

  const cx = mapBoxX + mapBoxSize / 2;
  const cy = mapBoxY + mapBoxSize / 2;
  const r = mapBoxSize / 2 - Math.max(6, Math.round(mapBoxSize * 0.07));
  const radarLineW = Math.max(1.5, Math.round(mapBoxSize * 0.012));

  ctx.strokeStyle = 'rgba(0, 240, 255, 0.70)';
  ctx.lineWidth = radarLineW;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.arc(cx, cy, r * 0.66, 0, Math.PI * 2);
  ctx.arc(cx, cy, r * 0.33, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy);
  ctx.stroke();

  const sweepGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
  sweepGrad.addColorStop(0, 'rgba(0, 240, 255, 0.45)');
  sweepGrad.addColorStop(1, 'rgba(0, 240, 255, 0.03)');
  ctx.fillStyle = sweepGrad;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, -Math.PI / 4, Math.PI / 4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#facc15';
  ctx.font = `bold ${Math.max(9, Math.round(mapBoxSize * 0.09))}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('▲ N', cx, cy - r + Math.round(mapBoxSize * 0.11));
  ctx.textAlign = 'left';

  const pinRadius = Math.max(4, Math.round(mapBoxSize * 0.035));
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(cx, cy, pinRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.5, Math.round(pinRadius * 0.4));
  ctx.stroke();

  let curY = ribbonY + Math.round(baseFontSize * 1.35) + 6;

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(baseFontSize * 1.15)}px sans-serif`;
  ctx.fillText((meta.notes || "Inspeksi Lapangan").substring(0, 75), textX, curY);
  curY += lineHeight + 3;

  ctx.font = `bold ${baseFontSize}px monospace`;
  ctx.fillStyle = '#facc15';
  ctx.fillText(`Ruas Jalan : ${meta.road || 'Area Tambang'}`, textX, curY);
  curY += lineHeight;

  ctx.fillStyle = '#cbd5e1';
  ctx.font = `${baseFontSize}px monospace`;
  ctx.fillText(`Waktu      : ${meta.time || UtilitiesFormatNowWita()}`, textX, curY);
  curY += lineHeight;

  ctx.fillText(`Pengawas   : ${meta.reporter || currentNRP}`, textX, curY);
  curY += lineHeight;

  ctx.fillStyle = '#00f0ff';
  ctx.font = `bold ${baseFontSize}px monospace`;
  ctx.fillText(`Photo ID   : ${meta.photoId || generatePhotoId()}`, textX, curY);

  return canvas.toDataURL('image/jpeg', 0.88);
}

function initGeotaggingCameraModule() {
  let takeInput = document.getElementById('geoInputTakeFile');
  if (!takeInput) {
    takeInput = document.createElement('input');
    takeInput.type = 'file';
    takeInput.id = 'geoInputTakeFile';
    takeInput.accept = 'image/*';
    takeInput.capture = 'environment';
    takeInput.style.display = 'none';
    document.body.appendChild(takeInput);
  }
  takeInput.addEventListener('change', handleCameraNativeFileChosen);

  let uploadInput = document.getElementById('geoInputUploadFile');
  if (!uploadInput) {
    uploadInput = document.createElement('input');
    uploadInput.type = 'file';
    uploadInput.id = 'geoInputUploadFile';
    uploadInput.accept = 'image/*';
    uploadInput.style.display = 'none';
    document.body.appendChild(uploadInput);
  }
  uploadInput.addEventListener('change', handleGalleryFileChosen);
}

function openCameraActionChooser() {
  const modal = document.getElementById('geoCameraChooserModal');
  if (modal) modal.style.display = 'flex';
}

function closeCameraActionChooser() {
  const modal = document.getElementById('geoCameraChooserModal');
  if (modal) modal.style.display = 'none';
}

function triggerDirectCameraCapture() {
  closeCameraActionChooser();
  const input = document.getElementById('geoInputTakeFile');
  if (input) input.click();
}

function triggerGalleryUploadCapture() {
  closeCameraActionChooser();
  const input = document.getElementById('geoInputUploadFile');
  if (input) input.click();
}

async function handleCameraNativeFileChosen(e) {
  const file = e.target.files ? e.target.files[0] : null;
  if (!file) return;
  currentPendingPhotoFile = file;
  currentRawImageElement = await fileToImageElement(file);

  let lat = null;
  let lng = null;
  let takenTime = UtilitiesFormatNowWita();

  if (window.exifr) {
    try {
      const exif = await exifr.parse(file, { gps: true, tiff: true });
      if (exif && exif.latitude && exif.longitude) {
        lat = exif.latitude;
        lng = exif.longitude;
      }
    } catch (err) {}
  }

  if (!lat || !lng) {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { proceedWithPhotoLocation(pos.coords.latitude, pos.coords.longitude, takenTime, currentRawImageElement); },
        () => {
          const c = map.getCenter();
          proceedWithPhotoLocation(c.lat, c.lng, takenTime, currentRawImageElement);
        },
        { enableHighAccuracy: true, timeout: 6000 }
      );
    } else {
      const c = map.getCenter();
      proceedWithPhotoLocation(c.lat, c.lng, takenTime, currentRawImageElement);
    }
    return;
  }

  proceedWithPhotoLocation(lat, lng, takenTime, currentRawImageElement);
}

async function handleGalleryFileChosen(e) {
  const file = e.target.files ? e.target.files[0] : null;
  if (!file) return;
  currentPendingPhotoFile = file;
  currentRawImageElement = await fileToImageElement(file);

  let lat = null;
  let lng = null;
  let takenTime = UtilitiesFormatNowWita();

  if (window.exifr) {
    try {
      const exif = await exifr.parse(file, { gps: true, tiff: true });
      if (exif && exif.latitude && exif.longitude) {
        lat = exif.latitude;
        lng = exif.longitude;
      }
    } catch (err) {}
  }

  if (!lat || !lng) {
    const warn = document.getElementById('geoExifWarningModal');
    if (warn) warn.style.display = 'flex';
    return;
  }

  proceedWithPhotoLocation(lat, lng, takenTime, currentRawImageElement);
}

function chooseNewGeoPhoto() {
  closeGeoExifWarningModal();
  triggerGalleryUploadCapture();
}

function useCurrentLiveGpsFallback() {
  closeGeoExifWarningModal();
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => { proceedWithPhotoLocation(pos.coords.latitude, pos.coords.longitude, UtilitiesFormatNowWita(), currentRawImageElement); },
    (err) => { alert("Gagal membaca GPS: " + err.message); },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function pickManualPointOnMapFallback() {
  closeGeoExifWarningModal();
  alert("Silakan ketuk titik lokasi jalan pada peta!");
  const oneTimeClick = (e) => {
    map.off('click', oneTimeClick);
    proceedWithPhotoLocation(e.latlng.lat, e.latlng.lng, UtilitiesFormatNowWita(), currentRawImageElement);
  };
  map.on('click', oneTimeClick);
}

function closeGeoExifWarningModal() {
  const modal = document.getElementById('geoExifWarningModal');
  if (modal) modal.style.display = 'none';
}

// HELPER TOGGLE JENIS ALAT CUSTOM GEOTAGGING
function toggleGeoToolCustomInput() {
  const sel = document.getElementById('geoReportToolType');
  const input = document.getElementById('geoReportToolCustom');
  if (sel && input) {
    input.style.display = sel.value === 'CUSTOM' ? 'block' : 'none';
    if (sel.value === 'CUSTOM') input.focus();
  }
}

async function proceedWithPhotoLocation(lat, lng, takenTime, imgElement) {
  const latlng = { lat: lat, lng: lng };
  const matchedWo = findNearestActiveWo(latlng, 60);
  const spatialCluster = detectClusterForLatLng(latlng);
  const photoId = generatePhotoId();
  
  const initialRoad = matchedWo ? matchedWo.road : "";
  const initialTime = takenTime || UtilitiesFormatNowWita();

  currentCapturedMetadata = {
    photoId: photoId,
    latlng: latlng,
    road: initialRoad,
    cluster: (matchedWo && matchedWo.cluster) ? matchedWo.cluster : spatialCluster.cluster,
    time: initialTime,
    reporter: currentNRP,
    matchedWo: matchedWo,
    notes: ""
  };

  currentWatermarkedBase64 = await renderWatermarkedEvidence(imgElement, currentCapturedMetadata);

  const previewModal = document.getElementById('geoPreviewReportModal');
  const imgElem = document.getElementById('geoPreviewStampedImg');
  const roadInput = document.getElementById('geoReportRoadName');
  const clusterInput = document.getElementById('geoReportClusterName');
  const toolSelect = document.getElementById('geoReportToolType');
  const toolCustom = document.getElementById('geoReportToolCustom');
  const egiInput = document.getElementById('geoReportEgi');
  const repInput = document.getElementById('geoReportReporter');
  const notesInput = document.getElementById('geoReportNotes');
  const statusSelect = document.getElementById('geoReportStatus');
  const woBox = document.getElementById('geoDetectedWoBox');
  const jobWrap = document.getElementById('geoJobSelectionWrapper');
  const dateInput = document.getElementById('geoReportDateTime');

  if (imgElem) imgElem.src = currentWatermarkedBase64;
  if (repInput) repInput.value = currentNRP;
  if (notesInput) notesInput.value = "";

  if (dateInput) {
    const currentNowLocal = getNowDateTimeLocalWita();
    dateInput.max = currentNowLocal;
    dateInput.value = currentNowLocal;
    currentCapturedMetadata.time = formatDateTimeLocalToWita(currentNowLocal);
  }

  // AUTO-DETECT CLUSTER & RUAS JALAN DARI POLIGON / WO
  if (clusterInput) {
    clusterInput.value = (matchedWo && matchedWo.cluster) ? matchedWo.cluster : (spatialCluster.cluster || "");
  }

  if (toolSelect) {
    let tType = "";
    if (matchedWo && matchedWo.jobs && matchedWo.jobs[0] && matchedWo.jobs[0].toolType) {
      tType = matchedWo.jobs[0].toolType;
    }
    const isStd = ['Ex', 'Dz', 'Gr', 'Cp', ''].includes(tType);
    toolSelect.value = isStd ? tType : 'CUSTOM';
    if (toolCustom) {
      toolCustom.style.display = isStd ? 'none' : 'block';
      toolCustom.value = isStd ? '' : tType;
    }
  }

  if (egiInput) {
    egiInput.value = (matchedWo && matchedWo.jobs && matchedWo.jobs[0] && matchedWo.jobs[0].egi) ? matchedWo.jobs[0].egi : "";
  }

  if (statusSelect) {
    statusSelect.value = matchedWo ? (matchedWo.status || "PROGRESS") : "PROGRESS";
  }
  // Live update watermark saat user mengetik nama jalan
  if (roadInput) {
    roadInput.readOnly = false;
    roadInput.style.background = "#090d16";

    if (matchedWo) {
      roadInput.value = matchedWo.road;
      roadInput.style.borderColor = "#22c55e";
      roadInput.style.color = "#22c55e";
    } else {
      roadInput.value = "";
      roadInput.placeholder = "Ketik Ruas Jalan (Wajib diisi)...";
      roadInput.style.borderColor = "#facc15";
      roadInput.style.color = "#facc15";
      setTimeout(() => roadInput.focus(), 250);
    }

    roadInput.oninput = async () => {
      currentCapturedMetadata.road = roadInput.value.trim() || 'Area Tambang';
      currentWatermarkedBase64 = await renderWatermarkedEvidence(currentRawImageElement, currentCapturedMetadata);
      if (imgElem) imgElem.src = currentWatermarkedBase64;
    };
  }

  if (matchedWo) {
    if (woBox) {
      woBox.innerHTML = `
        <div style="color:#22c55e; font-weight:bold; margin-bottom:2px;">📍 Terdeteksi di Area Poligon WO: ${matchedWo.road}</div>
        <div style="color:#94a3b8; font-size:10px;">Cluster: ${matchedWo.cluster || spatialCluster.cluster || '-'} | Nomor/STA: ${matchedWo.sta || '-'} | Status: ${matchedWo.status}</div>
      `;
    }

    const jobs = (matchedWo.jobs && matchedWo.jobs.length > 0) ? matchedWo.jobs : [{ detail: "Pekerjaan Lapangan", status: "OPEN" }];
    if (jobWrap) {
      jobWrap.innerHTML = `
        <label style="font-size:10px; color:#cbd5e1; display:block; margin-bottom:4px; font-weight:bold;">Pilih Target Job Pekerjaan:</label>
        <select id="geoSelectedJobIndex" style="width:100%; background:#090d16; border:1px solid #475569; padding:6px; border-radius:4px; color:#fff; font-size:11px;">
       ${jobs.map((j, i) => `<option value="${i}">Job #${i + 1}: ${j.detail || j.category || ''} [${j.status || 'OPEN'}]</option>`).join('')}
        </select>
      `;
    }
  } else {
    if (woBox) {
      woBox.innerHTML = `
        <div style="color:#f59e0b; font-weight:bold; margin-bottom:2px;">⚠️ Laporan Temuan Lapangan (Ad-Hoc)</div>
        <div style="color:#94a3b8; font-size:10px;">Cluster Terdeteksi: <b>${spatialCluster.cluster || 'Area Tambang'}</b>. Pin temuan baru akan dibuat otomatis.</div>
      `;
    }
    if (jobWrap) jobWrap.innerHTML = '';
  }

  if (previewModal) previewModal.style.display = 'flex';
}

async function handleGeoDateTimeChange() {
  const dateInput = document.getElementById('geoReportDateTime');
  const imgElem = document.getElementById('geoPreviewStampedImg');
  if (!dateInput || !dateInput.value || !currentCapturedMetadata || !currentRawImageElement) return;

  const chosenWita = formatDateTimeLocalToWita(dateInput.value);
  currentCapturedMetadata.time = chosenWita;

  currentWatermarkedBase64 = await renderWatermarkedEvidence(currentRawImageElement, currentCapturedMetadata);
  if (imgElem) {
    imgElem.src = currentWatermarkedBase64;
  }
}

function fileToImageElement(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function closeGeoPreviewModal() {
  const modal = document.getElementById('geoPreviewReportModal');
  if (modal) modal.style.display = 'none';
  currentCapturedMetadata = null;
  currentWatermarkedBase64 = null;
  currentPendingPhotoFile = null;
  currentRawImageElement = null;
}

async function executeSaveGeoToGalleryOnly() {
  if (!currentWatermarkedBase64 || !currentCapturedMetadata) return;
  const roadInput = document.getElementById('geoReportRoadName');
  const dateInput = document.getElementById('geoReportDateTime');
  const notesInput = document.getElementById('geoReportNotes');
  const repInput = document.getElementById('geoReportReporter');

  // Ambil teks yang diketik user di form
  const cleanRoad = (roadInput && roadInput.value.trim() !== '') 
    ? roadInput.value.trim() 
    : (currentCapturedMetadata.road || "Area Tambang");

  currentCapturedMetadata.road = cleanRoad;
  if (notesInput && notesInput.value.trim()) currentCapturedMetadata.notes = notesInput.value.trim();
  if (repInput && repInput.value.trim()) currentCapturedMetadata.reporter = repInput.value.trim();
  if (dateInput && dateInput.value) {
    currentCapturedMetadata.time = formatDateTimeLocalToWita(dateInput.value);
  }

  // Render ulang stempel watermark foto
  currentWatermarkedBase64 = await renderWatermarkedEvidence(currentRawImageElement, currentCapturedMetadata);

  const filename = `${currentCapturedMetadata.photoId}_${cleanRoad.replace(/\s+/g, '_')}.jpg`;
  downloadBase64Image(currentWatermarkedBase64, filename);
  alert("Foto berhasil diunduh dan disimpan ke Galeri HP!");
  closeGeoPreviewModal();
}
async function executeSubmitGeoEvidence() {
  if (!currentCapturedMetadata || !currentRawImageElement) return;

  const roadInput = document.getElementById('geoReportRoadName');
  const clusterInput = document.getElementById('geoReportClusterName');
  const toolSelect = document.getElementById('geoReportToolType');
  const toolCustom = document.getElementById('geoReportToolCustom');
  const egiInput = document.getElementById('geoReportEgi');
  const notesInput = document.getElementById('geoReportNotes');
  const repInput = document.getElementById('geoReportReporter');
  const statusSelect = document.getElementById('geoReportStatus');
  const jobSelect = document.getElementById('geoSelectedJobIndex');
  const dateInput = document.getElementById('geoReportDateTime');

  const finalRoadName = roadInput ? roadInput.value.trim() : "";
  const finalClusterName = clusterInput ? clusterInput.value.trim() : "";
  
  let toolType = toolSelect ? toolSelect.value : "";
  if (toolType === "CUSTOM") {
    toolType = toolCustom ? toolCustom.value.trim() : "";
  }
  const egi = egiInput ? egiInput.value.trim() : "";

  const notes = notesInput ? notesInput.value.trim() : "";
  const reporter = repInput ? repInput.value.trim() : currentNRP;
  const status = statusSelect ? statusSelect.value : "PROGRESS";
  const matchedWo = currentCapturedMetadata.matchedWo;

  if (!finalRoadName) {
    alert("Nama Ruas Jalan wajib diisi, bre!");
    if (roadInput) roadInput.focus();
    return;
  }
  if (!notes) {
    alert("Keterangan temuan lapangan wajib diisi, bre!");
    if (notesInput) notesInput.focus();
    return;
  }

  if (dateInput && dateInput.value) {
    currentCapturedMetadata.time = formatDateTimeLocalToWita(dateInput.value);
  }

  currentCapturedMetadata.road = finalRoadName;
  currentCapturedMetadata.notes = notes;
  currentCapturedMetadata.reporter = reporter;

  currentWatermarkedBase64 = await renderWatermarkedEvidence(currentRawImageElement, currentCapturedMetadata);

  const filename = `${currentCapturedMetadata.photoId}_${finalRoadName.replace(/\s+/g, '_')}.jpg`;
  downloadBase64Image(currentWatermarkedBase64, filename);

  setSyncStatus('updating', 'Mengunggah hasil geotagging...');

  const imagePayload = [{
    imageBase64: currentWatermarkedBase64,
    imageName: filename,
    imageMime: "image/jpeg"
  }];

  if (matchedWo) {
    const jobIdx = jobSelect ? parseInt(jobSelect.value) : 0;
    const targetJob = (matchedWo.jobs && matchedWo.jobs[jobIdx]) ? matchedWo.jobs[jobIdx] : { detail: "Pekerjaan Lapangan" };
    const jobTargetText = `Job ${jobIdx + 1}: ${targetJob.detail || targetJob.category}`;

    syncWorkOrderToCloud({
      action: "SUBMIT_EVIDENCE",
      woId: matchedWo.id,
      jobIndex: jobIdx,
      jobTarget: jobTargetText,
      road: finalRoadName,
      status: status,
      notes: notes,
      reporter: reporter,
      timestamp: currentCapturedMetadata.time,
      toolType: toolType,
      egi: egi,
      photoId: currentCapturedMetadata.photoId,
      images: imagePayload
    });

    if (matchedWo.jobs && matchedWo.jobs[jobIdx]) {
      matchedWo.jobs[jobIdx].status = status;
      if (toolType) matchedWo.jobs[jobIdx].toolType = toolType;
      if (egi) matchedWo.jobs[jobIdx].egi = egi;
    }
    matchedWo.status = calculateParentStatus(matchedWo.jobs);
    createOrUpdateMarker(matchedWo);

    broadcastWoSync('UPDATE_JOB_STATUS', {
      woId: matchedWo.id,
      jobIndex: jobIdx,
      status: status,
      parentStatus: matchedWo.status,
      notes: notes,
      reporter: reporter,
      toolType: toolType,
      egi: egi
    }, `${reporter} kirim evidence ${jobTargetText} ${finalRoadName}`);

  } else {
    const newWoId = 'wo_' + Date.now();
    const spatialCluster = detectClusterForLatLng(currentCapturedMetadata.latlng);

    const newWo = {
      id: newWoId,
      createdTime: currentCapturedMetadata.time,
      road: finalRoadName,
      cluster: finalClusterName || spatialCluster.cluster,
      lokasi: spatialCluster.lokasi,
      sta: "Temuan Lapangan",
      latlng: currentCapturedMetadata.latlng,
      jobs: [{ toolType: toolType, egi: egi, detail: notes, status: status }],
      notes: notes,
      reporter: reporter,
      photoUrls: [],
      status: status,
      linkedLineId: ""
    };

    allWorkOrders[newWoId] = newWo;
    createOrUpdateMarker(newWo);

    syncWorkOrderToCloud({
      action: "SAVE_WORK_ORDER",
      id: newWo.id,
      createdTime: newWo.createdTime,
      road: newWo.road,
      cluster: newWo.cluster,
      lokasi: newWo.lokasi,
      sta: newWo.sta,
      latlng: newWo.latlng,
      jobs: newWo.jobs,
      notes: newWo.notes,
      reporter: newWo.reporter,
      status: status,
      linkedLineId: "",
      photoId: currentCapturedMetadata.photoId,
      images: imagePayload
    });

    broadcastWoSync('CREATE_WO', sanitizeWoForBroadcast(newWo), `${reporter} melaporkan temuan baru di ${newWo.road}`);
  }

  catatLogKeServer("GEOTAG EVIDENCE", `ID: ${currentCapturedMetadata.photoId}, Pelapor: ${reporter}, Lokasi: ${finalRoadName}`);
  renderOutstandingList();
  alert(`Laporan dan foto (${currentCapturedMetadata.photoId}) berhasil dikirim serta disimpan ke Galeri HP!`);
  closeGeoPreviewModal();
}

// WINDOW EXPORTS
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
window.handleWoSubmitButtonClick = handleWoSubmitButtonClick;
window.openEvidenceStatusModal = openEvidenceStatusModal;
window.closeEvidenceStatusModal = closeEvidenceStatusModal;
window.confirmEvidenceStatusAndSubmit = confirmEvidenceStatusAndSubmit;
window.deleteCurrentWorkOrder = deleteCurrentWorkOrder;
window.openJobUpdateModal = openJobUpdateModal;
window.closeJobUpdateModal = closeJobUpdateModal;
window.triggerJobUpdateStatusPrompt = triggerJobUpdateStatusPrompt;
window.addNewJobItem = addNewJobItem;
window.removeJobItem = removeJobItem;
window.handleJobToolSelectChange = handleJobToolSelectChange;
window.toggleEvidenceCustomToolInput = toggleEvidenceCustomToolInput;
window.toggleJobUpdateCustomToolInput = toggleJobUpdateCustomToolInput;
window.openProgressTimelineModal = openProgressTimelineModal;
window.closeProgressTimelineModal = closeProgressTimelineModal;
window.filterTimelineByJob = filterTimelineByJob;
window.openImageLightbox = openImageLightbox;
window.closeImageLightbox = closeImageLightbox;
window.openCalendarFilterModal = openCalendarFilterModal;
window.closeCalendarFilterModal = closeCalendarFilterModal;
window.applyCalendarDateFilter = applyCalendarDateFilter;
window.resetCalendarToToday = resetCalendarToToday;
window.executeExportRekapWO = executeExportRekapWO;
window.executeExportRekapEvidence = executeExportRekapEvidence;
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
window.logoutUser = logoutUser;
window.handlePanelHeaderClick = handlePanelHeaderClick;
window.removeMainQueueFile = removeMainQueueFile;
window.removeJobQueueFile = removeJobQueueFile;

window.openCameraActionChooser = openCameraActionChooser;
window.closeCameraActionChooser = closeCameraActionChooser;
window.triggerDirectCameraCapture = triggerDirectCameraCapture;
window.triggerGalleryUploadCapture = triggerGalleryUploadCapture;
window.closeGeoPreviewModal = closeGeoPreviewModal;
window.executeSaveGeoToGalleryOnly = executeSaveGeoToGalleryOnly;
window.executeSubmitGeoEvidence = executeSubmitGeoEvidence;
window.chooseNewGeoPhoto = chooseNewGeoPhoto;
window.useCurrentLiveGpsFallback = useCurrentLiveGpsFallback;
window.pickManualPointOnMapFallback = pickManualPointOnMapFallback;
window.closeGeoExifWarningModal = closeGeoExifWarningModal;
window.handleGeoDateTimeChange = handleGeoDateTimeChange;
window.onCrossSectionStaChange = onCrossSectionStaChange;
window.toggleRadarUserOnline = toggleRadarUserOnline;
window.toggleGeoToolCustomInput = toggleGeoToolCustomInput;
window.openRoadSummaryModal = openRoadSummaryModal;
window.closeRoadSummaryModal = closeRoadSummaryModal;
window.openModulePortal = openModulePortal;
window.closeModulePortal = closeModulePortal;
window.selectAppMode = selectAppMode;
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      console.log('PWA Service Worker Aktif:', reg.scope);
    }).catch((err) => {
      console.warn('PWA Service Worker Gagal:', err);
    });
  });
}
