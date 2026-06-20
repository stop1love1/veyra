// @ts-nocheck -- Hoan Kiem AMBIENCE: weeping willows, koi, fireflies.
//
// hanoiAmbience.ts — the moving "soul" of the lake that static geometry can't give:
//   • weeping WILLOWS leaning over the jade water, fronds swaying in the wind,
//   • a few KOI gliding just on the jade surface (with expanding ripples),
//   • warm FIREFLIES / lantern-motes along the shore at night.
// (A drifting MIST point-cloud was removed: from above its sparse sprites read as
//  scattered bright dots on the water rather than continuous fog.)
//
//   createHanoiAmbience(THREE?, { quality }) -> {
//     build({ scene, lakeCx, lakeCz, lakeR, lakeNorthZ }),
//     update(t, dt, { camPos, windAmt, windDir, night }),
//     dispose(),
//   }
//
// ALL procedural — no external assets. Mirrors hanoiItems.ts conventions: the module
// owns every geometry / material / texture it allocates and frees them in dispose();
// the root objects it adds to the scene are tracked and removed too. Tier-aware: the
// heavier point clouds scale down (or off) on mid/low so the budget stays balanced.
// 1 world unit ≈ 1 metre.

import * as THREE from 'three';

export function createHanoiAmbience(THREEarg, { quality } = {}) {
  const T = THREEarg || THREE;
  const q = quality || {};
  const tier = q.tier || 'mid';

  // ── Resource tracking (exhaustive dispose) ──────────────────────────────
  const geoms = [], mats = [], texes = [], roots = [];
  const G = (g) => { geoms.push(g); return g; };
  const M = (m) => { mats.push(m); return m; };
  const X = (t) => { texes.push(t); return t; };

  // Scratch objects (no per-frame allocation).
  const _m = new T.Matrix4(), _p = new T.Vector3(), _qt = new T.Quaternion(), _s = new T.Vector3();
  const UP = new T.Vector3(0, 1, 0);
  const rnd = (i, salt = 0) => { const s = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453; return s - Math.floor(s); };

  // Soft radial sprite (white core → transparent edge) for the firefly motes.
  function softSprite(size = 64) {
    const c = (typeof document !== 'undefined') ? document.createElement('canvas') : new OffscreenCanvas(size, size);
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    const tex = new T.CanvasTexture(c); tex.needsUpdate = true;
    return X(tex);
  }

  // ── Live effect state (filled by build, read by update) ──────────────────
  let koi = null;           // { mesh, n, params, y }
  let ripples = null;       // { meshes, st, spawnAcc, counter } — expanding rings behind the koi
  let fireflies = null;     // { pts, mat }
  let willows = null;       // { count } — geometry is static; fronds sway via shader

  // Shared wind-sway uniforms for the weeping-willow fronds (updated each frame).
  const swayU = { uTime: { value: 0 }, uWind: { value: 0 }, uWindDir: { value: 0 } };
  function build(ctx) {
    const { scene } = ctx;
    const lakeCx = ctx.lakeCx || 0, lakeCz = ctx.lakeCz || 0;
    const lakeR = ctx.lakeR || 110, lakeNorthZ = ctx.lakeNorthZ ?? (lakeCz - lakeR);
    const lakePoly = ctx.lakePoly || null;       // real shore polygon (for willow placement)
    const circles = ctx.circles || null;          // collision sink (willow trunks)
    const sprite = softSprite();

    // ── 2. WEEPING WILLOWS along the shore (cây liễu rủ) ─────────────────
    // The signature of Hoan Kiem: willows leaning over the jade water, long fronds
    // drooping to the surface and swaying in the wind. Sampled along the REAL shore
    // polygon, set just on the land side, leaning toward the lake. Trunk + canopy +
    // a curtain of frond strips, each part ONE InstancedMesh (≈3 draw calls total).
    // Fronds sway via a vertex shader (free) driven by the shared swayU uniforms.
    if (lakePoly && lakePoly.length >= 3) {
      // Sample shore points at a tier-dependent spacing.
      const spacing = tier === 'high' ? 17 : tier === 'mid' ? 24 : 38;
      const spots = [];
      const n = lakePoly.length;
      for (let i = 0; i < n; i++) {
        const p = lakePoly[i], nx = lakePoly[(i + 1) % n];
        const segLen = Math.hypot(nx[0] - p[0], nx[1] - p[1]);
        const steps = Math.max(1, Math.round(segLen / spacing));
        for (let s = 0; s < steps; s++) {
          const tt = s / steps;
          const x = p[0] + (nx[0] - p[0]) * tt, z = p[1] + (nx[1] - p[1]) * tt;
          // Skip the north bridge mouth (kept clear, like the lake collision fence).
          if (Math.abs(x - lakeCx) < 6 && z > lakeNorthZ - 4 && z < lakeNorthZ + 12) continue;
          const ux = x - lakeCx, uz = z - lakeCz, ul = Math.hypot(ux, uz) || 1;
          // Trunk sits ~4 m onto the land side of the rim; canopy leans back over water.
          spots.push({ x: x + (ux / ul) * 4, z: z + (uz / ul) * 4, inx: -ux / ul, inz: -uz / ul });
        }
      }
      const W = spots.length;
      if (W > 0) {
        const FR = tier === 'high' ? 12 : tier === 'mid' ? 9 : 6;   // fronds per willow

        // Materials: bark trunk + willow-green canopy/fronds.
        const barkMat = M(new T.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.92, metalness: 0 }));
        const canopyMat = M(new T.MeshStandardMaterial({ color: 0x7d9a4c, roughness: 0.92, metalness: 0, flatShading: true }));
        // Physical (not Standard) + specularIntensity:0: the fronds are flat planes
        // drooping over the bright jade water, so Standard's full grazing Fresnel would
        // mirror the sky into a glassy pane. Zeroing specular keeps them matte green.
        const frondMat = M(new T.MeshPhysicalMaterial({ color: 0x82a449, roughness: 0.94, metalness: 0, specularIntensity: 0, side: T.DoubleSide }));
        // Frond sway: displace by how far BELOW the attach point the vertex hangs, so
        // the tips swing while the top stays put. Phase varies by instance position.
        frondMat.onBeforeCompile = (sh) => {
          sh.uniforms.uTime = swayU.uTime; sh.uniforms.uWind = swayU.uWind; sh.uniforms.uWindDir = swayU.uWindDir;
          sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\nuniform float uWindDir;\n' + sh.vertexShader;
          sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>',
            `#include <begin_vertex>
             float droop = max(-position.y, 0.0);
             float phase = instanceMatrix[3].x * 0.12 + instanceMatrix[3].z * 0.12;
             float amt = sin(uTime * 1.4 + phase) * (0.05 + uWind * 0.22) * droop;
             transformed.x += cos(uWindDir) * amt;
             transformed.z += sin(uWindDir) * amt;`);
          frondMat.userData.shader = sh;
        };

        // Geometry: leaning trunk (~3.4 m), two canopy blobs, a frond strip whose
        // pivot is its TOP (translated down so position.y ∈ [-len, 0]).
        const trunkGeo = G(new T.CylinderGeometry(0.16, 0.26, 3.4, 7));
        const blobGeo = G(new T.IcosahedronGeometry(1.5, 1));
        const frondLen = 3.6;          // longer, more graceful drooping strands
        const frondGeo = G(new T.PlaneGeometry(0.13, frondLen).translate(0, -frondLen / 2, 0));

        const trunks = new T.InstancedMesh(trunkGeo, barkMat, W);
        const blobs = new T.InstancedMesh(blobGeo, canopyMat, W * 2);
        const fronds = new T.InstancedMesh(frondGeo, frondMat, W * FR);
        trunks.castShadow = true; trunks.receiveShadow = false; trunks.frustumCulled = false;
        blobs.castShadow = true; blobs.frustumCulled = false;
        fronds.castShadow = false; fronds.frustumCulled = false;

        const _e = new T.Euler();
        const TOP = 3.4;                 // canopy attach height
        for (let i = 0; i < W; i++) {
          const sp = spots[i];
          const wsz = 0.85 + rnd(i, 28) * 0.45;        // per-willow size variation
          const lean = 0.18 + rnd(i, 29) * 0.12;       // varied lean toward the water
          const yaw = Math.atan2(sp.inx, sp.inz);      // face the lake (inward normal)
          const top = TOP * wsz;

          // Trunk: leaning toward the water, base at ground, height varies per tree.
          _e.set(Math.cos(yaw) * lean, 0, Math.sin(yaw) * lean);
          _qt.setFromEuler(_e);
          _p.set(sp.x, top / 2, sp.z); _s.set(1, wsz, 1);
          _m.compose(_p, _qt, _s); trunks.setMatrixAt(i, _m);

          // Canopy centre, pushed a little out over the water along the lean.
          const cxw = sp.x + sp.inx * 1.4, czw = sp.z + sp.inz * 1.4, cyw = top + 0.6;
          _qt.identity();
          _p.set(cxw, cyw, czw); _s.set(1.3 * wsz, 0.9 * wsz, 1.3 * wsz); _m.compose(_p, _qt, _s); blobs.setMatrixAt(i * 2, _m);
          _p.set(cxw + sp.inx * 0.8, cyw + 0.5, czw + sp.inz * 0.8); _s.set(1.0 * wsz, 0.8 * wsz, 1.0 * wsz); _m.compose(_p, _qt, _s); blobs.setMatrixAt(i * 2 + 1, _m);

          // Fronds: a curtain hanging from the canopy rim, drooping toward the water.
          for (let f = 0; f < FR; f++) {
            const a = (f / FR) * Math.PI * 2 + rnd(i * 7 + f, 23);
            const rr = 1.0 + rnd(i + f, 24) * 1.1;
            const fx = cxw + Math.cos(a) * rr + sp.inx * 0.4;
            const fz = czw + Math.sin(a) * rr + sp.inz * 0.4;
            const fy = cyw + 0.2 + rnd(i * 3 + f, 25) * 0.4;
            const fscl = 0.7 + rnd(i + f * 2, 26) * 0.6;
            // Slight outward tilt so fronds splay over the surface, plus random yaw.
            _e.set(sp.inx * 0.18, rnd(i + f, 27) * Math.PI, sp.inz * 0.18);
            _qt.setFromEuler(_e);
            _p.set(fx, fy, fz); _s.set(1, fscl, 1); _m.compose(_p, _qt, _s);
            fronds.setMatrixAt(i * FR + f, _m);
          }

          // Trunk collision so the player can't walk through it.
          if (circles) circles.push({ x: sp.x, z: sp.z, r: 0.7 });
        }
        trunks.instanceMatrix.needsUpdate = true; blobs.instanceMatrix.needsUpdate = true; fronds.instanceMatrix.needsUpdate = true;
        for (const im of [trunks, blobs, fronds]) { im.matrixAutoUpdate = false; im.updateMatrix(); scene.add(im); roots.push(im); }
        willows = { count: W };
      }
    }

    // ── 3. KOI on the jade surface ───────────────────────────────────────
    // Point-in-polygon so fish stay on the real water (never swim onto the shore).
    const inWater = (x, z) => {
      if (!lakePoly) return Math.hypot(x - lakeCx, z - lakeCz) < lakeR * 0.85;
      let inside = false;
      for (let a = 0, b = lakePoly.length - 1; a < lakePoly.length; b = a++) {
        const xi = lakePoly[a][0], zi = lakePoly[a][1], xj = lakePoly[b][0], zj = lakePoly[b][1];
        if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
      }
      return inside;
    };
    const koiN = tier === 'high' ? 48 : tier === 'mid' ? 30 : 16;
    if (koiN > 0) {
      // Flat fish silhouette (seen from above): a tapered body + a forked tail.
      const sh = new T.Shape();
      sh.moveTo(0.6, 0);                 // nose
      sh.quadraticCurveTo(0.2, 0.18, -0.25, 0.12);
      sh.lineTo(-0.5, 0.22);             // tail upper fork
      sh.lineTo(-0.4, 0);
      sh.lineTo(-0.5, -0.22);            // tail lower fork
      sh.lineTo(-0.25, -0.12);
      sh.quadraticCurveTo(0.2, -0.18, 0.6, 0);
      const geo = G(new T.ShapeGeometry(sh));
      geo.rotateX(-Math.PI / 2);         // lay flat in XZ (fish viewed from above)
      const mat = M(new T.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.55, metalness: 0.0, side: T.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      }));
      const mesh = new T.InstancedMesh(geo, mat, koiN);
      mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.renderOrder = 4;              // sit above the Water surface (renderOrder 1)
      if (mesh.instanceColor === null) mesh.instanceColor = new T.InstancedBufferAttribute(new Float32Array(koiN * 3), 3);
      const _c = new T.Color();
      const params = [];
      for (let i = 0; i < koiN; i++) {
        // Find a centre + slow-loop radius that stays fully inside the water, spread
        // across the WHOLE lake (not one cluster). Retry with varied seeds; shrink the
        // orbit on the last tries; fall back near the centroid if the lake is tiny.
        let cx = lakeCx, cz = lakeCz, orbit = 6, ok = false;
        for (let tr = 0; tr < 48 && !ok; tr++) {
          const ang = rnd(i, 50 + tr) * Math.PI * 2;
          const dist = Math.sqrt(rnd(i, 90 + tr)) * lakeR * 0.78;
          cx = lakeCx + Math.cos(ang) * dist;
          cz = lakeCz + Math.sin(ang) * dist;
          orbit = (3 + rnd(i, 140 + tr) * 9) * (tr < 36 ? 1 : 0.4);
          // Avoid the north bridge/island mouth; require the orbit ring to be in water.
          if (cz < lakeNorthZ + 22 && Math.abs(cx - lakeCx) < 10) continue;
          if (inWater(cx, cz) && inWater(cx + orbit, cz) && inWater(cx - orbit, cz)
              && inWater(cx, cz + orbit) && inWater(cx, cz - orbit)) ok = true;
        }
        const a = rnd(i, 11) * Math.PI * 2;
        params.push({
          cx, cz, r: orbit,
          sp: (0.1 + rnd(i, 15) * 0.18) * (rnd(i, 16) < 0.5 ? 1 : -1),
          ph: a, scl: 1.1 + rnd(i, 17) * 1.0,         // ~1.2–2.3 m: visible from the shore
        });
        // Koi colours: orange, white, calico (orange+white reads as light orange).
        const t = rnd(i, 18);
        if (t < 0.45) _c.setHSL(26 / 360, 0.85, 0.55);      // orange
        else if (t < 0.72) _c.setHSL(0, 0, 0.95);           // white
        else _c.setHSL(20 / 360, 0.6, 0.62);                // pale calico
        mesh.setColorAt(i, _c);
      }
      mesh.instanceColor.needsUpdate = true;
      scene.add(mesh); roots.push(mesh);
      koi = { mesh, n: koiN, params, y: 0.22 };   // just above the jade surface

      // ── 3b. KOI RIPPLES — soft rings that expand + fade where fish surface ──
      // A small pool of flat ring meshes (own material each → per-ring opacity).
      // update() spawns them at live koi positions, so the wake follows the fish.
      const RN = tier === 'high' ? 16 : 12;
      const ringGeo = G(new T.RingGeometry(0.5, 0.62, 24));
      ringGeo.rotateX(-Math.PI / 2);              // lie flat on the water
      const meshes = [], st = [];
      for (let i = 0; i < RN; i++) {
        const rm = M(new T.MeshBasicMaterial({
          color: 0xbfe0d8, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide, fog: false,
        }));
        const rip = new T.Mesh(ringGeo, rm);
        rip.renderOrder = 4; rip.visible = false; rip.frustumCulled = false;
        scene.add(rip); roots.push(rip);
        meshes.push(rip); st.push({ active: false, age: 0, life: 1.5 });
      }
      ripples = { meshes, st, spawnAcc: 0, counter: 0 };
    }

    // ── 4. FIREFLIES / lantern motes along the north shore at night ──────
    if (tier !== 'low') {
      const N = tier === 'high' ? 90 : 50;
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        // Cluster near the lantern-strung north shore, a few scattered wider.
        const a = -Math.PI / 2 + (rnd(i, 19) - 0.5) * 1.8;
        const rr = lakeR * (0.7 + rnd(i, 20) * 0.35);
        pos[i * 3] = lakeCx + Math.cos(a) * rr;
        pos[i * 3 + 1] = 1.0 + rnd(i, 21) * 4.0;
        pos[i * 3 + 2] = (lakeNorthZ - 4) + Math.sin(a) * rr * 0.25 + rnd(i, 22) * 6;
      }
      const geo = G(new T.BufferGeometry());
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      const mat = M(new T.PointsMaterial({
        map: sprite, color: 0xffe1a0, size: 0.7, sizeAttenuation: true,
        transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, fog: false,
      }));
      const pts = new T.Points(geo, mat);
      pts.position.set(0, 0, 0);
      pts.frustumCulled = false; pts.renderOrder = 5;
      scene.add(pts); roots.push(pts);
      fireflies = { pts, mat };
    }
  }

  // ── Per-frame update ──────────────────────────────────────────────────
  function update(t, dt, ctx) {
    const windAmt = ctx && ctx.windAmt ? ctx.windAmt : 0;
    const windDir = ctx && ctx.windDir ? ctx.windDir : 0;
    const night = Math.max(0, Math.min(1, ctx && ctx.night != null ? ctx.night : 0));

    // 2. WILLOWS: drive the frond-sway shader (cheap — three uniform writes).
    if (willows) {
      swayU.uTime.value = t;
      swayU.uWind.value = windAmt;
      swayU.uWindDir.value = windDir;
    }

    // 3. KOI: glide along slow loops, tail-waggle via an oscillating heading.
    if (koi) {
      const P = koi.params;
      for (let i = 0; i < koi.n; i++) {
        const p = P[i];
        const ang = t * p.sp + p.ph;
        const x = p.cx + Math.cos(ang) * p.r;
        const z = p.cz + Math.sin(ang) * p.r;
        // Heading = tangent to the loop, plus a small waggle so the body wiggles.
        const head = ang + (p.sp > 0 ? Math.PI / 2 : -Math.PI / 2) + Math.sin(t * 6 + p.ph) * 0.18;
        _p.set(x, koi.y, z);
        _qt.setFromAxisAngle(UP, head);
        _s.set(p.scl, p.scl, p.scl);
        _m.compose(_p, _qt, _s);
        koi.mesh.setMatrixAt(i, _m);
      }
      koi.mesh.instanceMatrix.needsUpdate = true;
    }

    // 3b. KOI RIPPLES: periodically spawn an expanding ring at a live koi position
    // (rotating through the school so wakes follow the fish), then grow + fade it.
    if (ripples && koi) {
      ripples.spawnAcc += dt;
      const interval = 0.3;
      while (ripples.spawnAcc > interval) {
        ripples.spawnAcc -= interval;
        const idx = ripples.st.findIndex((s) => !s.active);
        if (idx < 0) break;
        const p = koi.params[(ripples.counter++) % koi.n];
        const ang = t * p.sp + p.ph;
        const x = p.cx + Math.cos(ang) * p.r, z = p.cz + Math.sin(ang) * p.r;
        const s = ripples.st[idx];
        s.active = true; s.age = 0; s.life = 1.4 + (idx % 3) * 0.25;
        const rip = ripples.meshes[idx];
        rip.position.set(x, koi.y - 0.03, z); rip.visible = true;
      }
      for (let i = 0; i < ripples.st.length; i++) {
        const s = ripples.st[i]; if (!s.active) continue;
        s.age += dt; const tt = s.age / s.life;
        const rip = ripples.meshes[i];
        if (tt >= 1) { s.active = false; rip.visible = false; continue; }
        const sc = 0.5 + tt * 3.2;
        rip.scale.set(sc, sc, sc);
        rip.material.opacity = (1 - tt) * 0.32;
      }
    }

    // 4. FIREFLIES: appear at night, gently twinkle + drift (cheap object spin).
    if (fireflies) {
      fireflies.pts.rotation.y = Math.sin(t * 0.05) * 0.12;
      fireflies.mat.opacity = night * (0.55 + 0.45 * Math.sin(t * 2.0));
    }
  }

  function dispose() {
    for (const r of roots) {
      if (r.isInstancedMesh && r.dispose) { try { r.dispose(); } catch (_) {} }  // frees instance buffers
      if (r.parent) r.parent.remove(r);
    }
    roots.length = 0;
    for (const g of geoms) { try { g.dispose(); } catch (_) {} }
    for (const m of mats) { try { m.dispose(); } catch (_) {} }
    for (const x of texes) { try { x.dispose(); } catch (_) {} }
    geoms.length = 0; mats.length = 0; texes.length = 0;
    koi = ripples = fireflies = willows = null;
  }

  return { build, update, dispose };
}
