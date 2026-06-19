// @ts-nocheck -- realistic sky + sun + IBL environment

// environment.ts — physically-motivated outdoor daylight for a modern commercial street.
// Combines a Preetham `Sky`, a physical directional sun, soft hemisphere/ambient fill,
// and image-based lighting (PMREM) generated from the sky so glass/metal pick up real
// reflections. Tone mapping is ACES Filmic with sRGB output. 1 unit ~= 1 meter.
//
//   createEnvironment(renderer, scene, { quality }) -> {
//     sun, hemi, ambient, sky, env,
//     setTimeOfDay(t01), setWeather(w), update(dt, camPos), dispose()
//   }

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// How much the sun elevation (radians) must move before we pay for a PMREM re-bake.
const REGEN_ELEVATION_EPS = 0.035; // ~2 degrees

export function createEnvironment(renderer, scene, { quality } = {}) {
  quality = quality || {};
  const shadowMapSize = quality.shadowMapSize || 0;

  // ── Renderer: filmic look, linear → sRGB pipeline ─────────────────────────
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92; // tunable; weather nudges this down
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const baseExposure = 0.92;

  // ── Sky dome ──────────────────────────────────────────────────────────────
  // The Sky shader projects to camera.far, so a large uniform scale just keeps it
  // comfortably beyond everything else. We recenter it on the camera each frame.
  const sky = new Sky();
  sky.scale.setScalar(450000);
  const skyU = sky.material.uniforms;
  skyU.turbidity.value = 3.0;
  skyU.rayleigh.value = 1.2;
  skyU.mieCoefficient.value = 0.005;
  skyU.mieDirectionalG.value = 0.8;
  scene.add(sky);

  // Clear-sky baseline values so weather can lerp back toward them.
  const baseSky = { turbidity: 3.0, rayleigh: 1.2 };

  // ── Sun (key light) ───────────────────────────────────────────────────────
  // Warm white, intensity tuned for ACES. Position is driven by setTimeOfDay and
  // re-anchored near the camera every update so shadows stay crisp around the player.
  const sun = new THREE.DirectionalLight(0xfff4e6, 1.85);
  sun.position.set(80, 120, 60);
  const baseSunIntensity = 1.85;
  if (shadowMapSize > 0) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const sc = sun.shadow.camera; // orthographic frustum covering ~±70m of high-street
    sc.left = -70;
    sc.right = 70;
    sc.top = 70;
    sc.bottom = -70;
    sc.near = 1;
    sc.far = 300;
    sc.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
  }
  scene.add(sun);
  scene.add(sun.target); // target follows the camera; keep it in the graph

  // ── Soft fill ─────────────────────────────────────────────────────────────
  // Kept deliberately low — sun + IBL carry the scene. Hemisphere supplies sky/ground
  // bounce; ambient lifts the deepest shadows just slightly.
  const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x6b5b45, 0.3);
  const baseHemiIntensity = 0.3;
  hemi.position.set(0, 50, 0);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0xffffff, 0.1);
  scene.add(ambient);

  // ── IBL via PMREM ─────────────────────────────────────────────────────────
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  // A throwaway scene holding a private Sky we configure to the *current* sun
  // direction, then convert into a pre-filtered environment map. We never share
  // geometry/material with the visible sky.
  const skyScene = new THREE.Scene();
  const skySrc = new Sky();
  skySrc.scale.setScalar(450000);
  skyScene.add(skySrc);

  let env = null; // current PMREM render target
  let lastRegenElevation = Number.NEGATIVE_INFINITY;

  // Spherical sun direction shared between the visible sky, the IBL sky and the light.
  const sunDir = new THREE.Vector3(0, 1, 0);
  let curElevation = Math.PI / 4; // radians above horizon

  // Rebuild the environment map from the sky at the current sun direction.
  // Called sparingly (throttled by elevation delta / notable weather changes).
  function regenEnv() {
    // Mirror the visible sky's look + sun direction onto the source sky.
    const su = skySrc.material.uniforms;
    su.turbidity.value = skyU.turbidity.value;
    su.rayleigh.value = skyU.rayleigh.value;
    su.mieCoefficient.value = skyU.mieCoefficient.value;
    su.mieDirectionalG.value = skyU.mieDirectionalG.value;
    su.sunPosition.value.copy(skyU.sunPosition.value);

    const prev = env;
    env = pmrem.fromScene(skyScene);
    scene.environment = env.texture;
    if (prev) prev.dispose(); // free the previous render target
    lastRegenElevation = curElevation;
  }

  // ── Time of day ───────────────────────────────────────────────────────────
  // t01: 0 = dawn (sun on horizon, east), 0.5 = noon (overhead), 1 = dusk (west horizon).
  function setTimeOfDay(t01) {
    t01 = Math.max(0, Math.min(1, t01));

    // Elevation: rises to zenith at noon, back down at dusk. Keep a hair above the
    // horizon at the ends so the disc/scattering stays sane.
    const minElev = 0.03;                  // ~1.7° so we never go fully below horizon
    const maxElev = Math.PI / 2 - 0.12;    // just shy of straight up
    curElevation = minElev + (maxElev - minElev) * Math.sin(t01 * Math.PI);

    // Azimuth: sweep east → south → west across the day.
    const azimuth = THREE.MathUtils.degToRad(-90 + 180 * t01);

    // Spherical → cartesian (phi measured from the +Y zenith).
    const phi = Math.PI / 2 - curElevation;
    sunDir.set(
      Math.sin(phi) * Math.sin(azimuth),
      Math.cos(phi),
      Math.sin(phi) * Math.cos(azimuth),
    );

    // Drive the visible sky's sun position uniform.
    skyU.sunPosition.value.copy(sunDir);

    // Move the directional light along the sun direction (re-anchored to camera in update).
    sun.position.copy(sunDir).multiplyScalar(120);

    // Tint by elevation: warm/orange near the horizon, neutral white when high.
    // elev01 in 0..1 across the visible elevation band.
    const elev01 = THREE.MathUtils.clamp(curElevation / (Math.PI / 2), 0, 1);
    const horizon = new THREE.Color(0xff8a40); // low-sun warm
    const zenith = new THREE.Color(0xfff6ea);  // high-sun neutral-warm
    sun.color.copy(horizon).lerp(zenith, Math.pow(elev01, 0.6));

    // Slightly dim the sun at very low elevations (atmospheric extinction).
    sun.intensity = baseSunIntensity * THREE.MathUtils.lerp(0.55, 1.0, Math.pow(elev01, 0.5)) * weatherSunMul;

    // Throttle the costly PMREM bake: only when elevation moved enough.
    if (Math.abs(curElevation - lastRegenElevation) > REGEN_ELEVATION_EPS) {
      regenEnv();
    }
  }

  // ── Weather ───────────────────────────────────────────────────────────────
  // w: { overcast: 0..1, rain: 0..1 }. Overcast hazes the sky, kills sun contrast,
  // raises fill, and rolls in fog. Rain deepens fog and dims further.
  let weatherSunMul = 1.0;
  // Light, distant haze only — keep the scene crisp so the space reads clearly.
  const fog = new THREE.Fog(0xc9d4dc, 150, 680);
  scene.fog = fog;

  function setWeather(w) {
    w = w || {};
    const overcast = THREE.MathUtils.clamp(w.overcast ?? 0, 0, 1);
    const rain = THREE.MathUtils.clamp(w.rain ?? 0, 0, 1);
    const murk = Math.min(1, overcast + rain * 0.6);

    // Hazier, milkier sky as it clouds over.
    skyU.turbidity.value = THREE.MathUtils.lerp(baseSky.turbidity, 12, overcast);
    skyU.rayleigh.value = THREE.MathUtils.lerp(baseSky.rayleigh, 0.4, overcast);

    // Suppress the sun; let the hemisphere fill take over as a soft overcast key.
    weatherSunMul = THREE.MathUtils.lerp(1.0, 0.25, overcast);
    sun.intensity = baseSunIntensity *
      THREE.MathUtils.lerp(0.55, 1.0, Math.pow(THREE.MathUtils.clamp(curElevation / (Math.PI / 2), 0, 1), 0.5)) *
      weatherSunMul;
    hemi.intensity = THREE.MathUtils.lerp(baseHemiIntensity, 1.1, overcast);

    // Knock exposure down a touch under heavy cloud (flatter, cooler light).
    renderer.toneMappingExposure = baseExposure * THREE.MathUtils.lerp(1.0, 0.85, overcast);

    // Fog: tint toward the horizon sky color, denser with murk. Near/far tighten
    // dramatically in rain to read as a downpour.
    const fogColor = new THREE.Color(0xc9d4dc).lerp(new THREE.Color(0x8a98a4), murk);
    fog.color.copy(fogColor);
    fog.near = THREE.MathUtils.lerp(150, 50, murk);
    fog.far = THREE.MathUtils.lerp(680, 260, murk);

    // One bake so reflections reflect the new sky mood. setWeather is a discrete,
    // caller-driven event (not per-frame), so a single regen here is intentional.
    regenEnv();
  }

  // ── Per-frame ─────────────────────────────────────────────────────────────
  // Keep the sky centered on the camera and re-anchor the sun (and its shadow
  // frustum) near the player so cascaded-free shadows stay local and tight.
  const _camPos = new THREE.Vector3();
  function update(dt, camPos) {
    if (camPos) _camPos.copy(camPos);

    // Recenter the visible sky dome on the camera.
    sky.position.copy(_camPos);

    // Anchor the sun relative to the camera: light sits up-sun, target is the camera.
    sun.position.copy(sunDir).multiplyScalar(120).add(_camPos);
    sun.target.position.copy(_camPos);
    sun.target.updateMatrixWorld();
  }

  // ── Teardown ──────────────────────────────────────────────────────────────
  function dispose() {
    if (env) { env.dispose(); env = null; }
    scene.environment = null;
    scene.fog = null;

    pmrem.dispose();

    // Visible sky.
    scene.remove(sky);
    if (sky.geometry) sky.geometry.dispose();
    if (sky.material) sky.material.dispose();

    // IBL source sky.
    if (skySrc.geometry) skySrc.geometry.dispose();
    if (skySrc.material) skySrc.material.dispose();

    // Lights.
    scene.remove(sun);
    scene.remove(sun.target);
    scene.remove(hemi);
    scene.remove(ambient);
  }

  // Initial state: midday-ish, clear, then a first bake.
  setTimeOfDay(0.5);
  setWeather({ overcast: 0, rain: 0 });

  return {
    sun, hemi, ambient, sky, env,
    setTimeOfDay, setWeather, update, dispose,
  };
}
