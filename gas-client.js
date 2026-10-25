/* =====================================================================
   OVERWATCH - gas-client.js
   Klien Apps Script (Work Order, Evidence, Foto) dengan:
     - token login Supabase di setiap permintaan (server memvalidasi)
     - ANTREAN OFFLINE: aksi tulis disimpan di perangkat (IndexedDB) dan dikirim
       berurutan begitu ada sinyal. Tidak hilang walau aplikasi ditutup.
     - anti-dobel: SUBMIT_EVIDENCE membawa clientId, server mengabaikan kiriman ulang.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OverwatchGas = factory();
}(typeof self !== "undefined" ? self : this, function () {

  var WRITE_ACTIONS = ["SAVE_WORK_ORDER", "SUBMIT_EVIDENCE", "DELETE_WORK_ORDER", "SAVE_DRAW_LINE", "DELETE_DRAW_LINE", "LOG_AKTIVITAS"];
  var DROP_CODES = [400, 403, 404, 405];    // salah permintaan / tidak punya hak: percuma dikirim ulang

  function uid() {
    var r = Math.random().toString(36).slice(2, 10);
    return Date.now().toString(36) + "-" + r;
  }

  /* ---------- antrean (logika murni, penyimpanan & pengiriman disuntik) ---------- */
  function createQueue(opts) {
    var store = opts.store, send = opts.send;
    var onChange = opts.onChange || function () {};
    var onDrop = opts.onDrop || function () {};
    var onSent = opts.onSent || function () {};
    var getOwner = opts.getOwner || function () { return ""; };
    var flushing = false, seq = 0, retryTimer = null;

    async function pending() { return store.getAll(); }

    async function add(payload) {
      var items = await store.getAll();
      seq = Math.max(seq, items.reduce(function (m, i) { return Math.max(m, i.seq || 0); }, 0)) + 1;
      var item = { id: uid(), seq: seq, owner: getOwner(), payload: payload, createdAt: Date.now(), tries: 0 };
      await store.add(item);
      await notify();
      return item;
    }

    async function notify() { onChange((await store.getAll()).length); }

    async function flush() {
      if (flushing) return { skipped: true };
      flushing = true;
      var sent = 0, dropped = 0, stopped = false;
      try {
        var items = (await store.getAll()).sort(function (a, b) { return a.seq - b.seq; });
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          var owner = getOwner();
          if (it.owner && owner && it.owner !== owner) continue;   // milik akun lain, jangan dikirim atas nama orang ini
          var res;
          try { res = await send(it.payload, it); } catch (e) { res = { kind: "retry", message: String(e && e.message || e) }; }
          if (res.kind === "ok") {
            await store.remove(it.id); sent++; onSent(it, res.data);
          } else if (res.kind === "drop") {
            await store.remove(it.id); dropped++; onDrop(it, res.message || "Ditolak server.");
          } else {
            it.tries = (it.tries || 0) + 1; it.lastError = res.message || ""; await store.update(it);
            stopped = true; break;                                  // jaga urutan: berhenti di item pertama yang gagal
          }
        }
      } finally { flushing = false; await notify(); }
      return { sent: sent, dropped: dropped, stopped: stopped };
    }

    function scheduleRetry(ms) {
      if (retryTimer) return;
      retryTimer = setTimeout(function () { retryTimer = null; flush().then(function (r) { if (r && r.stopped) scheduleRetry(Math.min(ms * 2, 120000)); }); }, ms);
    }

    return { add: add, flush: flush, pending: pending, notify: notify, scheduleRetry: scheduleRetry };
  }

  /* ---------- klasifikasi respons Apps Script ---------- */
  function classify(httpOk, status, body) {
    if (!httpOk && status >= 500) return { kind: "retry", message: "Server " + status };
    if (!body || typeof body !== "object") return { kind: "retry", message: "Respons tidak dikenal" };   // halaman error HTML dari Google
    var st = String(body.status || "").toUpperCase();
    if (st === "SUCCESS" || st === "SAVED" || st === "DELETED" || st === "SUCCESS ") return { kind: "ok", data: body };
    if (body.status === "success") return { kind: "ok", data: body };
    if (st === "ERROR") {
      var code = Number(body.code || 0);
      if (code === 401) return { kind: "retry", message: body.message || "Sesi habis", auth: true };
      if (code === 503) return { kind: "retry", message: body.message || "Server sibuk" };
      if (DROP_CODES.indexOf(code) >= 0) return { kind: "drop", message: body.message || "Ditolak server", code: code };
      return { kind: "retry", message: body.message || "Gagal" };
    }
    if (Array.isArray(body.workOrders) || Array.isArray(body.data) || Array.isArray(body.history)) return { kind: "ok", data: body };
    return { kind: "retry", message: "Respons tidak dikenal" };
  }

  /* ---------- penyimpanan ---------- */
  function memoryStore() {
    var m = new Map();
    return {
      getAll: async function () { return Array.from(m.values()); },
      add: async function (i) { m.set(i.id, i); },
      update: async function (i) { m.set(i.id, i); },
      remove: async function (id) { m.delete(id); }
    };
  }

  function idbStore(name) {
    var dbp = null;
    function db() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        var rq = indexedDB.open(name, 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore("q", { keyPath: "id" }); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error); };
      });
      return dbp;
    }
    function tx(mode, fn) {
      return db().then(function (d) {
        return new Promise(function (res, rej) {
          var t = d.transaction("q", mode), s = t.objectStore("q"), out = fn(s);
          t.oncomplete = function () { res(out && out.result !== undefined ? out.result : undefined); };
          t.onerror = t.onabort = function () { rej(t.error); };
        });
      });
    }
    return {
      getAll: function () { return tx("readonly", function (s) { return s.getAll(); }).then(function (r) { return r || []; }); },
      add: function (i) { return tx("readwrite", function (s) { return s.put(i); }); },
      update: function (i) { return tx("readwrite", function (s) { return s.put(i); }); },
      remove: function (id) { return tx("readwrite", function (s) { return s.delete(id); }); }
    };
  }

  /* ---------- klien peramban ---------- */
  var client = null;

  function init(cfg) {
    var store;
    try { store = (typeof indexedDB !== "undefined") ? idbStore("overwatch-queue") : memoryStore(); } catch (e) { store = memoryStore(); }

    async function post(payload, timeoutMs) {
      var token = await cfg.getToken();
      if (!token) return { kind: "retry", message: "Belum login", auth: true };
      var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, timeoutMs || 90000);
      try {
        var r = await fetch(cfg.url, {
          method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(Object.assign({}, payload, { token: token })), signal: ctl.signal
        });
        var body = null;
        try { body = await r.json(); } catch (e) { body = null; }
        return Object.assign(classify(r.ok, r.status, body), { body: body });
      } catch (e) {
        return { kind: "retry", message: "Tidak ada koneksi" };
      } finally { clearTimeout(timer); }
    }

    var badge = null;
    function paintBadge(n) {
      if (typeof document === "undefined") return;
      if (!badge) {
        badge = document.createElement("button");
        badge.id = "gasQueueBadge"; badge.type = "button";
        badge.style.cssText = "position:fixed;left:10px;bottom:70px;z-index:99999;display:none;background:#f59e0b;color:#111;border:none;border-radius:999px;padding:8px 14px;font:600 12px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.4);cursor:pointer";
        badge.onclick = function () { client.flush(true); };
        document.body.appendChild(badge);
      }
      badge.style.display = n > 0 ? "block" : "none";
      badge.textContent = "⏳ " + n + " menunggu kirim (ketuk untuk coba)";
      if (typeof cfg.onQueueChange === "function") cfg.onQueueChange(n);
    }

    var queue = createQueue({
      store: store,
      getOwner: cfg.getOwner,
      onChange: paintBadge,
      onDrop: function (it, msg) { if (cfg.onToast) cfg.onToast("❌ Laporan ditolak server: " + msg); },
      onSent: function (it, data) { if (cfg.onSent) cfg.onSent(it.payload, data); },
      send: async function (payload) { return post(payload); }
    });

    client = {
      queue: queue,
      // Aksi tulis: masuk antrean dulu (aman dari putus sinyal), lalu langsung dicoba kirim.
      write: async function (payload) {
        if (WRITE_ACTIONS.indexOf(payload.action) < 0) throw new Error("Bukan aksi tulis: " + payload.action);
        var p = Object.assign({}, payload);
        if (p.action === "SUBMIT_EVIDENCE" && !p.clientId) p.clientId = "ev-" + uid();
        var item = await queue.add(p);
        var r = await queue.flush();
        if (r.stopped) queue.scheduleRetry(15000);
        return { queued: r.stopped === true, clientId: p.clientId, id: item.id };
      },
      // Aksi baca: langsung, tanpa antrean. Melempar error kalau gagal.
      read: async function (action, params) {
        var res = await post(Object.assign({ action: action }, params || {}), 60000);
        if (res.kind === "ok") return res.body;
        var err = new Error(res.message || "Gagal"); err.kind = res.kind; err.auth = !!res.auth; throw err;
      },
      flush: function (manual) {
        return queue.flush().then(function (r) {
          if (manual && cfg.onToast) cfg.onToast(r.stopped ? "Masih belum ada sinyal. Data aman di perangkat." : (r.sent ? "✅ " + r.sent + " laporan terkirim" : "Tidak ada antrean."));
          if (r.stopped) queue.scheduleRetry(15000);
          return r;
        });
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("online", function () { client.flush(); });
      document.addEventListener("visibilitychange", function () { if (!document.hidden) client.flush(); });
      setInterval(function () { client.flush(); }, 60000);
      queue.notify();
      setTimeout(function () { client.flush(); }, 3000);
    }
    return client;
  }

  return { init: init, get: function () { return client; }, createQueue: createQueue, classify: classify, memoryStore: memoryStore, WRITE_ACTIONS: WRITE_ACTIONS };
}));
