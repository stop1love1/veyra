// @ts-nocheck -- ported vanilla three.js engine; internals intentionally untyped
// gate.ts — Veyra entry: low-poly Kenney City Kit approach street + gateway into
// the Veyra district + character customization + walk-in (three.js ES module).
//
//   createVeyraGate(container, opts) -> { setLook, openGate, dispose }
//   opts: { look:{hue,skin,style,name}, onProximity(atGuard:boolean), onEnter(), onReady?() }
//
// Re-skinned to match world.ts / worldKit.ts: the realistic Sky / procedural PBR
// materials / procedural buildings + streetprops are gone. The scene is now built
// by cloning Kenney City Kit (CC0) GLB pieces at CITY_SCALE=7 — a short approach
// avenue (straight road + sidewalks) flanked by Kenney buildings & street lights,
// leading to a roundabout-plaza gateway into the district. Lighting mirrors
// worldKit: HemisphereLight + DirectionalLight sun + RoomEnvironment IBL (PMREM) +
// ACES tonemap + light fog + a pleasant sky colour.
//
// The FLOW is preserved verbatim: free-roam (keyboard + joystick + orbit camera);
// an invisible barrier in front of the guard until openGate(); onProximity(atGuard)
// fires within ~3m of the guard; openGate() slides the construction barriers aside
// + steps the guard aside + drops the barrier; crossing the threshold fires
// onEnter() once. Assets load async; build() runs after preload, then opts.onReady().

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { hsl, SKINS } from './shared/helpers';
import { buildAvatar } from './shared/avatar';
import { createKeyboard, createJoystick, createOrbitCamera } from './shared/controls';
import { disposeScene } from './shared/dispose';
import { detectQuality, applyQualityToRenderer } from './shared/quality';
import { createKitLoader } from './shared/assets';

export function createVeyraGate(container, opts) {
  opts = opts || {};
  let look = Object.assign({ hue: 184, skin: 1, style: 'minimal', name: 'Veyra' }, opts.look || {});

  const W = () => container.clientWidth || 390;
  const H = () => container.clientHeight || 700;

  // ── Quality tier ─────────────────────────────────────────
  let q = detectQuality();

  // ── Renderer ─────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  q = detectQuality(renderer); // refine with real GL caps
  applyQualityToRenderer(renderer, q);
  renderer.setSize(W(), H());
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  // ── Scene + camera ───────────────────────────────────────
  const SKY_COLOR = new THREE.Color('#9fd4ea');
  const FOG_COLOR = new THREE.Color('#bfe0d8');
  renderer.setClearColor(SKY_COLOR, 1);   // so the container isn't black during async load
  const scene = new THREE.Scene();
  scene.background = SKY_COLOR;
  scene.fog = new THREE.Fog(FOG_COLOR, 140, 620);

  const camera = new THREE.PerspectiveCamera(48, W() / H(), 0.1, 1200);
  camera.position.set(0, 30, 70);

  // ── Lighting: hemi + sun + RoomEnvironment IBL (mirrors worldKit) ─────────
  const hemi = new THREE.HemisphereLight('#eaf6ff', '#6f8a6a', 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff2da', 2.1);
  sun.position.set(80, 180, 120);
  if (q.shadowMapSize > 0) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const d = 140;
    Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 600 });
    sun.shadow.bias = -0.0004;
  }
  scene.add(sun);
  scene.add(sun.target);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const envRT = pmrem.fromScene(roomEnv, 0.04);
  scene.environment = envRT.texture;
  if (roomEnv.dispose) roomEnv.dispose();

  // ── Layout constants (scaled world units) ────────────────
  const CITY_SCALE = 7;          // tile ≈ 1u -> 7u footprint
  const TILE = CITY_SCALE;
  const APPROACH = 4;            // number of straight road tiles in the approach avenue
  // The avenue runs along Z. The player approaches from +Z and walks toward the
  // city (−Z). Tiles sit at z = i*TILE for i in [-1 .. APPROACH-1] roughly; the
  // gateway/roundabout caps the far (−Z) end.
  const GZ = -(APPROACH - 0.5) * TILE;   // gateway plane (z of the barriers / threshold)
  const PATH_HALF = TILE * 0.45;          // half-width of the clear corridor at the gate
  const START_Z = (APPROACH - 0.5) * TILE; // player spawn at the mouth of the avenue
  const PLAY_HALF_X = TILE * 1.2;          // lateral play bound (avenue width)
  const PLAY_MAX_Z = START_Z + TILE * 0.6;

  // ── Disposal / build state ───────────────────────────────
  let disposed = false;
  let started = false;       // build complete (gameplay active)

  // ── Kit loader ───────────────────────────────────────────
  const kit = createKitLoader();
  const BUILD = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n'];
  const SKY = ['a', 'b', 'c', 'd', 'e'];
  const preloadNames = [
    'road:straight', 'road:side', 'road:roundabout', 'road:light-square',
    'road:construction-barrier', 'road:construction-cone',
    ...BUILD.map((b) => 'build:building-' + b),
    ...SKY.map((s) => 'build:building-skyscraper-' + s),
    'build:detail-awning', 'build:detail-awning-wide', 'build:detail-parasol-a', 'build:detail-parasol-b',
  ];

  // deterministic hash so the street is varied but stable
  const hash01 = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

  // place a clone of `name` at scaled world (x,z), rotation ry, ground y=0.
  function put(group, name, x, z, ry, scale) {
    if (!kit.has(name)) return null;
    const c = kit.get(name);
    c.position.set(x, 0, z);
    c.rotation.y = ry || 0;
    c.scale.setScalar(scale != null ? scale : CITY_SCALE);
    group.add(c);
    return c;
  }
  function footprintR(obj) {
    const s = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
    return Math.max(s.x, s.z) / 2;
  }
  function pickBuilding(h, nearPlaza) {
    if (nearPlaza && h > 0.55) return 'build:building-skyscraper-' + SKY[Math.floor(h * SKY.length) % SKY.length];
    return 'build:building-' + BUILD[Math.floor(h * BUILD.length) % BUILD.length];
  }

  // ── Player avatar (built up front so dispose is uniform) ──
  const player = buildAvatar({ hue: look.hue, skinColor: SKINS[look.skin] });
  player.group.position.set(0, 0, START_Z);
  player.group.rotation.y = Math.PI; // face the gate (−Z)
  scene.add(player.group);
  player.setStyle(look.style);
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26 }));
  blob.rotation.x = -Math.PI / 2; blob.position.set(0, 0.05, START_Z); scene.add(blob);

  // ── Guard (neutral attendant) standing in the path ───────
  const guard = buildAvatar({ hue: 200, skinColor: SKINS[2] });
  const guardZ0 = GZ + TILE * 0.55;
  guard.group.position.set(0, 0, guardZ0);
  guard.group.rotation.y = 0;                  // face the incoming player (+Z)
  guard.mats.clothMat.color = hsl(210, 0.12, 0.32);
  guard.mats.pantsMat.color = hsl(210, 0.08, 0.2);
  scene.add(guard.group);
  // Simple cap.
  const gcap = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.29, 0.18, 16),
    new THREE.MeshStandardMaterial({ color: hsl(210, 0.12, 0.26), roughness: 0.8 }));
  gcap.position.y = 1.86; guard.group.add(gcap);
  const gvisor = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.3),
    new THREE.MeshStandardMaterial({ color: hsl(210, 0.1, 0.2), roughness: 0.8 }));
  gvisor.position.set(0, 1.8, 0.26); guard.group.add(gvisor);
  const guardBlob = new THREE.Mesh(new THREE.CircleGeometry(0.5, 18),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.24 }));
  guardBlob.rotation.x = -Math.PI / 2; guardBlob.position.set(0, 0.05, guardZ0); scene.add(guardBlob);
  const guardX0 = guard.group.position.x;

  // ── Bystanders (people waiting near the entrance) ────────
  const byStanders = [];
  [[-TILE * 1.0, TILE * 1.6, 130], [TILE * 1.0, TILE * 1.2, 60],
   [-TILE * 0.9, -TILE * 0.4, 30], [TILE * 0.9, -TILE * 0.2, 280]].forEach(([x, z, h], i) => {
    const c = buildAvatar({ hue: h, skinColor: SKINS[i % SKINS.length] });
    c.group.position.set(x, 0, z);
    c.group.rotation.y = Math.random() * Math.PI * 2;
    c.group.scale.setScalar(0.96);
    c.setStyle(['minimal', 'street', 'soft'][i % 3]);
    scene.add(c.group);
    const bb = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 }));
    bb.rotation.x = -Math.PI / 2; bb.position.set(x, 0.05, z); scene.add(bb);
    byStanders.push({ c, ph: Math.random() * 6 });
  });

  // ── Barrier handles (filled in build()) ──────────────────
  // Two construction barriers slide aside on openGate(); their pivots sit at the
  // gateway plane and rotate/translate outward.
  const barriers = [];   // { group, x0, side }

  // ── Build the scene (async, after preload) ───────────────
  function build() {
    if (disposed) return;
    const density = q.propDensity;
    const city = new THREE.Group();
    scene.add(city);

    // grass ground plane (large; fog hides the far edge)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1600, 1600),
      new THREE.MeshStandardMaterial({ color: 0x7fae5f, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
    scene.add(ground);

    // ── Approach avenue: straight road tiles along Z ──────────
    // i runs from the player end (+Z) toward the gateway (−Z).
    for (let i = -1; i < APPROACH; i++) {
      const z = -i * TILE + TILE * 0.5;   // tiles centred so the gate plane lands at GZ
      put(city, 'road:straight', 0, z, 0);
      // sidewalks both sides
      put(city, 'road:side', -TILE, z, 0);
      put(city, 'road:side', TILE, z, Math.PI);
      // building slots beyond the sidewalks, facing the avenue
      [-1, 1].forEach((sgn) => {
        const bx = sgn * 2 * TILE;
        const h = hash01(bx, z);
        const nearPlaza = i >= APPROACH - 2;
        const faceRy = sgn < 0 ? Math.PI / 2 : -Math.PI / 2;  // face avenue centreline
        const b = put(city, pickBuilding(h, nearPlaza), bx, z, faceRy);
        // a shop awning / parasol on some façades for character
        if (b && h > 0.45) {
          const r = footprintR(b);
          const det = ['detail-awning', 'detail-awning-wide', 'detail-parasol-a', 'detail-parasol-b'][Math.floor(hash01(z, bx) * 4) % 4];
          const fx = Math.sin(faceRy);
          put(city, 'build:' + det, bx + fx * (r * 0.55), z, faceRy);
        }
      });
      // street lights at intervals along the sidewalk edges
      if (i % 2 === 0) {
        put(city, 'road:light-square', -TILE * 0.85, z, 0);
        put(city, 'road:light-square', TILE * 0.85, z, Math.PI);
      }
    }

    // ── Gateway / threshold: a roundabout-plaza into the district ─────────────
    // Sits past the gate plane (further −Z); reads as "the entrance to the
    // Veyra district". Skyscrapers anchor it on the horizon.
    const plazaZ = GZ - TILE * 1.4;
    put(city, 'road:roundabout', 0, plazaZ, 0);
    // a couple more straight tiles + sidewalks leading off the plaza into the city
    for (let j = 1; j <= 2; j++) {
      const z = plazaZ - j * TILE;
      put(city, 'road:straight', 0, z, 0);
      put(city, 'road:side', -TILE, z, 0);
      put(city, 'road:side', TILE, z, Math.PI);
    }
    // skyscraper district anchors flanking + behind the plaza
    const anchors = [
      [-2.2 * TILE, plazaZ, Math.PI / 2], [2.2 * TILE, plazaZ, -Math.PI / 2],
      [-2.0 * TILE, plazaZ - 2 * TILE, Math.PI / 2], [2.0 * TILE, plazaZ - 2 * TILE, -Math.PI / 2],
      [0, plazaZ - 3 * TILE, 0],
    ];
    anchors.forEach(([x, z, ry], i) => {
      put(city, 'build:building-skyscraper-' + SKY[i % SKY.length], x, z, ry);
    });

    // ── The closed gate: two construction barriers across the road ───────────
    // Each barrier hangs on a pivot at the inner edge of the opening; on
    // openGate() the pivot rotates outward + slides aside, clearing the corridor.
    if (kit.has('road:construction-barrier')) {
      [-1, 1].forEach((side) => {
        const g = new THREE.Group();
        // pivot at the corridor edge, on the gate plane
        g.position.set(side * PATH_HALF, 0, GZ);
        const bar = kit.get('road:construction-barrier');
        // lay the barrier across the road: span inward from the pivot toward centre
        bar.scale.setScalar(CITY_SCALE * 0.5);
        bar.rotation.y = Math.PI / 2;                     // align its length across the road
        bar.position.set(-side * (PATH_HALF * 0.5), 0, 0);
        g.add(bar);
        // a couple of cones in front for read
        if (kit.has('road:construction-cone')) {
          const cone = kit.get('road:construction-cone');
          cone.scale.setScalar(CITY_SCALE * 0.45);
          cone.position.set(-side * (PATH_HALF * 0.55), 0, TILE * 0.35);
          g.add(cone);
        }
        scene.add(g);
        barriers.push({ group: g, x0: side * PATH_HALF, side });
      });
    }

    // point the sun shadow target at the avenue centre
    sun.target.position.set(0, 0, GZ + TILE);

    // frame the camera behind the player looking toward the gate
    orbitCam.cam.yaw = 0; orbitCam.cam.elev = 0.42; orbitCam.cam.dist = TILE * 4.0;

    started = true;
    opts.onReady && opts.onReady();
  }

  kit.preload(preloadNames).then(() => {
    if (disposed) { kit.dispose(); return; }
    build();
  }).catch(() => {
    kit.dispose();
    if (!disposed) { started = true; opts.onReady && opts.onReady(); }
  });

  // ── setLook (live) ───────────────────────────────────────
  function setLook(next) {
    look = Object.assign(look, next);
    player.mats.clothMat.color = hsl(look.hue, 0.55, 0.52);
    player.mats.pantsMat.color = hsl(look.hue, 0.35, 0.3);
    player.mats.hairMat.color = hsl(look.hue, 0.4, 0.2);
    player.mats.skinMat.color = new THREE.Color(SKINS[look.skin] || SKINS[1]);
    player.setStyle(look.style);
  }

  // ── Controls: free roam (joystick + keyboard + orbit camera) ──
  const sstep = (a, b, t) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
  const SPEED = TILE * 0.8;
  const kbd = createKeyboard();
  const keys = kbd.keys;
  const stick = createJoystick(container);
  const joy = stick.joy;

  const orbitCam = createOrbitCamera(renderer.domElement, {
    yaw: 0, elev: 0.42, dist: TILE * 4.0,
    minDist: TILE * 2.2, maxDist: TILE * 9, minElev: 0.18, maxElev: 0.95,
    pinch: 0.06, wheel: 0.05,
  });
  const cam = orbitCam.cam;

  // ── Guard barrier / proximity / gate ─────────────────────
  const barrierZ = guardZ0 + TILE * 0.7;   // player can't pass until the gate opens
  let gateOpen = false, gt = 0;            // gate-open animation timer
  let atGuard = false, doneFired = false, phase = 0;
  const camTarget = new THREE.Vector3(), tmp = new THREE.Vector3(), camPos = new THREE.Vector3();

  let raf = 0, running = true, last = performance.now();

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = now / 1000;

    // ambient life
    byStanders.forEach((b) => {
      b.c.group.rotation.y += Math.sin(t * 0.6 + b.ph) * 0.003;
      b.c.parts.torso.position.y = 1.05 + Math.sin(t * 1.2 + b.ph) * 0.02;
    });
    if (!gateOpen) guard.parts.head.rotation.y = Math.sin(t * 0.5) * 0.2;

    // ── input → movement (relative to camera yaw) ──
    let ix = 0, iz = 0;
    if (keys['w'] || keys['arrowup']) iz -= 1;
    if (keys['s'] || keys['arrowdown']) iz += 1;
    if (keys['a'] || keys['arrowleft']) ix -= 1;
    if (keys['d'] || keys['arrowright']) ix += 1;
    ix += joy.x; iz += joy.y;
    let mag = Math.hypot(ix, iz); const moving = started && mag > 0.08;
    if (mag > 1) { ix /= mag; iz /= mag; mag = 1; }

    if (moving) {
      const fwdX = -Math.sin(cam.yaw), fwdZ = -Math.cos(cam.yaw);
      const rgtX = Math.cos(cam.yaw), rgtZ = -Math.sin(cam.yaw);
      const mvx = rgtX * ix + fwdX * (-iz);
      const mvz = rgtZ * ix + fwdZ * (-iz);
      const p = player.group.position;
      p.x += mvx * SPEED * dt;
      p.z += mvz * SPEED * dt;
      // play area
      p.x = Math.max(-PLAY_HALF_X, Math.min(PLAY_HALF_X, p.x));
      p.z = Math.min(PLAY_MAX_Z, p.z);
      // invisible barrier across the opening until the guard lets you in
      if (!gateOpen && p.z < barrierZ) p.z = barrierZ;
      // funnel through the doorway when crossing the gateway plane
      if (p.z < GZ + TILE * 0.5) p.x = Math.max(-PATH_HALF, Math.min(PATH_HALF, p.x));
      // face direction of travel
      const targetRot = Math.atan2(mvx, mvz);
      let diff = ((targetRot - player.group.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
      player.group.rotation.y += diff * Math.min(1, dt * 12);
    }

    // walk animation
    const sp = moving ? mag : 0;
    phase += dt * (6 + sp * 4) * (moving ? 1 : 0);
    const swing = moving ? 0.7 * sp : 0;
    const ease = (pt, v) => pt.rotation.x += (v - pt.rotation.x) * Math.min(1, dt * 14);
    ease(player.parts.legL, Math.sin(phase) * swing);
    ease(player.parts.legR, -Math.sin(phase) * swing);
    ease(player.parts.armL, -Math.sin(phase) * swing * 0.7);
    ease(player.parts.armR, Math.sin(phase) * swing * 0.7);
    player.parts.torso.position.y = 1.05 + (moving ? Math.abs(Math.sin(phase)) * 0.04 : Math.sin(t * 1.4) * 0.015);
    blob.position.set(player.group.position.x, 0.05, player.group.position.z);

    // ── proximity to guard ──
    const gd = Math.hypot(player.group.position.x - guard.group.position.x, player.group.position.z - guardZ0);
    const nowAt = gd < TILE * 0.55;   // ~3m at CITY_SCALE=7 (avatars are ~1m units)
    if (nowAt !== atGuard) { atGuard = nowAt; opts.onProximity && opts.onProximity(atGuard); }

    // ── gate opening: barriers slide aside, guard steps aside, barrier drops ──
    if (gateOpen) {
      gt += dt;
      const dOpen = sstep(0, 1.3, gt);
      barriers.forEach((b) => {
        // rotate the leaf outward + slide it toward the sidewalk
        b.group.rotation.y = b.side * dOpen * 1.4;
        b.group.position.x = b.x0 + b.side * dOpen * TILE * 0.9;
      });
      const ga = sstep(0, 0.7, gt);
      guard.group.position.x = guardX0 - ga * TILE * 0.7;
      guardBlob.position.x = guardX0 - ga * TILE * 0.7;
      guard.parts.armR.rotation.x = -ga * 1.6;
      // the player walks through on their own — fire once they cross the threshold
      if (!doneFired && player.group.position.z < GZ - TILE * 0.2) { doneFired = true; opts.onEnter && opts.onEnter(); }
    }

    // ── third-person camera follow ──
    const offX = cam.dist * Math.cos(cam.elev) * Math.sin(cam.yaw);
    const offZ = cam.dist * Math.cos(cam.elev) * Math.cos(cam.yaw);
    const offY = cam.dist * Math.sin(cam.elev);
    camTarget.set(player.group.position.x + offX, TILE * 0.3 + offY, player.group.position.z + offZ);
    camera.position.lerp(camTarget, Math.min(1, dt * 6));
    tmp.set(player.group.position.x, TILE * 0.32, player.group.position.z);
    camera.lookAt(tmp);
    camPos.copy(camera.position);

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  const ro = new ResizeObserver(() => {
    camera.aspect = W() / H(); camera.updateProjectionMatrix();
    renderer.setSize(W(), H());
  });
  ro.observe(container);

  // Pause rendering while the tab is hidden (saves battery on mobile).
  const onVisibility = () => {
    if (disposed) return;
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    setLook,
    openGate() { if (!gateOpen) { gateOpen = true; gt = 0; } },
    dispose() {
      disposed = true; running = false; cancelAnimationFrame(raf); ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      kbd.dispose(); stick.dispose(); orbitCam.dispose();
      // Scene clones share geometry/material with the kit cache: dispose the scene
      // first to free those GPU resources, then kit.dispose() clears the cache map.
      disposeScene(scene);
      kit.dispose();
      envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    },
  };
}
