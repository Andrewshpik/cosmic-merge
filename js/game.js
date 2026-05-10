'use strict';

const { Engine, World, Bodies, Body, Composite, Events } = Matter;

// ---------- Config ----------
const W = 460;
const H = 640;
const DANGER_Y = 90;
const SPAWN_Y = 50;
const WALL_T = 30;

const TIERS = [
  { name: 'Пыль',         radius: 14,  fill: '#cdd0db', glow: '#9498a8', glowSize: 6  },
  { name: 'Частица',      radius: 18,  fill: '#7cd6e3', glow: '#3aa0c0', glowSize: 12 },
  { name: 'Атом',         radius: 23,  fill: '#a8d4ff', glow: '#3a78d8', glowSize: 14 },
  { name: 'Астероид',     radius: 30,  fill: '#a08770', glow: '#5a4030', glowSize: 4  },
  { name: 'Комета',       radius: 38,  fill: '#cdf0ff', glow: '#5fb8ff', glowSize: 18 },
  { name: 'Луна',         radius: 47,  fill: '#f0e5c8', glow: '#a8987a', glowSize: 8  },
  { name: 'Планета',      radius: 56,  fill: '#5dd4a4', glow: '#2a8068', glowSize: 10 },
  { name: 'Газ. гигант',  radius: 65,  fill: '#ffa86b', glow: '#c05020', glowSize: 12 },
  { name: 'Звезда',       radius: 75,  fill: '#fff5a0', glow: '#ff9020', glowSize: 28 },
  { name: 'Пульсар',      radius: 86,  fill: '#ff8af0', glow: '#a040c0', glowSize: 32 },
  { name: 'Галактика',    radius: 100, fill: '#d0a0ff', glow: '#5a20a0', glowSize: 40 },
];

const SPAWN_TIERS = [0, 1, 2, 3]; // tiers that can drop from top

// ---------- DOM ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const nextOrbEl = document.getElementById('next-orb');
const tierListEl = document.getElementById('tier-list');
const gameOverScreen = document.getElementById('game-over');
const finalStatsEl = document.getElementById('final-stats');
const historyScreen = document.getElementById('history-screen');
const historyContentEl = document.getElementById('history-content');
document.getElementById('reset').onclick = () => resetGame();
document.getElementById('restart-btn').onclick = () => resetGame();
document.getElementById('history').onclick = () => showHistory();
document.getElementById('history-close').onclick = () => historyScreen.classList.add('hidden');

// ---------- Canvas sizing ----------
function fitCanvas() {
  const wrap = canvas.parentElement;
  const rect = wrap.getBoundingClientRect();
  const aspect = W / H;
  let w = rect.width;
  let h = rect.height;
  if (w / h > aspect) w = h * aspect;
  else h = w / aspect;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  // Internal resolution stays at logical W×H for crisp physics-to-pixel mapping.
  canvas.width = W;
  canvas.height = H;
}
window.addEventListener('resize', fitCanvas);

// ---------- Tier list UI ----------
function buildTierList() {
  tierListEl.innerHTML = '';
  TIERS.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'tier-row';
    row.dataset.tier = i;
    const visualSize = Math.max(14, Math.min(28, t.radius * 0.55));
    row.innerHTML = `
      <div class="tier-orb" style="
        width:${visualSize}px;height:${visualSize}px;
        background: radial-gradient(circle at 30% 30%, #fff8, ${t.fill} 50%, ${t.glow} 100%);
        box-shadow: 0 0 ${t.glowSize / 2}px ${t.glow};
      "></div>
      <span class="tier-name">${t.name}</span>
    `;
    tierListEl.appendChild(row);
  });
}
function updateTierUI(unlocked) {
  for (const row of tierListEl.children) {
    const tier = parseInt(row.dataset.tier);
    row.classList.toggle('unlocked', tier <= unlocked);
  }
}

// ---------- Starfield bg ----------
const stars = [];
for (let i = 0; i < 60; i++) {
  stars.push({
    x: Math.random() * W,
    y: Math.random() * H,
    r: Math.random() * 1.2 + 0.3,
    a: Math.random() * 0.6 + 0.2,
    twinkle: Math.random() * Math.PI * 2,
  });
}

// ---------- Physics setup ----------
let engine, world;
let orbs = [];
let particles = [];
let score = 0;
let unlockedTier = 0;
let nextTier = pickSpawnTier();
let dropX = W / 2;
let canDropAt = 0;
let running = true;
let aboveLineTimes = new Map(); // bodyId -> seconds above danger line

function pickSpawnTier() {
  return SPAWN_TIERS[Math.floor(Math.random() * SPAWN_TIERS.length)];
}

function setupPhysics() {
  engine = Engine.create({ gravity: { x: 0, y: 1.2 } });
  world = engine.world;

  const wallOpts = { isStatic: true, restitution: 0.1, friction: 0.6 };
  // Floor
  Composite.add(world, Bodies.rectangle(W / 2, H + WALL_T / 2, W * 2, WALL_T, wallOpts));
  // Left wall
  Composite.add(world, Bodies.rectangle(-WALL_T / 2, H / 2, WALL_T, H * 2, wallOpts));
  // Right wall
  Composite.add(world, Bodies.rectangle(W + WALL_T / 2, H / 2, WALL_T, H * 2, wallOpts));

  Events.on(engine, 'collisionStart', onCollision);
}

function spawnOrb(x, y, tier) {
  const t = TIERS[tier];
  const body = Bodies.circle(x, y, t.radius, {
    restitution: 0.18,
    friction: 0.04,
    frictionAir: 0.005,
    density: 0.0015,
    label: 'orb',
  });
  body.tier = tier;
  body.merging = false;
  Composite.add(world, body);
  orbs.push(body);
  return body;
}

function onCollision(event) {
  for (const pair of event.pairs) {
    const a = pair.bodyA, b = pair.bodyB;
    if (a.label !== 'orb' || b.label !== 'orb') continue;
    if (a.merging || b.merging) continue;
    if (a.tier !== b.tier) continue;
    if (a.tier >= TIERS.length - 1) continue; // already max
    a.merging = true;
    b.merging = true;
    mergeOrbs(a, b);
  }
}

function mergeOrbs(a, b) {
  const tier = a.tier + 1;
  const x = (a.position.x + b.position.x) / 2;
  const y = (a.position.y + b.position.y) / 2;

  removeOrb(a);
  removeOrb(b);

  const newOrb = spawnOrb(x, y, tier);
  // Soft impulse outward
  Body.setVelocity(newOrb, {
    x: (a.velocity.x + b.velocity.x) / 4,
    y: (a.velocity.y + b.velocity.y) / 4 - 0.5,
  });

  // Score: tier value
  score += (tier + 1) * 10;
  if (tier > unlockedTier) unlockedTier = tier;
  updateScoreUI();
  updateTierUI(unlockedTier);

  // Merge particles
  const t = TIERS[tier];
  const count = 8 + tier;
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp = 2 + Math.random() * 4;
    particles.push({
      x, y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp - 1,
      life: 0.6 + Math.random() * 0.3,
      maxLife: 0.9,
      r: 2 + Math.random() * 2,
      color: t.fill,
    });
  }

  sfx.merge(tier);

  if (tier === TIERS.length - 1) {
    sfx.galaxy();
  }
}

function removeOrb(body) {
  Composite.remove(world, body);
  orbs = orbs.filter(o => o !== body);
  aboveLineTimes.delete(body.id);
}

// ---------- Game flow ----------
function dropOrb() {
  const now = performance.now();
  if (now < canDropAt || !running) return;
  const tier = nextTier;
  const t = TIERS[tier];
  const x = Math.max(t.radius + 4, Math.min(W - t.radius - 4, dropX));
  const orb = spawnOrb(x, SPAWN_Y, tier);
  Body.setVelocity(orb, { x: 0, y: 0.5 });
  nextTier = pickSpawnTier();
  updateNextPreview();
  canDropAt = now + 350;
  sfx.drop();
}

function updateNextPreview() {
  const t = TIERS[nextTier];
  const visualSize = Math.max(20, Math.min(48, t.radius * 0.6));
  nextOrbEl.style.width = visualSize + 'px';
  nextOrbEl.style.height = visualSize + 'px';
  nextOrbEl.style.background =
    `radial-gradient(circle at 30% 30%, #fff9, ${t.fill} 55%, ${t.glow} 100%)`;
  nextOrbEl.style.boxShadow = `0 0 ${t.glowSize / 2}px ${t.glow}`;
}

function updateScoreUI() {
  scoreEl.textContent = score;
  const best = parseInt(localStorage.getItem('cosmicmerge.best') || '0', 10);
  if (score > best) {
    localStorage.setItem('cosmicmerge.best', score);
    bestEl.textContent = score;
  }
}

function loadBest() {
  const best = parseInt(localStorage.getItem('cosmicmerge.best') || '0', 10);
  bestEl.textContent = best;
}

function loadRecords() {
  try {
    const raw = localStorage.getItem('cosmicmerge.records');
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveRecord(entry) {
  const records = loadRecords();
  records.unshift(entry);
  localStorage.setItem('cosmicmerge.records', JSON.stringify(records.slice(0, 10)));
}

function formatDate(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderRecords(records, withTitle) {
  if (!records.length) return '<div class="records-empty">Пока нет сыгранных партий</div>';
  const title = withTitle ? '<div class="records-title">Последние игры</div>' : '';
  return `${title}<ol class="records-list">${records.map((r) => `
    <li><span class="r-score">${r.score}</span><span class="r-tier">${r.tier || ''}</span><span class="r-date">${formatDate(r.date)}</span></li>
  `).join('')}</ol>`;
}

function showHistory() {
  historyContentEl.innerHTML = renderRecords(loadRecords(), false);
  historyScreen.classList.remove('hidden');
}

function gameOver() {
  if (!running) return;
  running = false;
  sfx.gameOver();
  saveRecord({ score, tier: TIERS[unlockedTier].name, date: Date.now() });
  const best = parseInt(localStorage.getItem('cosmicmerge.best') || '0', 10);
  finalStatsEl.innerHTML = `
    Score: <b>${score}</b><br>
    Best: <b>${best}</b><br>
    Эволюция: <b>${TIERS[unlockedTier].name}</b>
    ${renderRecords(loadRecords(), true)}
  `;
  gameOverScreen.classList.remove('hidden');
}

function resetGame() {
  // Tear down old engine
  if (engine) {
    Events.off(engine, 'collisionStart', onCollision);
    Engine.clear(engine);
  }
  orbs = [];
  particles = [];
  aboveLineTimes.clear();
  score = 0;
  unlockedTier = 0;
  nextTier = pickSpawnTier();
  dropX = W / 2;
  canDropAt = 0;
  running = true;
  setupPhysics();
  updateScoreUI();
  updateTierUI(-1);
  updateNextPreview();
  gameOverScreen.classList.add('hidden');
}

// ---------- Input ----------
function canvasToLogical(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * W;
  const y = ((clientY - rect.top) / rect.height) * H;
  return { x, y };
}

canvas.addEventListener('pointermove', e => {
  const p = canvasToLogical(e.clientX, e.clientY);
  dropX = p.x;
});
canvas.addEventListener('pointerdown', e => {
  const p = canvasToLogical(e.clientX, e.clientY);
  dropX = p.x;
});
canvas.addEventListener('pointerup', e => {
  e.preventDefault();
  dropOrb();
});

// Keyboard: drop on space, restart on R
window.addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); dropOrb(); }
  if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') resetGame();
});

// ---------- Sound (Web Audio synth) ----------
class Sfx {
  constructor() { this.ctx = null; }
  _ensure() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (Ctor) this.ctx = new Ctor();
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }
  _tone({ freq, type = 'sine', dur = 0.1, vol = 0.08, freqEnd = null }) {
    this._ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
  drop()  { this._tone({ freq: 380, freqEnd: 220, type: 'sine', dur: 0.12, vol: 0.05 }); }
  merge(tier) {
    const base = 220 + tier * 60;
    this._tone({ freq: base, type: 'triangle', dur: 0.18, vol: 0.08 });
    setTimeout(() => this._tone({ freq: base * 1.5, type: 'triangle', dur: 0.16, vol: 0.06 }), 50);
  }
  galaxy() {
    [262, 330, 392, 523, 659].forEach((f, i) =>
      setTimeout(() => this._tone({ freq: f, type: 'triangle', dur: 0.4, vol: 0.12 }), i * 90));
  }
  gameOver() {
    [330, 280, 220, 165].forEach((f, i) =>
      setTimeout(() => this._tone({ freq: f, type: 'sawtooth', dur: 0.3, vol: 0.1 }), i * 100));
  }
}
const sfx = new Sfx();

// ---------- Render ----------
function drawStarfield(time) {
  ctx.save();
  for (const s of stars) {
    const a = s.a + Math.sin(time * 0.002 + s.twinkle) * 0.2;
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawDangerLine(time) {
  ctx.save();
  const pulse = 0.4 + Math.sin(time * 0.005) * 0.2;
  ctx.strokeStyle = `rgba(255, 80, 120, ${pulse})`;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(0, DANGER_Y);
  ctx.lineTo(W, DANGER_Y);
  ctx.stroke();
  ctx.restore();
}

function drawOrb(x, y, angle, tier, scale = 1) {
  const t = TIERS[tier];
  const r = t.radius * scale;

  ctx.save();
  ctx.translate(x, y);

  // Glow
  if (t.glowSize > 0) {
    ctx.shadowColor = t.glow;
    ctx.shadowBlur = t.glowSize;
  }

  const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.4, 0, 0, 0, r);
  grad.addColorStop(0, '#ffffffcc');
  grad.addColorStop(0.4, t.fill);
  grad.addColorStop(1, t.glow);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;

  // Galaxy (top tier) — extra swirl
  if (tier === TIERS.length - 1) {
    ctx.rotate(angle);
    ctx.strokeStyle = 'rgba(255, 240, 255, 0.6)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.45 + i * 0.18), i * 1.2, i * 1.2 + Math.PI * 1.5);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawPreviewOrb(time) {
  if (!running) return;
  const t = TIERS[nextTier];
  const x = Math.max(t.radius + 4, Math.min(W - t.radius - 4, dropX));
  // Floating animation
  const y = SPAWN_Y + Math.sin(time * 0.003) * 3;
  // Aim line down to the floor
  ctx.save();
  ctx.strokeStyle = 'rgba(180, 180, 220, 0.15)';
  ctx.setLineDash([3, 6]);
  ctx.beginPath();
  ctx.moveTo(x, y + t.radius);
  ctx.lineTo(x, H - 8);
  ctx.stroke();
  ctx.restore();
  drawOrb(x, y, 0, nextTier, 0.95);
}

function drawParticles(dt) {
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.1;
    p.life -= dt;
  }
  particles = particles.filter(p => p.life > 0);

  for (const p of particles) {
    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * alpha, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------- Main loop ----------
let lastTime = performance.now();

function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (running) {
    Engine.update(engine, dt * 1000);
    checkGameOver(dt);
  }

  ctx.clearRect(0, 0, W, H);
  drawStarfield(now);
  drawDangerLine(now);

  for (const o of orbs) {
    drawOrb(o.position.x, o.position.y, o.angle, o.tier, 1);
  }

  drawParticles(dt);
  drawPreviewOrb(now);

  requestAnimationFrame(loop);
}

function checkGameOver(dt) {
  for (const o of orbs) {
    const top = o.position.y - TIERS[o.tier].radius;
    const settled = Math.abs(o.velocity.y) < 0.6 && Math.abs(o.velocity.x) < 0.6;
    if (top < DANGER_Y && settled) {
      const t = (aboveLineTimes.get(o.id) || 0) + dt;
      aboveLineTimes.set(o.id, t);
      if (t > 1.5) { gameOver(); return; }
    } else {
      aboveLineTimes.set(o.id, 0);
    }
  }
}

// ---------- Boot ----------
buildTierList();
fitCanvas();
loadBest();
resetGame();
requestAnimationFrame(loop);
