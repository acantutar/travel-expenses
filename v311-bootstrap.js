(() => {
  "use strict";

  if (window.__TRIPSPLIT_V311_LOADING__) return;
  window.__TRIPSPLIT_V311_LOADING__ = true;

  const PAYLOAD_URL = "deploy/v3.11.payload.b64?v=3.11";
  const JSZIP_URL = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Script yüklenemedi: " + src));
      document.head.appendChild(s);
    });
  }

  function base64ToBytes(text) {
    const clean = text.replace(/\s+/g, "");
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function boot() {
    const cfg = window.APP_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) {
      throw new Error("Supabase bağlantı ayarı eksik");
    }

    if (!window.JSZip) await loadScript(JSZIP_URL);

    const res = await fetch(PAYLOAD_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("v3.11 paketi alınamadı: HTTP " + res.status);

    const payload = await res.text();
    const zip = await window.JSZip.loadAsync(base64ToBytes(payload));
    const root = "travel-expenses-v3.11/";

    const indexFile = zip.file(root + "index.html");
    const appFile = zip.file(root + "app.js");
    const cssFile = zip.file(root + "styles.css");
    if (!indexFile || !appFile || !cssFile) throw new Error("v3.11 paket dosyaları eksik");

    const [html, app, css] = await Promise.all([
      indexFile.async("string"),
      appFile.async("string"),
      cssFile.async("string")
    ]);

    const cssUrl = URL.createObjectURL(new Blob([css], { type: "text/css" }));
    const appUrl = URL.createObjectURL(new Blob([app], { type: "text/javascript" }));

    const safeCfg = JSON.stringify({
      SUPABASE_URL: cfg.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: cfg.SUPABASE_PUBLISHABLE_KEY,
      AUTH_EMAIL_DOMAIN: cfg.AUTH_EMAIL_DOMAIN || "travel-expenses.app"
    }).replace(/</g, "\\u003c");

    const next = html
      .replace(/href="styles\.css\?v=3\.11"/, 'href="' + cssUrl + '"')
      .replace(/<script src="config\.js\?v=3\.11"><\/script>/, "<script>window.APP_CONFIG=" + safeCfg + ";<\/script>")
      .replace(/src="app\.js\?v=3\.11"/, 'src="' + appUrl + '"');

    document.open();
    document.write(next);
    document.close();
  }

  boot().catch((err) => {
    console.error("TripSplit v3.11 bootstrap failed", err);
    const el = document.getElementById("authMessage");
    if (el) {
      el.className = "message error";
      el.style.display = "block";
      el.textContent = "v3.11 yüklenemedi: " + (err?.message || err);
    }
  });
})();