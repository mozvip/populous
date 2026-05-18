import * as THREE from 'three';
import { GRID } from './js/constants.js';
import { BIOME_NAMES, biomeState } from './js/biomes.js';
import { scene, camera, renderer, controls, applyBiome } from './js/scene.js';
import { Game, gameRef } from './js/entities.js';
import { buildSpellRibbon, updateHUD, initInput } from './js/ui.js';
import { updateWeather } from './js/weather.js';

// =====================================================================
// Boot
// =====================================================================
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
