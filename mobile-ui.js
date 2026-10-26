/* =====================================================================
   OVERWATCH - mobile-ui.js
   Tiga perapian tampilan, khusus perilaku (gayanya ada di style.css):
     1. Menu TOOLS: satu tombol pemicu; saat diketuk, tombol DASH / BANDING / RIWAYAT / UKUR / 3D
        "mengorbit" keluar dari pemicu. Tombol aslinya (id & onclick) tidak diubah,
        jadi dashboard.js, compare.js, history.js, measure.js, drone.js tetap bekerja seperti biasa.
        LEGENDA yang ada di bawahnya turun sendiri (CSS) selama busur terbuka; popup LEGENDA / LOG menutup supaya tidak menutupi busur.
     2. Tanggal di header versi ringkas di layar sempit (26/10/2026 -> 26/10).
     3. Tombol OUTSTANDING turun otomatis bila dropdown filter Infra terbuka dan menutupinya (nilai --ow-right-shift).
   ===================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OwMobileUi = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var ACTIVE_BODY_CLASSES = ["ow-measuring", "ow-comparing", "ow-drone-on", "ow-history-on"];

  /* "26/10/2026" -> "26/10"; tahun lain dari tahun berjalan ditulis "26/10/25"; "26/10/2026 S2" -> "26/10 S2" */
  function shortDate(text, nowYear) {
    var raw = String(text == null ? "" : text);
    var m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/.exec(raw);
    if (!m) return raw.trim();
    var yr = Number(m[3]);
    var base = m[1] + "/" + m[2] + (nowYear && yr !== nowYear ? "/" + String(yr).slice(2) : "");
    var rest = (m[4] || "").trim();
    return rest ? base + " " + rest : base;
  }

  function initShortDate(doc, win) {
    var label = doc.getElementById("labelActiveWoDate");
    if (!label) return null;
    var busy = false;
    function apply() {
      if (busy) return; busy = true;
      try {
        label.setAttribute("data-short", shortDate(label.textContent, new Date().getFullYear()));
        label.classList.add("ow-short");
      } finally { busy = false; }
    }
    apply();
    var mo = null;
    var MO = win && win.MutationObserver;
    if (MO) { mo = new MO(apply); mo.observe(label, { childList: true, characterData: true, subtree: true }); }
    return { apply: apply, observer: mo };
  }

  function initOrbit(doc) {
    var wrap = doc.getElementById("owOrbit"), trig = doc.getElementById("btnOrbitTrigger");
    if (!wrap || !trig) return null;
    var items = Array.prototype.slice.call(wrap.querySelectorAll(".ow-orbit-item"));

    var win0 = doc.defaultView;
    function isOpen() { return wrap.classList.contains("open"); }
    // popup lain yang akan tertimpa busur ditutup lewat fungsi aslinya (toggle), bukan dipaksa lewat class
    function closeOthers() {
      var lg = doc.getElementById("legendDrawer"), nd = doc.getElementById("notificationDrawer");
      if (lg && !lg.classList.contains("hidden") && win0 && typeof win0.toggleLegendDrawer === "function") win0.toggleLegendDrawer();
      if (nd && nd.classList.contains("active-drawer") && win0 && typeof win0.toggleNotificationDrawer === "function") win0.toggleNotificationDrawer();
    }
    function setOpen(v) {
      v = !!v;
      if (v && !isOpen()) closeOthers();
      wrap.classList.toggle("open", v);
      trig.setAttribute("aria-expanded", v ? "true" : "false");
      items.forEach(function (it) { it.tabIndex = v ? 0 : -1; });
      return v;
    }
    function toggle() { return setOpen(!isOpen()); }

    trig.addEventListener("click", function (e) { e.stopPropagation(); toggle(); });
    // Setelah salah satu alat dipilih, menu menutup sendiri (handler asli tombol sudah jalan lebih dulu).
    items.forEach(function (it) { it.addEventListener("click", function () { setTimeout(function () { setOpen(false); }, 0); }); });
    // Ketuk di luar menu = tutup.
    doc.addEventListener("pointerdown", function (e) { if (isOpen() && !wrap.contains(e.target)) setOpen(false); }, true);
    doc.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen()) { setOpen(false); trig.focus(); } });

    // Pemicu menyala bila ada alat yang sedang aktif (ukur / banding / 3D).
    function paintActive() {
      var c = doc.body.classList, on = ACTIVE_BODY_CLASSES.some(function (k) { return c.contains(k); });
      trig.classList.toggle("is-active", on);
      if (on) setOpen(false);
    }
    paintActive();
    var win = doc.defaultView, MO = win && win.MutationObserver, mo = null;
    if (MO) { mo = new MO(paintActive); mo.observe(doc.body, { attributes: true, attributeFilter: ["class"] }); }

    setOpen(false);
    return { open: function () { return setOpen(true); }, close: function () { return setOpen(false); }, toggle: toggle, isOpen: isOpen, observer: mo };
  }

  /* OUTSTANDING (kanan) turun bila panel filter Infra terbuka & menimpanya. Dihitung dari ukuran nyata, jadi di desktop
     (Infra di sebelah kiri Satelit, tidak menimpa) nilainya 0. Gerak halusnya di CSS (translate + transition). */
  function computeRightShift(panelOpen, ctlRect, boxRect, baseTop, gap) {
    if (!panelOpen) return 0;
    var overlapX = ctlRect.left < boxRect.right - 1 && ctlRect.right > boxRect.left + 1;
    if (!overlapX) return 0;
    return Math.max(0, Math.ceil(ctlRect.bottom + gap - baseTop));
  }

  function initRightShift(doc, win) {
    var box = doc.getElementById("rightSidebarContainer");
    if (!box) return null;
    var root = doc.documentElement, GAP = 8, panel = null, ctl = null, mo = null, ro = null, current = 0;
    function find() {
      ctl = doc.getElementById("infraCtl"); panel = ctl && ctl.querySelector("#infraPanel");
      return !!panel;
    }
    function apply(px) {
      if (px === current && root.style.getPropertyValue("--ow-right-shift")) return;
      current = px; root.style.setProperty("--ow-right-shift", px + "px");
    }
    function measure() {
      if (!panel && !find()) { apply(0); return 0; }
      var open = !panel.classList.contains("hidden");
      var baseTop = parseFloat(win.getComputedStyle(box).top) || 0;
      var px = computeRightShift(open, ctl.getBoundingClientRect(), box.getBoundingClientRect(), baseTop, GAP);
      apply(px); return px;
    }
    function attach() {
      if (!find()) return false;
      var MO = win.MutationObserver, RO = win.ResizeObserver;
      if (MO) { mo = new MO(measure); mo.observe(panel, { attributes: true, attributeFilter: ["class"] }); }
      if (RO) { ro = new RO(measure); ro.observe(ctl); }
      measure();
      return true;
    }
    win.addEventListener("resize", measure); win.addEventListener("orientationchange", measure);
    var waiter = null;
    if (!attach() && win.MutationObserver) {      // #infraCtl dibuat belakangan oleh infra.js
      waiter = new win.MutationObserver(function () { if (attach()) { waiter.disconnect(); waiter = null; } });
      waiter.observe(doc.body, { childList: true });
    }
    apply(0);
    return { measure: measure, shift: function () { return current; } };
  }

  function init(doc, win) {
    doc = doc || (typeof document !== "undefined" ? document : null);
    win = win || (doc && doc.defaultView);
    if (!doc) return null;
    return { orbit: initOrbit(doc), date: initShortDate(doc, win), shift: win ? initRightShift(doc, win) : null };
  }

  var api = { shortDate: shortDate, init: init, initOrbit: initOrbit, initShortDate: initShortDate, initRightShift: initRightShift, computeRightShift: computeRightShift };

  if (typeof document !== "undefined" && typeof window !== "undefined") {
    var boot = function () { try { var inst = init(document, window) || {}; window.OwOrbit = inst.orbit || null; window.OwRightShift = inst.shift || null; } catch (e) { if (window.console) console.warn("[mobile-ui]", e); } };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  }
  return api;
}));
