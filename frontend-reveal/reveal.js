/**
 * Digital Wasteland — Surveillance Deck (Captive Style Multi-Device Archive)
 *
 * Core Concept:
 * 1. Captive Deck 3D Surveillance Cards:
 *    Latest video chunk on top, historical clips stack neatly behind with 3D depth,
 *    tilt perspective, and elevation shadows.
 * 2. Multi-Orientation Auto-Detection (Landscape 16:9 & Portrait 9:16):
 *    Detects natural video dimensions from media and applies adaptive frame aspect-ratio.
 * 3. Multi-device Interleaving & IndexedDB Persistence:
 *    Caches incoming slices to browser IndexedDB; supports wheel, drag/swipe, and arrow keys.
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
const MAX_CLIPS = 32;
const DEPTH = 5; // 可见堆叠层级

const deck = document.getElementById("deck");
const ghost = document.getElementById("ghost");
const hud = document.getElementById("hud");
const rail = document.getElementById("rail");
const fresh = document.getElementById("fresh");
const freshN = document.getElementById("fresh-n");
const hint = document.getElementById("hint");
const liveDot = document.getElementById("live-dot");

let dbInstance = null;
const clips = []; // 最新的在前
let pos = 0;      // 当前最顶层卡片索引
let unseen = 0;
let connected = false;

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

/* ---------------- 监视卡片构建与横竖屏自动识别 ---------------- */
function buildCard(item) {
  const el = document.createElement("article");
  el.className = "card is-portrait"; // 默认竖屏

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

  // 视频加载元数据后自动判断横竖屏比例
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

  // 录像 REC 标头
  const cam = document.createElement("div");
  cam.className = "cam";
  cam.innerHTML = `<span class="cam-dot"></span><span class="cam-text">LIVE FEED</span>`;
  frame.appendChild(cam);

  // 右侧元数据栏 (Captive Meta Tag)
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
  add("t-ip", `CHUNK #${item.chunkIndex ?? clips.length}`);

  const net = add("t-net", "EXFILTRATION ARCHIVE\nENCRYPTED LOCAL CACHE");
  net.style.whiteSpace = "pre-line";

  el.appendChild(frame);
  el.appendChild(tag);

  item.el = el;
  item.video = video;
  return el;
}

/* ---------------- 3D 堆栈空间排版算法 (Deck Layout) ---------------- */
function place(item, i, r) {
  const el = item.el;
  let x = 0, yPct = 0, yPx = 0, s = 1, rot = 0, op = 1, lift = 0, dim = 0;
  const side = i % 2 ? 1 : -1;

  if (r < 0) {
    // 掀开向上滑脱的卡片
    const t = Math.min(1, -r);
    yPct = -t * 120;
    yPx = -t * 24;
    s = 1 + 0.04 * smooth(0, 0.25, t);
    rot = -t * 6;
    op = 1 - smooth(0.55, 1, t);
    lift = Math.min(1, 0.35 + t * 2);
  } else {
    // 堆叠在后面的卡片
    const d = r;
    yPct = -d * 5.5;
    s = 1 - d * 0.052;
    rot = side * Math.min(d, 1) * 1.5 + side * Math.max(0, d - 1) * 0.35;
    x = side * Math.min(d, 1) * 7;
    dim = Math.min(0.85, d * 0.22);
    op = d > DEPTH ? Math.max(0, 1 - (d - DEPTH)) : 1;
  }

  el.style.transform = `translate3d(calc(-50% + ${x}px), calc(-50% + ${yPct}% + ${yPx}px), 0) scale(${s}) rotateZ(${rot}deg)`;
  el.style.opacity = op;
  el.style.setProperty("--lift", lift);
  el.style.setProperty("--dim", dim);
  el.style.zIndex = String(100 - Math.round(Math.abs(r) * 10));

  const isFront = Math.abs(r) < 0.25;
  el.classList.toggle("is-front", isFront);

  // 仅在顶层的卡片播放视频以节约算力
  if (item.video) {
    if (isFront && item.video.paused) {
      item.video.play().catch(() => {});
    } else if (!isFront && !item.video.paused) {
      item.video.pause();
    }
  }
}

function layout(offset = 0) {
  const target = pos + offset;
  ghost.classList.toggle("is-hidden", clips.length > 0);

  clips.forEach((item, i) => {
    const r = i - target;
    place(item, i, r);
  });

  updateHUD();
  updateRail();
}

function updateHUD() {
  const count = clips.length;
  if (!count) {
    hud.innerHTML = `<span>STANDBY</span>`;
    return;
  }
  const current = clips[pos];
  const dev = current?.deviceId || "STANDBY";
  hud.innerHTML = `<span>ARCHIVE: <b>${pos + 1} / ${count}</b></span> <span>SOURCE: <b>${dev}</b></span>`;
}

function updateRail() {
  rail.innerHTML = "";
  const count = clips.length;
  if (count <= 1) return;

  const maxDots = Math.min(16, count);
  for (let i = 0; i < maxDots; i++) {
    const btn = document.createElement("button");
    if (i === pos) btn.className = "is-current";
    btn.onclick = () => jumpTo(i);
    rail.appendChild(btn);
  }
}

function jumpTo(idx) {
  pos = clamp(idx, 0, Math.max(0, clips.length - 1));
  if (pos === 0) {
    unseen = 0;
    fresh.hidden = true;
  }
  layout(0);
}

/* ---------------- 交互手势与快捷键 ---------------- */
let dragStartY = 0;
let isDragging = false;

deck.addEventListener("pointerdown", (e) => {
  isDragging = true;
  dragStartY = e.clientY;
  deck.classList.add("is-dragging");
  hint.classList.add("is-gone");
});

window.addEventListener("pointermove", (e) => {
  if (!isDragging || clips.length === 0) return;
  const dy = e.clientY - dragStartY;
  const offset = -dy / (window.innerHeight * 0.35);
  layout(offset);
});

window.addEventListener("pointerup", (e) => {
  if (!isDragging) return;
  isDragging = false;
  deck.classList.remove("is-dragging");

  const dy = e.clientY - dragStartY;
  if (dy < -60 && pos < clips.length - 1) {
    pos++;
  } else if (dy > 60 && pos > 0) {
    pos--;
  }
  jumpTo(pos);
});

// 鼠标滚轮翻看卡片
window.addEventListener("wheel", (e) => {
  hint.classList.add("is-gone");
  if (e.deltaY > 25 && pos < clips.length - 1) {
    jumpTo(pos + 1);
  } else if (e.deltaY < -25 && pos > 0) {
    jumpTo(pos - 1);
  }
}, { passive: true });

// 上下箭头键盘翻看
window.addEventListener("keydown", (e) => {
  hint.classList.add("is-gone");
  if ((e.key === "ArrowDown" || e.key === "PageDown") && pos < clips.length - 1) {
    jumpTo(pos + 1);
  } else if ((e.key === "ArrowUp" || e.key === "PageUp") && pos > 0) {
    jumpTo(pos - 1);
  }
});

fresh.addEventListener("click", () => jumpTo(0));

/* ---------------- 添加新卡片进堆栈 ---------------- */
function addClip(meta, blob) {
  const url = URL.createObjectURL(blob);
  const item = { ...meta, blob, url };

  // 插入最前面（最新在前）
  clips.unshift(item);
  const cardEl = buildCard(item);
  deck.appendChild(cardEl);

  if (clips.length > MAX_CLIPS) {
    const dropped = clips.pop();
    if (dropped.url) URL.revokeObjectURL(dropped.url);
    if (dropped.el) dropped.el.remove();
  }

  if (pos > 0) {
    unseen++;
    freshN.textContent = `+${unseen}`;
    fresh.hidden = false;
  } else {
    pos = 0;
  }

  layout(0);
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
    for (const item of cached.slice(0, MAX_CLIPS)) {
      addClip(item, item.blob);
    }
  } catch (_) {}

  layout(0);
  connectWorkerB();
}

init();
