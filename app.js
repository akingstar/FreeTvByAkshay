(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "ftvbyakshay.library.v1";
  const FAVORITES_KEY = "ftvbyakshay.favorites.v1";
  const video = $("video");
  let hls = null;
  let activeFilter = "all";
  let items = load(STORAGE_KEY, []);
  let favorites = load(FAVORITES_KEY, []);
  let deferredInstall = null;

  function load(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key)); return Array.isArray(value) ? value : fallback; }
    catch { return fallback; }
  }
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  }
  function toast(message) {
    const el = $("toast"); el.textContent = message; el.classList.add("show");
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
  }
  function safeUrl(value) {
    try { const u = new URL(value); return ["https:", "http:"].includes(u.protocol) ? u.href : null; }
    catch { return null; }
  }
  function stopPlayback() {
    if (hls) { hls.destroy(); hls = null; }
    video.pause(); video.removeAttribute("src"); video.load();
  }
  function playItem(item) {
    const url = safeUrl(item.url);
    if (!url) return toast("Please use a valid http/https URL.");
    stopPlayback();
    $("nowTitle").textContent = item.name;
    $("playingName").textContent = item.name;
    $("playingDescription").textContent = item.description || "Enjoy this stream. Playback depends on the source provider and browser support.";
    $("playingType").textContent = item.type === "live" ? "● LIVE CHANNEL" : "MY VIDEO";
    $("playerMessage").classList.add("hidden");
    const isHls = /\.m3u8($|[?#])/i.test(url) || item.type === "live";
    if (isHls && window.Hls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hls.loadSource(url); hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) toast("Stream unavailable. Check the URL, CORS and provider restrictions.");
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl") && isHls) {
      video.src = url;
    } else {
      video.src = url;
    }
    video.play().catch(() => toast("Press Play in the video player to start."));
    $("watch").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function render() {
    const query = $("searchInput").value.trim().toLowerCase();
    const visible = items.filter(item => {
      const filterOk = activeFilter === "all" || (activeFilter === "live" && item.type === "live") ||
        (activeFilter === "videos" && item.type === "video") || (activeFilter === "favorites" && favorites.includes(item.id));
      return filterOk && (item.name + " " + (item.description || "")).toLowerCase().includes(query);
    });
    const grid = $("channelGrid");
    if (!visible.length) {
      grid.innerHTML = `<div class="empty-state"><div>▣</div><strong>${items.length ? "Nothing found here" : "Your library is empty"}</strong><p>${items.length ? "Try another search or category." : "Add a legal stream or a video URL you own."}</p></div>`;
      return;
    }
    grid.innerHTML = visible.map(item => {
      const fav = favorites.includes(item.id);
      const initial = escapeHtml(item.name.trim().charAt(0).toUpperCase() || "▶");
      return `<article class="channel-card">
        <div class="card-top"><div class="channel-icon">${initial}</div><span class="card-type">${item.type === "live" ? "● LIVE" : "ON DEMAND"}</span></div>
        <h3 title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(item.description || (item.type === "live" ? "Live stream" : "Personal video"))}</p>
        <div class="card-actions"><button data-play="${item.id}">▶ Watch</button><button class="favorite" data-fav="${item.id}" aria-label="Toggle favorite">${fav ? "♥" : "♡"}</button></div>
      </article>`;
    }).join("");
  }
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  }
  $("channelGrid").addEventListener("click", event => {
    const playId = event.target.closest("[data-play]")?.dataset.play;
    const favId = event.target.closest("[data-fav]")?.dataset.fav;
    if (playId) { const item = items.find(x => x.id === playId); if (item) playItem(item); }
    if (favId) { favorites = favorites.includes(favId) ? favorites.filter(x => x !== favId) : [...favorites, favId]; save(); render(); }
  });
  $("addForm").addEventListener("submit", event => {
    event.preventDefault();
    const name = $("itemName").value.trim(), url = safeUrl($("itemUrl").value.trim());
    if (!name || !url) return toast("Enter a name and a valid http/https URL.");
    const type = $("itemType").value;
    if (type === "live" && !/\.m3u8($|[?#])/i.test(url)) {
      if (!confirm("This URL does not end in .m3u8. Add it anyway? Some live streams may not play.")) return;
    }
    items.unshift({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), type, name, url, description: $("itemDesc").value.trim() });
    save(); render(); event.target.reset(); toast("Added to your library on this device.");
  });
  document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    tab.classList.add("active"); activeFilter = tab.dataset.filter; render();
  }));
  $("searchInput").addEventListener("input", render);
  $("browseBtn").addEventListener("click", () => $("channels").scrollIntoView({ behavior:"smooth" }));
  $("addVideoHero").addEventListener("click", () => { $("itemType").value = "video"; $("add").scrollIntoView({ behavior:"smooth" }); $("itemName").focus(); });
  $("fullscreenBtn").addEventListener("click", () => {
    const target = $("video").parentElement;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else target.requestFullscreen?.().catch(() => toast("Full screen is not available in this browser."));
  });
  $("year").textContent = new Date().getFullYear();
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault(); deferredInstall = event; $("installBtn").classList.remove("hidden");
  });
  $("installBtn").addEventListener("click", async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $("installBtn").classList.add("hidden");
  });
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
  render();
})();