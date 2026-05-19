import { MAX_H, STEP } from './constants.js';

// Armageddon: wipe every house and flip the game into "rally to the centre"
// mode. Walkers themselves change behaviour via the `armageddon` flag read in
// Walker.pickTarget — see entities.js. Once cast, the only thing left to
// settle is which team's followers survive the brawl.
export function castArmageddon(game) {
  game.armageddon = true;
  for (const h of game.houses) h.dead = true;
}

// Global flood: lower the whole heightmap by one step, sink any house
// whose footprint now sits at or below sea level, and drown walkers
// caught in newly-submerged cells. Surviving houses drop with the land.
export function castFlood(game) {
  game.terrain.flood();
  for (const h of game.houses) {
    h.terrainH -= 1;
    if (h.terrainH < 1) {
      h.dead = true;
    } else {
      h.mesh.position.y = h.terrainH * STEP;
    }
  }
  for (const w of game.walkers) {
    const cx = Math.floor(w.x), cz = Math.floor(w.z);
    if (!game.terrain.cInside(cx, cz) || game.terrain.cellMin(cx, cz) < 1) {
      w.dead = true;
    }
  }
}

// Targeted volcano: stamp a MAX_H cone at the picked vertex, falling off
// one step per ring (Chebyshev) so the heightmap's 1-step neighbour rule
// is preserved without further smoothing. Walkers and houses caught in
// the lava zone are killed; raised footprints would tear houses down on
// their next update anyway, but we destroy them now for immediate feedback.
export function castVolcano(game, vx, vz) {
  const terrain = game.terrain;
  for (let dz = -MAX_H; dz <= MAX_H; dz++) {
    for (let dx = -MAX_H; dx <= MAX_H; dx++) {
      const x = vx + dx, z = vz + dz;
      if (!terrain.vInside(x, z)) continue;
      const cheb = Math.max(Math.abs(dx), Math.abs(dz));
      const coneH = MAX_H - cheb;
      if (coneH <= 0) continue;
      if (terrain.getV(x, z) < coneH) terrain.setV(x, z, coneH);
    }
  }
  terrain.rebuild();

  const KILL = 3;
  for (const w of game.walkers) {
    if (Math.max(Math.abs(w.x - vx), Math.abs(w.z - vz)) <= KILL) {
      w.dead = true;
    }
  }
  for (const h of game.houses) {
    const hx = h.x + 1, hz = h.z + 1;
    if (Math.max(Math.abs(hx - vx), Math.abs(hz - vz)) <= KILL) {
      h.dead = true;
    }
  }
}
