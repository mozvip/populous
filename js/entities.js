import * as THREE from 'three';
import { GRID, STEP, TEAM_BLUE, TEAM_RED } from './constants.js';
import { scene } from './scene.js';
import { Terrain } from './terrain.js';

// =====================================================================
// Walker
// =====================================================================
const sharedWalkerGeo = new THREE.CapsuleGeometry(0.18, 0.35, 4, 6);
const matWalkerBlue = new THREE.MeshLambertMaterial({ color: 0x4ab0ff });
const matWalkerRed  = new THREE.MeshLambertMaterial({ color: 0xff5050 });

export class Walker {
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
      this.target = { kind: 'build', cx: best.x, cz: best.z };
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
export class House {
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
// Game
// =====================================================================
// Mutable holder so other modules (input, hud, spells) can reach the
// current Game instance through a stable import — `current` is swapped
// out on restart without forcing those modules to re-bind.
export const gameRef = { current: null };

export class Game {
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
