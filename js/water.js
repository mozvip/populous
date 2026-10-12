import * as THREE from 'three';
import { GRID, VW } from './constants.js';

// =====================================================================
// Water
//
// A subdivided plane driven by a custom shader: summed sine waves for the
// swell, scrolling noise for small ripples, Fresnel sky reflection, sun
// glints, shallow→deep colour, shoreline foam and caustics. The lava biome
// swaps the look for a slow-flowing molten crust.
//
// "Depth" comes from a shore-distance field: every vertex of a padded copy
// of the terrain grid stores its distance to the nearest land vertex
// (h >= 1). The seabed is flat, so distance from shore is what reads as
// depth to the eye. The field is rebuilt whenever the terrain changes.
// =====================================================================
const PAD  = 24;                 // field padding around the island, in cells
const SIZE = VW + PAD * 2;       // field resolution (one texel per vertex)
const MAXD = 12;                 // distances are clamped to this many units

const field = new Float32Array(SIZE * SIZE);
const fieldData = new Uint8Array(SIZE * SIZE * 4);
const shoreTex = new THREE.DataTexture(fieldData, SIZE, SIZE, THREE.RGBAFormat);
shoreTex.magFilter = THREE.LinearFilter;
shoreTex.minFilter = THREE.LinearFilter;
shoreTex.wrapS = shoreTex.wrapT = THREE.ClampToEdgeWrapping;

const GLSL_COMMON = /* glsl */`
  uniform float uTime;
  uniform float uWaveAmp;
  uniform float uWaveSpeed;
  uniform sampler2D uShore;
  uniform vec2 uShoreXform;   // (PAD + 0.5, 1 / SIZE)

  // .r = distance to nearest land, .g = largest distance nearby (how open
  // the surrounding water is), both in world units.
  vec2 shoreSample(vec2 p) {
    return texture2D(uShore, (p + uShoreXform.x) * uShoreXform.y).rg * ${MAXD.toFixed(1)};
  }
  float shoreDist(vec2 p) { return shoreSample(p).x; }

  // Sum of directional sine waves. Returns height; writes the xz gradient.
  float waves(vec2 p, out vec2 grad) {
    const vec4 D[4] = vec4[4](
      // dir.xy, wavenumber, amplitude
      vec4( 0.96,  0.28, 0.90, 1.00),
      vec4(-0.37,  0.93, 1.35, 0.65),
      vec4( 0.71, -0.71, 2.10, 0.40),
      vec4(-0.98, -0.20, 3.30, 0.22)
    );
    float h = 0.0;
    grad = vec2(0.0);
    for (int i = 0; i < 4; i++) {
      vec2 d = D[i].xy;
      float k = D[i].z;
      float a = D[i].w * uWaveAmp;
      float w = sqrt(9.8 * k) * 0.55 * uWaveSpeed;
      float ph = dot(d, p) * k + w * uTime + float(i) * 1.7;
      h += a * sin(ph);
      grad += a * k * d * cos(ph);
    }
    return h;
  }
`;

const vertexShader = /* glsl */`
  ${GLSL_COMMON}
  varying vec3 vWorld;
  varying float vShore;
  varying float vSwell;
  #include <fog_pars_vertex>

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    float sd = shoreDist(world.xz);
    // Calm the swell near the beach so it laps instead of flooding it.
    float damp = mix(0.3, 1.0, smoothstep(0.8, 5.0, sd));
    vec2 g;
    float h = waves(world.xz, g) * damp;
    world.y += h;
    vWorld = world.xyz;
    vShore = sd;
    vSwell = h / max(uWaveAmp, 1e-4);
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */`
  ${GLSL_COMMON}
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uLava;
  varying vec3 vWorld;
  varying float vShore;
  varying float vSwell;
  #include <fog_pars_fragment>

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  // Value noise with analytic derivatives: (value, d/dx, d/dy).
  vec3 noised(vec2 x) {
    vec2 i = floor(x), f = fract(x);
    vec2 u = f * f * (3.0 - 2.0 * f);
    vec2 du = 6.0 * f * (1.0 - f);
    float a = hash(i), b = hash(i + vec2(1, 0));
    float c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
    float k = a - b - c + d;
    return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y,
                du * (vec2(b - a, c - a) + k * u.yx));
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * noised(p).x; p = p * 2.03 + 7.1; a *= 0.5; }
    return s;
  }
  // Cheap caustic web: bright where two warped sine lattices cross.
  float caustic(vec2 p, float t) {
    vec2 q = p * 1.7 + vec2(fbm(p * 0.6 + t * 0.15), fbm(p * 0.6 - t * 0.12)) * 2.0;
    float c = abs(sin(q.x + t * 0.7) * sin(q.y - t * 0.5));
    return pow(1.0 - c, 6.0);
  }

  void main() {
    vec2 p = vWorld.xz;
    float t = uTime * uWaveSpeed;
    float camDist = length(cameraPosition - vWorld);
    float depthT = smoothstep(0.8, 7.0, vShore);

    if (uLava > 0.5) {
      // Molten flow: a dark crust drifting over glowing seams, hotter near
      // the shore where it churns against the rock.
      vec2 flow = vec2(t * 0.06, t * 0.04);
      vec2 q = p * 0.22 + flow;
      float n = fbm(q + fbm(q * 1.7 - flow) * 0.9);
      float veins = 1.0 - smoothstep(0.0, 0.035, abs(n - 0.5));
      float pools = smoothstep(0.68, 0.8, n);
      float edgeHeat = 1.0 - smoothstep(0.8, 2.2, vShore);
      float pulse = 0.8 + 0.2 * sin(uTime * 1.3 + n * 12.0);
      float heat = clamp(max(max(veins, pools), edgeHeat) * pulse, 0.0, 1.0);
      vec3 crust = uDeep * (0.6 + 0.8 * fbm(p * 1.1 - flow));
      vec3 col = mix(crust, uShallow * 1.5, heat);
      gl_FragColor = vec4(col, 1.0);
    } else {
      vec2 g;
      waves(p, g);
      g *= mix(0.3, 1.0, smoothstep(0.8, 5.0, vShore));
      // Ripples fade with distance so far water doesn't shimmer/alias.
      float detail = 0.35 / (1.0 + camDist * 0.025);
      g += noised(p * 1.6 + vec2( t * 0.30,  t * 0.14)).yz * 1.6 * detail;
      g += noised(p * 3.7 + vec2(-t * 0.22,  t * 0.33)).yz * 3.7 * detail * 0.45;
      g += noised(p * 8.3 + vec2( t * 0.45, -t * 0.25)).yz * 8.3 * detail * 0.15;
      vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
      vec3 V = normalize(cameraPosition - vWorld);
      vec3 L = normalize(uSunDir);

      float NdV = max(dot(N, V), 0.0);
      float fresnel = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);

      vec3 R = reflect(-V, N);
      vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.7, abs(R.y)));

      // Body colour: turquoise shallows into the deep tone, lit softly by
      // the sun, with crests catching a little forward-scattered light.
      vec3 body = mix(uShallow, uDeep, depthT);
      body *= 0.6 + 0.4 * max(dot(N, L), 0.0);
      body += uShallow * 0.25 * clamp(vSwell * 0.5 + 0.2, 0.0, 1.0) * pow(1.0 - NdV, 2.0);
      body += uSunColor * caustic(p, t) * (1.0 - depthT) * 0.18;

      vec3 col = mix(body, sky, fresnel * 0.85);

      vec3 H = normalize(L + V);
      float NdH = max(dot(N, H), 0.0);
      col += uSunColor * (pow(NdH, 600.0) * 4.0 + pow(NdH, 60.0) * 0.12);

      // Shoreline foam: a solid lip at the waterline plus bands that roll
      // in toward the beach, broken up by noise.
      float foamNoise = fbm(p * 2.2 + vec2(t * 0.2, -t * 0.15));
      float lip = 1.0 - smoothstep(0.78, 0.9, vShore);
      float bands = sin(vShore * 5.0 + t * 1.6) * 0.5 + 0.5;
      bands *= smoothstep(1.0, 1.4, vShore) * (1.0 - smoothstep(1.4, 2.8, vShore));
      float foam = max(lip, smoothstep(0.55, 0.9, bands * (foamNoise + 0.35)));
      foam = clamp(foam * smoothstep(0.25, 0.55, foamNoise + lip * 0.3), 0.0, 1.0);
      // Puddles too small for surf stay glassy.
      foam *= smoothstep(1.2, 2.2, shoreSample(p).y);
      col = mix(col, vec3(0.95, 0.97, 1.0) * (0.6 + 0.4 * max(L.y, 0.0)), foam * 0.75);

      float alpha = mix(0.55, 0.94, depthT);
      alpha = max(alpha, max(fresnel, foam * 0.9));
      gl_FragColor = vec4(col, alpha);
    }

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const SEGMENTS = 256;
export const water = new THREE.Mesh(
  new THREE.PlaneGeometry(GRID * 6, GRID * 6, SEGMENTS, SEGMENTS),
  new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime:       { value: 0 },
        uWaveAmp:    { value: 0.06 },
        uWaveSpeed:  { value: 1 },
        uShore:      { value: null },
        uShoreXform: { value: new THREE.Vector2(PAD + 0.5, 1 / SIZE) },
        uDeep:       { value: new THREE.Color() },
        uShallow:    { value: new THREE.Color() },
        uHorizon:    { value: new THREE.Color() },
        uZenith:     { value: new THREE.Color() },
        uSunDir:     { value: new THREE.Vector3(0, 1, 0) },
        uSunColor:   { value: new THREE.Color(1, 1, 1) },
        uLava:       { value: 0 },
      },
    ]),
    vertexShader,
    fragmentShader,
    transparent: true,
    fog: true,
  }),
);
// UniformsUtils.merge clones values, so bind the shared texture afterwards.
water.material.uniforms.uShore.value = shoreTex;
water.rotation.x = -Math.PI / 2;
water.position.set(GRID / 2, 0.15, GRID / 2);

export function setWaterBiome(b, sun) {
  const u = water.material.uniforms;
  const lava = !!b.lava;
  u.uDeep.value.set(b.water);
  u.uShallow.value.set(b.waterShallow);
  u.uHorizon.value.set(b.sky);
  u.uZenith.value.set(b.sky).multiplyScalar(0.6).lerp(u.uDeep.value, 0.25);
  u.uSunColor.value.copy(sun.color);
  u.uSunDir.value.copy(sun.position).normalize();
  u.uWaveAmp.value = b.waveAmp ?? 0.06;
  u.uWaveSpeed.value = b.waveSpeed ?? 1;
  u.uLava.value = lava ? 1 : 0;
  water.material.transparent = !lava;
  water.material.needsUpdate = true;
}

export function updateWater(dt) {
  water.material.uniforms.uTime.value += dt;
}

// Chamfer distance transform from land vertices over the padded grid,
// written into the red channel of the shore texture.
export function updateShoreField(h) {
  const INF = 1e6, D1 = 1, D2 = Math.SQRT2;
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      const vx = x - PAD, vz = z - PAD;
      const land = vx >= 0 && vz >= 0 && vx < VW && vz < VW && h[vz * VW + vx] >= 1;
      field[z * SIZE + x] = land ? 0 : INF;
    }
  }
  const relax = (i, x, z, d) => {
    if (x < 0 || z < 0 || x >= SIZE || z >= SIZE) return;
    const c = field[z * SIZE + x] + d;
    if (c < field[i]) field[i] = c;
  };
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      const i = z * SIZE + x;
      relax(i, x - 1, z,     D1);
      relax(i, x,     z - 1, D1);
      relax(i, x - 1, z - 1, D2);
      relax(i, x + 1, z - 1, D2);
    }
  }
  for (let z = SIZE - 1; z >= 0; z--) {
    for (let x = SIZE - 1; x >= 0; x--) {
      const i = z * SIZE + x;
      relax(i, x + 1, z,     D1);
      relax(i, x,     z + 1, D1);
      relax(i, x + 1, z + 1, D2);
      relax(i, x - 1, z + 1, D2);
    }
  }
  const R = 2;
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      const i = z * SIZE + x;
      let open = 0;
      for (let dz = -R; dz <= R; dz++) {
        const zz = Math.max(0, Math.min(SIZE - 1, z + dz));
        for (let dx = -R; dx <= R; dx++) {
          const xx = Math.max(0, Math.min(SIZE - 1, x + dx));
          open = Math.max(open, field[zz * SIZE + xx]);
        }
      }
      fieldData[i * 4]     = Math.round(Math.min(field[i] / MAXD, 1) * 255);
      fieldData[i * 4 + 1] = Math.round(Math.min(open / MAXD, 1) * 255);
    }
  }
  shoreTex.needsUpdate = true;
}
