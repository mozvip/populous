import * as THREE from 'three';

// =====================================================================
// Constants
// =====================================================================
export const GRID  = 48;           // cells per side
export const VW    = GRID + 1;     // vertex grid is one larger than cell grid
export const STEP  = 0.5;          // world units per integer height level
export const MAX_H = 8;

export const TEAM_BLUE = 1;
export const TEAM_RED  = 2;

export const TINT_BLUE = new THREE.Color(0x6aa8e8);
export const TINT_RED  = new THREE.Color(0xe06868);

export const NEI4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
export const NEI8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
