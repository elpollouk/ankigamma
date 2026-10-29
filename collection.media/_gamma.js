(function() {

const VERSION = "3";
const API_KEY = "anon_abair";
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024; // Total estimated size across cached audio entries.
const CACHE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_DATABASE_NAME = "ankigamma-audio-cache";
const CACHE_STORE_NAME = "audio";

const STYLE = `
.gamma button {
  color: #ffffff;
  border: none;
  padding: 10px 18px;
  font-size: 16px;
  border-radius: 8px;
  cursor: pointer;
  margin-top: 10px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: background-color 0.2s ease;
  -webkit-touch-callout: none;
  user-select: none;
}

.gamma button:active {
  transform: scale(0.9);
}

.gamma-version-watermark {
  position: fixed;
  right: 6px;
  bottom: 4px;
  z-index: 2147483646;
  margin: 0;
  padding: 2px 4px;
  border: 0;
  background: transparent;
  color: rgba(128, 128, 128, 0.65);
  font: 10px sans-serif;
  cursor: pointer;
}

.gamma-stats-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.6);
  color: #ffffff;
  font: 16px sans-serif;
}

.gamma-stats-panel {
  box-sizing: border-box;
  width: 100%;
  max-width: 360px;
  padding: 20px;
  border-radius: 12px;
  background: #252525;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.gamma-stats-panel h2 {
  margin: 0 0 14px;
  font-size: 20px;
}

.gamma-stats-panel dl {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px 16px;
  margin: 0 0 16px;
}

.gamma-stats-panel dt,
.gamma-stats-panel dd {
  margin: 0;
}

.gamma-stats-panel dt {
  text-align: left;
}

.gamma-stats-panel dd {
  text-align: right;
}

.gamma-stats-panel button {
  box-sizing: border-box;
  color: #ffffff;
  border: none;
  padding: 10px 18px;
  font-size: 16px;
  width: 100%;
  border-radius: 8px;
  margin: 0;
  background: #555555;
  cursor: pointer;
}
`;

const REQUESTS = {
    gaeilge: async (input) => {
        const response = await fetch("https://api.abair.ie/v4/synthesis", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Abair-Api-Key": API_KEY,
            },
            body: JSON.stringify({ input, voice: "sibeal" }),
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const json = await response.json();
        if (!json.audioContent) {
            throw new Error("No audio content returned from the API.");
        }
        return `data:audio/wav;base64,${json.audioContent}`;
    },
}

let cacheDatabasePromise;
let cacheWarningShown = false;

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
}

async function transformAudioBytes(bytes, CompressionStreamType) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStreamType("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function encodeCachedAudio(audio) {
    if (typeof CompressionStream === "undefined" || typeof DecompressionStream === "undefined" ||
        typeof Blob === "undefined" || typeof Blob.prototype.stream !== "function" || typeof Response === "undefined") {
        return { audio, size: audio.length * 2 };
    }

    const dataUri = /^data:audio\/wav;base64,(.*)$/.exec(audio);
    if (!dataUri) {
        return { audio, size: audio.length * 2 };
    }

    const uncompressed = base64ToBytes(dataUri[1]);
    const compressed = await transformAudioBytes(uncompressed, CompressionStream);
    const compressionRatio = (compressed.byteLength / uncompressed.byteLength) * 100;
    console.info(
        `Anki Gamma: audio compression: ${uncompressed.byteLength} bytes uncompressed, ` +
        `${compressed.byteLength} bytes compressed (${compressionRatio.toFixed(1)}% of original).`
    );
    if (compressed.byteLength >= audio.length * 2) {
        return { audio, size: audio.length * 2 };
    }
    return { audio: compressed, encoding: "gzip", size: compressed.byteLength };
}

async function decodeCachedAudio(entry) {
    if (entry.encoding !== "gzip") {
        return entry.audio;
    }
    if (typeof DecompressionStream === "undefined") {
        throw new Error("DecompressionStream is not available.");
    }

    const bytes = await transformAudioBytes(entry.audio, DecompressionStream);
    return `data:audio/wav;base64,${bytesToBase64(bytes)}`;
}

async function openCacheDatabase() {
    if (typeof indexedDB === "undefined") {
        throw new Error("IndexedDB is not available.");
    }

    if (!cacheDatabasePromise) {
        cacheDatabasePromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(CACHE_DATABASE_NAME, 1);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(CACHE_STORE_NAME)) {
                    request.result.createObjectStore(CACHE_STORE_NAME, { keyPath: "key" });
                }
            };
            request.onsuccess = () => {
                request.result.onversionchange = () => request.result.close();
                resolve(request.result);
            };
            request.onerror = () => reject(request.error || new Error("Could not open the audio cache."));
        }).catch(error => {
            cacheDatabasePromise = null;
            throw error;
        });
    }

    return cacheDatabasePromise;
}

async function stats() {
    const database = await openCacheDatabase();
    const entries = await new Promise((resolve, reject) => {
        const transaction = database.transaction(CACHE_STORE_NAME, "readonly");
        const request = transaction.objectStore(CACHE_STORE_NAME).getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Could not read the audio cache stats."));
        transaction.onerror = () => reject(transaction.error || new Error("Could not read the audio cache stats."));
        transaction.onabort = () => reject(transaction.error || new Error("Audio cache stats read was aborted."));
    });
    const totalSizeBytes = entries.reduce((total, entry) => total + entry.size, 0);
    const largestEntry = entries.reduce((largest, entry) => entry.size > largest.size ? entry : largest, entries[0]);
    const smallestEntry = entries.reduce((smallest, entry) => entry.size < smallest.size ? entry : smallest, entries[0]);
    const stats = {
        entryCount: entries.length,
        estimatedSizeBytes: totalSizeBytes,
        maximumSizeBytes: MAX_CACHE_SIZE_BYTES,
        utilizationPercent: MAX_CACHE_SIZE_BYTES > 0 ? Number((totalSizeBytes / MAX_CACHE_SIZE_BYTES * 100).toFixed(1)) : null,
        averageEntrySizeBytes: entries.length ? Number((totalSizeBytes / entries.length).toFixed(1)) : 0,
        largestEntry: largestEntry ? { key: largestEntry.key, sizeBytes: largestEntry.size } : null,
        smallestEntry: smallestEntry ? { key: smallestEntry.key, sizeBytes: smallestEntry.size } : null,
    };

    console.info("Anki Gamma: audio cache database stats", stats);
    return stats;
}

window.$gamma = window.$gamma || {};
window.$gamma.stats = stats;

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KiB", "MiB", "GiB"];
    let value = bytes;
    let unitIndex = -1;
    do {
        value /= 1024;
        unitIndex++;
    } while (value >= 1024 && unitIndex < units.length - 1);
    return `${value.toFixed(1)} ${units[unitIndex]}`;
}

async function showStats() {
    const cacheStats = await stats();
    const existingOverlay = document.querySelector(".gamma-stats-overlay");
    if (existingOverlay) existingOverlay.remove();

    const overlay = document.createElement("div");
    overlay.className = "gamma-stats-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "gamma-stats-title");

    const panel = document.createElement("section");
    panel.className = "gamma-stats-panel";
    const title = document.createElement("h2");
    title.id = "gamma-stats-title";
    title.textContent = "Audio cache";
    panel.appendChild(title);

    const details = document.createElement("dl");
    const rows = [
        ["Entries", cacheStats.entryCount],
        ["Storage used", formatBytes(cacheStats.estimatedSizeBytes)],
        ["Maximum", formatBytes(cacheStats.maximumSizeBytes)],
        ["Used", cacheStats.utilizationPercent === null ? "N/A" : `${cacheStats.utilizationPercent}%`],
        ["Average entry", formatBytes(cacheStats.averageEntrySizeBytes)],
        ["Largest entry", cacheStats.largestEntry ? formatBytes(cacheStats.largestEntry.sizeBytes) : "N/A"],
        ["Smallest entry", cacheStats.smallestEntry ? formatBytes(cacheStats.smallestEntry.sizeBytes) : "N/A"],
    ];
    for (const [label, value] of rows) {
        const term = document.createElement("dt");
        term.textContent = label;
        const description = document.createElement("dd");
        description.textContent = String(value);
        details.append(term, description);
    }
    panel.appendChild(details);

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "Close";
    panel.appendChild(closeButton);
    overlay.appendChild(panel);

    const close = () => {
        overlay.remove();
        document.removeEventListener("keydown", onKeyDown);
    };
    const onKeyDown = event => {
        if (event.key === "Escape") close();
    };
    closeButton.addEventListener("click", close);
    overlay.addEventListener("click", event => {
        if (event.target === overlay) close();
    });
    document.addEventListener("keydown", onKeyDown);
    document.body.appendChild(overlay);
    closeButton.focus();
}

async function readCachedAudio(key) {
    const database = await openCacheDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(CACHE_STORE_NAME, "readwrite");
        const store = transaction.objectStore(CACHE_STORE_NAME);
        const request = store.get(key);
        let cachedEntry = null;
        let expiredEntrySize = 0;

        request.onsuccess = () => {
            const entry = request.result;
            if (!entry) return;

            if (Date.now() - entry.createdAt >= CACHE_EXPIRY_MS) {
                store.delete(key);
                expiredEntrySize = entry.size;
                return;
            }

            entry.lastAccessedAt = Date.now();
            store.put(entry);
            cachedEntry = entry;
        };
        request.onerror = () => reject(request.error || new Error("Could not read the audio cache."));
        transaction.oncomplete = async () => {
            if (expiredEntrySize) {
                console.info(`Anki Gamma: evicted 1 expired cache entry (${expiredEntrySize} estimated bytes).`);
            }
            try {
                resolve(cachedEntry ? await decodeCachedAudio(cachedEntry) : null);
            } catch (error) {
                reject(error);
            }
        };
        transaction.onerror = () => reject(transaction.error || new Error("Could not read the audio cache."));
        transaction.onabort = () => reject(transaction.error || new Error("Audio cache read was aborted."));
    });
}

async function writeCachedAudio(key, audio) {
    const cachedAudio = await encodeCachedAudio(audio);
    const size = cachedAudio.size;
    if (size > MAX_CACHE_SIZE_BYTES || MAX_CACHE_SIZE_BYTES <= 0) {
        return;
    }

    const database = await openCacheDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(CACHE_STORE_NAME, "readwrite");
        const store = transaction.objectStore(CACHE_STORE_NAME);
        const request = store.getAll();
        let expiredEntryCount = 0;
        let expiredEntrySize = 0;
        let lruEntryCount = 0;
        let lruEntrySize = 0;
        let finalEntryCount = 0;
        let finalCacheSize = 0;

        request.onsuccess = () => {
            const now = Date.now();
            const entries = request.result.filter(entry => {
                if (now - entry.createdAt >= CACHE_EXPIRY_MS) {
                    store.delete(entry.key);
                    expiredEntryCount++;
                    expiredEntrySize += entry.size;
                    return false;
                }
                return entry.key !== key;
            });

            let totalSize = entries.reduce((total, entry) => total + entry.size, 0);
            entries.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

            while (totalSize + size > MAX_CACHE_SIZE_BYTES && entries.length) {
                const oldest = entries.shift();
                totalSize -= oldest.size;
                store.delete(oldest.key);
                lruEntryCount++;
                lruEntrySize += oldest.size;
            }

            store.put({ key, ...cachedAudio, createdAt: now, lastAccessedAt: now });
            finalEntryCount = entries.length + 1;
            finalCacheSize = totalSize + size;
        };
        request.onerror = () => reject(request.error || new Error("Could not update the audio cache."));
        transaction.oncomplete = () => {
            if (expiredEntryCount) {
                console.info(`Anki Gamma: evicted ${expiredEntryCount} expired cache entries (${expiredEntrySize} estimated bytes).`);
            }
            if (lruEntryCount) {
                console.info(`Anki Gamma: evicted ${lruEntryCount} least-recently-used cache entries to make room (${lruEntrySize} estimated bytes).`);
            }
            const cacheUtilizationPercent = (finalCacheSize / MAX_CACHE_SIZE_BYTES * 100).toFixed(1);
            console.info(`Anki Gamma: cache size is ${finalCacheSize} estimated bytes (${cacheUtilizationPercent}% of maximum) across ${finalEntryCount} entries.`);
            resolve();
        };
        transaction.onerror = () => reject(transaction.error || new Error("Could not update the audio cache."));
        transaction.onabort = () => reject(transaction.error || new Error("Audio cache write was aborted."));
    });
}

function warnCacheFailure(error) {
    if (!cacheWarningShown) {
        console.warn("Anki Gamma: audio caching is unavailable; continuing without cache.", error);
        cacheWarningShown = true;
    }
}

async function getCachedAudio(key) {
    if (MAX_CACHE_SIZE_BYTES <= 0) return null;

    try {
        return await readCachedAudio(key);
    } catch (error) {
        warnCacheFailure(error);
        return null;
    }
}

async function cacheAudio(key, audio) {
    try {
        await writeCachedAudio(key, audio);
    } catch (error) {
        warnCacheFailure(error);
    }
}

// Extract the configuration for this playback element
const currentScript = document.currentScript;
if (!currentScript) {
    throw new Error("This script must be included in a <script> tag.");
}
const language = currentScript.dataset.language || 'gaeilge';
const phrase = currentScript.dataset.phrase || 'Dia duit';
const input = /%[0-9A-Fa-f]{2}/.test(phrase) ? decodeURIComponent(phrase) : phrase;

// Create the DOM elements to insert into the card and make sure they are available for the functions below to use
const root = document.createElement("div");
const requestButton = document.createElement("button");
const player = document.createElement("audio");

// Function to handle the request and playback of the audio
async function speak() {
    requestButton.disabled = true;

    if (!player.src) {
        requestButton.innerText = "⏳";
        const cacheKey = `v1|${language}|v4|sibeal|${input}`;
        const cachedAudio = await getCachedAudio(cacheKey);
        if (cachedAudio) {
            player.src = cachedAudio;
            console.info("Anki Gamma: playing audio from cache.");
        } else {
            console.info("Anki Gamma: fetching audio from HTTP service.");
            const request = REQUESTS[language];
            player.src = await request(input);
            await cacheAudio(cacheKey, player.src);
        }
    }

    await player.play();
}

function onerror(error) {
    alert(error.message);
    requestButton.disabled = true;
    requestButton.innerText = "❌";
}

// Make sure the style is only added once to the document
if (!document.querySelector('style.gamma')) {
  const style = document.createElement('style');
  style.className = 'gamma';
  style.textContent = STYLE;
  document.head.appendChild(style);
}

// Build the DOM for the playback element and insert it into the card
requestButton.innerText = "🔈";
requestButton.onclick = () => speak().catch(onerror);
player.hidden = true;
player.onplaying = () => {
    requestButton.innerText = "🔊";
};
player.onended = () => {
    requestButton.disabled = false;
    requestButton.innerText = "🔈";
};
root.classList.add("gamma");
root.appendChild(requestButton);
root.appendChild(player);

currentScript.insertAdjacentElement("beforebegin", root);

if (!document.querySelector(".gamma-version-watermark")) {
    const versionWatermark = document.createElement("button");
    versionWatermark.type = "button";
    versionWatermark.className = "gamma-version-watermark";
    versionWatermark.textContent = `v${VERSION}`;
    versionWatermark.setAttribute("aria-label", `Anki Gamma ${VERSION}: show audio cache stats`);
    versionWatermark.addEventListener("click", () => {
        showStats().catch(error => {
            console.error("Anki Gamma: could not display audio cache stats.", error);
            alert(error.message);
        });
    });
    document.body.appendChild(versionWatermark);
}
})();