import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// =====================================================================
// Constants
// =====================================================================
const GRID  = 48;           // cells per side
const VW    = GRID + 1;     // vertex grid is one larger than cell grid
const STEP  = 0.5;          // world units per integer height level
const MAX_H = 8;

const TEAM_BLUE = 1;
const TEAM_RED  = 2;

const TINT_BLUE = new THREE.Color(0x6aa8e8);
const TINT_RED  = new THREE.Color(0xe06868);

// =====================================================================
// Spells — the seven "acts of God" from the 1989 game. Sculpt is the
// existing raise/lower behaviour; the others are placeholders until the
// effects are wired up. Each entry carries its mana cost and an inline
// SVG icon used by the ribbon.
// =====================================================================
const SPELLS = [
  {
    id: 'sculpt', name: 'Sculpt', cost: 3,
    svg: '<path d="M2 21 L8 9 L12 15 L18 5 L22 21 Z"/>',
  },
  {
    id: 'earthquake', name: 'Earthquake', cost: 20,
    svg: '<path d="M2 12 L6 6 L8 14 L12 4 L14 16 L18 8 L22 14"/>',
  },
  {
    id: 'swamp', name: 'Swamp', cost: 15,
    svg: '<path d="M2 14 Q6 10 10 14 T18 14 T26 14"/><path d="M2 19 Q6 15 10 19 T18 19 T26 19"/><circle cx="7" cy="7" r="1.2"/><circle cx="13" cy="5" r="1.2"/><circle cx="18" cy="8" r="1.2"/>',
  },
  {
    id: 'knight', name: 'Knight', cost: 40,
    svg: '<path d="M14 3 L21 3 L21 10 L9 22 L4 22 L4 17 L16 5 Z"/><path d="M13 7 L17 11"/>',
  },
  {
    id: 'volcano', name: 'Volcano', cost: 50,
    svg: '<path d="M2 22 L8 11 L11 15 L13 4 L15 15 L18 11 L22 22 Z"/><path d="M11 4 Q13 2 14 4"/>',
  },
  {
    id: 'flood', name: 'Flood', cost: 80,
    svg: '<path d="M2 7 Q6 3 10 7 T18 7 T26 7"/><path d="M2 13 Q6 9 10 13 T18 13 T26 13"/><path d="M2 19 Q6 15 10 19 T18 19 T26 19"/>',
  },
  {
    id: 'armageddon', name: 'Armageddon', cost: 150,
    svg: '<path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z"/>',
  },
];
const SPELLS_BY_ID = Object.fromEntries(SPELLS.map(s => [s.id, s]));
let selectedSpell = 'sculpt';

// =====================================================================
// Biomes — the four original Populous worlds. Each biome owns its own
// terrain palette (low → high), water color, sky/fog, and light tints.
// =====================================================================
const BIOMES = {
  grassy: {
    label: 'Grassland',
    terrain: {
      water: new THREE.Color(0x1f4f7a),
      sand:  new THREE.Color(0x7ac850),
      low:   new THREE.Color(0x66c042),
      mid:   new THREE.Color(0x9a7a48),
      high:  new THREE.Color(0xb0a89c),
      peak:  new THREE.Color(0xf4f4f8),
    },
    water: 0x2a5a8a,
    sky:   0x9ed4ec,
    sun:   0xfff2d8,
    hemiSky:    0xfff4e0,
    hemiGround: 0x504030,
  },
  desert: {
    label: 'Desert',
    terrain: {
      water: new THREE.Color(0x2f7a8a),
      sand:  new THREE.Color(0xf2d894),
      low:   new THREE.Color(0xd8a85a),
      mid:   new THREE.Color(0xb05a26),
      high:  new THREE.Color(0x7a3818),
      peak:  new THREE.Color(0xf0e0a8),
    },
    water: 0x3a8090,
    sky:   0xe8c878,
    sun:   0xffe2a0,
    hemiSky:    0xffe0a0,
    hemiGround: 0x804020,
  },
  snow: {
    label: 'Snow',
    terrain: {
      water: new THREE.Color(0x355870),
      sand:  new THREE.Color(0xd8e2ec),
      low:   new THREE.Color(0xf0f4f8),
      mid:   new THREE.Color(0xb4c0cc),
      high:  new THREE.Color(0x586878),
      peak:  new THREE.Color(0xffffff),
    },
    water: 0x4a7494,
    sky:   0xc8d4e0,
    sun:   0xe4ecf4,
    hemiSky:    0xd8e4f0,
    hemiGround: 0x405068,
  },
  lava: {
    label: 'Lava',
    terrain: {
      water: new THREE.Color(0xc83018),
      sand:  new THREE.Color(0x4a3830),
      low:   new THREE.Color(0x6a4838),
      mid:   new THREE.Color(0x503028),
      high:  new THREE.Color(0x261c20),
      peak:  new THREE.Color(0xff6020),
    },
    water: 0xd84020,
    sky:   0x4a2018,
    sun:   0xffa460,
    hemiSky:    0xff8048,
    hemiGround: 0x200808,
  },
};
const BIOME_NAMES = Object.keys(BIOMES);
let currentBiome = BIOME_NAMES[Math.floor(Math.random() * BIOME_NAMES.length)];

// =====================================================================
// Scene
// =====================================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(BIOMES[currentBiome].sky);
scene.fog = new THREE.Fog(BIOMES[currentBiome].sky, 60, 140);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 500);
camera.position.set(GRID * 0.5, 32, GRID * 1.0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(GRID / 2, 1, GRID / 2);
// Right-drag pans the camera. A right *click* (no movement) still lowers a
// vertex — detected via the mouseup handler below.
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.panSpeed = 1.0;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 10;
controls.maxDistance = 90;
controls.maxPolarAngle = Math.PI * 0.46;

const sun = new THREE.DirectionalLight(BIOMES[currentBiome].sun, 1.1);
sun.position.set(60, 90, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 200;
scene.add(sun);
const hemi = new THREE.HemisphereLight(
  BIOMES[currentBiome].hemiSky,
  BIOMES[currentBiome].hemiGround,
  0.55,
);
scene.add(hemi);

const water = new THREE.Mesh(
  new THREE.PlaneGeometry(GRID * 6, GRID * 6),
  new THREE.MeshLambertMaterial({
    color: BIOMES[currentBiome].water,
    transparent: true,
    opacity: 0.85,
  }),
);
water.rotation.x = -Math.PI / 2;
water.position.set(GRID / 2, 0.15, GRID / 2);
water.receiveShadow = true;
scene.add(water);

function applyBiome(name) {
  if (!BIOMES[name]) return;
  currentBiome = name;
  const b = BIOMES[name];
  scene.background.set(b.sky);
  scene.fog.color.set(b.sky);
  sun.color.set(b.sun);
  hemi.color.set(b.hemiSky);
  hemi.groundColor.set(b.hemiGround);
  water.material.color.set(b.water);
}

// =====================================================================
// Terrain (vertex-based heightmap)
//
// `h[v]` stores the integer height of vertex v in a (GRID+1) x (GRID+1)
// grid. Cells are the GRID x GRID quads between vertices; each cell has
// four corner heights that may all differ, producing sloped triangles.
// `owner[c]` is per-cell ownership for the territory tint.
// =====================================================================
class Terrain {
  constructor() {
    this.h = new Int8Array(VW * VW);
    this.owner = new Int8Array(GRID * GRID);
    this.geo = new THREE.BufferGeometry();
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    this.generate();
    this.rebuild();
  }

  // --- vertex helpers ---
  vInside(x, z) { return x >= 0 && z >= 0 && x < VW && z < VW; }
  vIdx(x, z)    { return z * VW + x; }
  getV(x, z) {
    if (!this.vInside(x, z)) return -1;
    return this.h[this.vIdx(x, z)];
  }
  setV(x, z, v) {
    if (!this.vInside(x, z)) return;
    this.h[this.vIdx(x, z)] = Math.max(0, Math.min(MAX_H, v));
  }

  // --- cell helpers ---
  cInside(x, z) { return x >= 0 && z >= 0 && x < GRID && z < GRID; }
  cellCorners(cx, cz) {
    return [
      this.getV(cx,     cz),
      this.getV(cx + 1, cz),
      this.getV(cx,     cz + 1),
      this.getV(cx + 1, cz + 1),
    ];
  }
  cellMin(cx, cz) { const c = this.cellCorners(cx, cz); return Math.min(c[0], c[1], c[2], c[3]); }
  cellMax(cx, cz) { const c = this.cellCorners(cx, cz); return Math.max(c[0], c[1], c[2], c[3]); }
  cellIsFlat(cx, cz) {
    const c = this.cellCorners(cx, cz);
    return c[0] === c[1] && c[1] === c[2] && c[2] === c[3];
  }
  cellWalkable(cx, cz) {
    if (!this.cInside(cx, cz)) return false;
    const mn = this.cellMin(cx, cz);
    const mx = this.cellMax(cx, cz);
    return mn >= 1 && (mx - mn) <= 1;
  }

  // Returns true if a `size` x `size` block of cells starting at (cx, cz)
  // is perfectly flat at the same height — needed for building.
  isFlatArea(cx, cz, size = 2) {
    if (cx < 0 || cz < 0 || cx + size > GRID || cz + size > GRID) return false;
    const h0 = this.getV(cx, cz);
    if (h0 < 1) return false;
    for (let dz = 0; dz <= size; dz++) {
      for (let dx = 0; dx <= size; dx++) {
        if (this.getV(cx + dx, cz + dz) !== h0) return false;
      }
    }
    return true;
  }

  getOwner(cx, cz) {
    if (!this.cInside(cx, cz)) return 0;
    return this.owner[cz * GRID + cx];
  }
  setOwner(cx, cz, v) {
    if (!this.cInside(cx, cz)) return;
    this.owner[cz * GRID + cx] = v;
  }

  // Bilinear interpolation of corner heights at a world-space (wx, wz).
  // Used so walkers ride the terrain smoothly even on slopes.
  heightAtWorld(wx, wz) {
    let cx = Math.floor(wx), cz = Math.floor(wz);
    cx = Math.max(0, Math.min(GRID - 1, cx));
    cz = Math.max(0, Math.min(GRID - 1, cz));
    const fx = Math.max(0, Math.min(1, wx - cx));
    const fz = Math.max(0, Math.min(1, wz - cz));
    const nw = Math.max(0, this.getV(cx,     cz));
    const ne = Math.max(0, this.getV(cx + 1, cz));
    const sw = Math.max(0, this.getV(cx,     cz + 1));
    const se = Math.max(0, this.getV(cx + 1, cz + 1));
    const top = nw * (1 - fx) + ne * fx;
    const bot = sw * (1 - fx) + se * fx;
    return (top * (1 - fz) + bot * fz) * STEP;
  }

  // --- generation ---
  generate() {
    const cx0 = VW / 2, cz0 = VW / 2;
    const radius = VW * 0.45;
    for (let z = 0; z < VW; z++) {
      for (let x = 0; x < VW; x++) {
        const dx = x - cx0, dz = z - cz0;
        const d = Math.sqrt(dx * dx + dz * dz);
        const falloff = Math.max(0, 1 - d / radius);
        const n =
          0.6 * pseudoNoise(x * 0.18, z * 0.18) +
          0.3 * pseudoNoise(x * 0.40 + 9, z * 0.40 - 5) +
          0.1 * pseudoNoise(x * 0.90, z * 0.90);
        let h = (n * 4 + falloff * 4) - 1.5;
        h = Math.round(h);
        this.setV(x, z, Math.max(0, Math.min(MAX_H, h)));
      }
    }
    this.smoothAll();
  }

  // Enforces |h(v) - h(neighbor)| <= 1 over 8-neighborhood by clamping
  // neighbours down. Run until stable.
  smoothAll() {
    let changed = true, iters = 0;
    while (changed && iters++ < 80) {
      changed = false;
      for (let z = 0; z < VW; z++) {
        for (let x = 0; x < VW; x++) {
          const h = this.getV(x, z);
          for (const [dx, dz] of NEI8) {
            const nh = this.getV(x + dx, z + dz);
            if (nh < 0) continue;
            if (h - nh > 1) {
              this.setV(x + dx, z + dz, h - 1);
              changed = true;
            }
          }
        }
      }
    }
  }

  // --- shaping ---
  raise(vx, vz) { this.shape(vx, vz, +1); }
  lower(vx, vz) { this.shape(vx, vz, -1); }

  // Drop every vertex by one step (clamped at 0). Effectively raises the
  // sea level relative to the land — the visual water plane stays put but
  // any vertex that was at h=1 now reads as water.
  flood() {
    for (let i = 0; i < this.h.length; i++) {
      if (this.h[i] > 0) this.h[i] -= 1;
    }
    this.rebuild();
  }

  shape(vx, vz, sign) {
    if (!this.vInside(vx, vz)) return;
    this.setV(vx, vz, this.getV(vx, vz) + sign);
    // BFS smoothing on vertex grid using 8-neighbours so diagonals also
    // stay within one step.
    const q = [[vx, vz]];
    const seen = new Set([this.vIdx(vx, vz)]);
    while (q.length) {
      const [x, z] = q.shift();
      const h = this.getV(x, z);
      for (const [dx, dz] of NEI8) {
        const nx = x + dx, nz = z + dz;
        if (!this.vInside(nx, nz)) continue;
        const nh = this.getV(nx, nz);
        let changed = false;
        if (sign > 0 && h - nh > 1) { this.setV(nx, nz, h - 1); changed = true; }
        if (sign < 0 && nh - h > 1) { this.setV(nx, nz, h + 1); changed = true; }
        if (changed) {
          const k = this.vIdx(nx, nz);
          if (!seen.has(k)) { seen.add(k); q.push([nx, nz]); }
        }
      }
    }
    this.rebuild();
  }

  // Rebuild the mesh from vertex heights — two triangles per cell, with
  // the diagonal chosen so the height step across the cut is minimized
  // (otherwise saddle cells look folded).
  rebuild() {
    const positions = [];
    const normals = [];
    const colors = [];

    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const n  = new THREE.Vector3();

    const pushTri = (v1, v2, v3, col) => {
      e1.subVectors(v2, v1);
      e2.subVectors(v3, v1);
      n.crossVectors(e1, e2).normalize();
      for (const v of [v1, v2, v3]) {
        positions.push(v.x, v.y, v.z);
        normals.push(n.x, n.y, n.z);
        colors.push(col.r, col.g, col.b);
      }
    };

    for (let cz = 0; cz < GRID; cz++) {
      for (let cx = 0; cx < GRID; cx++) {
        const hNW = this.getV(cx,     cz);
        const hNE = this.getV(cx + 1, cz);
        const hSW = this.getV(cx,     cz + 1);
        const hSE = this.getV(cx + 1, cz + 1);

        // Cell color from the minimum corner height so that slopes keep the
        // base color and only fully-elevated cells take the higher tier.
        const minH = Math.min(hNW, hNE, hSW, hSE);
        const base = pickTerrainColor(minH);
        const own = this.getOwner(cx, cz);
        const col = base.clone();
        if (own === TEAM_BLUE)     col.lerp(TINT_BLUE, 0.35);
        else if (own === TEAM_RED) col.lerp(TINT_RED,  0.35);

        const vNW = new THREE.Vector3(cx,     hNW * STEP, cz);
        const vNE = new THREE.Vector3(cx + 1, hNE * STEP, cz);
        const vSW = new THREE.Vector3(cx,     hSW * STEP, cz + 1);
        const vSE = new THREE.Vector3(cx + 1, hSE * STEP, cz + 1);

        // Pick the diagonal that lies between the two closer-in-height
        // corners — that's the natural fold for the quad.
        if (Math.abs(hNW - hSE) <= Math.abs(hNE - hSW)) {
          pushTri(vNW, vSE, vNE, col);
          pushTri(vNW, vSW, vSE, col);
        } else {
          pushTri(vNW, vSW, vNE, col);
          pushTri(vNE, vSW, vSE, col);
        }
      }
    }

    this.geo.dispose();
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
    this.geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors,    3));
    this.geo.computeBoundingSphere();
    this.mesh.geometry = this.geo;
  }
}

function pickTerrainColor(h) {
  const t = BIOMES[currentBiome].terrain;
  if (h <= 0)   return t.water;
  if (h <= 1.2) return t.sand;
  if (h <= 3)   return t.low;
  if (h <= 5)   return t.mid;
  if (h <= 7)   return t.high;
  return t.peak;
}

const NEI4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const NEI8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

let _seed = 1337;
function pseudoNoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const a = hash01(xi,     zi);
  const b = hash01(xi + 1, zi);
  const c = hash01(xi,     zi + 1);
  const d = hash01(xi + 1, zi + 1);
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, sx),
    THREE.MathUtils.lerp(c, d, sx),
    sz
  );
}
function hash01(x, z) {
  let h = x * 374761393 + z * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 10000) / 10000;
}

// =====================================================================
// Game
// =====================================================================
class Game {
  constructor() {
    this.terrain = new Terrain();
    this.walkers = [];
    this.houses  = [];
    this.mana    = { [TEAM_BLUE]: 20, [TEAM_RED]: 20 };
    this.aiCooldown = 4;
    this.gameOver   = false;
    this.spawnInitial();
  }

  spawnInitial() {
    const blueSpot = this.findStartingSpot(8, 8);
    const redSpot  = this.findStartingSpot(GRID - 10, GRID - 10);
    if (blueSpot) {
      this.placeHouse(blueSpot.x, blueSpot.z, TEAM_BLUE);
      for (let i = 0; i < 4; i++) this.spawnWalker(blueSpot.x + 1, blueSpot.z + 1, TEAM_BLUE);
    }
    if (redSpot) {
      this.placeHouse(redSpot.x, redSpot.z, TEAM_RED);
      for (let i = 0; i < 4; i++) this.spawnWalker(redSpot.x + 1, redSpot.z + 1, TEAM_RED);
    }
  }

  findStartingSpot(x, z) {
    for (let r = 0; r < 14; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const xx = x + dx, zz = z + dz;
          if (this.terrain.isFlatArea(xx, zz, 2)) return { x: xx, z: zz };
        }
      }
    }
    return null;
  }

  placeHouse(cx, cz, team) {
    const h = this.terrain.getV(cx, cz);
    const house = new House(cx, cz, team, h);
    this.houses.push(house);
    for (let dz = -1; dz <= 2; dz++)
      for (let dx = -1; dx <= 2; dx++)
        this.terrain.setOwner(cx + dx, cz + dz, team);
    this.terrain.rebuild();
    return house;
  }

  spawnWalker(wx, wz, team) {
    const w = new Walker(
      wx + (Math.random() - 0.5) * 0.6,
      wz + (Math.random() - 0.5) * 0.6,
      team,
      this.terrain,
    );
    this.walkers.push(w);
    return w;
  }

  update(dt) {
    if (this.gameOver) return;

    for (const team of [TEAM_BLUE, TEAM_RED]) {
      const pop = this.popOf(team);
      this.mana[team] = Math.min(200, this.mana[team] + dt * (1 + pop * 0.15));
    }

    for (const w of this.walkers) w.update(dt, this);
    for (const h of this.houses)  h.update(dt, this);

    // Combat
    for (let i = 0; i < this.walkers.length; i++) {
      const a = this.walkers[i];
      if (a.dead) continue;
      for (let j = i + 1; j < this.walkers.length; j++) {
        const b = this.walkers[j];
        if (b.dead || a.team === b.team) continue;
        const dx = a.x - b.x, dz = a.z - b.z;
        if (dx * dx + dz * dz < 0.35) {
          a.hp -= dt * 35;
          b.hp -= dt * 35;
          if (a.hp <= 0) a.dead = true;
          if (b.hp <= 0) b.dead = true;
        }
      }
    }

    for (const w of this.walkers) if (w.dead) w.dispose();
    this.walkers = this.walkers.filter(w => !w.dead);
    for (const h of this.houses) if (h.dead) h.dispose();
    this.houses = this.houses.filter(h => !h.dead);

    this.aiCooldown -= dt;
    if (this.aiCooldown <= 0) {
      this.aiTurn();
      this.aiCooldown = 1.6 + Math.random() * 1.2;
    }

    const blueAlive = this.popOf(TEAM_BLUE) + this.housesOf(TEAM_BLUE);
    const redAlive  = this.popOf(TEAM_RED)  + this.housesOf(TEAM_RED);
    if (blueAlive === 0)     this.endGame('Red wins');
    else if (redAlive === 0) this.endGame('Blue wins');
  }

  popOf(team)    { return this.walkers.filter(w => w.team === team).length; }
  housesOf(team) { return this.houses.filter(h => h.team === team).length; }

  endGame(msg) {
    this.gameOver = true;
    const el = document.getElementById('message');
    el.textContent = msg + ' — press R to restart';
    el.classList.add('show');
  }

  // Global flood: lower the whole heightmap by one step, sink any house
  // whose footprint now sits at or below sea level, and drown walkers
  // caught in newly-submerged cells. Surviving houses drop with the land.
  castFlood() {
    this.terrain.flood();
    for (const h of this.houses) {
      h.terrainH -= 1;
      if (h.terrainH < 1) {
        h.dead = true;
      } else {
        h.mesh.position.y = h.terrainH * STEP;
      }
    }
    for (const w of this.walkers) {
      const cx = Math.floor(w.x), cz = Math.floor(w.z);
      if (!this.terrain.cInside(cx, cz) || this.terrain.cellMin(cx, cz) < 1) {
        w.dead = true;
      }
    }
  }

  aiTurn() {
    if (this.mana[TEAM_RED] < 6) return;
    const red = this.walkers.filter(w => w.team === TEAM_RED);
    if (!red.length) return;
    const w = red[Math.floor(Math.random() * red.length)];
    const cvx = Math.round(w.x), cvz = Math.round(w.z);

    if (Math.random() < 0.6) {
      // Try to flatten home area: find the vertex around the walker whose
      // height differs most from the walker's stand height and bring it in.
      let target = null, bestDiff = 0;
      const standH = Math.round(this.terrain.heightAtWorld(w.x, w.z) / STEP);
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          const vx = cvx + dx, vz = cvz + dz;
          if (!this.terrain.vInside(vx, vz)) continue;
          const h = this.terrain.getV(vx, vz);
          const diff = h - standH;
          if (Math.abs(diff) > Math.abs(bestDiff)) {
            bestDiff = diff;
            target = { x: vx, z: vz };
          }
        }
      }
      if (target) {
        if (bestDiff > 0) this.terrain.lower(target.x, target.z);
        else              this.terrain.raise(target.x, target.z);
        this.mana[TEAM_RED] -= 4;
      }
    } else {
      // Raise a vertex between the AI walker and the nearest enemy — this
      // tends to wall off or interrupt a blue settlement.
      let nearest = null, best = Infinity;
      for (const b of this.walkers) {
        if (b.team !== TEAM_BLUE) continue;
        const d = (b.x - w.x) ** 2 + (b.z - w.z) ** 2;
        if (d < best) { best = d; nearest = b; }
      }
      if (nearest) {
        const tx = Math.round((w.x + nearest.x) / 2);
        const tz = Math.round((w.z + nearest.z) / 2);
        this.terrain.raise(tx, tz);
        this.mana[TEAM_RED] -= 5;
      }
    }
  }

  destroy() {
    for (const w of this.walkers) w.dispose();
    for (const h of this.houses)  h.dispose();
    scene.remove(this.terrain.mesh);
    this.terrain.geo.dispose();
    this.terrain.mat.dispose();
  }
}

// =====================================================================
// Walker
// =====================================================================
const sharedWalkerGeo = new THREE.CapsuleGeometry(0.18, 0.35, 4, 6);
const matWalkerBlue = new THREE.MeshLambertMaterial({ color: 0x4ab0ff });
const matWalkerRed  = new THREE.MeshLambertMaterial({ color: 0xff5050 });

class Walker {
  constructor(x, z, team, terrain) {
    this.x = x;
    this.z = z;
    this.team = team;
    this.terrain = terrain;
    this.hp = 100;
    this.dead = false;
    this.target = null;
    this.speed = 1.6 + Math.random() * 0.4;
    this.thinkCooldown = 0;
    this.mesh = new THREE.Mesh(sharedWalkerGeo, team === TEAM_BLUE ? matWalkerBlue : matWalkerRed);
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    this.syncMesh();
  }

  syncMesh() {
    const y = this.terrain.heightAtWorld(this.x, this.z) + 0.32;
    this.mesh.position.set(this.x, y, this.z);
  }

  pickTarget(game) {
    const cx = Math.floor(this.x), cz = Math.floor(this.z);

    if (game.terrain.isFlatArea(cx, cz, 2) && !this.houseAt(cx, cz, game)) {
      const owner = game.terrain.getOwner(cx, cz);
      if (owner === 0 || owner === this.team) {
        this.target = { kind: 'build', cx, cz };
        return;
      }
    }

    let best = null, bestD = Infinity;
    for (let r = 1; r < 10; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx, z = cz + dz;
          if (!game.terrain.isFlatArea(x, z, 2)) continue;
          const own = game.terrain.getOwner(x, z);
          if (own !== 0 && own !== this.team) continue;
          if (this.houseAt(x, z, game)) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) { bestD = d; best = { x, z }; }
        }
      }
      if (best) break;
    }
    if (best) {
      this.target = { kind: 'move', x: best.x + 1, z: best.z + 1 };
      return;
    }

    let nearestEnemy = null, ed = Infinity;
    for (const w of game.walkers) {
      if (w.team === this.team || w.dead) continue;
      const dd = (w.x - this.x) ** 2 + (w.z - this.z) ** 2;
      if (dd < ed) { ed = dd; nearestEnemy = w; }
    }
    if (nearestEnemy && ed < 200) {
      this.target = { kind: 'attack', walker: nearestEnemy };
      return;
    }

    const ang  = Math.random() * Math.PI * 2;
    const dist = 2 + Math.random() * 3;
    this.target = {
      kind: 'wander',
      x: this.x + Math.cos(ang) * dist,
      z: this.z + Math.sin(ang) * dist,
    };
  }

  houseAt(x, z, game) {
    return game.houses.some(h =>
      h.x <= x && x < h.x + 2 && h.z <= z && z < h.z + 2
    );
  }

  update(dt, game) {
    this.thinkCooldown -= dt;
    if (!this.target || this.thinkCooldown <= 0) {
      this.pickTarget(game);
      this.thinkCooldown = 1.2 + Math.random();
    }
    const t = this.target;
    let tx, tz;
    if (t.kind === 'attack') {
      if (t.walker.dead) { this.target = null; return; }
      tx = t.walker.x; tz = t.walker.z;
    } else if (t.kind === 'build') {
      tx = t.cx + 1; tz = t.cz + 1;
    } else {
      tx = t.x; tz = t.z;
    }

    const dx = tx - this.x;
    const dz = tz - this.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.1) {
      this.arrive(game);
      return;
    }

    const stepX = (dx / dist) * this.speed * dt;
    const stepZ = (dz / dist) * this.speed * dt;
    const nx = this.x + stepX;
    const nz = this.z + stepZ;
    // A cell is traversable when it isn't underwater and isn't too steep.
    // With vertex-shaped terrain, "too steep" = max(corners) - min > 1.
    const ncx = Math.floor(nx), ncz = Math.floor(nz);
    if (!game.terrain.cellWalkable(ncx, ncz)) {
      this.target = null;
      this.thinkCooldown = 0.4;
      return;
    }
    this.x = nx;
    this.z = nz;
    this.mesh.rotation.y = Math.atan2(dx, dz);
    this.syncMesh();
  }

  arrive(game) {
    const t = this.target;
    if (t.kind === 'build') {
      const { cx, cz } = t;
      if (game.terrain.isFlatArea(cx, cz, 2) && !this.houseAt(cx, cz, game)) {
        const own = game.terrain.getOwner(cx, cz);
        if (own === 0 || own === this.team) {
          game.placeHouse(cx, cz, this.team);
        }
      }
    }
    this.target = null;
  }

  dispose() {
    scene.remove(this.mesh);
  }
}

// =====================================================================
// House
//
// Footprint = 2x2 cells starting at (x, z), which is 3x3 vertices that
// all need to share the same height. Any change to those 9 vertices
// collapses the settlement — that's the Populous mechanic.
// =====================================================================
class House {
  constructor(x, z, team, terrainH) {
    this.x = x;
    this.z = z;
    this.team = team;
    this.hp = 200;
    this.dead = false;
    this.spawnTimer = 4 + Math.random() * 3;
    this.terrainH = terrainH;

    const group = new THREE.Group();
    const wallCol = team === TEAM_BLUE ? 0xa8c8e8 : 0xe8b0a8;
    const roofCol = team === TEAM_BLUE ? 0x224488 : 0x882222;
    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.7, 1.6),
      new THREE.MeshLambertMaterial({ color: wallCol })
    );
    walls.position.y = 0.35;
    walls.castShadow = true;
    group.add(walls);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(1.25, 0.7, 4),
      new THREE.MeshLambertMaterial({ color: roofCol, flatShading: true })
    );
    roof.position.y = 0.7 + 0.35;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);

    group.position.set(x + 1, terrainH * STEP, z + 1);
    scene.add(group);
    this.mesh = group;
  }

  // Verify that every one of the 9 footprint vertices still sits at the
  // height the house was built on. As soon as the player or AI tweaks any
  // of them, the building tears itself down.
  footprintOk(terrain) {
    for (let dz = 0; dz <= 2; dz++) {
      for (let dx = 0; dx <= 2; dx++) {
        if (terrain.getV(this.x + dx, this.z + dz) !== this.terrainH) return false;
      }
    }
    return true;
  }

  update(dt, game) {
    if (!this.footprintOk(game.terrain)) {
      this.dead = true;
      return;
    }
    this.spawnTimer -= dt;
    const pop = game.popOf(this.team);
    const capacity = game.housesOf(this.team) * 5;
    if (this.spawnTimer <= 0 && pop < capacity) {
      game.spawnWalker(this.x + 1, this.z + 1, this.team);
      this.spawnTimer = 3.5 + Math.random() * 2;
    }
  }

  dispose() {
    scene.remove(this.mesh);
    this.mesh.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

// =====================================================================
// Cursor — a wireframe marker that snaps to the targeted vertex so the
// player knows exactly which corner they'll affect.
// =====================================================================
const cursor = new THREE.Mesh(
  new THREE.OctahedronGeometry(0.32, 0),
  new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true })
);
cursor.visible = false;
scene.add(cursor);

// =====================================================================
// Spell ribbon — bottom-center bar of selectable spells. Selecting only
// changes `selectedSpell`; the actual casting happens in the canvas
// click handler below.
// =====================================================================
function buildSpellRibbon() {
  const ribbon = document.getElementById('spell-ribbon');
  for (const s of SPELLS) {
    const btn = document.createElement('button');
    btn.className = 'spell';
    btn.dataset.spell = s.id;
    btn.title = `${s.name} — ${s.cost} mana`;
    btn.innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${s.svg}</svg>` +
      `<span class="name">${s.name}</span>` +
      `<span class="cost">${s.cost}</span>`;
    btn.addEventListener('click', () => {
      selectedSpell = s.id;
      refreshSpellRibbon();
    });
    ribbon.appendChild(btn);
  }
  refreshSpellRibbon();
}

function refreshSpellRibbon() {
  const mana = game ? game.mana[TEAM_BLUE] : 0;
  for (const s of SPELLS) {
    const btn = document.querySelector(`.spell[data-spell="${s.id}"]`);
    if (!btn) continue;
    btn.classList.toggle('selected', s.id === selectedSpell);
    btn.classList.toggle('disabled', mana < s.cost);
  }
}

// =====================================================================
// Input — pick the nearest vertex to the mouse and operate on it.
// =====================================================================
const raycaster = new THREE.Raycaster();
const mouseNDC  = new THREE.Vector2();

function pickVertex(ev) {
  mouseNDC.x =  (ev.clientX / innerWidth)  * 2 - 1;
  mouseNDC.y = -(ev.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, camera);
  const hit = raycaster.intersectObject(game.terrain.mesh, false)[0];
  if (!hit) return null;
  const vx = Math.round(hit.point.x);
  const vz = Math.round(hit.point.z);
  if (vx < 0 || vz < 0 || vx > GRID || vz > GRID) return null;
  return { x: vx, z: vz };
}

renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

// Distinguish click from drag: if the mouse barely moved between press and
// release, treat it as a click and shape terrain. Anything bigger is left
// to OrbitControls (right-drag pans, middle-drag rotates).
const CLICK_PIXELS = 4;
const press = { 0: null, 2: null };  // by button index

renderer.domElement.addEventListener('mousedown', ev => {
  if (ev.button === 0 || ev.button === 2) {
    press[ev.button] = { x: ev.clientX, y: ev.clientY, moved: 0 };
  }
});

renderer.domElement.addEventListener('mousemove', ev => {
  // Update hover cursor
  const v = pickVertex(ev);
  if (v) {
    cursor.position.set(v.x, game.terrain.getV(v.x, v.z) * STEP, v.z);
    cursor.visible = true;
  } else {
    cursor.visible = false;
  }
  // Track motion since press to know if the gesture has become a drag.
  for (const b of [0, 2]) {
    const p = press[b];
    if (!p) continue;
    p.moved = Math.max(p.moved, Math.hypot(ev.clientX - p.x, ev.clientY - p.y));
  }
});

renderer.domElement.addEventListener('mouseleave', () => { cursor.visible = false; });

renderer.domElement.addEventListener('mouseup', ev => {
  const p = press[ev.button];
  press[ev.button] = null;
  if (!p || p.moved >= CLICK_PIXELS) return;   // it was a drag, not a click
  if (game.gameOver) return;
  if (ev.button !== 0 && ev.button !== 2) return;
  const v = pickVertex(ev);
  if (!v) return;

  const spell = SPELLS_BY_ID[selectedSpell];
  if (!spell) return;

  if (spell.id === 'sculpt') {
    if (game.mana[TEAM_BLUE] < spell.cost) {
      flashMessage('Not enough mana');
      return;
    }
    game.mana[TEAM_BLUE] -= spell.cost;
    if (ev.button === 0) game.terrain.raise(v.x, v.z);
    else                 game.terrain.lower(v.x, v.z);
    cursor.position.y = game.terrain.getV(v.x, v.z) * STEP;
    return;
  }

  // Non-sculpt spells: only the left button casts; right is reserved for
  // panning. Effects aren't implemented yet — flash the name and bail
  // without spending mana so the player isn't penalised for the stub.
  if (ev.button !== 0) return;
  if (game.mana[TEAM_BLUE] < spell.cost) {
    flashMessage('Not enough mana');
    return;
  }

  if (spell.id === 'flood') {
    game.mana[TEAM_BLUE] -= spell.cost;
    game.castFlood();
    flashMessage('Flood!');
    cursor.visible = false;
    return;
  }

  flashMessage(`${spell.name} — coming soon`);
});

window.addEventListener('keydown', ev => {
  if (ev.key === 'r' || ev.key === 'R') restart();
  const slot = '1234'.indexOf(ev.key);
  if (slot >= 0 && slot < BIOME_NAMES.length) restart(BIOME_NAMES[slot]);
});

function flashMessage(text) {
  const el = document.getElementById('message');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(flashMessage._t);
  flashMessage._t = setTimeout(() => el.classList.remove('show'), 900);
}

// =====================================================================
// Loop
// =====================================================================
applyBiome(currentBiome);
let game = new Game();
buildSpellRibbon();

function restart(biomeName) {
  if (game) game.destroy();
  document.getElementById('message').classList.remove('show');
  applyBiome(
    biomeName || BIOME_NAMES[Math.floor(Math.random() * BIOME_NAMES.length)],
  );
  game = new Game();
}

const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(0.1, clock.getDelta());
  game.update(dt);
  // Keep the pan target reasonably close to the island so the player can't
  // accidentally fly off into empty ocean.
  controls.target.x = Math.max(0, Math.min(GRID, controls.target.x));
  controls.target.z = Math.max(0, Math.min(GRID, controls.target.z));
  controls.update();
  updateHUD();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

function updateHUD() {
  document.getElementById('blue-pop').textContent  = game.popOf(TEAM_BLUE);
  document.getElementById('red-pop').textContent   = game.popOf(TEAM_RED);
  document.getElementById('blue-mana').textContent = Math.floor(game.mana[TEAM_BLUE]);
  document.getElementById('biome').textContent     = BIOMES[currentBiome].label;
  refreshSpellRibbon();
}

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
