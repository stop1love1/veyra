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

export function createEnvironment(renderer, scene, { quality, envHdrUrl } = {}) {
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
  let useHdrEnv = false;   // once an HDRI is bound, the dynamic Sky bake is skipped
  let hdrEnvRT = null;     // PMREM render target for the HDRI (freed in dispose)

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

  // ── Day/night state (shared by setTimeOfDay + setWeather via applyLighting) ──
  let curDaylight = 1;      // 0 = full night … 1 = full day (soft twilight band)
  let curOvercastV = 0;     // remembered overcast so time changes keep weather mood
  const _horizonCol = new THREE.Color(0xff8a40); // low-sun warm
  const _zenithCol = new THREE.Color(0xfff6ea);  // high-sun neutral-warm
  const _nightFog = new THREE.Color(0x0b1622);   // deep blue night haze

  // Apply the combined sun/fill/exposure/IBL response for the current daylight +
  // overcast. Called whenever either the time of day OR the weather changes so the
  // two never stomp each other's lighting writes.
  function applyLighting() {
    const elev01 = THREE.MathUtils.clamp(curElevation / (Math.PI / 2), 0, 1);
    const overcast = curOvercastV;
    // Sun: warm near the horizon, neutral high; intensity falls to ~0 at night.
    sun.color.copy(_horizonCol).lerp(_zenithCol, Math.pow(elev01, 0.6));
    sun.intensity = baseSunIntensity * (0.15 + 0.85 * Math.pow(elev01, 0.5)) * curDaylight * weatherSunMul;
    // Fills: keep a small cool moonlight floor at night so it never goes pitch black.
    hemi.intensity = THREE.MathUtils.lerp(0.08, THREE.MathUtils.lerp(baseHemiIntensity, 1.1, overcast), curDaylight);
    hemi.color.setHSL(0.6, 0.5, THREE.MathUtils.lerp(0.35, 0.78, curDaylight)); // cooler/darker at night
    ambient.intensity = THREE.MathUtils.lerp(0.02, 0.1, curDaylight);
    // Exposure: dark at night, normal by day, knocked down a touch under cloud.
    // This scales the WHOLE rendered image (incl. IBL/HDRI-lit surfaces) before
    // tone mapping, so it carries the night dimming even though three r160 has no
    // scene.environmentIntensity (the line below is a forward-compatible no-op).
    renderer.toneMappingExposure = baseExposure
      * THREE.MathUtils.lerp(0.40, 1.0, curDaylight)
      * THREE.MathUtils.lerp(1.0, 0.85, overcast);
    scene.environmentIntensity = THREE.MathUtils.lerp(0.12, 1.0, curDaylight);
  }

  // ── Time of day ───────────────────────────────────────────────────────────
  // t01 maps the REAL 24h clock: 0 = midnight, 0.25 = sunrise, 0.5 = noon,
  // 0.75 = sunset, 1 = midnight. The sun goes BELOW the horizon at night so the
  // Preetham sky darkens and the emissive street lamps/lanterns carry the scene.
  function setTimeOfDay(t01) {
    t01 = Math.max(0, Math.min(1, t01));
    const maxElev = Math.PI / 2 - 0.12;    // just shy of straight up

    // True solar arc (can be negative at night).
    const solarElev = maxElev * Math.sin(2 * Math.PI * (t01 - 0.25));
    // Daylight factor with a soft twilight band straddling the horizon.
    curDaylight = THREE.MathUtils.clamp((solarElev + 0.12) / 0.34, 0, 1);
    // For IBL/landmark scaling keep a tiny positive elevation; the sky/light use
    // the REAL (possibly negative) elevation so night reads as night.
    curElevation = Math.max(0.02, solarElev);

    // Azimuth: sweep east → south → west across the day.
    const azimuth = THREE.MathUtils.degToRad(-90 + 180 * t01);
    const phi = Math.PI / 2 - solarElev;   // REAL elevation drives the visible sun
    sunDir.set(
      Math.sin(phi) * Math.sin(azimuth),
      Math.cos(phi),
      Math.sin(phi) * Math.cos(azimuth),
    );
    skyU.sunPosition.value.copy(sunDir);
    sun.position.copy(sunDir).multiplyScalar(120);

    applyLighting();

    // Throttle the costly PMREM bake: only when elevation moved enough — and never
    // once a static HDRI env is bound (it supersedes the Sky-baked reflections).
    if (!useHdrEnv && Math.abs(curElevation - lastRegenElevation) > REGEN_ELEVATION_EPS) {
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
    curOvercastV = overcast;

    // Hazier, milkier sky as it clouds over.
    skyU.turbidity.value = THREE.MathUtils.lerp(baseSky.turbidity, 12, overcast);
    skyU.rayleigh.value = THREE.MathUtils.lerp(baseSky.rayleigh, 0.4, overcast);
    weatherSunMul = THREE.MathUtils.lerp(1.0, 0.25, overcast);

    // Sun / fills / exposure / IBL come from the shared day+weather response.
    applyLighting();

    // Fog: by day tint toward the horizon sky and densify with murk; by night sink
    // toward a deep blue haze so distance reads dark, not milky-grey.
    const dayFog = new THREE.Color(0xc9d4dc).lerp(new THREE.Color(0x8a98a4), murk);
    fog.color.copy(dayFog).lerp(_nightFog, 1 - curDaylight);
    fog.near = THREE.MathUtils.lerp(150, 50, murk);
    fog.far = THREE.MathUtils.lerp(680, 260, murk);

    // One bake so reflections reflect the new sky mood. setWeather is a discrete,
    // caller-driven event (not per-frame), so a single regen here is intentional.
    // Skipped once an HDRI env is bound.
    if (!useHdrEnv) regenEnv();
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
    if (hdrEnvRT) { hdrEnvRT.dispose(); hdrEnvRT = null; }
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

  // Optional HDRI IBL: load async; when ready it replaces the Sky-baked env and
  // disables the per-frame rebake. Failure is silent (keep dynamic Sky-PMREM).
  if (envHdrUrl) {
    import('three/addons/loaders/RGBELoader.js').then(({ RGBELoader }) => {
      new RGBELoader().load(envHdrUrl, (hdr) => {
        const gen = new THREE.PMREMGenerator(renderer);
        gen.compileEquirectangularShader();
        hdrEnvRT = gen.fromEquirectangular(hdr);
        hdr.dispose(); gen.dispose();
        if (env) { env.dispose(); env = null; }   // drop the Sky-baked env
        scene.environment = hdrEnvRT.texture;
        useHdrEnv = true;
      }, undefined, () => { /* keep dynamic Sky-PMREM on failure */ });
    }).catch(() => {});
  }

  return {
    sun, hemi, ambient, sky, env, sunDir,
    setTimeOfDay, setWeather, update, dispose,
    getSunElevation: () => curElevation,
  };
}
