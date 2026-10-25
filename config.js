/* =====================================================================
   OVERWATCH - config.js
   SATU-SATUNYA file yang perlu diedit setelah Worker di-deploy.
   Dipakai oleh index.html (peta) dan upload.html (halaman upload admin).
   ===================================================================== */
window.OVERWATCH_CONFIG = {
  // URL Worker data (isi setelah deploy, tanpa garis miring di akhir).
  // Contoh: "https://overwatch-data-api.operationoverwatch001.workers.dev"
  // Kalau dikosongkan, peta jalan seperti dulu (baca folder data/ di GitHub).
  DATA_API: "https://overwatch-data-api.operationoverwatch001.workers.dev",

  // Sama dengan yang ada di app.js (kunci publishable memang boleh publik)
  SUPABASE_URL: "https://bjgojyazemlrwnqpxoqp.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_mUqC6rBWoHL-5IjW44uhfA_TL7YB1Zg"
};
