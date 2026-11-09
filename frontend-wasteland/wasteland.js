/**
 * Digital Wasteland — Gaseous Mist & Backlit Touch Fluid System
 *
 * Core Visual Experience:
 * 1. Gaseous Mist Environment:
 *    Suspended layers of semi-transparent smoke puffs and dust particles drifting across a dark space.
 * 2. Subsurface Backlight Illumination:
 *    When viewers tap or swipe on their phones, a soft volumetric backlight is illuminated
 *    beneath the fog (Tyndall scattering effect), while touch gestures push fluid mist eddies.
 * 3. Multi-Device Concurrency:
 *    Maintains independent device states and custom backlight palettes per unique deviceId.
 */

import { SoundscapeInterface } from "./soundscape.js";

const WORKER_A_WS =
  "wss://digital-wasteland-worker-a-touch.dsm-project.workers.dev/ws?role=consumer&room=main";

const canvas = document.getElementById("wasteland-canvas");
const ctx = canvas.getContext("2d", { alpha: false });
const startOverlay = document.getElementById("start-overlay");
const startBtn = document.getElementById("btn-start");

export const soundscape = new SoundscapeInterface();

// Multi-device backlight color palettes (automatically assigned per deviceId)
const DEVICE_PALETTES = [
  { r: 110, g: 235, b: 245 }, // Cyan Mist
  { r: 255, g: 185, b: 110 }, // Warm Amber
  { r: 175, g: 155, b: 255 }, // Soft Violet
  { r: 130, g: 245, b: 195 }, // Aurora Mint
  { r: 255, g: 140, b: 155 }, // Coral Glow
];

const state = {
  width: window.innerWidth,
  height: window.innerHeight,
  entropy: 0.0,
  mistPuffs: [],            // Volumetric gas puffs
  dustMotes: [],            // Suspended motes (illuminated by backlight)
  backlights: [],           // Touch-ignited volumetric backlights
  deviceCursors: new Map(), // Map<deviceId, { lastX, lastY, lastTime, palette }>
  ws: null,
};

function getDeviceState(deviceId = "local") {
  if (!state.deviceCursors.has(deviceId)) {
    let hash = 0;
    for (let i = 0; i < deviceId.length; i++) {
      hash = (hash * 31 + deviceId.charCodeAt(i)) >>> 0;
    }
    const palette = DEVICE_PALETTES[hash % DEVICE_PALETTES.length];
    state.deviceCursors.set(deviceId, {
      lastX: -1,
      lastY: -1,
      lastTime: 0,
      palette,
    });
  }
  return state.deviceCursors.get(deviceId);
}

function resizeCanvas() {
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  canvas.width = state.width * window.devicePixelRatio;
  canvas.height = state.height * window.devicePixelRatio;
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  initGasEnvironment();
}

/**
 * Initialize gaseous clouds and floating dust motes
 */
function initGasEnvironment() {
  state.mistPuffs = [];
  state.dustMotes = [];

  // 1. 180 large volumetric gas puffs
  const puffCount = 180;
  for (let i = 0; i < puffCount; i++) {
    const x = Math.random() * state.width;
    const y = Math.random() * state.height;
    state.mistPuffs.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      radius: 75 + Math.random() * 115,
      phase: Math.random() * Math.PI * 2,
      litLevel: 0,
      litColor: { r: 120, g: 225, b: 240 },
    });
  }

  // 2. 2200 suspended Tyndall dust motes
  const moteCount = 2200;
  for (let i = 0; i < moteCount; i++) {
    const x = Math.random() * state.width;
    const y = Math.random() * state.height;
    state.dustMotes.push({
      x,
      y,
      vx: 0,
      vy: 0,
      size: 1.0 + Math.random() * 1.8,
      baseAlpha: 0.08 + Math.random() * 0.14,
      litLevel: 0,
      litColor: { r: 160, g: 235, b: 245 },
      seed: Math.random() * 100,
    });
  }
}

/**
 * Organic background flow field
 */
function gasCurlAngle(x, y, t) {
  return (
    Math.sin(x * 0.0025 + t * 0.22) * Math.cos(y * 0.0025 - t * 0.18) * Math.PI * 2
  );
}

/**
 * Ignite backlight and push ambient mist on touch
 */
function igniteBacklightAndPushGas(x, y, dirVx, dirVy, isTap, palette) {
  // 1. Create subtle, soft-toned backlight node (smaller radius, gentle luminance)
  state.backlights.push({
    x,
    y,
    vx: dirVx * 0.15,
    vy: dirVy * 0.15,
    radius: isTap ? 75 : 52,
    maxRadius: isTap ? 120 : 88,
    intensity: isTap ? 0.62 : 0.42,
    fadeSpeed: isTap ? 0.65 : 0.85,
    color: palette,
  });

  if (state.backlights.length > 70) {
    state.backlights.shift();
  }

  // 2. Apply gentle fluid advection to nearby mist and motes (compact influence)
  const influenceR = isTap ? 100 : 72;
  const rSq = influenceR * influenceR;

  // Push and illuminate mist puffs
  for (let i = 0; i < state.mistPuffs.length; i++) {
    const puff = state.mistPuffs[i];
    const dx = puff.x - x;
    const dy = puff.y - y;
    const dSq = dx * dx + dy * dy;
    const reach = influenceR + puff.radius * 0.5;
    if (dSq < reach * reach) {
      const d = Math.sqrt(dSq) || 1;
      const falloff = Math.max(0, 1 - d / reach);
      puff.vx += dirVx * falloff * 0.09 + (dx / d) * falloff * (isTap ? 0.8 : 0.25);
      puff.vy += dirVy * falloff * 0.09 + (dy / d) * falloff * (isTap ? 0.8 : 0.25);
      if (falloff > puff.litLevel * 0.6) {
        puff.litColor = palette;
      }
      puff.litLevel = Math.min(1.0, puff.litLevel + falloff * 0.65);
    }
  }

  // Push and illuminate suspended motes
  for (let i = 0; i < state.dustMotes.length; i++) {
    const m = state.dustMotes[i];
    const dx = m.x - x;
    const dy = m.y - y;
    const dSq = dx * dx + dy * dy;
    if (dSq < rSq && dSq > 0.01) {
      const d = Math.sqrt(dSq);
      const falloff = (1 - d / influenceR) * (1 - d / influenceR);
      const swirlAngle = Math.atan2(dy, dx) + 0.45;
      m.vx += dirVx * falloff * 0.22 + Math.cos(swirlAngle) * falloff * (isTap ? 1.8 : 0.75);
      m.vy += dirVy * falloff * 0.22 + Math.sin(swirlAngle) * falloff * (isTap ? 1.8 : 0.75);

      const sp = Math.hypot(m.vx, m.vy);
      if (sp > 2.8) {
        m.vx = (m.vx / sp) * 2.8;
        m.vy = (m.vy / sp) * 2.8;
      }

      if (falloff > m.litLevel * 0.5) {
        m.litColor = palette;
      }
      m.litLevel = Math.min(1.0, m.litLevel + falloff * 0.85);
    }
  }
}

/**
 * Handle touch stream from any connected device
 */
function ingestTouchEvent(ev, deviceId = "local") {
  const nx = Number(ev.nx ?? ev.x ?? -1);
  const ny = Number(ev.ny ?? ev.y ?? -1);

  // Filter invalid or (0, 0) coordinates
  if (nx <= 0.008 && ny <= 0.008) return;
  if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return;

  const dev = getDeviceState(deviceId);
  const targetX = nx * state.width;
  const targetY = ny * state.height;
  const now = performance.now();

  const dtMs = now - dev.lastTime;
  const dx = targetX - dev.lastX;
  const dy = targetY - dev.lastY;
  const dist = Math.hypot(dx, dy);
  const maxStep = Math.min(state.width, state.height) * 0.22;

  const isNewTouch =
    ev.action === "down" || dtMs > 220 || dev.lastX < 0 || dist > maxStep;

  if (isNewTouch) {
    igniteBacklightAndPushGas(targetX, targetY, 0, 0, true, dev.palette);
    dev.lastX = targetX;
    dev.lastY = targetY;
    dev.lastTime = now;
  } else if (dist > 10) {
    // Continuous swipe: interpolate backlights along touch path
    const steps = Math.max(1, Math.min(4, Math.ceil(dist / 28)));
    const stepVx = (dx / dist) * 3.0;
    const stepVy = (dy / dist) * 3.0;

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const ix = dev.lastX + dx * t;
      const iy = dev.lastY + dy * t;
      igniteBacklightAndPushGas(ix, iy, stepVx, stepVy, false, dev.palette);
    }
    dev.lastX = targetX;
    dev.lastY = targetY;
    dev.lastTime = now;
  }

  state.entropy = Math.min(1.0, state.entropy + (isNewTouch ? 0.025 : 0.008));
  soundscape.onTouchEvent({ nx, ny, action: ev.action || "move", deviceId });
}

let lastFrameTime = performance.now();

function animate(now) {
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  const timeSec = now * 0.001;

  state.entropy = Math.max(0, state.entropy - 0.06 * dt);
  soundscape.onIntensityChange(state.entropy);

  // 1. Deep ambient dark base
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(4, 6, 10, 0.28)";
  ctx.fillRect(0, 0, state.width, state.height);

  // 2. Base layer: Additive Volumetric Backlights
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = state.backlights.length - 1; i >= 0; i--) {
    const bl = state.backlights[i];
    bl.x += bl.vx;
    bl.y += bl.vy;
    bl.vx *= 0.95;
    bl.vy *= 0.95;
    bl.radius += (bl.maxRadius - bl.radius) * 2.2 * dt;
    bl.intensity -= bl.fadeSpeed * dt;

    if (bl.intensity <= 0.01) {
      state.backlights.splice(i, 1);
      continue;
    }

    const { r, g, b } = bl.color;
    const alpha = bl.intensity * 0.13; // Softened intensity to avoid blowing out
    const innerR = Math.min(230, Math.round(r * 0.85 + 30));
    const innerG = Math.min(230, Math.round(g * 0.85 + 30));
    const innerB = Math.min(230, Math.round(b * 0.85 + 30));

    const grad = ctx.createRadialGradient(bl.x, bl.y, 0, bl.x, bl.y, bl.radius);
    // Eliminate direct 255,255,255 pure white center; use warm/tinted soft gradient
    grad.addColorStop(0, `rgba(${innerR}, ${innerG}, ${innerB}, ${(alpha * 0.9).toFixed(3)})`);
    grad.addColorStop(0.35, `rgba(${r}, ${g}, ${b}, ${(alpha * 0.65).toFixed(3)})`);
    grad.addColorStop(0.72, `rgba(${r}, ${g}, ${b}, ${(alpha * 0.18).toFixed(3)})`);
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(bl.x, bl.y, bl.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Middle layer: Volumetric Mist Clouds
  for (let i = 0; i < state.mistPuffs.length; i++) {
    const puff = state.mistPuffs[i];
    const angle = gasCurlAngle(puff.x, puff.y, timeSec + puff.phase);
    puff.vx += Math.cos(angle) * 0.012;
    puff.vy += Math.sin(angle) * 0.012;
    puff.vx *= 0.96;
    puff.vy *= 0.96;
    puff.x += puff.vx;
    puff.y += puff.vy;

    // Smooth boundary wrap
    if (puff.x < -puff.radius) puff.x = state.width + puff.radius;
    if (puff.x > state.width + puff.radius) puff.x = -puff.radius;
    if (puff.y < -puff.radius) puff.y = state.height + puff.radius;
    if (puff.y > state.height + puff.radius) puff.y = -puff.radius;

    puff.litLevel = Math.max(0, puff.litLevel - dt * 0.42);

    const mistAlpha = 0.008 + puff.litLevel * 0.042;
    const { r, g, b } = puff.litColor;
    const grad = ctx.createRadialGradient(
      puff.x,
      puff.y,
      0,
      puff.x,
      puff.y,
      puff.radius
    );
    grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${mistAlpha.toFixed(4)})`);
    grad.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, ${(mistAlpha * 0.45).toFixed(4)})`);
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(puff.x, puff.y, puff.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4. Surface layer: Suspended Tyndall Dust Motes
  for (let i = 0; i < state.dustMotes.length; i++) {
    const m = state.dustMotes[i];
    const angle = gasCurlAngle(m.x, m.y, timeSec * 0.8 + m.seed * 0.02);
    m.vx += Math.cos(angle) * 0.022;
    m.vy += Math.sin(angle) * 0.022;
    m.vx *= 0.92;
    m.vy *= 0.92;
    m.x += m.vx;
    m.y += m.vy;

    if (m.x < 0) m.x = state.width;
    if (m.x > state.width) m.x = 0;
    if (m.y < 0) m.y = state.height;
    if (m.y > state.height) m.y = 0;

    m.litLevel = Math.max(0, m.litLevel - dt * 0.55);

    const lit = m.litLevel;
    const alpha = m.baseAlpha + lit * 0.45;
    const { r, g, b } = m.litColor;
    const mr = Math.round(55 + lit * (r - 55));
    const mg = Math.round(95 + lit * (g - 95));
    const mb = Math.round(115 + lit * (b - 115));

    ctx.fillStyle = `rgba(${mr}, ${mg}, ${mb}, ${alpha.toFixed(2)})`;
    const drawSize = m.size + lit * 0.75;
    ctx.beginPath();
    ctx.arc(m.x, m.y, drawSize * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  requestAnimationFrame(animate);
}

function connectWorkerA() {
  try {
    const ws = new WebSocket(WORKER_A_WS);
    state.ws = ws;
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
                },
                deviceId
              );
            }, idx * 15);
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

// Multi-pointer / Mouse interaction for testing
const activePointers = new Set();
canvas.addEventListener("pointerdown", (e) => {
  activePointers.add(e.pointerId);
  ingestTouchEvent(
    {
      nx: e.clientX / state.width,
      ny: e.clientY / state.height,
      action: "down",
    },
    `pointer-${e.pointerId}`
  );
});
canvas.addEventListener("pointermove", (e) => {
  if (!activePointers.has(e.pointerId)) return;
  ingestTouchEvent(
    {
      nx: e.clientX / state.width,
      ny: e.clientY / state.height,
      action: "move",
    },
    `pointer-${e.pointerId}`
  );
});
window.addEventListener("pointerup", (e) => {
  activePointers.delete(e.pointerId);
});
window.addEventListener("pointercancel", (e) => {
  activePointers.delete(e.pointerId);
});

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
connectWorkerA();
requestAnimationFrame(animate);
