/**
 * Digital Wasteland — Multi-Device Surveillance Matrix
 *
 * Core Enhancements:
 * 1. Ultra-Minimalist: All text removed except the glowing "LIVE" indicator badge.
 * 2. True Centering: Perfect horizontal & vertical centering (0 phantom ghost frames).
 * 3. Multi-Device Side-by-Side: Dynamic lanes that only exist when footage is active.
 * 4. Infinite Loop Playback: Active slice loops continuously until the next chunk arrives.
 * 5. Feed Timestamp Pill: Real-time reception clock & delta interval (seconds) in bottom-right.
 * 6. Low GPU Footprint: Deep DOM cull (<=3 cards per deck), zero backdrop-blur, paused non-front videos.
 */

// Cloudflare Worker B WebSocket URL (dynamically resolves to host when deployed on Worker, empty in standalone mode)
const WORKER_B_WS =
  window.location.protocol === "https:" || window.location.protocol === "http:"
    ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws?role=consumer&room=main`
    : "";

const DB_NAME = "DigitalWastelandVaultV3";
const STORE_NAME = "video_chunks";
const MAX_DOM_CARDS_PER_DEVICE = 3; // Keep GPU lean by limiting 3D cards in DOM

const lanesContainer = document.getElementById("lanes");
const telemetryTimeEl = document.getElementById("telemetry-time");
const telemetryPillEl = document.getElementById("telemetry-pill");

let dbInstance = null;
let activeWs = null;
let lastChunkArrivalTs = 0;
const deviceLanes = new Map();

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const pad2 = (n) => String(n).padStart(2, "0");
function fmtTime(ts) {
  const d = new Date(ts || Date.now());
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

/* ---------------- IndexedDB ---------------- */
function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "chunkId" });
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
    tx.objectStore(STORE_NAME).put({
      chunkId,
      recordedAt: meta.recordedAt || Date.now(),
      deviceId: meta.deviceId || "node-default",
      mimeType: meta.mimeType || blob.type || "video/mp4",
      blob,
    });
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function loadCachedChunks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).index("recordedAt").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function clearAllCachedChunks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

/* ---------------- 设备通道 Lane 管理（无虚假占位框） ---------------- */
function getOrCreateDeviceLane(deviceId = "node-default") {
  if (deviceLanes.has(deviceId)) {
    return deviceLanes.get(deviceId);
  }

  const laneEl = document.createElement("div");
  laneEl.className = "lane";
  laneEl.dataset.deviceId = deviceId;

  const deckEl = document.createElement("div");
  deckEl.className = "deck";

  laneEl.appendChild(deckEl);
  lanesContainer.appendChild(laneEl);

  const laneData = {
    deviceId,
    laneEl,
    deckEl,
    clips: [],
    pos: 0,
    isInteracting: false,
    lastInteractionTime: 0,
  };

  setupLaneInteraction(laneData);
  deviceLanes.set(deviceId, laneData);
  return laneData;
}

function removeLaneIfEmpty(laneData) {
  if (laneData.clips.length === 0) {
    if (laneData.laneEl.parentNode) {
      laneData.laneEl.parentNode.removeChild(laneData.laneEl);
    }
    deviceLanes.delete(laneData.deviceId);
  }
}

/* ---------------- 监视卡片构建（仅保留 LIVE 呼吸标，支持无缝循环） ---------------- */
function buildCard(item) {
  const el = document.createElement("article");
  el.className = "card is-portrait";

  const frame = document.createElement("div");
  frame.className = "frame";

  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("loop", "");
  video.src = item.url;

  // 1. 无缝无等待循环：在视频到达末尾 150ms 前主动回卷到 0，消除 Chrome 解码停顿
  video.addEventListener("timeupdate", () => {
    if (video.duration && video.currentTime >= video.duration - 0.15) {
      video.currentTime = 0;
      video.play().catch(() => {});
    }
  });

  video.addEventListener("ended", () => {
    video.currentTime = 0;
    video.play().catch(() => {});
  });

  // 2. 自动检测横竖屏宽高比
  video.addEventListener("loadedmetadata", () => {
    const vw = video.videoWidth || 9;
    const vh = video.videoHeight || 16;
    const isLandscape = vw > vh;

    el.classList.remove("is-portrait", "is-landscape");
    el.classList.add(isLandscape ? "is-landscape" : "is-portrait");
    video.play().catch(() => {});
  });

  frame.appendChild(video);

  // 唯一的文字标识：LIVE 呼吸标头
  const cam = document.createElement("div");
  cam.className = "cam";
  cam.innerHTML = `<span class="cam-dot"></span><span class="cam-text">LIVE</span>`;
  frame.appendChild(cam);

  el.appendChild(frame);

  item.el = el;
  item.video = video;
  return el;
}

/* ---------------- 3D 堆栈空间排版算法（优化 GPU 层叠） ---------------- */
function place(item, i, r) {
  const el = item.el;
  if (!el) return;

  // GPU 性能防线：超过 MAX_DOM_CARDS_PER_DEVICE 时彻底隐藏 DOM 渲染
  if (r > MAX_DOM_CARDS_PER_DEVICE - 1 || r < -1) {
    el.style.display = "none";
    if (item.video && !item.video.paused) {
      item.video.pause();
    }
    return;
  } else {
    el.style.display = "flex";
  }

  let x = 0, yPct = 0, yPx = 0, s = 1, rot = 0, op = 1, dim = 0;
  const side = i % 2 ? 1 : -1;

  if (r < 0) {
    const t = Math.min(1, -r);
    yPct = -t * 115;
    yPx = -t * 20;
    s = 1 + 0.04 * smooth(0, 0.25, t);
    rot = -t * 5;
    op = 1 - smooth(0.55, 1, t);
  } else {
    const d = r;
    yPct = -d * 4.5;
    s = 1 - d * 0.045;
    rot = side * Math.min(d, 1) * 1.2;
    x = side * Math.min(d, 1) * 5;
    dim = Math.min(0.8, d * 0.25);
    op = d > 2 ? 0.4 : 1;
  }

  // 严格居中变换
  el.style.transform = `translate3d(calc(-50% + ${x}px), calc(-50% + ${yPct}% + ${yPx}px), 0) scale(${s}) rotateZ(${rot}deg)`;
  el.style.opacity = op;
  el.style.setProperty("--dim", dim);
  el.style.zIndex = String(100 - Math.round(Math.abs(r) * 10));

  const isFront = Math.abs(r) < 0.25;
  el.classList.toggle("is-front", isFront);

  if (item.video) {
    if (isFront) {
      if (item.video.paused) item.video.play().catch(() => {});
    } else {
      // 释放后台卡片视频硬件解码器占用
      if (!item.video.paused) item.video.pause();
    }
  }
}

function layoutLane(laneData, offset = 0) {
  const target = laneData.pos + offset;
  laneData.clips.forEach((item, i) => {
    const r = i - target;
    place(item, i, r);
  });
}

/* ---------------- 交互手势与滚轮 ---------------- */
function setupLaneInteraction(laneData) {
  const deck = laneData.deckEl;
  let dragStartY = 0;
  let isDragging = false;

  deck.addEventListener("pointerdown", (e) => {
    isDragging = true;
    laneData.isInteracting = true;
    laneData.lastInteractionTime = Date.now();
    dragStartY = e.clientY;
    deck.classList.add("is-dragging");
  });

  window.addEventListener("pointermove", (e) => {
    if (!isDragging || laneData.clips.length === 0) return;
    const dy = e.clientY - dragStartY;
    const offset = -dy / (window.innerHeight * 0.35);
    layoutLane(laneData, offset);
  });

  window.addEventListener("pointerup", (e) => {
    if (!isDragging) return;
    isDragging = false;
    laneData.lastInteractionTime = Date.now();
    deck.classList.remove("is-dragging");

    const dy = e.clientY - dragStartY;
    if (dy < -50 && laneData.pos < laneData.clips.length - 1) {
      laneData.pos++;
    } else if (dy > 50 && laneData.pos > 0) {
      laneData.pos--;
    }
    layoutLane(laneData, 0);

    setTimeout(() => {
      if (Date.now() - laneData.lastInteractionTime >= 14000) {
        laneData.isInteracting = false;
        laneData.pos = 0;
        layoutLane(laneData, 0);
      }
    }, 15000);
  });

  deck.addEventListener("wheel", (e) => {
    laneData.isInteracting = true;
    laneData.lastInteractionTime = Date.now();
    if (e.deltaY > 25 && laneData.pos < laneData.clips.length - 1) {
      laneData.pos++;
    } else if (e.deltaY < -25 && laneData.pos > 0) {
      laneData.pos--;
    }
    layoutLane(laneData, 0);

    setTimeout(() => {
      if (Date.now() - laneData.lastInteractionTime >= 14000) {
        laneData.isInteracting = false;
        laneData.pos = 0;
        layoutLane(laneData, 0);
      }
    }, 15000);
  }, { passive: true });
}

/* ---------------- 压入新切片 ---------------- */
function addClip(meta, blob) {
  const devId = meta.deviceId || "node-default";
  const laneData = getOrCreateDeviceLane(devId);

  const url = URL.createObjectURL(blob);
  const item = { ...meta, blob, url };

  laneData.clips.unshift(item);
  const cardEl = buildCard(item);
  laneData.deckEl.appendChild(cardEl);

  // 严格限制最大缓存数量，回收内存与 Blob URL
  if (laneData.clips.length > MAX_DOM_CARDS_PER_DEVICE * 4) {
    const dropped = laneData.clips.pop();
    if (dropped.url) URL.revokeObjectURL(dropped.url);
    if (dropped.el) dropped.el.remove();
  }

  if (!laneData.isInteracting) {
    laneData.pos = 0;
  }

  layoutLane(laneData, 0);
}

/* ---------------- 遥测时间数据刷新 ---------------- */
function updateTelemetryClock(devId) {
  const now = Date.now();
  const timeStr = fmtTime(now);
  let deltaText = "";
  if (lastChunkArrivalTs > 0) {
    const diffSec = ((now - lastChunkArrivalTs) / 1000).toFixed(1);
    deltaText = ` (+${diffSec}s)`;
  }
  lastChunkArrivalTs = now;

  const shortDev = devId.replace(/^node-/, "");
  if (telemetryTimeEl) {
    telemetryTimeEl.textContent = `RECVD ${timeStr}${deltaText} · ${shortDev.toUpperCase()}`;
  }

  if (telemetryPillEl) {
    telemetryPillEl.classList.add("is-flash");
    setTimeout(() => {
      telemetryPillEl.classList.remove("is-flash");
    }, 700);
  }
}

/* ---------------- WebSocket 实时中继接入 ---------------- */
let pendingMeta = null;

function connectWorkerB() {
  if (!WORKER_B_WS) return;
  try {
    const ws = new WebSocket(WORKER_B_WS);
    activeWs = ws;
    ws.binaryType = "arraybuffer";

    ws.onmessage = async (event) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "chunk_meta") {
            pendingMeta = msg;
          } else if (msg.type === "archive_cleared") {
            clearFrontendState();
          }
        } catch (_) {}
      } else if (event.data instanceof ArrayBuffer) {
        const meta = pendingMeta || {
          chunkId: `chunk-${Date.now()}`,
          mimeType: "video/mp4",
          recordedAt: Date.now(),
          deviceId: "node-live",
        };
        pendingMeta = null;
        const blob = new Blob([event.data], { type: meta.mimeType || "video/mp4" });
        await saveChunk(meta, blob);
        addClip(meta, blob);
        updateTelemetryClock(meta.deviceId || "node-live");
      }
    };

    ws.onclose = () => {
      activeWs = null;
      setTimeout(connectWorkerB, 3000);
    };
  } catch (_) {}
}

function clearFrontendState() {
  deviceLanes.forEach((laneData) => {
    laneData.clips.forEach((c) => {
      if (c.url) URL.revokeObjectURL(c.url);
      if (c.el) c.el.remove();
    });
    if (laneData.laneEl.parentNode) {
      laneData.laneEl.parentNode.removeChild(laneData.laneEl);
    }
  });

  deviceLanes.clear();
  lanesContainer.innerHTML = "";
  lastChunkArrivalTs = 0;
  if (telemetryTimeEl) {
    telemetryTimeEl.textContent = "FEED: ARCHIVE CLEARED";
  }
}

/* ---------------- 初始化：恢复缓存并连线 ---------------- */
async function init() {
  try {
    const cached = await loadCachedChunks();
    cached.sort((a, b) => b.recordedAt - a.recordedAt);

    for (const item of cached) {
      addClip(item, item.blob);
    }
  } catch (_) {}

  deviceLanes.forEach((l) => layoutLane(l, 0));
  connectWorkerB();
}

/* ---------------- 清空所有缓存逻辑 ---------------- */
const clearBtn = document.getElementById("btn-clear");
if (clearBtn) {
  clearBtn.addEventListener("click", async () => {
    if (!confirm("Clear all cached surveillance clips?")) return;

    try {
      await clearAllCachedChunks();
    } catch (_) {}

    // 广播通知 Worker B 清空中继 ringBuffer 并清空本地显示
    if (activeWs && activeWs.readyState === WebSocket.OPEN) {
      try {
        activeWs.send(JSON.stringify({ type: "clear_archive" }));
      } catch (_) {}
    }

    clearFrontendState();
  });
}

init();
