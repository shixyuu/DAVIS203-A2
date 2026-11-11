/**
 * Digital Wasteland — Natural Ocean Surface Wavefield & Floating Words
 *
 * Core Concept:
 * 1. Gentle Light Ocean Swell:
 *    Natural multi-frequency 2D wavefield that breathes and rises slowly across light aquamarine depths.
 * 2. Delicate Touch Ripples:
 *    Phone interactions simply disturb the water surface, creating physical wave equation ripples.
 * 3. Ephemeral Floating Text (30s duration):
 *    Words/phrases clicked on Android devices float up at random coordinates, rocking gently
 *    with water swells, gradually dissipating after 30 seconds.
 */

import { SoundscapeInterface } from "./soundscape.js";

// Cloudflare Worker A WebSocket URL (fallback to local or remote)
const WORKER_A_WS =
  window.location.protocol === "https:"
    ? `wss://${window.location.host}/ws?role=consumer&room=main`
    : (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? "wss://digital-wasteland-worker-a-touch.dsm-project.workers.dev/ws?role=consumer&room=main"
    : "wss://digital-wasteland-worker-a-touch.dsm-project.workers.dev/ws?role=consumer&room=main";

const canvas = document.getElementById("wasteland-canvas");
const ctx = canvas.getContext("2d", { alpha: false });
const startOverlay = document.getElementById("start-overlay");
const startBtn = document.getElementById("btn-start");

export const soundscape = new SoundscapeInterface();

// 2D 波动方程网格设置
const COLS = 130;
const ROWS = 80;
let width = window.innerWidth;
let height = window.innerHeight;
let cellW = width / COLS;
let cellH = height / ROWS;

let currentHeight = new Float32Array(COLS * ROWS);
let previousHeight = new Float32Array(COLS * ROWS);

// 漂浮文字池 (存活 30 秒)
const floatingWords = [];

// 随机文字采样库 (用于灵感测试)
const DEMO_WORDS = [
  "privacy", "consciousness", "exfiltration", "whisper",
  "memory", "telemetry", "breath", "ocean",
  "distance", "translucent", "surveillance", "ephemeral",
  "流转", "余烬", "微澜", "浮生", "浅海", "呼吸", "隐秘"
];

function resizeCanvas() {
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width;
  canvas.height = height;
  cellW = width / (COLS - 1);
  cellH = height / (ROWS - 1);
}

/**
 * 物理涟漪激荡
 */
function disturbWater(screenX, screenY, strength = 18.0) {
  const col = Math.floor((screenX / width) * COLS);
  const row = Math.floor((screenY / height) * ROWS);
  const radius = 3;

  for (let r = -radius; r <= radius; r++) {
    for (let c = -radius; c <= radius; c++) {
      const tc = col + c;
      const tr = row + r;
      if (tc > 1 && tc < COLS - 1 && tr > 1 && tr < ROWS - 1) {
        const dist = Math.hypot(c, r);
        if (dist <= radius) {
          const falloff = 1 - dist / radius;
          const idx = tr * COLS + tc;
          currentHeight[idx] += strength * falloff;
        }
      }
    }
  }
}

/**
 * 随机位置浮现词句，漂浮 30 秒
 */
function spawnFloatingWord(text, originX, originY) {
  const word = text || DEMO_WORDS[Math.floor(Math.random() * DEMO_WORDS.length)];

  // 随机散落在屏幕各处（保持安全边距）
  const rx = Math.random() * (width - 240) + 120;
  const ry = Math.random() * (height - 180) + 90;

  floatingWords.push({
    text: word,
    x: rx,
    y: ry,
    vx: (Math.random() - 0.5) * 0.15,
    vy: -0.06 - Math.random() * 0.08, // 微微向上浮游
    createdAt: performance.now(),
    lifeSpanMs: 30000, // 30 秒生命周期
    fontSize: 16 + Math.floor(Math.random() * 8),
    angle: (Math.random() - 0.5) * 0.06,
    seed: Math.random() * 100,
  });

  if (floatingWords.length > 30) {
    floatingWords.shift();
  }
}

/**
 * 大洋自然深涌叠加算法 (Natural Ocean Swell)
 */
function getNaturalOceanSwell(x, y, t) {
  const wave1 = Math.sin(x * 0.0032 + y * 0.0020 - t * 0.85) * 13.0;
  const wave2 = Math.sin(x * 0.0016 - y * 0.0035 + t * 0.65) * 9.0;
  const wave3 = Math.cos(x * 0.0055 + y * 0.0040 + t * 1.15) * 4.5;
  const tide = Math.sin(t * 0.28) * 3.5;
  return wave1 + wave2 + wave3 + tide;
}

/**
 * 波动方程数值求解
 */
function stepWaveSimulation() {
  const damping = 0.968;
  const cSq = 0.42;

  for (let r = 1; r < ROWS - 1; r++) {
    const rowOffset = r * COLS;
    for (let c = 1; c < COLS - 1; c++) {
      const idx = rowOffset + c;
      const laplacian =
        currentHeight[idx - 1] +
        currentHeight[idx + 1] +
        currentHeight[idx - COLS] +
        currentHeight[idx + COLS] -
        4 * currentHeight[idx];

      let next = 2 * currentHeight[idx] - previousHeight[idx] + cSq * laplacian;
      next *= damping;
      previousHeight[idx] = next;
    }
  }

  const temp = currentHeight;
  currentHeight = previousHeight;
  previousHeight = temp;
}

/**
 * 处理触摸与点击事件流
 */
function ingestTouchEvent(ev, deviceId = "local") {
  const nx = Number(ev.nx ?? ev.x ?? -1);
  const ny = Number(ev.ny ?? ev.y ?? -1);
  if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return;

  const targetX = nx * width;
  const targetY = ny * height;
  const isTap = ev.action === "down";

  // 1. 水面掀起轻柔涟漪
  disturbWater(targetX, targetY, isTap ? 28.0 : 12.0);

  // 2. 如果携带用户在手机点击的文字，或者属于点击事件，随机生成浮现文字 (存活 30s)
  if (ev.text) {
    spawnFloatingWord(ev.text, targetX, targetY);
  } else if (isTap && Math.random() < 0.6) {
    spawnFloatingWord(null, targetX, targetY);
  }

  soundscape.onTouchEvent({ nx, ny, action: ev.action || "move", deviceId });
}

let oceanTime = 0;

function animate(now) {
  oceanTime += 0.015;

  stepWaveSimulation();

  // 1. 浅色清透海洋底色 (Warm Light Ocean Gradient)
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#ebf4f8");
  bg.addColorStop(0.5, "#dcebf3");
  bg.addColorStop(1, "#cce2ee");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // 2. 海洋连续起伏曲面 (Surface Mesh Wavefield)
  ctx.save();
  const lightX = 0.55;
  const lightY = 0.65;

  for (let r = 0; r < ROWS - 1; r += 2) {
    for (let c = 0; c < COLS; c += 2) {
      const px = c * cellW;
      const py = r * cellH;

      const rippleH = currentHeight[r * COLS + c];
      const oceanH = getNaturalOceanSwell(px, py, oceanTime);
      const totalH = oceanH + rippleH;

      const nextH_X = getNaturalOceanSwell(px + 22, py, oceanTime) + currentHeight[r * COLS + Math.min(COLS - 1, c + 1)];
      const nextH_Y = getNaturalOceanSwell(px, py + 22, oceanTime) + currentHeight[Math.min(ROWS - 1, r + 1) * COLS + c];

      const slopeX = (nextH_X - totalH) * 0.08;
      const slopeY = (nextH_Y - totalH) * 0.08;
      const diffuse = slopeX * lightX + slopeY * lightY;
      const brightness = Math.max(-0.25, Math.min(0.42, diffuse));

      let baseR = 212 + brightness * 55;
      let baseG = 232 + brightness * 38;
      let baseB = 246 + brightness * 20;

      // 浪尖微光
      if (Math.abs(rippleH) > 2.5) {
        const crest = Math.min(1.0, Math.abs(rippleH) / 16.0);
        baseR = baseR * (1 - crest) + 255 * crest;
        baseG = baseG * (1 - crest) + 255 * crest;
        baseB = baseB * (1 - crest) + 255 * crest;
      }

      baseR = Math.max(160, Math.min(255, Math.round(baseR)));
      baseG = Math.max(195, Math.min(255, Math.round(baseG)));
      baseB = Math.max(220, Math.min(255, Math.round(baseB)));

      ctx.fillStyle = `rgb(${baseR}, ${baseG}, ${baseB})`;
      ctx.fillRect(px, py + totalH * 0.42, cellW * 2 + 1, cellH * 2 + 1);
    }
  }

  // 3. 浅海自然等高起伏纹 (Swell Iso-lines)
  for (let w = 0; w < 6; w++) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.28 + w * 0.04})`;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 16) {
      const yWave = (height * (w + 1)) / 7;
      const swell = getNaturalOceanSwell(x, yWave, oceanTime);
      const col = Math.floor((x / width) * (COLS - 1));
      const row = Math.floor((yWave / height) * (ROWS - 1));
      const rip = currentHeight[row * COLS + col] || 0;

      const finalY = yWave + swell * 1.45 + rip * 0.75;
      if (x === 0) ctx.moveTo(x, finalY);
      else ctx.lineTo(x, finalY);
    }
    ctx.stroke();
  }
  ctx.restore();

  // 4. 漂浮在水面的 30 秒消散文字 (Floating Ephemeral Words)
  ctx.save();
  for (let i = floatingWords.length - 1; i >= 0; i--) {
    const item = floatingWords[i];
    const ageMs = now - item.createdAt;

    // 超过 30 秒平滑移出
    if (ageMs >= item.lifeSpanMs) {
      floatingWords.splice(i, 1);
      continue;
    }

    // 生命周期曲线：前 3 秒渐入，中间稳定，后 6 秒慢慢隐没消散
    let alpha = 1.0;
    if (ageMs < 3000) {
      alpha = ageMs / 3000;
    } else if (ageMs > 24000) {
      alpha = (item.lifeSpanMs - ageMs) / 6000;
    }

    // 随水体起伏摇曳
    const localSwell = getNaturalOceanSwell(item.x, item.y, oceanTime);
    item.x += item.vx + Math.sin(oceanTime * 0.8 + item.seed) * 0.18;
    item.y += item.vy;

    const renderY = item.y + localSwell * 0.6;

    ctx.save();
    ctx.translate(item.x, renderY);
    ctx.rotate(item.angle + Math.sin(oceanTime + item.seed) * 0.03);

    // 字体排版风格：优雅空灵质感
    ctx.font = `300 ${item.fontSize}px -apple-system, BlinkMacSystemFont, "Noto Serif SC", serif`;
    ctx.letterSpacing = "0.22em";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // 柔和水下倒影 / 辉光
    ctx.fillStyle = `rgba(255, 255, 255, ${(alpha * 0.75).toFixed(3)})`;
    ctx.fillText(item.text, 0, 1);

    // 文字主体墨青色
    ctx.fillStyle = `rgba(30, 58, 86, ${(alpha * 0.82).toFixed(3)})`;
    ctx.fillText(item.text, 0, 0);

    ctx.restore();
  }
  ctx.restore();

  requestAnimationFrame(animate);
}

function connectWorkerA() {
  if (!WORKER_A_WS) return;
  try {
    const ws = new WebSocket(WORKER_A_WS);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const deviceId = data.deviceId || "android-node";
        if (data.type === "touch_batch" && Array.isArray(data.events)) {
          const sw = data.screenWidth || 1080;
          const sh = data.screenHeight || 2400;
          data.events.forEach((ev, idx) => {
            setTimeout(() => {
              ingestTouchEvent(
                {
                  nx: ev.nx !== undefined ? ev.nx : (ev.x || 0) / sw,
                  ny: ev.ny !== undefined ? ev.ny : (ev.y || 0) / sh,
                  action: ev.action || "move",
                  text: ev.text || null,
                },
                deviceId
              );
            }, idx * 12);
          });
        } else if (data.type === "touch_event") {
          ingestTouchEvent(data, deviceId);
        }
      } catch (_) {}
    };
    ws.onclose = () => {
      setTimeout(connectWorkerA, 2500);
    };
  } catch (_) {}
}

startBtn.addEventListener("click", async () => {
  startOverlay.classList.add("hidden");
  await soundscape.init();
});

// 支持鼠标/触控交互测试
let isPointerDown = false;
canvas.addEventListener("pointerdown", (e) => {
  isPointerDown = true;
  ingestTouchEvent(
    {
      nx: e.clientX / width,
      ny: e.clientY / height,
      action: "down",
    },
    "local-mouse"
  );
});

canvas.addEventListener("pointermove", (e) => {
  if (!isPointerDown) return;
  ingestTouchEvent(
    {
      nx: e.clientX / width,
      ny: e.clientY / height,
      action: "move",
    },
    "local-mouse"
  );
});

window.addEventListener("pointerup", () => isPointerDown = false);
window.addEventListener("resize", resizeCanvas);

resizeCanvas();
connectWorkerA();
requestAnimationFrame(animate);
