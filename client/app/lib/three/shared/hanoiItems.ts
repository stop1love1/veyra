// @ts-nocheck -- lively HANOI STREET ITEMS: procedural low-poly, instanced.
//
// hanoiItems.ts — the street life of Hanoi's Old Quarter. The world
// (worldHanoi.ts) renders a real OSM map (streets, ~2000 buildings, lake) but
// almost no street life, so it feels empty. This module supplies the missing
// soul: the rivers of MOTORBIKES, the tangle of overhead WIRES, the sidewalk
// PLASTIC-STOOL cafés, the street vendors, the lamps and leaning utility poles.
//
//   createHanoiItems(THREE?) -> {
//     motorbikes, people, stalls, cafes, lampPosts, powerLines,
//     planters, hangingSigns, awnings, trafficLights, dispose
//   }
//
// Every builder takes a PLACEMENTS array (positions sampled by the integration
// from the OSM road / sidewalk network) and returns a THREE.Group that the
// caller can add to the scene and later remove. Each Group is composed of a
// handful of THREE.InstancedMesh sub-parts (one per "part" of the prop), so N
// items cost only a few draw calls regardless of N. Per-item triangle counts
// are kept LOW (boxes, short cylinders, cones) and variation is seeded by index
// so the result is deterministic-ish and stable across rebuilds.
//
// ALL geometry & materials are PROCEDURAL — no external assets / models /
// network / API. Geometries and materials are tracked internally; the returned
// dispose() frees every one of them. (The Groups themselves are owned by the
// caller / disposeScene walks the graph; this module only frees the shared
// geometry + material pools it allocated.)
//
// Conventions match streetprops.ts / materials.ts: 1 world unit ≈ 1 metre.
// Default sizes: bike ~1.8 m long, person ~1.7 m tall, plastic stool ~0.35 m,
// lamp ~5 m tall, utility pole ~7 m tall.

import * as THREE from 'three';

export function createHanoiItems(THREEarg) {
  // Prefer the imported THREE (self-contained), but accept an injected THREE so
  // the caller can guarantee a single three.js instance. Same constructors.
  const T = THREEarg || THREE;

  /* ------------------------------------------------------------------ *
   * Resource pools. Everything allocated here is tracked so dispose()
   * is exhaustive. Builders pull from these shared pools — geometry is
   * shared across instances (that's the whole point of InstancedMesh),
   * and the small PBR material set is shared across every builder.
   * ------------------------------------------------------------------ */
  const geoms = [];
  const mats = [];

  /** Track + return a geometry. */
  const G = (g) => { geoms.push(g); return g; };
  /** Track + return a material. */
  const M = (m) => { mats.push(m); return m; };

  // Primitive factories (tracked).
  const box = (w, h, d) => G(new T.BoxGeometry(w, h, d));
  const cyl = (rt, rb, h, seg = 10) => G(new T.CylinderGeometry(rt, rb, h, seg));
  const cone = (r, h, seg = 8) => G(new T.ConeGeometry(r, h, seg));
  const sphere = (r, ws = 8, hs = 6) => G(new T.SphereGeometry(r, ws, hs));

  /* ----------------------------- materials ------------------------------ */
  // A small SHARED PBR set in the muted-but-lively Hanoi register. Standard
  // materials so they pick up the scene's IBL/env like the rest of the world.
  const hsl = (h, s, l) => new T.Color().setHSL(h / 360, s, l);

  const std = (color, rough = 0.7, metal = 0.0, extra = {}) =>
    M(new T.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }));

  // Black/charcoal rubber + dark plastics (tyres, seats, dark trim).
  const rubber = std(hsl(0, 0, 0.06), 0.85, 0.0);
  // Bare/painted metal (bike frames base, lamp poles, stall frames).
  const metalDark = std(hsl(220, 0.04, 0.2), 0.5, 0.7);
  const chrome = std(hsl(210, 0.02, 0.62), 0.3, 0.85);
  // Concrete (utility poles, pots).
  const concrete = std(hsl(30, 0.02, 0.55), 0.92, 0.0);
  // Weathered wood / bamboo (poles, cart bodies, low tables).
  const wood = std(hsl(28, 0.34, 0.42), 0.82, 0.0);
  const woodLight = std(hsl(34, 0.3, 0.58), 0.8, 0.0);
  // Generic instanced body material — white so per-instance instanceColor shows.
  const bodyTint = std(0xffffff, 0.55, 0.15);
  const clothTint = std(0xffffff, 0.85, 0.0);     // people clothing (instanceColor)
  const fabricTint = std(0xffffff, 0.9, 0.0, { side: T.DoubleSide }); // awnings / parasols
  const signTint = std(0xffffff, 0.6, 0.1, { emissive: hsl(0, 0, 0), emissiveIntensity: 0.0 });
  // Skin (people heads/arms).
  const skin = std(hsl(28, 0.38, 0.68), 0.7, 0.0);
  // Foliage (planters).
  const leaf = std(hsl(120, 0.42, 0.34), 0.9, 0.0, { side: T.DoubleSide, flatShading: true });
  // Drooping overhead WIRES — near-black, faintly glossy.
  const wireMat = std(hsl(0, 0, 0.04), 0.6, 0.1);
  // Emissive lamp head (warm bulb) + traffic-light lenses.
  const bulb = M(new T.MeshStandardMaterial({ color: 0xfff3d2, emissive: 0xffe2a0, emissiveIntensity: 1.4, roughness: 0.4 }));
  const headlight = M(new T.MeshStandardMaterial({ color: 0xfffbe8, emissive: 0xfff0b0, emissiveIntensity: 0.9, roughness: 0.4 }));
  // Warm paper-lantern body + shared hanging-sign board (both ramp at dusk).
  const lanternMat = M(new T.MeshStandardMaterial({ color: 0xff8a4e, emissive: 0xff5a1e, emissiveIntensity: 0.6, roughness: 0.5 }));
  const signEmissive = M(new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05, emissive: 0xffffff, emissiveIntensity: 0.18 }));

  // Night ramp: [material, baseIntensity]. setNightFactor(0)=day, (1)=full night.
  const _emissiveBases = [[bulb, 1.4], [headlight, 0.9], [signEmissive, 0.18], [lanternMat, 0.6]];
  function setNightFactor(n) {
    const k = Math.max(0, Math.min(1, n));
    for (const [m, base] of _emissiveBases) m.emissiveIntensity = base * (0.15 + 1.6 * k);
  }

  // Terracotta pot + ripe-kumquat orange (potted ornamental trees / cây cảnh).
  const terracotta = std(hsl(18, 0.45, 0.42), 0.85, 0.0);
  const fruitOrange = std(hsl(30, 0.75, 0.52), 0.6, 0.0);
  // Red propaganda banner cloth + its yellow band; brass-ish birdcage.
  const bannerRed = std(hsl(0, 0.72, 0.42), 0.85, 0.0, { side: T.DoubleSide });
  const bannerYellow = std(hsl(48, 0.85, 0.55), 0.8, 0.0, { side: T.DoubleSide });
  const cageBrass = std(hsl(40, 0.5, 0.55), 0.5, 0.4);

  // ── Vietnamese flag (cờ đỏ sao vàng): red cloth + a yellow 5-point star ──
  function makeFlagTexture() {
    const c = (typeof document !== 'undefined') ? document.createElement('canvas') : new OffscreenCanvas(192, 128);
    c.width = 192; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#da251d'; ctx.fillRect(0, 0, 192, 128);           // flag red
    ctx.fillStyle = '#ff0'; ctx.beginPath();                          // yellow star
    const cx = 96, cy = 64, R = 38, r = R * 0.382;
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + i * Math.PI / 5;
      const rad = i % 2 === 0 ? R : r;
      const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.needsUpdate = true;
    return tex;
  }
  const flagTex = makeFlagTexture();
  const flagMat = M(new T.MeshStandardMaterial({ map: flagTex, roughness: 0.85, metalness: 0.0, side: T.DoubleSide }));

  // Wind uniforms for the fluttering flags (driven each frame via setWind()).
  const _windUbo = { uTime: { value: 0 }, uWind: { value: 0 }, uWindDir: { value: 0 } };
  function setWind(t, w, dir) { _windUbo.uTime.value = t; _windUbo.uWind.value = w; if (dir != null) _windUbo.uWindDir.value = dir; }
  // Flag cloth flutter: a travelling wave along the flag, growing toward the free
  // end, scaled by wind. Flag local: x∈[0,1] from the pole (0) to the free end (1).
  flagMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = _windUbo.uTime; shader.uniforms.uWind = _windUbo.uWind;
    shader.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float fEnd = position.x + 0.5;
       transformed.z += sin(position.x * 6.0 - uTime * 6.0) * (0.04 + uWind * 0.30) * fEnd;
       transformed.y += cos(position.x * 5.0 - uTime * 5.0) * (0.02 + uWind * 0.12) * fEnd;`,
    );
  };

  /* ------------------------------ helpers ------------------------------- */
  // Reusable scratch objects (avoid per-instance allocation).
  const _m = new T.Matrix4();
  const _p = new T.Vector3();
  const _q = new T.Quaternion();
  const _s = new T.Vector3();
  const _e = new T.Euler();
  const _c = new T.Color();
  const UP = new T.Vector3(0, 1, 0);

  /** Cheap deterministic pseudo-random in [0,1) seeded by an integer index. */
  function rnd(i, salt = 0) {
    const s = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }

  /**
   * Make an InstancedMesh for `count` items from a shared geometry + material,
   * pre-configured as a static shadow-caster. `count` may be 0 (we still return
   * a valid—if empty—mesh so the Group structure is uniform).
   */
  function imesh(geo, mat, count, { cast = true, receive = false, color = false } = {}) {
    const im = new T.InstancedMesh(geo, mat, Math.max(0, count));
    im.castShadow = cast;
    im.receiveShadow = receive;
    im.frustumCulled = false; // props span the whole map; per-instance culling N/A
    if (color && im.instanceColor === null) {
      // Force allocation of the instanceColor buffer up-front.
      im.instanceColor = new T.InstancedBufferAttribute(new Float32Array(Math.max(1, count) * 3), 3);
    }
    return im;
  }

  /**
   * Compose a world transform for sub-part `partOffset` (a local offset/rot/scale
   * relative to the item's origin) placed at world (x,z) with yaw `ry`, then
   * write it to instanced mesh `im` at index `i`. `partOffset`:
   *   { x?,y?,z?, rx?,ry?,rz?, sx?,sy?,sz? } all local to the un-yawed item.
   */
  function setPart(im, i, x, z, ry, off) {
    // Local offset rotated into the item's yaw frame.
    const ox = off.x || 0, oy = off.y || 0, oz = off.z || 0;
    const cy = Math.cos(ry || 0), sy = Math.sin(ry || 0);
    const wx = x + ox * cy + oz * sy;
    const wz = z - ox * sy + oz * cy;
    _p.set(wx, oy, wz);
    _e.set(off.rx || 0, (ry || 0) + (off.ry || 0), off.rz || 0);
    _q.setFromEuler(_e);
    _s.set(off.sx != null ? off.sx : 1, off.sy != null ? off.sy : 1, off.sz != null ? off.sz : 1);
    _m.compose(_p, _q, _s);
    im.setMatrixAt(i, _m);
  }

  /** Finalise a Group: flush instance buffers, mark static, return it. */
  function finalize(group, meshes) {
    for (const im of meshes) {
      if (!im) continue;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.matrixAutoUpdate = false;
      im.updateMatrix();
      group.add(im);
    }
    group.matrixAutoUpdate = false;
    group.updateMatrix();
    return group;
  }

  /* ====================================================================
   * motorbikes(places) — the lifeblood of Hanoi. A low-poly scooter:
   * two wheels, a floorboard/body, a seat, handlebars + headlight. ONE
   * InstancedMesh per sub-part, so 1500 bikes ≈ 6 draw calls. Body colour
   * varies per bike via instanceColor.
   *   places: [{ x, z, ry, color? }]   color is a THREE-acceptable hex/Color.
   * Default footprint ≈ 1.8 m long, 0.7 m wide, seat ~0.75 m.
   * ================================================================== */
  function motorbikes(places) {
    const g = new T.Group();
    const n = places ? places.length : 0;

    // Shared part geometries (low-poly).
    const wheelGeo = cyl(0.26, 0.26, 0.12, 12);          // tyre (laid on its side)
    const bodyGeo = box(1.15, 0.22, 0.42);               // floorboard / underbone body
    const cowlGeo = box(0.5, 0.5, 0.42);                 // front leg-shield / fairing
    const seatGeo = box(0.62, 0.16, 0.36);               // saddle
    const barGeo = cyl(0.025, 0.025, 0.62, 6);           // handlebar
    const lightGeo = box(0.16, 0.16, 0.1);               // headlight block

    const wheels = imesh(wheelGeo, rubber, n * 2, { color: false });
    const body = imesh(bodyGeo, bodyTint, n, { color: true });
    const cowl = imesh(cowlGeo, bodyTint, n, { color: true });
    const seat = imesh(seatGeo, rubber, n, { color: false });
    const bars = imesh(barGeo, metalDark, n, { color: false });
    const light = imesh(lightGeo, headlight, n, { color: false });

    for (let i = 0; i < n; i++) {
      const pl = places[i];
      const x = pl.x, z = pl.z, ry = pl.ry || 0;

      // Body colour: explicit, else a lively seeded hue.
      if (pl.color != null) _c.set(pl.color);
      else _c.setHSL(rnd(i, 1), 0.6, 0.5);

      // Wheels (cylinder axis is +Y; rotate to roll along the bike's length X).
      setPart(wheels, i * 2 + 0, x, z, ry, { x: -0.62, y: 0.26, z: 0, rx: Math.PI / 2 });
      setPart(wheels, i * 2 + 1, x, z, ry, { x: 0.62, y: 0.26, z: 0, rx: Math.PI / 2 });

      // Floorboard body.
      setPart(body, i, x, z, ry, { x: 0, y: 0.46, z: 0 });
      body.setColorAt(i, _c);

      // Front leg-shield / fairing (same colour as body).
      setPart(cowl, i, x, z, ry, { x: 0.5, y: 0.52, z: 0 });
      cowl.setColorAt(i, _c);

      // Saddle, slightly raised toward the rear.
      setPart(seat, i, x, z, ry, { x: -0.2, y: 0.74, z: 0 });

      // Handlebars across the front (cylinder spun to lie across Z).
      setPart(bars, i, x, z, ry, { x: 0.6, y: 0.92, z: 0, rx: Math.PI / 2 });

      // Headlight on the front shield.
      setPart(light, i, x, z, ry, { x: 0.76, y: 0.62, z: 0 });
    }

    return finalize(g, [wheels, body, cowl, seat, bars, light]);
  }

  /* ====================================================================
   * people(places) — stylised pedestrians: a tapered torso, a head, and
   * suggested legs (a single split block) + arms. Instanced; clothing
   * colour varies via instanceColor and height varies per person.
   *   places: [{ x, z, ry, scale?, hue? }]
   * Default height ≈ 1.7 m.
   * ================================================================== */
  function people(places) {
    const g = new T.Group();
    const n = places ? places.length : 0;

    const torsoGeo = cyl(0.16, 0.2, 0.62, 8);     // tapered torso (unit-ish)
    const headGeo = sphere(0.13, 8, 6);
    const legsGeo = box(0.28, 0.7, 0.18);         // suggested legs block
    const armGeo = cyl(0.05, 0.05, 0.5, 6);       // an arm

    const torso = imesh(torsoGeo, clothTint, n, { color: true });
    const head = imesh(headGeo, skin, n, { color: false });
    const legs = imesh(legsGeo, clothTint, n, { color: true });
    const armL = imesh(armGeo, clothTint, n, { color: true });
    const armR = imesh(armGeo, clothTint, n, { color: true });

    for (let i = 0; i < n; i++) {
      const pl = places[i];
      const x = pl.x, z = pl.z, ry = pl.ry || 0;
      const s = pl.scale != null ? pl.scale : 0.92 + rnd(i, 2) * 0.22; // height variation

      // Clothing colour.
      const hue = pl.hue != null ? pl.hue : rnd(i, 3) * 360;
      _c.setHSL(((hue % 360) + 360) % 360 / 360, 0.5, 0.5);

      // Legs (bottom of the body), scaled with the person.
      setPart(legs, i, x, z, ry, { y: 0.35 * s, sx: s, sy: s, sz: s });
      legs.setColorAt(i, _c);

      // Torso above the legs.
      setPart(torso, i, x, z, ry, { y: 1.0 * s, sx: s, sy: s, sz: s });
      torso.setColorAt(i, _c);

      // Head on top.
      setPart(head, i, x, z, ry, { y: 1.42 * s, sx: s, sy: s, sz: s });

      // Arms at the sides (same clothing colour, hanging).
      setPart(armL, i, x, z, ry, { x: 0, y: 1.02 * s, z: 0.22 * s, sx: s, sy: s, sz: s });
      armL.setColorAt(i, _c);
      setPart(armR, i, x, z, ry, { x: 0, y: 1.02 * s, z: -0.22 * s, sx: s, sy: s, sz: s });
      armR.setColorAt(i, _c);
    }

    return finalize(g, [legs, torso, head, armL, armR]);
  }

  /* ====================================================================
   * stalls(places) — a street-food cart / vendor stall: a wheeled cart
   * body, a goods box on top, a couple of baskets, and a bright parasol
   * shading it. Instanced parts.
   *   places: [{ x, z, ry }]
   * ================================================================== */
  function stalls(places) {
    const g = new T.Group();
    const n = places ? places.length : 0;

    const cartGeo = box(1.4, 0.6, 0.7);            // cart body
    const wheelGeo = cyl(0.22, 0.22, 0.08, 10);    // cart wheels
    const goodsGeo = box(1.1, 0.34, 0.55);         // goods box / display
    const basketGeo = cyl(0.22, 0.16, 0.2, 10);    // round basket
    const poleGeo = cyl(0.03, 0.03, 2.4, 6);       // parasol pole
    const canopyGeo = cone(1.25, 0.42, 8);         // parasol canopy

    const cart = imesh(cartGeo, wood, n, { color: false });
    const wheels = imesh(wheelGeo, rubber, n * 2, { color: false });
    const goods = imesh(goodsGeo, woodLight, n, { color: false });
    const baskets = imesh(basketGeo, woodLight, n * 2, { color: false });
    const pole = imesh(poleGeo, metalDark, n, { color: false });
    const canopy = imesh(canopyGeo, fabricTint, n, { color: true });

    for (let i = 0; i < n; i++) {
      const pl = places[i];
      const x = pl.x, z = pl.z, ry = pl.ry || 0;

      setPart(cart, i, x, z, ry, { x: 0, y: 0.65, z: 0 });
      setPart(wheels, i * 2 + 0, x, z, ry, { x: -0.45, y: 0.22, z: 0.36, rx: Math.PI / 2 });
      setPart(wheels, i * 2 + 1, x, z, ry, { x: 0.45, y: 0.22, z: 0.36, rx: Math.PI / 2 });

      setPart(goods, i, x, z, ry, { x: 0, y: 1.12, z: 0 });
      setPart(baskets, i * 2 + 0, x, z, ry, { x: -0.42, y: 1.0, z: -0.34 });
      setPart(baskets, i * 2 + 1, x, z, ry, { x: 0.42, y: 1.0, z: -0.34 });

      setPart(pole, i, x, z, ry, { x: 0.1, y: 1.4, z: 0 });

      // Bright parasol — saturated, lively Hanoi colours.
      _c.setHSL(rnd(i, 4), 0.75, 0.52);
      setPart(canopy, i, x, z, ry, { x: 0.1, y: 2.55, z: 0 });
      canopy.setColorAt(i, _c);
    }

    return finalize(g, [cart, wheels, goods, baskets, pole, canopy]);
  }

  /* ====================================================================
   * cafes(places) — the iconic Hanoi sidewalk café: a tight cluster of
   * tiny low PLASTIC STOOLS (red/blue) around a low table. Instanced.
   *   places: [{ x, z, ry }]
   * Default stool seat ≈ 0.35 m; ~5 stools per café.
   * ================================================================== */
  function cafes(places) {
    const g = new T.Group();
    const n = places ? places.length : 0;
    const STOOLS = 5; // stools per café cluster

    // A plastic stool = a small seat disc + 3 stubby legs, merged conceptually
    // into 2 instanced parts (seat + a single leg-cluster block to stay cheap).
    const seatGeo = cyl(0.16, 0.14, 0.05, 8);      // round plastic seat top
    const seatBodyGeo = cyl(0.14, 0.1, 0.3, 6);    // tapered stool body/legs
    const tableTopGeo = cyl(0.34, 0.32, 0.04, 10); // low round table top
    const tableLegGeo = cyl(0.1, 0.12, 0.42, 6);   // table pedestal

    const seat = imesh(seatGeo, bodyTint, n * STOOLS, { color: true });
    const seatBody = imesh(seatBodyGeo, bodyTint, n * STOOLS, { color: true });
    const tableTop = imesh(tableTopGeo, metalDark, n, { color: false });
    const tableLeg = imesh(tableLegGeo, metalDark, n, { color: false });

    // Stool ring offsets around the table (tight cluster).
    const ring = [];
    for (let k = 0; k < STOOLS; k++) {
      const a = (k / STOOLS) * Math.PI * 2;
      ring.push([Math.cos(a) * 0.55, Math.sin(a) * 0.55]);
    }

    for (let i = 0; i < n; i++) {
      const pl = places[i];
      const x = pl.x, z = pl.z, ry = pl.ry || 0;

      // Low table at the centre.
      setPart(tableTop, i, x, z, ry, { x: 0, y: 0.44, z: 0 });
      setPart(tableLeg, i, x, z, ry, { x: 0, y: 0.21, z: 0 });

      for (let k = 0; k < STOOLS; k++) {
        const idx = i * STOOLS + k;
        const ox = ring[k][0], oz = ring[k][1];
        // Classic Hanoi stool colours: alternating red / blue (a few green).
        const t = rnd(idx, 5);
        if (t < 0.45) _c.setHSL(0 / 360, 0.7, 0.5);       // red
        else if (t < 0.9) _c.setHSL(210 / 360, 0.65, 0.5); // blue
        else _c.setHSL(140 / 360, 0.55, 0.45);             // green

        setPart(seat, idx, x, z, ry, { x: ox, y: 0.31, z: oz });
        seat.setColorAt(idx, _c);
        setPart(seatBody, idx, x, z, ry, { x: ox, y: 0.15, z: oz });
        seatBody.setColorAt(idx, _c);
      }
    }

    return finalize(g, [tableTop, tableLeg, seat, seatBody]);
  }

  /* ====================================================================
   * lampPosts(places) — a street lamp: pole + cantilevered arm + an
   * emissive lamp head. Instanced.
   *   places: [{ x, z }]
   * Default height ≈ 5 m.
   * ================================================================== */
  function lampPosts(places) {
    const g = new T.Group();
    const n = places ? places.length : 0;

    const baseGeo = cyl(0.14, 0.2, 0.4, 10);
    const poleGeo = cyl(0.07, 0.1, 4.6, 8);
    const armGeo = cyl(0.04, 0.05, 1.0, 6);
    const headGeo = box(0.4, 0.14, 0.26);
    const bulbGeo = box(0.32, 0.05, 0.2);

    const base = imesh(baseGeo, metalDark, n, { receive: true });
    const pole = imesh(poleGeo, metalDark, n);
    const arm = imesh(armGeo, metalDark, n);
    const head = imesh(headGeo, metalDark, n);
    const bulbM = imesh(bulbGeo, bulb, n, { cast: false });

    for (let i = 0; i < n; i++) {
      const pl = places[i];
      const x = pl.x, z = pl.z;
      // Slight per-lamp yaw so the arms don't all face the same way.
      const ry = pl.ry != null ? pl.ry : rnd(i, 6) * Math.PI * 2;

      setPart(base, i, x, z, ry, { y: 0.2 });
      setPart(pole, i, x, z, ry, { y: 2.5 });
      // Arm reaching out over the carriageway (laid horizontal along +X).
      setPart(arm, i, x, z, ry, { x: 0.5, y: 4.7, rz: Math.PI / 2 });
      setPart(head, i, x, z, ry, { x: 0.95, y: 4.62 });
      setPart(bulbM, i, x, z, ry, { x: 0.95, y: 4.54 });
    }

    return finalize(g, [base, pole, arm, head, bulbM]);
  }

  /* ====================================================================
   * powerLines(poles) — leaning concrete/wood utility poles and the messy
   * DROOPING overhead WIRES strung between consecutive poles. This tangle
   * is hugely characteristic of Hanoi. `poles` is in PATH order: a wire
   * bundle is drawn from each pole to the next.
   *   poles: [{ x, z }]
   * Default pole height ≈ 7 m. Each gap gets a few catenary-sagging spans.
   * ================================================================== */
  function powerLines(poles) {
    const g = new T.Group();
    const n = poles ? poles.length : 0;

    const POLE_H = 7.0;
    const poleGeo = cyl(0.11, 0.16, POLE_H, 6);
    const crossGeo = box(1.2, 0.1, 0.1);       // crossarm
    const transformerGeo = cyl(0.18, 0.18, 0.5, 8);

    const poleM = imesh(poleGeo, concrete, n);
    const crossM = imesh(crossGeo, wood, n * 2);     // two crossarms per pole
    const xfmrM = imesh(transformerGeo, metalDark, n, { cast: true });

    // Each pole leans slightly (seeded) — store top positions for wire spans.
    const tops = new Array(n);

    for (let i = 0; i < n; i++) {
      const p = poles[i];
      const x = p.x, z = p.z;
      // Lean: small tilt in a seeded direction.
      const tilt = (rnd(i, 7) - 0.5) * 0.16;
      const tdir = rnd(i, 8) * Math.PI * 2;
      const rx = Math.cos(tdir) * tilt;
      const rz = Math.sin(tdir) * tilt;
      const ry = rnd(i, 9) * Math.PI * 2;

      // Pole centre at half height; tilt about the base => offset top a touch.
      _p.set(x, POLE_H / 2, z);
      _e.set(rx, ry, rz);
      _q.setFromEuler(_e);
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      poleM.setMatrixAt(i, _m);

      // Top of the pole (where wires attach), accounting for lean.
      const topY = POLE_H * 0.95;
      const tx = x + Math.sin(rz) * topY;   // lean displacement (approx)
      const tz = z - Math.sin(rx) * topY;
      tops[i] = new T.Vector3(tx, topY, tz);

      // Two crossarms near the top, perpendicular layout.
      setPart(crossM, i * 2 + 0, x, z, ry, { y: POLE_H - 0.7 });
      setPart(crossM, i * 2 + 1, x, z, ry, { y: POLE_H - 1.3, ry: Math.PI / 2 });

      // A boxy transformer drum on some poles.
      setPart(xfmrM, i, x, z, ry, { x: 0.22, y: POLE_H - 2.0 });
    }
    poleM.instanceMatrix.needsUpdate = true;

    // ── WIRES: between each consecutive pole, a bundle of a few wires each
    // sagging via several short cylinder spans (catenary approximation). Count
    // the spans first so we can size one InstancedMesh.
    const WIRES_PER_GAP = 4;   // bundle thickness
    const SEGS = 5;            // catenary resolution per wire
    const gaps = Math.max(0, n - 1);
    const wireCount = gaps * WIRES_PER_GAP * SEGS;
    const wireGeo = cyl(0.02, 0.02, 1, 4); // unit-length; scaled per span
    const wireM = imesh(wireGeo, wireMat, wireCount, { cast: false });

    let w = 0;
    const a = new T.Vector3();
    const b = new T.Vector3();
    const cur = new T.Vector3();
    const nxt = new T.Vector3();
    const mid = new T.Vector3();
    for (let gi = 0; gi < gaps; gi++) {
      const t0 = tops[gi];
      const t1 = tops[gi + 1];
      const span = t0.distanceTo(t1);
      const sag = Math.min(1.6, 0.18 * span + 0.4); // longer gaps droop more

      for (let wj = 0; wj < WIRES_PER_GAP; wj++) {
        // Spread the bundle: small lateral + vertical offsets per wire.
        const lat = (wj - (WIRES_PER_GAP - 1) / 2) * 0.18;
        const vof = (rnd(gi * 7 + wj, 10) - 0.5) * 0.25;
        // Perpendicular (in XZ) to the span direction for lateral spread.
        let dx = t1.x - t0.x, dz = t1.z - t0.z;
        const dl = Math.hypot(dx, dz) || 1;
        const px = -dz / dl, pz = dx / dl;

        for (let si = 0; si < SEGS; si++) {
          const u0 = si / SEGS, u1 = (si + 1) / SEGS;
          // Catenary-ish: y = lerp(top.y) minus sag*sin(pi*u) parabola.
          cur.set(
            t0.x + (t1.x - t0.x) * u0 + px * lat,
            t0.y + (t1.y - t0.y) * u0 + vof - sag * Math.sin(Math.PI * u0),
            t0.z + (t1.z - t0.z) * u0 + pz * lat,
          );
          nxt.set(
            t0.x + (t1.x - t0.x) * u1 + px * lat,
            t0.y + (t1.y - t0.y) * u1 + vof - sag * Math.sin(Math.PI * u1),
            t0.z + (t1.z - t0.z) * u1 + pz * lat,
          );
          mid.addVectors(cur, nxt).multiplyScalar(0.5);
          const len = cur.distanceTo(nxt) || 0.001;
          // Orient the +Y unit cylinder along (nxt-cur).
          b.subVectors(nxt, cur).normalize();
          _q.setFromUnitVectors(UP, b);
          _s.set(1, len, 1);
          _m.compose(mid, _q, _s);
          wireM.setMatrixAt(w++, _m);
        }
      }
    }

    return finalize(g, [poleM, crossM, xfmrM, wireM]);
  }

  /* ====================================================================
   * planters(places) — a potted plant / small tree in a tapered pot.
   * Instanced (pot + a couple of foliage blobs).
   *   places: [{ x, z }]
   * ================================================================== */
  function planters(places) {
    const g = new T.Group();
    const n = places ? places.length : 0;

    const potGeo = cyl(0.26, 0.18, 0.4, 10);
    const rimGeo = cyl(0.28, 0.28, 0.06, 10);
    const stemGeo = cyl(0.04, 0.05, 0.5, 5);
    const blobGeo = G(new T.IcosahedronGeometry(0.34, 0));

    const pot = imesh(potGeo, concrete, n, { receive: true });
    const rim = imesh(rimGeo, concrete, n);
    const stem = imesh(stemGeo, wood, n);
    const blobA = imesh(blobGeo, leaf, n, { color: true });
    const blobB = imesh(blobGeo, leaf, n, { color: true });

    for (let i = 0; i < n; i++) {
      const pl = places[i];
      const x = pl.x, z = pl.z;
      const ry = rnd(i, 11) * Math.PI * 2;
      const h = 0.85 + rnd(i, 12) * 0.6; // plant height variation

      setPart(pot, i, x, z, ry, { y: 0.2 });
      setPart(rim, i, x, z, ry, { y: 0.4 });
      setPart(stem, i, x, z, ry, { y: 0.4 + 0.25 * h, sy: h });

      // Two foliage blobs, slightly varied green.
      _c.setHSL((108 + rnd(i, 13) * 24) / 360, 0.42, 0.3 + rnd(i, 14) * 0.1);
      setPart(blobA, i, x, z, ry, { x: -0.08, y: 0.45 + 0.5 * h, z: 0.05, sx: 1.1, sy: 1.0, sz: 1.1 });
      blobA.setColorAt(i, _c);
      setPart(blobB, i, x, z, ry, { x: 0.1, y: 0.45 + 0.62 * h, z: -0.06, sx: 0.9, sy: 0.95, sz: 0.9 });
      blobB.setColorAt(i, _c);
    }

    return finalize(g, [pot, rim, stem, blobA, blobB]);
  }

  /* ====================================================================
   * hangingSigns(places) — vertical shop signboards projecting from
   * façades. A short bracket arm + a tall thin board. Instanced, colour
   * varies via instanceColor (a touch emissive so they pop).
   *   places: [{ x, z, ry, hue? }]   ry faces the board out from the wall.
   * ================================================================== */
  function hangingSigns(places) {
    const g = new T.Group();
    const n = places ? places.length : 0;

    const armGeo = cyl(0.025, 0.025, 0.5, 5);
    const boardGeo = box(0.06, 1.3, 0.42);   // tall vertical signboard
    const sign = signEmissive;               // shared (ramps with night factor)

    const arm = imesh(armGeo, metalDark, n);
    const board = imesh(boardGeo, sign, n, { color: true });

    for (let i = 0; i < n; i++) {
      const pl = places[i];
      const x = pl.x, z = pl.z, ry = pl.ry || 0;
      const y = 2.8 + rnd(i, 15) * 0.8; // mounting height on the façade

      // Bracket arm projecting out from the wall (+X local), board hanging at its end.
      setPart(arm, i, x, z, ry, { x: 0.28, y: y + 0.6, rz: Math.PI / 2 });
      setPart(board, i, x, z, ry, { x: 0.5, y });

      const hue = pl.hue != null ? pl.hue : rnd(i, 16) * 360;
      _c.setHSL(((hue % 360) + 360) % 360 / 360, 0.7, 0.5);
      board.setColorAt(i, _c);
    }

    return finalize(g, [arm, board]);
  }

  /* ====================================================================
   * awnings(places) — fabric shop awnings / tarps over shopfronts. A
   * sloped fabric panel + a hanging valance + two struts. Instanced,
   * colour varies, width via `w`.
   *   places: [{ x, z, ry, w? }]   ry orients the awning along the façade.
   * ================================================================== */
  function awnings(places) {
    const g = new T.Group();
    const n = places ? places.length : 0;
    const DEPTH = 1.2;
    const TILT = 0.32;

    // Unit-width panel (1 m), scaled per-awning by `w` along its X.
    const panelGeo = box(1, 0.04, DEPTH);
    const valGeo = box(1, 0.26, 0.04);
    const strutGeo = cyl(0.02, 0.02, DEPTH, 5);

    const panel = imesh(panelGeo, fabricTint, n, { color: true });
    const valance = imesh(valGeo, fabricTint, n, { color: true });
    const strutL = imesh(strutGeo, metalDark, n);
    const strutR = imesh(strutGeo, metalDark, n);

    const dz = (DEPTH / 2) * Math.cos(TILT);
    for (let i = 0; i < n; i++) {
      const pl = places[i];
      const x = pl.x, z = pl.z, ry = pl.ry || 0;
      const w = pl.w != null ? pl.w : 3 + rnd(i, 17) * 1.5;

      // Sloped fabric panel (tilts down toward the street, +X local face out).
      setPart(panel, i, x, z, ry, { x: 0, y: 2.5, z: dz, rx: -TILT, sx: w });
      _c.setHSL(rnd(i, 18), 0.55, 0.5);
      panel.setColorAt(i, _c);

      // Front hanging valance, a touch lighter — reuse the same tint.
      setPart(valance, i, x, z, ry, { x: 0, y: 2.34, z: DEPTH * Math.cos(TILT), sx: w });
      _c.offsetHSL(0, 0, 0.08);
      valance.setColorAt(i, _c);

      // Two struts back to the wall.
      setPart(strutL, i, x, z, ry, { x: -w / 2 + 0.2, y: 2.55, z: dz, rx: Math.PI / 2 - TILT });
      setPart(strutR, i, x, z, ry, { x: w / 2 - 0.2, y: 2.55, z: dz, rx: Math.PI / 2 - TILT });
    }

    return finalize(g, [panel, valance, strutL, strutR]);
  }

  /* ====================================================================
   * trafficLights(places) — a cheap signal: pole + a 3-lens head with
   * emissive red/amber/green lenses. Instanced.
   *   places: [{ x, z, ry }]
   * ================================================================== */
  function trafficLights(places) {
    const g = new T.Group();
    const n = places ? places.length : 0;

    const poleGeo = cyl(0.06, 0.08, 3.2, 8);
    const headGeo = box(0.28, 0.78, 0.22);
    const lensGeo = cyl(0.08, 0.08, 0.05, 8);

    const redL = M(new T.MeshStandardMaterial({ color: 0xff3322, emissive: 0xff2200, emissiveIntensity: 0.9, roughness: 0.4 }));
    const amberL = M(new T.MeshStandardMaterial({ color: 0xffbb22, emissive: 0xffaa00, emissiveIntensity: 0.5, roughness: 0.4 }));
    const greenL = M(new T.MeshStandardMaterial({ color: 0x2bd24a, emissive: 0x22cc44, emissiveIntensity: 0.5, roughness: 0.4 }));

    const pole = imesh(poleGeo, metalDark, n);
    const head = imesh(headGeo, metalDark, n);
    const red = imesh(lensGeo, redL, n, { cast: false });
    const amber = imesh(lensGeo, amberL, n, { cast: false });
    const green = imesh(lensGeo, greenL, n, { cast: false });

    for (let i = 0; i < n; i++) {
      const pl = places[i];
      const x = pl.x, z = pl.z, ry = pl.ry || 0;
      setPart(pole, i, x, z, ry, { y: 1.6 });
      setPart(head, i, x, z, ry, { x: 0.05, y: 3.3 });
      // Lenses face out along +X (rotate the disc to face outward).
      setPart(red, i, x, z, ry, { x: 0.18, y: 3.56, rz: Math.PI / 2 });
      setPart(amber, i, x, z, ry, { x: 0.18, y: 3.3, rz: Math.PI / 2 });
      setPart(green, i, x, z, ry, { x: 0.18, y: 3.04, rz: Math.PI / 2 });
    }

    return finalize(g, [pole, head, red, amber, green]);
  }

  /* ====================================================================
   * lanterns(places) — a string of warm paper lanterns (emissive) for the
   * lakeside. Instanced spheres; glow ramps via setNightFactor.
   *   places: [{ x, z, y? }]
   * ================================================================== */
  function lanterns(places) {
    const g = new T.Group();
    const n = places ? places.length : 0;
    const bodyGeo = sphere(0.18, 8, 6);
    const body = imesh(bodyGeo, lanternMat, n, { cast: false });
    for (let i = 0; i < n; i++) {
      const pl = places[i];
      setPart(body, i, pl.x, pl.z, 0, { y: pl.y != null ? pl.y : 4.2, sy: 1.25 });
    }
    return finalize(g, [body]);
  }

  /* ====================================================================
   * bicycles(places) — parked pushbikes leaning along the curb. Instanced,
   * slimmer than a motorbike: two thin wheels, frame bar, seat, handlebars.
   *   places: [{ x, z, ry }]
   * ================================================================== */
  function bicycles(places) {
    const g = new T.Group();
    const n = places ? places.length : 0;
    const wheelGeo = cyl(0.32, 0.32, 0.04, 14);
    const frameGeo = box(0.9, 0.05, 0.05);
    const seatGeo = box(0.18, 0.06, 0.1);
    const barGeo = cyl(0.02, 0.02, 0.44, 6);
    const wheels = imesh(wheelGeo, rubber, n * 2, { color: false });
    const frame = imesh(frameGeo, metalDark, n, { color: true });
    const seat = imesh(seatGeo, rubber, n, { color: false });
    const bars = imesh(barGeo, chrome, n, { color: false });
    for (let i = 0; i < n; i++) {
      const pl = places[i]; const x = pl.x, z = pl.z, ry = pl.ry || 0;
      const lean = (rnd(i, 21) - 0.5) * 0.18;
      setPart(wheels, i * 2 + 0, x, z, ry, { x: -0.5, y: 0.32, z: 0, rx: Math.PI / 2, rz: lean });
      setPart(wheels, i * 2 + 1, x, z, ry, { x: 0.5, y: 0.32, z: 0, rx: Math.PI / 2, rz: lean });
      setPart(frame, i, x, z, ry, { x: 0, y: 0.5, z: 0, rz: lean });
      _c.setHSL(rnd(i, 22), 0.45, 0.45); frame.setColorAt(i, _c);
      setPart(seat, i, x, z, ry, { x: -0.32, y: 0.74, z: 0 });
      setPart(bars, i, x, z, ry, { x: 0.5, y: 0.84, z: 0, rx: Math.PI / 2 });
    }
    return finalize(g, [wheels, frame, seat, bars]);
  }

  /* ====================================================================
   * vendors(places) — shoulder-pole street vendor (gánh hàng rong): a
   * standing figure with a nón lá, a shoulder pole, and two hanging baskets.
   *   places: [{ x, z, ry }]
   * ================================================================== */
  function vendors(places) {
    const g = new T.Group();
    const n = places ? places.length : 0;
    const bodyGeo = cyl(0.16, 0.2, 0.95, 8);
    const headGeo = sphere(0.13, 8, 6);
    const hatGeo = cone(0.32, 0.22, 12);      // nón lá
    const poleGeo = cyl(0.02, 0.02, 1.5, 5);
    const basketGeo = cyl(0.26, 0.18, 0.22, 10);
    const body = imesh(bodyGeo, clothTint, n, { color: true });
    const head = imesh(headGeo, skin, n, { color: false });
    const hat = imesh(hatGeo, woodLight, n, { color: false });
    const pole = imesh(poleGeo, wood, n, { color: false });
    const baskets = imesh(basketGeo, woodLight, n * 2, { color: false });
    for (let i = 0; i < n; i++) {
      const pl = places[i]; const x = pl.x, z = pl.z, ry = pl.ry || 0;
      setPart(body, i, x, z, ry, { y: 0.78 }); _c.setHSL(0.08, 0.2, 0.55); body.setColorAt(i, _c);
      setPart(head, i, x, z, ry, { y: 1.4 });
      setPart(hat, i, x, z, ry, { y: 1.52 });
      setPart(pole, i, x, z, ry, { y: 1.32, rz: Math.PI / 2 });   // pole across the shoulders (along X)
      setPart(baskets, i * 2 + 0, x, z, ry, { x: -0.7, y: 0.7 });
      setPart(baskets, i * 2 + 1, x, z, ry, { x: 0.7, y: 0.7 });
    }
    return finalize(g, [body, head, hat, pole, baskets]);
  }

  /* ====================================================================
   * flags(places) — Vietnamese flag (cờ đỏ sao vàng) on a pole jutting from a
   * façade; the cloth flutters in the wind (setWind drives it).
   *   places: [{ x, z, ry }]   ry faces the flag out from the wall (+X local).
   * ================================================================== */
  function flags(places) {
    const g = new T.Group();
    const n = places ? places.length : 0;
    const poleGeo = cyl(0.025, 0.025, 1.2, 5);
    const flagGeo = G(new T.PlaneGeometry(0.9, 0.55, 10, 2));
    const pole = imesh(poleGeo, metalDark, n, { color: false });
    const flag = imesh(flagGeo, flagMat, n, { color: false, cast: false });
    for (let i = 0; i < n; i++) {
      const pl = places[i]; const x = pl.x, z = pl.z, ry = pl.ry || 0;
      const y = 3.2 + rnd(i, 30) * 0.7;          // mount height on the façade
      setPart(pole, i, x, z, ry, { x: 0.12, y, rz: -0.5 });      // pole tilts up-and-out
      setPart(flag, i, x, z, ry, { x: 0.62, y: y + 0.46 });      // cloth hangs from the pole
    }
    return finalize(g, [pole, flag]);
  }

  /* ====================================================================
   * kumquat(places) — a potted ornamental tree / cây cảnh: terracotta pot, a
   * green canopy and a scatter of small orange kumquats. Instanced.
   *   places: [{ x, z }]
   * ================================================================== */
  function kumquat(places) {
    const g = new T.Group();
    const n = places ? places.length : 0;
    const FRUIT = 7;
    const potGeo = cyl(0.28, 0.2, 0.4, 10);
    const canopyGeo = sphere(0.42, 8, 6);
    const fruitGeo = sphere(0.06, 5, 4);
    const pot = imesh(potGeo, terracotta, n, { receive: true });
    const canopy = imesh(canopyGeo, leaf, n, { color: true });
    const fruit = imesh(fruitGeo, fruitOrange, n * FRUIT, { color: false });
    for (let i = 0; i < n; i++) {
      const pl = places[i]; const x = pl.x, z = pl.z;
      const ry = rnd(i, 31) * Math.PI * 2;
      const h = 0.9 + rnd(i, 32) * 0.5;
      setPart(pot, i, x, z, ry, { y: 0.2 });
      setPart(canopy, i, x, z, ry, { y: 0.4 + 0.5 * h, sy: h });
      _c.setHSL((110 + rnd(i, 33) * 16) / 360, 0.5, 0.3); canopy.setColorAt(i, _c);
      for (let k = 0; k < FRUIT; k++) {
        const a = (k / FRUIT) * Math.PI * 2;
        setPart(fruit, i * FRUIT + k, x, z, ry, { x: Math.cos(a) * 0.32, y: 0.5 + 0.5 * h + Math.sin(k * 1.7) * 0.14, z: Math.sin(a) * 0.32 });
      }
    }
    return finalize(g, [pot, canopy, fruit]);
  }

  /* ====================================================================
   * birdcages(places) — a hanging songbird cage (very Hanoi café detail): a
   * small brass cage, domed top, a hook, and a tiny bird. Instanced.
   *   places: [{ x, z, ry, y? }]
   * ================================================================== */
  function birdcages(places) {
    const g = new T.Group();
    const n = places ? places.length : 0;
    const cageGeo = cyl(0.16, 0.16, 0.34, 8);
    const domeGeo = sphere(0.16, 8, 4);
    const hookGeo = cyl(0.012, 0.012, 0.18, 4);
    const birdGeo = sphere(0.06, 6, 4);
    const cage = imesh(cageGeo, cageBrass, n, { cast: false });
    const dome = imesh(domeGeo, cageBrass, n, { cast: false });
    const hook = imesh(hookGeo, metalDark, n, { cast: false });
    const bird = imesh(birdGeo, rubber, n, { cast: false });
    for (let i = 0; i < n; i++) {
      const pl = places[i]; const x = pl.x, z = pl.z, ry = pl.ry || 0;
      const y = pl.y != null ? pl.y : 2.6;
      setPart(hook, i, x, z, ry, { x: 0.0, y: y + 0.27 });
      setPart(cage, i, x, z, ry, { x: 0.0, y });
      setPart(dome, i, x, z, ry, { x: 0.0, y: y + 0.17, sy: 0.5 });
      setPart(bird, i, x, z, ry, { x: 0.03, y: y - 0.02 });
    }
    return finalize(g, [hook, cage, dome, bird]);
  }

  /* ====================================================================
   * banners(places) — a vertical red propaganda banner (băng rôn) with a yellow
   * band, hung flush on a façade. Instanced.
   *   places: [{ x, z, ry }]   ry faces the banner out from the wall.
   * ================================================================== */
  function banners(places) {
    const g = new T.Group();
    const n = places ? places.length : 0;
    const panelGeo = box(0.04, 1.6, 0.7);
    const stripeGeo = box(0.045, 0.18, 0.72);
    const panel = imesh(panelGeo, bannerRed, n, { cast: false });
    const stripe = imesh(stripeGeo, bannerYellow, n, { cast: false });
    for (let i = 0; i < n; i++) {
      const pl = places[i]; const x = pl.x, z = pl.z, ry = pl.ry || 0;
      const y = 2.8 + rnd(i, 40) * 0.6;
      setPart(panel, i, x, z, ry, { x: 0.06, y });
      setPart(stripe, i, x, z, ry, { x: 0.07, y: y + 0.32 });
    }
    return finalize(g, [panel, stripe]);
  }

  /* ------------------------------ dispose ------------------------------- */
  /** Free EVERY geometry & material this module allocated. */
  function dispose() {
    for (const gm of geoms) { try { gm.dispose(); } catch (_) {} }
    for (const mt of mats) { try { mt.dispose(); } catch (_) {} }
    geoms.length = 0;
    mats.length = 0;
  }

  return {
    motorbikes,
    people,
    stalls,
    cafes,
    lampPosts,
    powerLines,
    planters,
    hangingSigns,
    awnings,
    trafficLights,
    lanterns,
    bicycles,
    vendors,
    flags,
    kumquat,
    birdcages,
    banners,
    setNightFactor,
    setWind,
    dispose,
  };
}
