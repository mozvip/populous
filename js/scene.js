import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GRID } from './constants.js';
import { BIOMES, biomeState } from './biomes.js';
import { setWeather } from './weather.js';

// =====================================================================
// Scene
// =====================================================================
const initialBiome = BIOMES[biomeState.current];

export const scene = new THREE.Scene();
scene.background = new THREE.Color(initialBiome.sky);
scene.fog = new THREE.Fog(initialBiome.sky, 60, 140);

export const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 500);
camera.position.set(GRID * 0.5, 32, GRID * 1.0);

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

export const controls = new OrbitControls(camera, renderer.domElement);
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

export const sun = new THREE.DirectionalLight(initialBiome.sun, 1.1);
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

export const hemi = new THREE.HemisphereLight(
  initialBiome.hemiSky,
  initialBiome.hemiGround,
  0.55,
);
scene.add(hemi);

export const water = new THREE.Mesh(
  new THREE.PlaneGeometry(GRID * 6, GRID * 6),
  new THREE.MeshLambertMaterial({
    color: initialBiome.water,
    transparent: true,
    opacity: 0.85,
  }),
);
water.rotation.x = -Math.PI / 2;
water.position.set(GRID / 2, 0.15, GRID / 2);
water.receiveShadow = true;
scene.add(water);

export function applyBiome(name) {
  if (!BIOMES[name]) return;
  biomeState.current = name;
  const b = BIOMES[name];
  scene.background.set(b.sky);
  scene.fog.color.set(b.sky);
  sun.color.set(b.sun);
  hemi.color.set(b.hemiSky);
  hemi.groundColor.set(b.hemiGround);
  water.material.color.set(b.water);
  setWeather(name);
}

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
