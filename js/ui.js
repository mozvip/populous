import * as THREE from 'three';
import { GRID, STEP, TEAM_BLUE, TEAM_RED } from './constants.js';
import { BIOMES, BIOME_NAMES, biomeState } from './biomes.js';
import { scene, camera, renderer } from './scene.js';
import { gameRef } from './entities.js';
import { castFlood, castVolcano, castArmageddon } from './powers.js';

// =====================================================================
// Spells — the seven "acts of God" from the 1989 game. Sculpt is the
// existing raise/lower behaviour; the others are placeholders until the
// effects are wired up. Each entry carries its mana cost and an inline
// SVG icon used by the ribbon.
// =====================================================================
export const SPELLS = [
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
export const spellState = { selected: 'sculpt' };

// =====================================================================
// Spell ribbon — bottom-center bar of selectable spells. Selecting only
// changes `spellState.selected`; the actual casting happens in the canvas
// click handler below.
// =====================================================================
export function buildSpellRibbon() {
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
      spellState.selected = s.id;
      refreshSpellRibbon();
    });
    ribbon.appendChild(btn);
  }
  refreshSpellRibbon();
}

export function refreshSpellRibbon() {
  const mana = gameRef.current ? gameRef.current.mana[TEAM_BLUE] : 0;
  for (const s of SPELLS) {
    const btn = document.querySelector(`.spell[data-spell="${s.id}"]`);
    if (!btn) continue;
    btn.classList.toggle('selected', s.id === spellState.selected);
    btn.classList.toggle('disabled', mana < s.cost);
  }
}

// =====================================================================
// HUD
// =====================================================================
export function updateHUD() {
  const game = gameRef.current;
  if (!game) return;
  document.getElementById('blue-pop').textContent  = game.popOf(TEAM_BLUE);
  document.getElementById('red-pop').textContent   = game.popOf(TEAM_RED);
  document.getElementById('blue-mana').textContent = Math.floor(game.mana[TEAM_BLUE]);
  document.getElementById('biome').textContent     = BIOMES[biomeState.current].label;
  refreshSpellRibbon();
}

export function flashMessage(text) {
  const el = document.getElementById('message');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(flashMessage._t);
  flashMessage._t = setTimeout(() => el.classList.remove('show'), 900);
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
// Input — pick the nearest vertex to the mouse and operate on it.
// =====================================================================
const raycaster = new THREE.Raycaster();
const mouseNDC  = new THREE.Vector2();

function pickVertex(ev) {
  mouseNDC.x =  (ev.clientX / innerWidth)  * 2 - 1;
  mouseNDC.y = -(ev.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, camera);
  const hit = raycaster.intersectObject(gameRef.current.terrain.mesh, false)[0];
  if (!hit) return null;
  const vx = Math.round(hit.point.x);
  const vz = Math.round(hit.point.z);
  if (vx < 0 || vz < 0 || vx > GRID || vz > GRID) return null;
  return { x: vx, z: vz };
}

export function initInput({ onRestart }) {
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
    const game = gameRef.current;
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
    const game = gameRef.current;
    if (game.gameOver) return;
    if (ev.button !== 0 && ev.button !== 2) return;
    const v = pickVertex(ev);
    if (!v) return;

    const spell = SPELLS_BY_ID[spellState.selected];
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
      castFlood(game);
      flashMessage('Flood!');
      cursor.visible = false;
      return;
    }

    if (spell.id === 'volcano') {
      game.mana[TEAM_BLUE] -= spell.cost;
      castVolcano(game, v.x, v.z);
      flashMessage('Volcano!');
      cursor.visible = false;
      return;
    }

    if (spell.id === 'armageddon') {
      game.mana[TEAM_BLUE] -= spell.cost;
      castArmageddon(game);
      flashMessage('Armageddon!');
      cursor.visible = false;
      return;
    }

    flashMessage(`${spell.name} — coming soon`);
  });

  window.addEventListener('keydown', ev => {
    if (ev.key === 'r' || ev.key === 'R') onRestart();
    const slot = '1234'.indexOf(ev.key);
    if (slot >= 0 && slot < BIOME_NAMES.length) onRestart(BIOME_NAMES[slot]);
  });
}
