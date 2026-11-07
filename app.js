(() => {
"use strict";

const $ = id => document.getElementById(id);
const PAGE_SIZE = 48;
const PLAYLIST_URL = "./data/playlist.m3u";
const INDIA_PLAYLIST_URL = "./data/india-working.m3u";
let channels = [];
let indiaChannels = [];
let indiaFiltered = [];
let indiaPage = 0;
const INDIA_PAGE_SIZE = 48;
let filtered = [];
let page = 0;
let hls = null;

const video = $("video");


function safeUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return ["http:","https:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}

function countryName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "International";

  const aliases = {
    US:"United States",USA:"United States",GB:"United Kingdom",UK:"United Kingdom",
    KR:"South Korea",KP:"North Korea",AE:"United Arab Emirates",
    RU:"Russia",CZ:"Czechia",TR:"Turkey",VN:"Vietnam",TW:"Taiwan",HK:"Hong Kong"
  };

  const upper = raw.toUpperCase();
  if (aliases[upper]) return aliases[upper];

  if (/^[A-Z]{2}$/.test(upper)) {
    try {
      return new Intl.DisplayNames(["en"],{type:"region"}).of(upper) || raw;
    } catch {}
  }
  return raw;
}

function getCountry(attrs, tvgId) {
  const explicit = attrs["tvg-country"] || attrs.country;
  if (explicit) return countryName(explicit);

  const named = String(tvgId || "").match(/@([A-Za-z][A-Za-z ]+)$/);
  if (named && named[1].length > 2) return countryName(named[1]);

  const code = String(tvgId || "").match(/\.([a-z]{2})@/i);
  return code ? countryName(code[1]) : "International";
}

function parsePlaylist(data) {
  const result = [];
  let pending = null;

  for (const rawLine of data.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF")) {
      const comma = line.lastIndexOf(",");
      const attrs = {};
      for (const match of line.matchAll(/([\w-]+)="([^"]*)"/g)) {
        attrs[match[1].toLowerCase()] = match[2];
      }

      pending = {
        name: comma >= 0 ? line.slice(comma + 1).trim() : "Live Channel",
        country: getCountry(attrs,attrs["tvg-id"]),
        logo: safeUrl(attrs["tvg-logo"])
      };
      continue;
    }

    if (pending && !line.startsWith("#")) {
      const url = safeUrl(line);
      if (url) {
        result.push({
          id: result.length,
          name: pending.name || "Live Channel",
          country: pending.country,
          logo: pending.logo,
          url
        });
      }
      pending = null;
    }
  }
  return result;
}

function parseIndiaPlaylist(data) {
  const result = [];
  const seen = new Set();
  let pending = null;

  for (const rawLine of data.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const comma = line.lastIndexOf(",");
      const attrs = {};
      for (const match of line.matchAll(/([\w-]+)="([^"]*)"/g)) {
        attrs[match[1].toLowerCase()] = match[2];
      }
      pending = {
        name: comma >= 0 ? line.slice(comma + 1).trim() : "Indian Live Channel",
        category: attrs["group-title"] || "Other",
        logo: safeUrl(attrs["tvg-logo"])
      };
      continue;
    }
    if (pending && !line.startsWith("#")) {
      const url = safeUrl(line);
      const name = pending.name || "Indian Live Channel";
      // DD/WAVES entries were deliberately removed from this directory.
      const excluded = /^(?:DD\b|Doordarshan\b)|WAVES/i.test(name);
      if (url && !excluded && !seen.has(url)) {
        seen.add(url);
        result.push({
          id: result.length,
          name,
          country: `INDIA • ${pending.category}`,
          category: pending.category,
          logo: pending.logo,
          url
        });
      }
      pending = null;
    }
  }
  return result;
}

function getFavorites() {
  try {
    const value = JSON.parse(localStorage.getItem("akshaytv-favorites") || "[]");
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}

let favorites = getFavorites();

function saveFavorites() {
  try {
    localStorage.setItem("akshaytv-favorites",JSON.stringify([...favorites]));
  } catch {
    $("loadStatus").textContent = "Favorites could not be saved by this browser.";
  }
}

function makeCard(channel) {
  const card = document.createElement("article");
  card.className = "channel-card";

  const top = document.createElement("div");
  top.className = "channel-top";

  const logo = document.createElement("div");
  logo.className = "channel-logo";
  logo.textContent = "▶";

  if (channel.logo) {
    const img = document.createElement("img");
    img.src = channel.logo;
    img.alt = "";
    img.loading = "lazy";
    img.onerror = () => img.replaceWith(logo.cloneNode(true));
    logo.replaceChildren(img);
  }

  const details = document.createElement("div");
  details.className = "channel-details";

  const name = document.createElement("div");
  name.className = "channel-name";
  name.textContent = channel.name;

  const country = document.createElement("div");
  country.className = "channel-country";
  country.textContent = channel.country;

  details.append(name,country);
  top.append(logo,details);

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const play = document.createElement("button");
  play.className = "play-button";
  play.type = "button";
  play.textContent = "▶ WATCH";
  play.addEventListener("click",() => playChannel(channel));

  const fav = document.createElement("button");
  fav.className = "favorite-button";
  fav.type = "button";
  fav.textContent = favorites.has(channel.url) ? "♥" : "♡";
  fav.setAttribute("aria-label","Toggle favorite");
  fav.setAttribute("aria-pressed",String(favorites.has(channel.url)));
  fav.addEventListener("click",() => {
    if (favorites.has(channel.url)) favorites.delete(channel.url);
    else favorites.add(channel.url);
    saveFavorites();
    render();
    renderIndia();
  });

  actions.append(play,fav);
  card.append(top,actions);
  return card;
}

function updateCountries() {
  const select = $("countryFilter");
  const previous = select.value;
  const countries = [...new Set(channels.map(c => c.country))]
    .sort((a,b) => a.localeCompare(b));

  select.replaceChildren(new Option("All Countries","all"));
  countries.forEach(name => select.add(new Option(name,name)));

  if (countries.includes(previous)) select.value = previous;
}

function render() {
  const query = $("searchInput").value.toLowerCase().trim();
  const selectedCountry = $("countryFilter").value;
  const view = $("viewFilter").value;

  filtered = channels.filter(channel => {
    const matchesName = channel.name.toLowerCase().includes(query);
    const matchesCountry = selectedCountry === "all" || channel.country === selectedCountry;
    const matchesFavorite = view !== "favorites" || favorites.has(channel.url);
    return matchesName && matchesCountry && matchesFavorite;
  });

  const totalPages = Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  page = Math.min(page,totalPages-1);

  const start = page * PAGE_SIZE;
  const current = filtered.slice(start,start+PAGE_SIZE);
  const grid = $("channelGrid");
  grid.replaceChildren();

  if (!current.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = view === "favorites"
      ? "No favorites yet. Tap ♡ on a channel to save it."
      : "No channels found. Try another search or country.";
    grid.append(empty);
  } else {
    const fragment = document.createDocumentFragment();
    current.forEach(channel => fragment.append(makeCard(channel)));
    grid.append(fragment);
  }

  $("totalCount").textContent = `${filtered.length.toLocaleString()} channels`;
  $("pagination").replaceChildren();

  if (filtered.length > PAGE_SIZE) {
    const previous = document.createElement("button");
    previous.textContent = "← Previous";
    previous.disabled = page === 0;
    previous.onclick = () => { page--; render(); };

    const label = document.createElement("span");
    label.textContent = `Page ${page+1} of ${totalPages}`;

    const next = document.createElement("button");
    next.textContent = "Next →";
    next.disabled = page >= totalPages-1;
    next.onclick = () => { page++; render(); };

    $("pagination").append(previous,label,next);
  } else if (filtered.length) {
    $("pagination").textContent = `Showing all ${filtered.length} channels`;
  }
}

function stopPlayer() {
  if (hls) {
    hls.destroy();
    hls = null;
  }
  video.pause();
  video.removeAttribute("src");
  video.load();
  $("playerPlaceholder").classList.remove("hidden");
}

function playChannel(channel) {
  stopPlayer();

  $("nowTitle").textContent = channel.name;
  $("playingName").textContent = channel.name;
  $("playerStatus").textContent = "Connecting...";
  $("playerPlaceholder").classList.add("hidden");

  const isHls = /\.m3u8($|[?#])/i.test(channel.url);

  if (isHls && window.Hls && Hls.isSupported()) {
    hls = new Hls({enableWorker:true});
    hls.loadSource(channel.url);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED,() => {
      $("playerStatus").textContent = "Stream loaded";
      video.play().catch(() => {
        $("playerStatus").textContent = "Press Play to start";
      });
    });

    hls.on(Hls.Events.ERROR,(_,data) => {
      if (data.fatal) $("playerStatus").textContent = "Stream unavailable or blocked";
    });
  } else {
    video.src = channel.url;
    video.play().then(() => {
      $("playerStatus").textContent = "Playing";
    }).catch(() => {
      $("playerStatus").textContent = "Cannot play this stream in browser";
    });
  }

  $("watch").scrollIntoView({behavior:"smooth"});
}

function updateIndiaCategories() {
  const select = $("indiaCategoryFilter");
  const previous = select.value;
  const categories = [...new Set(indiaChannels.map(c => c.category))]
    .filter(Boolean).sort((a,b) => a.localeCompare(b));
  select.replaceChildren(new Option("All categories","all"));
  categories.forEach(name => select.add(new Option(name,name)));
  if (categories.includes(previous)) select.value = previous;
}

function renderIndia() {
  const search = $("indiaSearch");
  const categorySelect = $("indiaCategoryFilter");
  const viewSelect = $("indiaViewFilter");
  const grid = $("indiaChannelGrid");
  if (!search || !categorySelect || !viewSelect || !grid) return;

  const query = search.value.toLowerCase().trim();
  const category = categorySelect.value;
  const view = viewSelect.value;
  indiaFiltered = indiaChannels.filter(channel =>
    channel.name.toLowerCase().includes(query) &&
    (category === "all" || channel.category === category) &&
    (view !== "favorites" || favorites.has(channel.url))
  );

  const totalPages = Math.max(1,Math.ceil(indiaFiltered.length/INDIA_PAGE_SIZE));
  indiaPage = Math.min(indiaPage,totalPages-1);
  const start = indiaPage * INDIA_PAGE_SIZE;
  const current = indiaFiltered.slice(start,start+INDIA_PAGE_SIZE);
  grid.replaceChildren();

  if (!current.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = view === "favorites"
      ? "No Indian favorites yet. Tap ♡ on a channel to save it."
      : "No Indian channels found. Try another search or category.";
    grid.append(empty);
  } else {
    const fragment = document.createDocumentFragment();
    current.forEach(channel => fragment.append(makeCard(channel)));
    grid.append(fragment);
  }

  $("indiaTotalCount").textContent = `${indiaFiltered.length.toLocaleString()} channels`;
  const pagination = $("indiaPagination");
  pagination.replaceChildren();
  if (indiaFiltered.length > INDIA_PAGE_SIZE) {
    const previous = document.createElement("button");
    previous.textContent = "← Previous";
    previous.disabled = indiaPage === 0;
    previous.onclick = () => { indiaPage--; renderIndia(); };
    const label = document.createElement("span");
    label.textContent = `Page ${indiaPage+1} of ${totalPages}`;
    const next = document.createElement("button");
    next.textContent = "Next →";
    next.disabled = indiaPage >= totalPages-1;
    next.onclick = () => { indiaPage++; renderIndia(); };
    pagination.append(previous,label,next);
  } else if (indiaFiltered.length) {
    pagination.textContent = `Showing all ${indiaFiltered.length} Indian channels`;
  }
}

async function loadIndiaChannels() {
  const status = $("indiaLoadStatus");
  try {
    const response = await fetch(INDIA_PLAYLIST_URL,{cache:"no-store"});
    if (!response.ok) throw new Error("India playlist HTTP " + response.status);
    const data = await response.text();
    if (!data.trimStart().startsWith("#EXTM3U")) throw new Error("Invalid India playlist format");

indiaChannels = parseIndiaPlaylist(data);
const popularFirst = [
  "Aaj Tak", "ABP News", "India TV", "NDTV India", "Zee News",
  "News18 India", "Republic Bharat", "TV9 Bharatvarsh", "News24",
  "News Nation", "CNBC Awaaz", "Zee Business", "Zee TV",
  "Colors", "Sony SAB", "Star Bharat", "Zee Cinema", "9XM"
];
indiaChannels.sort((a,b) => {
  const rank = name => {
    const i = popularFirst.findIndex(x => name.toLowerCase().includes(x.toLowerCase()));
    return i < 0 ? 999 : i;
  };
  return rank(a.name) - rank(b.name);
});

    updateIndiaCategories();
    renderIndia();
    status.textContent = `Loaded ${indiaChannels.length.toLocaleString()} Indian stream listings. Availability and playback depend on each provider.`;
  } catch (error) {
    console.error("India playlist loading error:",error);
    status.textContent = "Could not load Indian channels: " + error.message;
  }
}

async function loadChannels() {
  $("loadStatus").textContent = "Loading worldwide playlist...";

  try {
    const response = await fetch(PLAYLIST_URL,{cache:"no-store"});
    if (!response.ok) throw new Error("Playlist HTTP " + response.status);

    const data = await response.text();
    if (!data.trimStart().startsWith("#EXTM3U")) {
      throw new Error("Playlist format is invalid");
    }

    channels = parsePlaylist(data);
    if (!channels.length) throw new Error("No valid stream URLs found");

    updateCountries();
    render();

    const countryCount = new Set(channels.map(c => c.country)).size;
    $("loadStatus").textContent =
      `Loaded ${channels.length.toLocaleString()} channels across ${countryCount} country groups. Some streams may be offline or region-restricted.`;
  } catch (error) {
    console.error("Playlist loading error:",error);
    $("loadStatus").textContent = "Could not load playlist: " + error.message;
    $("totalCount").textContent = "0 channels";
    $("channelGrid").innerHTML =
      '<div class="empty">Worldwide playlist unavailable. Please refresh.</div>';
  }
}


$("indiaSearch").addEventListener("input",() => {
  indiaPage = 0;
  renderIndia();
});

$("indiaCategoryFilter").addEventListener("change",() => {
  indiaPage = 0;
  renderIndia();
});

$("indiaViewFilter").addEventListener("change",() => {
  indiaPage = 0;
  renderIndia();
});

$("searchInput").addEventListener("input",() => {
  page = 0;
  render();
});

$("countryFilter").addEventListener("change",() => {
  page = 0;
  render();
});

$("viewFilter").addEventListener("change",() => {
  page = 0;
  render();
});

$("fullscreenBtn").addEventListener("click",() => {
  if (video.requestFullscreen) video.requestFullscreen();
  else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
});

$("stopBtn").addEventListener("click",() => {
  stopPlayer();
  $("playerStatus").textContent = "Playback stopped";
});

video.addEventListener("error",() => {
  $("playerStatus").textContent = "Playback failed: stream may be offline or blocked";
});
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(console.warn);
}

loadChannels();
loadIndiaChannels();
})();
