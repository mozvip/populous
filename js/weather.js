import * as THREE from 'three';
import { GRID } from './constants.js';
import { scene } from './scene.js';

// =====================================================================
// Weather — per-biome ambient particles. One THREE.Points system whose
// buffer and material are rebuilt every time the biome changes.
// =====================================================================
const AREA = GRID * 1.4;             // particle box extends past the island
const CX   = GRID / 2;
const CZ   = GRID / 2;
const TOP  = 28;                     // ceiling for falling particles
const FLOOR = 0;                     // ground level for rising embers

// Each preset describes how to seed and animate one particle. `vy` is
// positive for rising effects (embers) and negative for falling ones.
const PRESETS = {
  grassy: {                          // rain
    count: 1200,
    color: 0xaecbe6,
    size:  0.10,
    opacity: 0.55,
    vy:   -22,
    vyJitter: 4,
    vxz:  0.4,
    sway: 0,
    spawnTop: true,
  },
  desert: {                          // wind-blown sand
    count: 700,
    color: 0xe6c98a,
    size:  0.18,
    opacity: 0.45,
    vy:   -1.2,
    vyJitter: 0.4,
    vxz:  3.5,
    sway: 0.8,
    spawnTop: true,
  },
  snow: {                            // snowflakes
    count: 900,
    color: 0xffffff,
    size:  0.22,
    opacity: 0.85,
    vy:   -1.4,
    vyJitter: 0.4,
    vxz:  0.6,
    sway: 1.6,
    spawnTop: true,
  },
  lava: {                            // rising embers
    count: 600,
    color: 0xff7a28,
    size:  0.20,
    opacity: 0.9,
    vy:    4.5,
    vyJitter: 1.5,
    vxz:  0.5,
    sway: 0.6,
    spawnTop: false,
  },
};

let points = null;
let preset = null;
let velocities = null;               // Float32Array, 3 per particle
let phases = null;                   // Float32Array, used for sway

function seedParticle(i, fromAnywhere) {
  const pos = points.geometry.attributes.position.array;
  const p = preset;
  pos[i * 3 + 0] = CX + (Math.random() - 0.5) * AREA;
  pos[i * 3 + 2] = CZ + (Math.random() - 0.5) * AREA;
  if (fromAnywhere) {
    pos[i * 3 + 1] = FLOOR + Math.random() * (TOP - FLOOR);
  } else {
    pos[i * 3 + 1] = p.spawnTop ? TOP : FLOOR;
  }
  velocities[i * 3 + 0] = (Math.random() - 0.5) * p.vxz;
  velocities[i * 3 + 1] = p.vy + (Math.random() - 0.5) * p.vyJitter;
  velocities[i * 3 + 2] = (Math.random() - 0.5) * p.vxz;
  phases[i] = Math.random() * Math.PI * 2;
}

export function setWeather(biomeName) {
  const p = PRESETS[biomeName];
  if (points) {
    scene.remove(points);
    points.geometry.dispose();
    points.material.dispose();
    points = null;
  }
  if (!p) return;
  preset = p;

  const positions = new Float32Array(p.count * 3);
  velocities = new Float32Array(p.count * 3);
  phases = new Float32Array(p.count);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: p.color,
    size: p.size,
    transparent: true,
    opacity: p.opacity,
    depthWrite: false,
    sizeAttenuation: true,
  });
  points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  for (let i = 0; i < p.count; i++) seedParticle(i, true);
  geo.attributes.position.needsUpdate = true;
}

export function updateWeather(dt) {
  if (!points || !preset) return;
  const pos = points.geometry.attributes.position.array;
  const p = preset;
  const count = p.count;
  const swayAmp = p.sway;

  for (let i = 0; i < count; i++) {
    const ix = i * 3;
    const iy = ix + 1;
    const iz = ix + 2;

    let extraX = 0;
    let extraZ = 0;
    if (swayAmp > 0) {
      phases[i] += dt * 1.5;
      extraX = Math.sin(phases[i]) * swayAmp * dt;
      extraZ = Math.cos(phases[i] * 0.7) * swayAmp * dt;
    }

    pos[ix] += velocities[ix] * dt + extraX;
    pos[iy] += velocities[iy] * dt;
    pos[iz] += velocities[iz] * dt + extraZ;

    const out =
      pos[iy] < FLOOR - 1 ||
      pos[iy] > TOP + 2 ||
      pos[ix] < CX - AREA ||
      pos[ix] > CX + AREA ||
      pos[iz] < CZ - AREA ||
      pos[iz] > CZ + AREA;
    if (out) seedParticle(i, false);
  }
  points.geometry.attributes.position.needsUpdate = true;
}
