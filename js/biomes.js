import * as THREE from 'three';

// =====================================================================
// Biomes — the four original Populous worlds. Each biome owns its own
// terrain palette (low → high), water color, sky/fog, and light tints.
// =====================================================================
export const BIOMES = {
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
export const BIOME_NAMES = Object.keys(BIOMES);

// Mutable container so other modules can observe the active biome without
// holding a stale value at import time.
export const biomeState = {
  current: BIOME_NAMES[Math.floor(Math.random() * BIOME_NAMES.length)],
};

export function pickTerrainColor(h) {
  const t = BIOMES[biomeState.current].terrain;
  if (h <= 0)   return t.water;
  if (h <= 1.2) return t.sand;
  if (h <= 3)   return t.low;
  if (h <= 5)   return t.mid;
  if (h <= 7)   return t.high;
  return t.peak;
}
