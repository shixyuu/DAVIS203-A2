/**
 * Exhibition Reveal System — Chronological Replay & Local Cache
 *
 * 1. Automatically connects to Worker B in background, receives 15s video chunks,
 *    and caches them in browser IndexedDB with deduplication.
 * 2. Clicking "Play" plays all cached chunks chronologically in seamless fullscreen loop.
 */

// Set your Cloudflare Worker B WebSocket URL here (leave empty for standalone local mode)
const WORKER_B_WS =
  window.location.protocol === "https:"
    ? `wss://${window.location.host}/ws?role=consumer&room=main`
    : (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? "wss://digital-wasteland-worker-b-video.dsm-project.workers.dev/ws?role=consumer&room=main"
    : "wss://digital-wasteland-worker-b-video.dsm-project.workers.dev/ws?role=consumer&room=main";

const DB_NAME = "DigitalWastelandVaultV2";
const STORE_NAME = "video_chunks";

const videoEl = document.getElementById("replay-video");
const overlayEl = document.getElementById("start-overlay");
const startBtn = document.getElementById("btn-start-reveal");
const statusEl = document.getElementById("cache-status");

let dbInstance = null;
let chunks = [];
let currentIndex = 0;
let currentUrl = null;
let pendingMeta = null;
let isPlayingReveal = false;

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "chunkId",
        });
        store.createIndex("recordedAt", "recordedAt", { unique: false });
      }
    };
    req.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

async function saveChunk(meta, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const chunkId = meta.chunkId || `chunk-${meta.recordedAt || Date.now()}`;
    const req = tx.objectStore(STORE_NAME).put({
      chunkId,
      recordedAt: meta.recordedAt || Date.now(),
      mimeType: meta.mimeType || blob.type || "video/mp4",
      blob,
    });
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

async function loadChunks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).index("recordedAt").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function refreshCount() {
  chunks = await loadChunks();
  const totalMB = (
    chunks.reduce((acc, c) => acc + (c.blob ? c.blob.size : 0), 0) /
    (1024 * 1024)
  ).toFixed(2);
  statusEl.textContent = `Local cache: ${chunks.length} clip(s) (${totalMB} MB)`;
}

function playAt(index) {
  if (index < 0 || index >= chunks.length) return;
  currentIndex = index;
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(chunks[index].blob);
  videoEl.src = currentUrl;
  videoEl.play().catch(() => {});
}

videoEl.addEventListener("ended", async () => {
  chunks = await loadChunks();
  if (currentIndex + 1 < chunks.length) {
    playAt(currentIndex + 1);
  } else if (chunks.length > 0) {
    playAt(0);
  }
});

videoEl.addEventListener("click", () => {
  overlayEl.classList.remove("hidden");
  videoEl.pause();
  isPlayingReveal = false;
});

startBtn.addEventListener("click", async () => {
  await refreshCount();
  isPlayingReveal = true;
  overlayEl.classList.add("hidden");
  if (chunks.length > 0) {
    playAt(0);
  }
});

function connectWorkerB() {
  if (!WORKER_B_WS) return;
  try {
    const ws = new WebSocket(WORKER_B_WS);
    ws.binaryType = "arraybuffer";

    ws.onmessage = async (event) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "chunk_meta") pendingMeta = msg;
        } catch (_) {}
      } else if (event.data instanceof ArrayBuffer) {
        const meta = pendingMeta || {
          chunkId: `chunk-${Date.now()}`,
          mimeType: "video/mp4",
          recordedAt: Date.now(),
        };
        pendingMeta = null;
        const blob = new Blob([event.data], { type: meta.mimeType || "video/mp4" });
        await saveChunk(meta, blob);
        await refreshCount();

        if (isPlayingReveal && (videoEl.paused || !videoEl.src) && chunks.length > 0) {
          playAt(chunks.length - 1);
        }
      }
    };

    ws.onclose = () => {
      setTimeout(connectWorkerB, 2500);
    };
  } catch (_) {}
}

refreshCount();
connectWorkerB();
