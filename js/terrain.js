import * as THREE from 'three';
import {
  GRID, VW, STEP, MAX_H,
  TEAM_BLUE, TEAM_RED, TINT_BLUE, TINT_RED,
  NEI8,
} from './constants.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BIOMES, biomeState, pickTerrainColor } from './biomes.js';
import { scene } from './scene.js';
import { updateShoreField } from './water.js';

// =====================================================================
// Terrain (vertex-based heightmap)
//
// `h[v]` stores the integer height of vertex v in a (GRID+1) x (GRID+1)
// grid. Cells are the GRID x GRID quads between vertices; each cell has
// four corner heights that may all differ, producing sloped triangles.
// `owner[c]` is per-cell ownership for the territory tint.
// =====================================================================
// Rocks are decorative-but-blocking obstacles that sit on cells. Once a
// rock exists, building on that cell is impossible; lowering the terrain
// under it until the cell goes underwater removes the rock. Shared
// geometry/material keep the per-rock cost minimal.
const sharedRockGeo = new THREE.DodecahedronGeometry(0.42, 0);
const sharedRockMat = new THREE.MeshLambertMaterial({
  color: 0x6b6b70,
  flatShading: true,
});

// Trees work like rocks — they block building and settlement growth on
// their cell, ride the terrain when it is reshaped and drown when the cell
// goes underwater — but walkers can pass through them. Each tree is a
// single merged trunk + two-tier canopy geometry with vertex colors, built
// once per biome so a forest costs one draw call per tree.
const treeGeoCache = new Map();
const sharedTreeMat = new THREE.MeshLambertMaterial({
  vertexColors: true,
  flatShading: true,
});
function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
function treeGeometry() {
  const name = biomeState.current;
  if (treeGeoCache.has(name)) return treeGeoCache.get(name);
  const { trunk, foliage } = BIOMES[name].tree;
  const parts = [
    paint(new THREE.CylinderGeometry(0.05, 0.08, 0.4, 5).translate(0, 0.2, 0), trunk),
    paint(new THREE.ConeGeometry(0.34, 0.6, 6).translate(0, 0.55, 0), foliage),
    paint(new THREE.ConeGeometry(0.25, 0.5, 6).translate(0, 0.85, 0), foliage),
  ];
  // Cones/cylinders carry uv while some builds differ; strip to the
  // attributes mergeGeometries needs to match.
  for (const g of parts) g.deleteAttribute('uv');
  const geo = mergeGeometries(parts.map(g => g.toNonIndexed()));
  for (const g of parts) g.dispose();
  treeGeoCache.set(name, geo);
  return geo;
}

export class Terrain {
  constructor() {
    this.h = new Int8Array(VW * VW);
    this.owner = new Int8Array(GRID * GRID);
    this.rocks = new Set();
    this.rockMeshes = new Map();
    this.rockGroup = new THREE.Group();
    scene.add(this.rockGroup);
    this.trees = new Set();
    this.treeMeshes = new Map();
    this.treeGroup = new THREE.Group();
    scene.add(this.treeGroup);
    this.geo = new THREE.BufferGeometry();
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    this.generate();
    this.rebuild();
    this.generateRocks();
    this.generateTrees();
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
  // is perfectly flat at the same height — needed for building. Cells
  // carrying a rock or tree disqualify the footprint regardless of height.
  isFlatArea(cx, cz, size = 2) {
    if (cx < 0 || cz < 0 || cx + size > GRID || cz + size > GRID) return false;
    const h0 = this.getV(cx, cz);
    if (h0 < 1) return false;
    for (let dz = 0; dz <= size; dz++) {
      for (let dx = 0; dx <= size; dx++) {
        if (this.getV(cx + dx, cz + dz) !== h0) return false;
      }
    }
    for (let dz = 0; dz < size; dz++) {
      for (let dx = 0; dx < size; dx++) {
        if (this.isBlocked(cx + dx, cz + dz)) return false;
      }
    }
    return true;
  }

  // --- rocks ---
  rockKey(cx, cz) { return cz * GRID + cx; }
  hasRock(cx, cz) {
    if (!this.cInside(cx, cz)) return false;
    return this.rocks.has(this.rockKey(cx, cz));
  }
  addRock(cx, cz) {
    if (!this.cInside(cx, cz)) return;
    const k = this.rockKey(cx, cz);
    if (this.rocks.has(k)) return;
    this.removeTree(k);
    this.rocks.add(k);
    const m = new THREE.Mesh(sharedRockGeo, sharedRockMat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.rotation.set(
      Math.random() * 0.5,
      Math.random() * Math.PI * 2,
      Math.random() * 0.5,
    );
    const s = 0.65 + Math.random() * 0.45;
    m.scale.set(s, 0.55 + Math.random() * 0.4, s);
    this.rockMeshes.set(k, m);
    this.rockGroup.add(m);
    this.positionRock(k);
  }
  removeRock(k) {
    const m = this.rockMeshes.get(k);
    if (!m) return;
    this.rockGroup.remove(m);
    this.rockMeshes.delete(k);
    this.rocks.delete(k);
  }
  positionRock(k) {
    const m = this.rockMeshes.get(k);
    if (!m) return;
    const cx = k % GRID;
    const cz = Math.floor(k / GRID);
    const minH = this.cellMin(cx, cz);
    if (minH < 1) {
      this.removeRock(k);
      return;
    }
    m.position.set(cx + 0.5, minH * STEP, cz + 0.5);
  }
  updateRockPositions() {
    for (const k of [...this.rocks]) this.positionRock(k);
  }
  generateRocks() {
    const ROCK_DENSITY = 0.012;
    for (let cz = 0; cz < GRID; cz++) {
      for (let cx = 0; cx < GRID; cx++) {
        if (!this.cellWalkable(cx, cz)) continue;
        if (Math.random() < ROCK_DENSITY) this.addRock(cx, cz);
      }
    }
  }
  disposeRocks() {
    scene.remove(this.rockGroup);
    this.rockGroup.clear();
    this.rocks.clear();
    this.rockMeshes.clear();
  }

  // --- trees ---
  hasTree(cx, cz) {
    if (!this.cInside(cx, cz)) return false;
    return this.trees.has(this.rockKey(cx, cz));
  }
  // A cell that can't host a building or count towards settlement growth.
  isBlocked(cx, cz) { return this.hasRock(cx, cz) || this.hasTree(cx, cz); }
  addTree(cx, cz) {
    if (!this.cInside(cx, cz) || this.hasRock(cx, cz)) return;
    const k = this.rockKey(cx, cz);
    if (this.trees.has(k)) return;
    this.trees.add(k);
    const m = new THREE.Mesh(treeGeometry(), sharedTreeMat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.rotation.y = Math.random() * Math.PI * 2;
    const s = 0.75 + Math.random() * 0.5;
    m.scale.set(s, s * (0.85 + Math.random() * 0.3), s);
    // Jitter inside the cell so forests don't read as a grid.
    m.userData.ox = 0.3 + Math.random() * 0.4;
    m.userData.oz = 0.3 + Math.random() * 0.4;
    this.treeMeshes.set(k, m);
    this.treeGroup.add(m);
    this.positionTree(k);
  }
  removeTree(k) {
    const m = this.treeMeshes.get(k);
    if (!m) return;
    this.treeGroup.remove(m);
    this.treeMeshes.delete(k);
    this.trees.delete(k);
  }
  positionTree(k) {
    const m = this.treeMeshes.get(k);
    if (!m) return;
    const cx = k % GRID;
    const cz = Math.floor(k / GRID);
    if (this.cellMin(cx, cz) < 1) {
      this.removeTree(k);
      return;
    }
    const wx = cx + m.userData.ox, wz = cz + m.userData.oz;
    m.position.set(wx, this.heightAtWorld(wx, wz), wz);
  }
  updateTreePositions() {
    for (const k of [...this.trees]) this.positionTree(k);
  }
  // Forests: a low-frequency noise field picks wooded regions, and cells
  // inside them get a tree with a probability that rises towards the
  // forest's heart. Peaks and beaches stay bare.
  generateTrees() {
    const ox = Math.random() * 1000, oz = Math.random() * 1000;
    for (let cz = 0; cz < GRID; cz++) {
      for (let cx = 0; cx < GRID; cx++) {
        if (!this.cellWalkable(cx, cz) || this.hasRock(cx, cz)) continue;
        const mn = this.cellMin(cx, cz);
        if (mn < 2 || mn > 6) continue;
        const f = pseudoNoise(cx * 0.12 + ox, cz * 0.12 + oz);
        const p = f > 0.6 ? 0.12 + (f - 0.6) * 1.2 : 0.008;
        if (Math.random() < p) this.addTree(cx, cz);
      }
    }
  }
  disposeTrees() {
    scene.remove(this.treeGroup);
    this.treeGroup.clear();
    this.trees.clear();
    this.treeMeshes.clear();
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
        let h = (n * 7 + falloff * 4) - 1.5;
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
    // Reshaping the ground uproots trees on every cell touching a moved
    // vertex — that's how the god clears forest for settlers.
    for (const v of seen) {
      const x = v % VW, z = Math.floor(v / VW);
      for (let dz = -1; dz <= 0; dz++)
        for (let dx = -1; dx <= 0; dx++)
          if (this.hasTree(x + dx, z + dz)) this.removeTree(this.rockKey(x + dx, z + dz));
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
        const maxH = Math.max(hNW, hNE, hSW, hSE);
        const base = pickTerrainColor(minH);
        const own = this.getOwner(cx, cz);
        const col = base.clone();
        // Brightness ramp per level so adjacent terraces within the same
        // color tier stay distinguishable, plus a darker band on slopes
        // to outline each step.
        col.multiplyScalar(0.72 + 0.05 * minH);
        if (maxH > minH) col.multiplyScalar(0.82);
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
    this.updateRockPositions();
    this.updateTreePositions();
    updateShoreField(this.h);
  }
}

// --- noise helpers used only during terrain generation ---
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
