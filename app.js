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

  function normalizeCountry(value) {
    const raw = String(value || "").trim();
    if (!raw) return "International";

    const map = {
      US: "United States", USA: "United States",
      GB: "United Kingdom", UK: "United Kingdom",
      IN: "India", AU: "Australia", CA: "Canada",
      FR: "France", DE: "Germany", ES: "Spain",
      IT: "Italy", JP: "Japan", KR: "South Korea",
      BR: "Brazil", MX: "Mexico", AE: "United Arab Emirates",
      SA: "Saudi Arabia", QA: "Qatar", TR: "Turkey",
      PK: "Pakistan", BD: "Bangladesh", LK: "Sri Lanka",
      CN: "China", RU: "Russia", ZA: "South Africa"
    };

    const upper = raw.toUpperCase();
    return map[upper] || raw;
  }

  function detectLanguage(name, explicit) {
    if (explicit && explicit.trim()) return explicit.trim();

    const text = String(name || "").toLowerCase();
    const languages = [
      ["English", /\benglish\b/],
      ["Hindi", /\bhindi\b/],
      ["Urdu", /\burdu\b/],
      ["Arabic", /\barabic\b/],
      ["Spanish", /\b(spanish|español|espanol)\b/],
      ["French", /\bfrench|français\b/],
      ["German", /\bgerman|deutsch\b/],
      ["Persian", /\b(persian|farsi)\b/],
      ["Portuguese", /\bportuguese\b/],
      ["Russian", /\brussian\b/],
      ["Chinese", /\b(chinese|mandarin)\b/],
      ["Bengali", /\b(bengali|bangla)\b/],
      ["Tamil", /\btamil\b/],
      ["Telugu", /\btelugu\b/],
      ["Japanese", /\bjapanese\b/],
      ["Korean", /\bkorean\b/]
    ];

    const found = languages.find(([, pattern]) => pattern.test(text));
    return found ? found[0] : "Unknown";
  }

  function syncFilter(select, values, label) {
    if (!select) return;
    const previous = select.value;
    select.innerHTML = "";
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = "All " + label;
    select.appendChild(all);

    values.forEach(value => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });

    select.value = values.includes(previous) ? previous : "all";
  }

  function stopPlayback() {
    if (hls) { hls.destroy(); hls = null; }
    video.pause(); video.removeAttribute("src"); video.load();
  }
  function playItem(item) {
    const url = safeUrl(item.url);
    if (!url) return toast("Please use a valid http/https URL.");
    stopPlayback();

    video.querySelectorAll("track").forEach(track => track.remove());
    if (item.subtitleUrl) {
      const subtitleUrl = safeUrl(item.subtitleUrl);
      if (subtitleUrl) {
        const track = document.createElement("track");
        track.kind = "captions";
        track.label = "English";
        track.srclang = "en";
        track.src = subtitleUrl;
        track.default = true;
        video.appendChild(track);
      }
    }

    $("nowTitle").textContent = item.name;
    $("playingName").textContent = item.name;
    $("playingDescription").textContent = item.description || "Enjoy this stream. Playback depends on the source provider and browser support.";
    $("playingType").textContent = item.type === "live" ? "● LIVE CHANNEL" : "MY VIDEO";
    $("playerMessage").classList.add("hidden");
    const isHls = /\.m3u8($|[?#])/i.test(url) || item.type === "live";
    if (isHls && window.Hls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hls.loadSource(url); hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const tracks = hls.subtitleTracks || [];
        if (tracks.length) {
          let english = tracks.findIndex(track =>
            /en|english/i.test((track.lang || "") + " " + (track.name || ""))
          );
          hls.subtitleTrack = english >= 0 ? english : 0;
          hls.subtitleDisplay = true;
        }
      });
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
    const countrySelect = $("countryFilter");
    const languageSelect = $("languageFilter");

    const countries = [...new Set(items.map(item =>
      item.type === "video" ? "My Videos" : normalizeCountry(item.country)
    ))].sort();

    const languages = [...new Set(items.map(item =>
      item.language || "Unknown"
    ))].sort();

    syncFilter(countrySelect, countries, "Countries");
    syncFilter(languageSelect, languages, "Languages");

    const selectedCountry = countrySelect?.value || "all";
    const selectedLanguage = languageSelect?.value || "all";

    const visible = items.filter(item => {
      const itemCountry = item.type === "video"
        ? "My Videos"
        : normalizeCountry(item.country);
      const itemLanguage = item.language || "Unknown";

      const filterOk =
        activeFilter === "all" ||
        (activeFilter === "live" && item.type === "live") ||
        (activeFilter === "videos" && item.type === "video") ||
        (activeFilter === "favorites" && favorites.includes(item.id));

      const countryOk =
        selectedCountry === "all" || itemCountry === selectedCountry;
      const languageOk =
        selectedLanguage === "all" || itemLanguage === selectedLanguage;

      return filterOk && countryOk && languageOk &&
        (item.name + " " + (item.description || "")).toLowerCase().includes(query);
    });

    const grid = $("channelGrid");

    if (!visible.length) {
      grid.innerHTML = `<div class="empty-state"><div>▣</div><strong>Nothing found here</strong><p>Try another country, language or search.</p></div>`;
      return;
    }

    const groups = new Map();
    visible.forEach(item => {
      const country = item.type === "video"
        ? "My Videos"
        : normalizeCountry(item.country);
      if (!groups.has(country)) groups.set(country, []);
      groups.get(country).push(item);
    });

    function card(item) {
      const fav = favorites.includes(item.id);
      const initial = escapeHtml(item.name.trim().charAt(0).toUpperCase() || "▶");
      return `<article class="channel-card">
        <div class="card-top">
          <div class="channel-icon">${initial}</div>
          <span class="card-type">${item.type === "live" ? "● LIVE" : "ON DEMAND"}</span>
        </div>
        <h3 title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(item.language || "Unknown")} · ${escapeHtml(item.description || (item.type === "live" ? "Live stream" : "Personal video"))}</p>
        <div class="card-actions">
          <button data-play="${escapeHtml(item.id)}">▶ Watch</button>
          <button class="favorite" data-fav="${escapeHtml(item.id)}" aria-label="Toggle favorite">${fav ? "♥" : "♡"}</button>
        </div>
      </article>`;
    }

    grid.innerHTML = [...groups.entries()].map(([country, entries]) => `
      <section class="country-section">
        <h3 class="country-heading">${escapeHtml(country)}</h3>
        <div class="channel-grid country-grid">
          ${entries.map(card).join("")}
        </div>
      </section>
    `).join("");
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
    const subtitleInput = $("subtitleUrl")?.value.trim() || "";
    const subtitleUrl = subtitleInput ? safeUrl(subtitleInput) : "";
    if (subtitleInput && !subtitleUrl) {
      return toast("Enter a valid English VTT subtitle URL.");
    }
    if (type === "live" && !/\.m3u8($|[?#])/i.test(url)) {
      if (!confirm("This URL does not end in .m3u8. Add it anyway? Some live streams may not play.")) return;
    }
    items.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      type, name, url,
      description: $("itemDesc").value.trim(),
      subtitleUrl,
      language: "Unknown",
      country: type === "video" ? "My Videos" : "International"
    });
    save(); render(); event.target.reset(); toast("Added to your library on this device.");
  });
  document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    tab.classList.add("active"); activeFilter = tab.dataset.filter; render();
  }));
  $("searchInput").addEventListener("input", render);
  $("countryFilter").addEventListener("change", render);
  $("languageFilter").addEventListener("change", render);
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

  async function loadDefaultPlaylist() {
    const playlistUrl =
      "https://raw.githubusercontent.com/AdeelWajid/iptv_validated_list/main/playlist.m3u";

    try {
      const response = await fetch(playlistUrl);
      if (!response.ok) throw new Error("HTTP " + response.status);

      const data = await response.text();
      if (!data.trim().startsWith("#EXTM3U")) {
        throw new Error("Invalid M3U playlist");
      }

      const lines = data.split(/\r?\n/);
      let channelName = "";
      let channelCountry = "International";
      let channelLanguage = "Unknown";
      let added = 0;

      function makeId(url) {
        let hash = 2166136261;
        for (let i = 0; i < url.length; i++) {
          hash ^= url.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        return "public-" + (hash >>> 0).toString(16);
      }

      for (const line of lines) {
        if (line.startsWith("#EXTINF")) {
          const comma = line.lastIndexOf(",");
          channelName = comma >= 0
            ? line.slice(comma + 1).trim()
            : "Public TV Channel";

          const attributes = {};
          for (const match of line.matchAll(/([\w-]+)="([^"]*)"/g)) {
            attributes[match[1].toLowerCase()] = match[2];
          }

          const tvgId = attributes["tvg-id"] || "";
          const idCountry = tvgId.match(/\.([a-z]{2})@/i)?.[1] || "";
          const idLanguage = tvgId.match(/@([a-z]{3,})$/i)?.[1] || "";

          let countryValue =
            attributes["tvg-country"] || attributes["country"] || idCountry;

          if (/^[a-z]{2}$/i.test(countryValue)) {
            try {
              countryValue = new Intl.DisplayNames(["en"], {
                type: "region"
              }).of(countryValue.toUpperCase()) || countryValue;
            } catch {}
          }

          channelCountry = normalizeCountry(countryValue);
          channelLanguage = detectLanguage(
            channelName,
            attributes["tvg-language"] ||
            attributes["language"] ||
            idLanguage
          );
        } else if (channelName && line.trim() && !line.startsWith("#")) {
          const url = safeUrl(line.trim());

          if (url) {
            const id = makeId(url);
            const existing = items.find(
              item => item.id === id || item.url === url
            );

            if (existing) {
              if (!existing.country || existing.country === "International") {
                existing.country = channelCountry;
              }
              if (!existing.language || existing.language === "Unknown") {
                existing.language = channelLanguage;
              }
            } else {
              items.push({
                id,
                type: "live",
                name: channelName || "Public TV Channel",
                url,
                country: channelCountry,
                language: channelLanguage,
                description:
                  "Public playlist stream. Check broadcaster rights, region and availability.",
                source: "public-playlist"
              });
              added++;
            }
          }

          channelName = "";
        }
      }

      if (added) save();
      render();
      toast(added + " live channels loaded.");
      console.log("Public TV channels added:", added);
    } catch (error) {
      console.error("Live playlist error:", error);
      toast("Live playlist unavailable. Try again later.");
    }
  }

  render();
  loadDefaultPlaylist();
})();