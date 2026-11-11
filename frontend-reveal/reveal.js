/**
 * Digital Wasteland — Multi-Device Surveillance Matrix
 *
 * Core Concept:
 * 1. Perfectly Centered Multi-Device Side-by-Side Presentation:
 *    Multiple phones appear side-by-side on the exhibition screen (auto-centered).
 * 2. Auto-Follow Newest Live State:
 *    When a new 15s chunk arrives, the card deck smoothly auto-advances to the front,
 *    keeping the latest footage live while preserving manual inspection history.
 * 3. Unified Aesthetic with WA (Ocean / Ambient Glass / Michroma Typography):
 *    Frosted glass cards, teal/cyan telemetry glow, deep ambient wave background.
 * 4. Multi-Aspect Ratio (16:9 Landscape & 9:16 Portrait) auto-detection.
 */

// Cloudflare Worker B WebSocket URL
const WORKER_B_WS =
  window.location.protocol === "https:"
    ? `wss://${window.location.host}/ws?role=consumer&room=main`
    : (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? "wss://digital-wasteland-worker-b-video.dsm-project.workers.dev/ws?role=consumer&room=main"
    : "wss://digital-wasteland-worker-b-video.dsm-project.workers.dev/ws?role=consumer&room=main";

const DB_NAME = "DigitalWastelandVaultV3";
const STORE_NAME = "video_chunks";
const MAX_CLIPS_PER_DEVICE = 20;

const lanesContainer = document.getElementById("lanes");
const hud = document.getElementById("hud");
const liveDot = document.getElementById("live-dot");

let dbInstance = null;
let connected = false;

// 每个设备独立的卡片堆栈管理器
// deviceLanes: Map<deviceId, { laneEl, deckEl, ghostEl, clips: [], pos: 0, isInteracting: false, lastInteractionTime: 0 }>
const deviceLanes = new Map();

const pad2 = (n) => String(n).padStart(2, "0");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

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

/* ---------------- 设备通道 Lane 管理（支持多设备并排居中） ---------------- */
function getOrCreateDeviceLane(deviceId = "node-default") {
  if (deviceLanes.has(deviceId)) {
    return deviceLanes.get(deviceId);
  }

  const laneEl = document.createElement("div");
  laneEl.className = "lane";

  const header = document.createElement("div");
  header.className = "lane-header";
  header.innerHTML = `
    <span class="lane-tag">SOURCE: ${deviceId}</span>
    <span class="lane-status" id="status-${deviceId}">READY</span>
  `;
  laneEl.appendChild(header);

  const deckEl = document.createElement("div");
  deckEl.className = "deck";

  // 待机空状态 Ghost 卡片
  const ghostEl = document.createElement("div");
  ghostEl.className = "ghost is-portrait";
  ghostEl.innerHTML = `
    <div class="ghost-frame"></div>
    <div class="ghost-tag"></div>
    <span class="ghost-label">AWAITING FEED FROM ${deviceId.toUpperCase()}</span>
  `;
  deckEl.appendChild(ghostEl);

  laneEl.appendChild(deckEl);
  lanesContainer.appendChild(laneEl);

  const laneData = {
    deviceId,
    laneEl,
    deckEl,
    ghostEl,
    clips: [],
    pos: 0,
    isInteracting: false,
    lastInteractionTime: 0,
  };

  setupLaneInteraction(laneData);
  deviceLanes.set(deviceId, laneData);
  updateGlobalHUD();
  return laneData;
}

/* ---------------- 监视卡片构建与横竖屏自动识别 ---------------- */
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
  video.src = item.url;

  // 自动检测横竖屏宽高比
  video.addEventListener("loadedmetadata", () => {
    const vw = video.videoWidth || 9;
    const vh = video.videoHeight || 16;
    const isLandscape = vw > vh;

    el.classList.remove("is-portrait", "is-landscape");
    el.classList.add(isLandscape ? "is-landscape" : "is-portrait");

    const aspectBadge = el.querySelector(".t-aspect");
    if (aspectBadge) {
      aspectBadge.textContent = isLandscape ? `16:9 ${vw}x${vh}` : `9:16 ${vw}x${vh}`;
    }
  });

  frame.appendChild(video);

  const cam = document.createElement("div");
  cam.className = "cam";
  cam.innerHTML = `<span class="cam-dot"></span><span class="cam-text">LIVE</span>`;
  frame.appendChild(cam);

  // 右侧元数据栏
  const tag = document.createElement("div");
  tag.className = "tag";

  const add = (cls, text) => {
    const s = document.createElement("span");
    s.className = cls;
    s.textContent = text;
    tag.appendChild(s);
    return s;
  };

  add("t-idx", fmtTime(item.recordedAt));
  const rule = document.createElement("div");
  rule.className = "t-rule";
  tag.appendChild(rule);

  add("t-name", item.deviceId || "android-node");
  add("t-aspect", "AUTO DETECT");
  add("t-ip", `CHUNK #${item.chunkIndex ?? 0}`);

  const net = add("t-net", "EXFILTRATION ARCHIVE\nENCRYPTED LOCAL CACHE");

  el.appendChild(frame);
  el.appendChild(tag);

  item.el = el;
  item.video = video;
  return el;
}

/* ---------------- 3D 堆栈空间排版算法 ---------------- */
function place(item, i, r) {
  const el = item.el;
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
    yPct = -d * 5.2;
    s = 1 - d * 0.05;
    rot = side * Math.min(d, 1) * 1.4 + side * Math.max(0, d - 1) * 0.35;
    x = side * Math.min(d, 1) * 6;
    dim = Math.min(0.85, d * 0.22);
    op = d > 4 ? Math.max(0, 1 - (d - 4)) : 1;
  }

  // 严格基于卡片自身宽高 -50% 居中偏移
  el.style.transform = `translate3d(calc(-50% + ${x}px), calc(-50% + ${yPct}% + ${yPx}px), 0) scale(${s}) rotateZ(${rot}deg)`;
  el.style.opacity = op;
  el.style.setProperty("--dim", dim);
  el.style.zIndex = String(100 - Math.round(Math.abs(r) * 10));

  const isFront = Math.abs(r) < 0.25;
  el.classList.toggle("is-front", isFront);

  if (item.video) {
    if (isFront && item.video.paused) {
      item.video.play().catch(() => {});
    } else if (!isFront && !item.video.paused) {
      item.video.pause();
    }
  }
}

function layoutLane(laneData, offset = 0) {
  const target = laneData.pos + offset;
  laneData.ghostEl.classList.toggle("is-hidden", laneData.clips.length > 0);

  laneData.clips.forEach((item, i) => {
    const r = i - target;
    place(item, i, r);
  });

  const statusEl = laneData.laneEl.querySelector(`#status-${laneData.deviceId}`);
  if (statusEl && laneData.clips.length > 0) {
    statusEl.textContent = `${laneData.pos + 1}/${laneData.clips.length}`;
  }
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

    // 15 秒无人操作后，自动恢复自动跟随最新状态 (Auto-Follow Newest)
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

/* ---------------- 压入新切片 (自动刷新到最新状态) ---------------- */
function addClip(meta, blob) {
  const devId = meta.deviceId || "node-default";
  const laneData = getOrCreateDeviceLane(devId);

  const url = URL.createObjectURL(blob);
  const item = { ...meta, blob, url };

  // 插入到该设备最前列 (最新在前)
  laneData.clips.unshift(item);
  const cardEl = buildCard(item);
  laneData.deckEl.appendChild(cardEl);

  if (laneData.clips.length > MAX_CLIPS_PER_DEVICE) {
    const dropped = laneData.clips.pop();
    if (dropped.url) URL.revokeObjectURL(dropped.url);
    if (dropped.el) dropped.el.remove();
  }

  // 核心功能：如果没有处于手动查看历史，自动刷新推进到最新切片 (Auto-Follow Newest)
  if (!laneData.isInteracting) {
    laneData.pos = 0;
  }

  layoutLane(laneData, 0);
  updateGlobalHUD();
}

function updateGlobalHUD() {
  const devCount = deviceLanes.size;
  let totalClips = 0;
  deviceLanes.forEach((d) => (totalClips += d.clips.length));

  if (!devCount || !totalClips) {
    hud.innerHTML = `<span>STANDBY · ZERO STREAMS</span>`;
    return;
  }

  hud.innerHTML = `
    <span>ACTIVE NODES: <b>${devCount}</b></span>
    <span>TOTAL ARCHIVE: <b>${totalClips}</b></span>
  `;
}

/* ---------------- WebSocket 实时中继接入 ---------------- */
let pendingMeta = null;

function connectWorkerB() {
  if (!WORKER_B_WS) return;
  try {
    const ws = new WebSocket(WORKER_B_WS);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      connected = true;
      liveDot.classList.remove("is-offline");
    };

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
          deviceId: "node-live",
        };
        pendingMeta = null;
        const blob = new Blob([event.data], { type: meta.mimeType || "video/mp4" });
        await saveChunk(meta, blob);
        addClip(meta, blob);
      }
    };

    ws.onclose = () => {
      connected = false;
      liveDot.classList.add("is-offline");
      setTimeout(connectWorkerB, 3000);
    };
  } catch (_) {}
}

/* ---------------- 初始化：恢复缓存并连线 ---------------- */
async function init() {
  try {
    const cached = await loadCachedChunks();
    // 按时间顺序（最新在前）
    cached.sort((a, b) => b.recordedAt - a.recordedAt);

    // 预先建立默认通道（如果完全没有数据则显示一个默认空通道）
    if (cached.length === 0) {
      getOrCreateDeviceLane("node-01");
    } else {
      for (const item of cached) {
        addClip(item, item.blob);
      }
    }
  } catch (_) {
    getOrCreateDeviceLane("node-01");
  }

  deviceLanes.forEach((l) => layoutLane(l, 0));
  connectWorkerB();
}

init();
