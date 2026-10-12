import * as THREE from 'three';
import { GRID } from './js/constants.js';
import { BIOME_NAMES, biomeState } from './js/biomes.js';
import { scene, camera, renderer, controls, applyBiome } from './js/scene.js';
import { Game, gameRef } from './js/entities.js';
import { buildSpellRibbon, updateHUD, initInput } from './js/ui.js';
import { updateWeather } from './js/weather.js';
import { updateWater } from './js/water.js';
import { loadBuildings } from './js/buildings.js';
import { loadVillager } from './js/villager.js';

// =====================================================================
// Boot
// =====================================================================
// Keep the game playable with placeholder models if a GLB can't load.
await Promise.all([
  loadBuildings().catch(err =>
    console.error('Failed to load building models, using placeholders:', err)),
  loadVillager().catch(err =>
    console.error('Failed to load villager model, using placeholders:', err)),
]);
applyBiome(biomeState.current);
gameRef.current = new Game();
buildSpellRibbon();
initInput({ onRestart: restart });

function restart(biomeName) {
  if (gameRef.current) gameRef.current.destroy();
  document.getElementById('message').classList.remove('show');
  applyBiome(
    biomeName || BIOME_NAMES[Math.floor(Math.random() * BIOME_NAMES.length)],
  );
  gameRef.current = new Game();
}

// =====================================================================
// Loop
// =====================================================================
const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(0.1, clock.getDelta());
  gameRef.current.update(dt);
  updateWeather(dt);
  updateWater(dt);
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
