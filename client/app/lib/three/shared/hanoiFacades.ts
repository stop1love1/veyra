// @ts-nocheck -- procedural Hanoi façade material library (canvas-generated PBR).
//
// createHanoiFacades(THREE) → tileable wall materials + roof detail toppers that
// turn the ~2000 extruded OSM building prisms in worldHanoi.ts into something that
// reads like a REAL Hanoi street: Old-Quarter tube houses, French-colonial
// shophouses, modern mini-hotels and plain rendered blocks — instead of flat
// painted blocks. Everything is generated ONCE on a <canvas> (no external assets,
// no network) and SHARED across every building, so the merged-by-material city
// still costs ~14 draw calls.
//
//  ── How the integration uses this ──────────────────────────────────────────
//  Each wall face is UV-mapped in METRES: u = horizontal distance along the wall,
//  v = height above ground. The integration sets every map's
//      wrapS = wrapT = THREE.RepeatWrapping
//      repeat = (1 / tileWidth, 1 / tileHeight)
//  so one texture tile spans `tileWidth` m across and `tileHeight` m up. Therefore
//  EVERY texture here is authored to tile SEAMLESSLY in both axes over that patch:
//    • tileWidth  = 4   m  → one structural "bay" (one window column) per tile
//    • tileHeight = 9.9 m  → 3 residential floors @ 3.3 m
//  The bottom-most tile of a wall is the GROUND FLOOR; because v starts at 0 at the
//  pavement, the ground-floor shopfront row of each texture lands exactly on the
//  street. (The vertical motif repeats every 3 floors, which on a real tube house
//  is visually fine — upper floors genuinely do repeat.)
//
//  ── Exports ─────────────────────────────────────────────────────────────────
//    createHanoiFacades(THREE) → {
//      tileWidth, tileHeight,                     // metres per texture tile
//      materials,                                 // ~14 MeshStandardMaterial
//      pickVariant(seed01, heightMeters),         // → index into materials
//      buildRoofDetail(footprintPoly, h, seed01), // → THREE.Object3D | null
//      dispose(),
//    }
//
// 1 world unit ≈ 1 metre. Style matches shared/materials.ts (canvas noise, sRGB
// albedo/emissive, high anisotropy, mipmaps, MeshStandardMaterial).

import * as THREE from 'three';

/* ============================ deterministic rng =========================== */

/** Mulberry32 — tiny seeded PRNG so every texture/topper is reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================ canvas helpers ============================== */

const TILE_W_PX = 256; // texture width  (one 4 m bay)
const TILE_H_PX = 512; // texture height (one 9.9 m / 3-floor stack)

/** Allocate a w×h 2D canvas (OffscreenCanvas when available). */
function makeCanvas(w, h) {
  const c =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : (typeof document !== 'undefined'
          ? document.createElement('canvas')
          : new OffscreenCanvas(w, h));
  c.width = w;
  c.height = h;
  return c;
}

/** css rgb() string from 0..1 rgb. */
function rgb(r, g, b) {
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

/** Lighten/darken a THREE.Color by `f` (>0 lighten toward white, <0 darken). */
function shade(col, f) {
  const c = col.clone();
  if (f >= 0) {
    c.r += (1 - c.r) * f;
    c.g += (1 - c.g) * f;
    c.b += (1 - c.b) * f;
  } else {
    const k = 1 + f;
    c.r *= k;
    c.g *= k;
    c.b *= k;
  }
  return c;
}

/**
 * Sprinkle seamless, wrap-aware grime/plaster grain over the whole canvas. Uses
 * the rng so it's deterministic. Speckles that fall off an edge are re-drawn on
 * the opposite edge so the result tiles.
 */
function grain(ctx, w, h, rng, amount, dark) {
  ctx.save();
  for (let i = 0; i < amount; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = 0.5 + rng() * 1.8;
    const a = 0.04 + rng() * 0.10;
    ctx.fillStyle = dark
      ? `rgba(0,0,0,${a})`
      : `rgba(255,255,255,${a * 0.8})`;
    for (const ox of [0, -w, w]) {
      for (const oy of [0, -h, h]) {
        if (x + ox > -4 && x + ox < w + 4 && y + oy > -4 && y + oy < h + 4) {
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  ctx.restore();
}

/** Vertical weathering streaks (rain/dirt running down) — wraps horizontally. */
function streaks(ctx, w, h, rng, count) {
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = rng() * w;
    const y0 = rng() * h * 0.5;
    const len = h * (0.3 + rng() * 0.6);
    const wpx = 1 + rng() * 3;
    const a = 0.04 + rng() * 0.07;
    const grad = ctx.createLinearGradient(0, y0, 0, y0 + len);
    grad.addColorStop(0, `rgba(0,0,0,0)`);
    grad.addColorStop(0.4, `rgba(20,16,10,${a})`);
    grad.addColorStop(1, `rgba(20,16,10,0)`);
    ctx.fillStyle = grad;
    for (const ox of [0, -w, w]) ctx.fillRect(x + ox - wpx / 2, y0, wpx, len);
  }
  ctx.restore();
}

/* ============================ feature painters =========================== */
// All coordinates below are in PIXELS within ONE tile (TILE_W_PX × TILE_H_PX).
// A tile = one 4 m bay wide × 9.9 m (3 floors) tall. Floor pixel height:
const FLOOR_PX = TILE_H_PX / 3; // ≈ 170.7 px per 3.3 m floor.

/** A small AC condenser box clinging to the wall. */
function paintAC(ctx, x, y, rng) {
  const w = 22 + rng() * 8;
  const h = 14 + rng() * 5;
  ctx.fillStyle = rgb(0.82, 0.82, 0.8);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  // louver grille
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  for (let i = 3; i < h - 2; i += 3) {
    ctx.beginPath();
    ctx.moveTo(x + 3, y + i);
    ctx.lineTo(x + w - 3, y + i);
    ctx.stroke();
  }
  // drip stain below
  const g = ctx.createLinearGradient(0, y + h, 0, y + h + 40);
  g.addColorStop(0, 'rgba(30,25,18,0.16)');
  g.addColorStop(1, 'rgba(30,25,18,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x + w * 0.3, y + h, w * 0.4, 40);
}

/**
 * A shuttered residential window with a small juliet balcony/railing. Returns
 * the lit colour decision (for the emissive pass to mirror exactly).
 */
function paintTubeWindow(ctx, cx, top, ww, wh, frameCol, shutterCol, rng, lit) {
  // recessed reveal
  ctx.fillStyle = rgb(shade(frameCol, -0.45).r, shade(frameCol, -0.45).g, shade(frameCol, -0.45).b);
  ctx.fillRect(cx - ww / 2 - 3, top - 3, ww + 6, wh + 6);
  // glass (dark) — lit handled in emissive pass; here just a dark pane
  ctx.fillStyle = lit ? rgb(0.92, 0.82, 0.55) : rgb(0.10, 0.12, 0.14);
  ctx.fillRect(cx - ww / 2, top, ww, wh);
  // window frame cross
  ctx.strokeStyle = rgb(frameCol.r, frameCol.g, frameCol.b);
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - ww / 2, top, ww, wh);
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx, top + wh);
  ctx.stroke();
  // louvered shutters folded to each side
  const sw = ww * 0.28;
  for (const sx of [cx - ww / 2 - sw + 2, cx + ww / 2 - 2]) {
    ctx.fillStyle = rgb(shutterCol.r, shutterCol.g, shutterCol.b);
    ctx.fillRect(sx, top, sw, wh);
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1;
    for (let i = 3; i < wh - 2; i += 4) {
      ctx.beginPath();
      ctx.moveTo(sx + 1, top + i);
      ctx.lineTo(sx + sw - 1, top + i);
      ctx.stroke();
    }
    ctx.strokeRect(sx + 0.5, top + 0.5, sw - 1, wh - 1);
  }
  // juliet balcony railing across the sill
  const ry = top + wh + 2;
  ctx.strokeStyle = 'rgba(20,20,22,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - ww / 2 - sw, ry + 12);
  ctx.lineTo(cx + ww / 2 + sw, ry + 12);
  ctx.moveTo(cx - ww / 2 - sw, ry);
  ctx.lineTo(cx + ww / 2 + sw, ry);
  ctx.stroke();
  ctx.lineWidth = 1.4;
  for (let bx = cx - ww / 2 - sw + 2; bx <= cx + ww / 2 + sw; bx += 5) {
    ctx.beginPath();
    ctx.moveTo(bx, ry);
    ctx.lineTo(bx, ry + 12);
    ctx.stroke();
  }
}

/** A tall colonial arched/louvered window with shutters + a cornice sill. */
function paintColonialWindow(ctx, cx, top, ww, wh, frameCol, shutterCol, lit) {
  const archH = ww * 0.55;
  // recess
  ctx.fillStyle = rgb(0.08, 0.09, 0.1);
  ctx.beginPath();
  ctx.moveTo(cx - ww / 2, top + wh);
  ctx.lineTo(cx - ww / 2, top + archH);
  ctx.quadraticCurveTo(cx, top - archH * 0.3, cx + ww / 2, top + archH);
  ctx.lineTo(cx + ww / 2, top + wh);
  ctx.closePath();
  ctx.fill();
  // glass
  ctx.fillStyle = lit ? rgb(0.95, 0.85, 0.6) : rgb(0.12, 0.14, 0.17);
  ctx.fill();
  // shutters
  ctx.fillStyle = rgb(shutterCol.r, shutterCol.g, shutterCol.b);
  const sw = ww * 0.34;
  for (const sx of [cx - ww / 2, cx + ww / 2 - sw]) {
    ctx.fillRect(sx, top + archH, sw, wh - archH);
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1;
    for (let i = 3; i < wh - archH - 2; i += 4) {
      ctx.beginPath();
      ctx.moveTo(sx + 1, top + archH + i);
      ctx.lineTo(sx + sw - 1, top + archH + i);
      ctx.stroke();
    }
  }
  // arch keystone + frame
  ctx.strokeStyle = rgb(frameCol.r, frameCol.g, frameCol.b);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - ww / 2 - 2, top + wh);
  ctx.lineTo(cx - ww / 2 - 2, top + archH);
  ctx.quadraticCurveTo(cx, top - archH * 0.35, cx + ww / 2 + 2, top + archH);
  ctx.lineTo(cx + ww / 2 + 2, top + wh);
  ctx.stroke();
  // sill cornice
  ctx.fillStyle = rgb(frameCol.r, frameCol.g, frameCol.b);
  ctx.fillRect(cx - ww / 2 - 5, top + wh, ww + 10, 4);
}

/* ============================ tile composition =========================== */

/**
 * Draw ONE complete archetype tile (4 m × 9.9 m) onto albedo / emissive /
 * roughness contexts simultaneously, so the three maps stay perfectly aligned.
 * `spec` selects the archetype + colours. `rng` is seeded → deterministic.
 *
 * Layout (bottom row of the tile = ground floor = street):
 *   y ∈ [2*FLOOR, 3*FLOOR]  bottom of canvas → upper floor   (residence)
 *   y ∈ [1*FLOOR, 2*FLOOR]                                    (residence)
 *   y ∈ [0,        1*FLOOR]  top of canvas    → GROUND FLOOR  (shopfront)
 * NB: canvas y grows DOWN; UV v grows UP. The integration maps v so that v=0
 * (street) samples the BOTTOM of the canvas. We therefore paint the ground-floor
 * shopfront at the BOTTOM of the canvas (largest y).
 */
function drawArchetype(actx, ectx, rctx, spec, rng) {
  const W = TILE_W_PX;
  const H = TILE_H_PX;
  const wall = spec.wall;
  const lit = spec.lit;

  // ----- base wall fill on albedo -----
  actx.fillStyle = rgb(wall.r, wall.g, wall.b);
  actx.fillRect(0, 0, W, H);
  // subtle large-scale tonal variation (two soft vertical bands), wrap-safe
  const band = actx.createLinearGradient(0, 0, W, 0);
  band.addColorStop(0, rgb(shade(wall, 0.04).r, shade(wall, 0.04).g, shade(wall, 0.04).b));
  band.addColorStop(0.5, rgb(shade(wall, -0.05).r, shade(wall, -0.05).g, shade(wall, -0.05).b));
  band.addColorStop(1, rgb(shade(wall, 0.04).r, shade(wall, 0.04).g, shade(wall, 0.04).b));
  actx.globalAlpha = 0.5;
  actx.fillStyle = band;
  actx.fillRect(0, 0, W, H);
  actx.globalAlpha = 1;

  // ----- roughness base (wall = rough/bright value) -----
  rctx.fillStyle = rgb(0.86, 0.86, 0.86); // high roughness for plaster/concrete
  rctx.fillRect(0, 0, W, H);

  // ----- emissive base: black (nothing glows) -----
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, W, H);

  // helper: mark a rectangle as smooth glass on the roughness map
  const glassRough = (x, y, w, h) => {
    rctx.fillStyle = rgb(0.12, 0.12, 0.12); // low roughness → reflective glass
    rctx.fillRect(x, y, w, h);
  };
  // helper: paint a warm lit pane on the emissive map (only when lit)
  const emitPane = (x, y, w, h, strength) => {
    ectx.fillStyle = `rgba(255,${Math.round(205 * 1)},${Math.round(120)},${strength})`;
    ectx.fillRect(x, y, w, h);
  };

  const cx = W / 2;

  /* ============ UPPER FLOORS (rows 0 and 1 from canvas top) ============ */
  // canvas-y of the two upper floors' tops:
  const upperTops = [0, FLOOR_PX]; // top two canvas bands = upper storeys
  for (let f = 0; f < 2; f++) {
    const fy = upperTops[f];
    const winLit = lit && rng() < spec.litChance;

    if (spec.kind === 'tube' || spec.kind === 'plain') {
      const ww = spec.kind === 'plain' ? W * 0.42 : W * 0.46;
      const wh = FLOOR_PX * 0.6;
      const top = fy + FLOOR_PX * 0.18;
      if (spec.kind === 'tube') {
        paintTubeWindow(actx, cx, top, ww, wh, spec.frame, spec.shutter, rng, winLit);
      } else {
        // plain: simple framed window
        actx.fillStyle = rgb(shade(spec.frame, -0.3).r, shade(spec.frame, -0.3).g, shade(spec.frame, -0.3).b);
        actx.fillRect(cx - ww / 2 - 2, top - 2, ww + 4, wh + 4);
        actx.fillStyle = winLit ? rgb(0.9, 0.8, 0.55) : rgb(0.11, 0.13, 0.16);
        actx.fillRect(cx - ww / 2, top, ww, wh);
        actx.strokeStyle = rgb(spec.frame.r, spec.frame.g, spec.frame.b);
        actx.lineWidth = 2;
        actx.strokeRect(cx - ww / 2, top, ww, wh);
        actx.beginPath();
        actx.moveTo(cx, top); actx.lineTo(cx, top + wh);
        actx.moveTo(cx - ww / 2, top + wh / 2); actx.lineTo(cx + ww / 2, top + wh / 2);
        actx.stroke();
      }
      glassRough(cx - ww / 2, top, ww, wh);
      if (winLit) emitPane(cx - ww / 2, top, ww, wh, 0.9);
      // occasional AC unit beside the window
      if (rng() < 0.4) paintAC(actx, cx + ww / 2 + 4 > W - 30 ? cx - ww / 2 - 28 : cx + ww / 2 + 4, fy + FLOOR_PX * 0.12, rng);
    } else if (spec.kind === 'colonial') {
      const ww = W * 0.4;
      const wh = FLOOR_PX * 0.66;
      const top = fy + FLOOR_PX * 0.2;
      paintColonialWindow(actx, cx, top, ww, wh, spec.frame, spec.shutter, winLit);
      glassRough(cx - ww / 2, top, ww, wh);
      if (winLit) emitPane(cx - ww / 2, top + wh * 0.3, ww, wh * 0.7, 0.85);
      // cornice line under each floor
      actx.fillStyle = rgb(shade(wall, 0.18).r, shade(wall, 0.18).g, shade(wall, 0.18).b);
      actx.fillRect(0, fy + FLOOR_PX - 6, W, 5);
    } else if (spec.kind === 'modern') {
      // horizontal glass band spanning the bay with a cantilever balcony slab
      const bandTop = fy + FLOOR_PX * 0.22;
      const bandH = FLOOR_PX * 0.52;
      actx.fillStyle = winLit ? rgb(0.7, 0.78, 0.82) : rgb(0.16, 0.22, 0.27);
      actx.fillRect(0, bandTop, W, bandH);
      // mullions
      actx.strokeStyle = rgb(spec.frame.r, spec.frame.g, spec.frame.b);
      actx.lineWidth = 2;
      for (let mx = W * 0.16; mx < W; mx += W * 0.16) {
        actx.beginPath(); actx.moveTo(mx, bandTop); actx.lineTo(mx, bandTop + bandH); actx.stroke();
      }
      actx.strokeRect(0, bandTop, W, bandH);
      glassRough(0, bandTop, W, bandH);
      if (winLit) emitPane(0, bandTop, W, bandH, 0.7);
      // cantilever floor slab (spans full width, wraps)
      actx.fillStyle = rgb(shade(wall, 0.12).r, shade(wall, 0.12).g, shade(wall, 0.12).b);
      actx.fillRect(0, fy + FLOOR_PX - 10, W, 9);
      // balcony railing (glass) below the slab
      actx.strokeStyle = 'rgba(40,44,48,0.6)';
      actx.lineWidth = 1.5;
      actx.strokeRect(2, fy + FLOOR_PX - 9, W - 4, 7);
      if (rng() < 0.5) paintAC(actx, W - 30, fy + FLOOR_PX * 0.1, rng);
    }
  }

  // ----- inter-bay pilaster shadow at the tile seam (sells vertical rhythm,
  // and tiles because it's centred on the wrap edge x=0 / x=W) -----
  const pil = actx.createLinearGradient(0, 0, 8, 0);
  pil.addColorStop(0, 'rgba(0,0,0,0.18)');
  pil.addColorStop(1, 'rgba(0,0,0,0)');
  actx.fillStyle = pil;
  actx.fillRect(0, 0, 8, H);
  const pilR = actx.createLinearGradient(W - 8, 0, W, 0);
  pilR.addColorStop(0, 'rgba(0,0,0,0)');
  pilR.addColorStop(1, 'rgba(0,0,0,0.18)');
  actx.fillStyle = pilR;
  actx.fillRect(W - 8, 0, 8, H);

  /* ================= GROUND FLOOR (bottom band of canvas) ================ */
  const gTop = 2 * FLOOR_PX;
  paintGroundFloor(actx, ectx, rctx, spec, gTop, FLOOR_PX, rng, glassRough, emitPane);

  /* ===================== whole-tile weathering ===================== */
  streaks(actx, W, H, rng, spec.kind === 'modern' ? 4 : 10);
  grain(actx, W, H, rng, spec.kind === 'modern' ? 60 : 160, true);
  grain(actx, W, H, rng, 50, false);
  // roughness gets matching grain so wet/dry detail isn't flat
  grain(rctx, W, H, rng, 80, true);
}

/** The street-level shopfront: glazing + roller shutter + signboard band. */
function paintGroundFloor(actx, ectx, rctx, spec, gTop, gH, rng, glassRough, emitPane) {
  const W = TILE_W_PX;
  const wall = spec.wall;

  if (spec.kind === 'modern') {
    // modern lobby: full-height dark glass + a slim canopy
    const top = gTop + 10;
    const h = gH - 18;
    actx.fillStyle = rgb(0.13, 0.17, 0.2);
    actx.fillRect(4, top, W - 8, h);
    actx.strokeStyle = rgb(spec.frame.r, spec.frame.g, spec.frame.b);
    actx.lineWidth = 2;
    for (let mx = W * 0.25; mx < W; mx += W * 0.25) {
      actx.beginPath(); actx.moveTo(mx, top); actx.lineTo(mx, top + h); actx.stroke();
    }
    actx.strokeRect(4, top, W - 8, h);
    glassRough(4, top, W - 8, h);
    if (spec.lit) emitPane(4, top, W - 8, h, 0.5);
    // canopy slab
    actx.fillStyle = rgb(shade(wall, 0.1).r, shade(wall, 0.1).g, shade(wall, 0.1).b);
    actx.fillRect(0, gTop + 2, W, 9);
    return;
  }

  // signboard band across the top of the shopfront (the detail that "sells street")
  const signH = gH * 0.22;
  const signCol = spec.sign;
  actx.fillStyle = rgb(signCol.r, signCol.g, signCol.b);
  actx.fillRect(0, gTop + 2, W, signH);
  // faux lettering blocks on the sign
  actx.fillStyle = 'rgba(255,255,255,0.82)';
  let lx = 14;
  const ly = gTop + 2 + signH * 0.32;
  const lh = signH * 0.36;
  const nWords = 1 + Math.floor(rng() * 2);
  for (let wd = 0; wd < nWords; wd++) {
    const letters = 2 + Math.floor(rng() * 4);
    for (let i = 0; i < letters && lx < W - 14; i++) {
      const lw = 6 + rng() * 8;
      actx.fillRect(lx, ly, lw, lh);
      lx += lw + 4;
    }
    lx += 12;
  }
  // signboards often glow at dusk
  if (spec.lit) {
    ectx.fillStyle = `rgba(255,150,60,${0.4 + rng() * 0.4})`;
    ectx.fillRect(0, gTop + 2, W, signH);
  }
  rctx.fillStyle = rgb(0.4, 0.4, 0.4); // sign panel a bit glossier
  rctx.fillRect(0, gTop + 2, W, signH);

  // shopfront opening below the sign
  const openTop = gTop + signH + 6;
  const openH = gH - signH - 12;
  const openX = 8;
  const openW = W - 16;

  const roller = rng() < 0.32; // some shops shuttered (roller down)
  if (roller) {
    // metal roller shutter (corrugated horizontal lines)
    actx.fillStyle = rgb(0.5, 0.5, 0.52);
    actx.fillRect(openX, openTop, openW, openH);
    actx.strokeStyle = 'rgba(0,0,0,0.22)';
    actx.lineWidth = 1;
    for (let yy = openTop + 3; yy < openTop + openH; yy += 4) {
      actx.beginPath();
      actx.moveTo(openX, yy);
      actx.lineTo(openX + openW, yy);
      actx.stroke();
    }
    actx.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let yy = openTop + 4; yy < openTop + openH; yy += 4) {
      actx.beginPath();
      actx.moveTo(openX, yy);
      actx.lineTo(openX + openW, yy);
      actx.stroke();
    }
    actx.strokeStyle = rgb(spec.frame.r, spec.frame.g, spec.frame.b);
    actx.lineWidth = 2;
    actx.strokeRect(openX, openTop, openW, openH);
    rctx.fillStyle = rgb(0.35, 0.35, 0.35); // metal: medium roughness
    rctx.fillRect(openX, openTop, openW, openH);
  } else {
    // open glazed shopfront with a glowing interior + a door
    actx.fillStyle = rgb(0.1, 0.12, 0.14);
    actx.fillRect(openX, openTop, openW, openH);
    // shop interior is usually lit (commerce) — warm glow
    const shopLit = rng() < 0.75;
    if (shopLit) {
      actx.fillStyle = rgb(0.5, 0.42, 0.3);
      actx.fillRect(openX + 3, openTop + 3, openW - 6, openH - 6);
    }
    // mullions + a door division
    actx.strokeStyle = rgb(spec.frame.r, spec.frame.g, spec.frame.b);
    actx.lineWidth = 3;
    actx.strokeRect(openX, openTop, openW, openH);
    actx.lineWidth = 2;
    const doorX = openX + openW * (0.6 + rng() * 0.15);
    actx.beginPath();
    actx.moveTo(doorX, openTop);
    actx.lineTo(doorX, openTop + openH);
    actx.moveTo(openX + openW * 0.33, openTop);
    actx.lineTo(openX + openW * 0.33, openTop + openH);
    actx.stroke();
    glassRough(openX, openTop, openW, openH);
    if (spec.lit && shopLit) emitPane(openX, openTop, openW, openH, 0.8);
  }

  // a stepped plinth / curb shadow at the very bottom of the wall
  actx.fillStyle = rgb(shade(wall, -0.3).r, shade(wall, -0.3).g, shade(wall, -0.3).b);
  actx.fillRect(0, gTop + gH - 6, W, 6);
}

/* ============================ archetype palette =========================== */
// 14 variants spanning the four Hanoi archetypes. Colours are muted (low sat).

function buildSpecs() {
  // helper local colour
  const C = (h, s, l) => new THREE.Color().setHSL(h / 360, s, l);
  const frameDark = C(30, 0.1, 0.28);
  const shutterGreen = C(120, 0.22, 0.34);
  const shutterBlue = C(205, 0.25, 0.4);
  const shutterBrown = C(28, 0.35, 0.32);

  const specs = [
    /* (a) OLD-QUARTER TUBE HOUSES — the most common; several colour variants */
    { kind: 'tube', name: 'tube-ochre', wall: C(38, 0.4, 0.62), frame: frameDark, shutter: shutterGreen, sign: C(2, 0.5, 0.4), lit: true, litChance: 0.45 },
    { kind: 'tube', name: 'tube-yellow', wall: C(48, 0.5, 0.68), frame: frameDark, shutter: shutterBlue, sign: C(210, 0.45, 0.4), lit: true, litChance: 0.5 },
    { kind: 'tube', name: 'tube-faded-green', wall: C(96, 0.18, 0.6), frame: frameDark, shutter: shutterBrown, sign: C(150, 0.4, 0.34), lit: true, litChance: 0.4 },
    { kind: 'tube', name: 'tube-faded-blue', wall: C(200, 0.2, 0.62), frame: frameDark, shutter: C(28, 0.4, 0.3), sign: C(28, 0.5, 0.42), lit: true, litChance: 0.45 },
    { kind: 'tube', name: 'tube-faded-pink', wall: C(355, 0.28, 0.7), frame: frameDark, shutter: shutterGreen, sign: C(330, 0.45, 0.45), lit: true, litChance: 0.5 },
    { kind: 'tube', name: 'tube-terracotta', wall: C(18, 0.45, 0.5), frame: frameDark, shutter: C(40, 0.3, 0.7), sign: C(45, 0.6, 0.5), lit: true, litChance: 0.45 },
    { kind: 'tube', name: 'tube-mint', wall: C(160, 0.2, 0.66), frame: frameDark, shutter: C(20, 0.35, 0.3), sign: C(0, 0.5, 0.42), lit: true, litChance: 0.4 },

    /* (b) FRENCH-COLONIAL SHOPHOUSES — pastel cream/yellow, arched windows */
    { kind: 'colonial', name: 'colonial-cream', wall: C(44, 0.28, 0.78), frame: C(40, 0.12, 0.5), shutter: shutterGreen, sign: C(150, 0.35, 0.3), lit: true, litChance: 0.35 },
    { kind: 'colonial', name: 'colonial-yellow', wall: C(46, 0.42, 0.7), frame: C(40, 0.12, 0.46), shutter: shutterBlue, sign: C(205, 0.4, 0.35), lit: true, litChance: 0.35 },
    { kind: 'colonial', name: 'colonial-grey', wall: C(40, 0.06, 0.72), frame: C(30, 0.1, 0.42), shutter: shutterBrown, sign: C(28, 0.45, 0.4), lit: true, litChance: 0.3 },

    /* (c) MODERN MINI-HOTEL / GLASS — horizontal bands, reflective glass */
    { kind: 'modern', name: 'modern-glass-blue', wall: C(210, 0.08, 0.72), frame: C(220, 0.05, 0.4), shutter: frameDark, sign: C(210, 0.4, 0.4), lit: true, litChance: 0.55 },
    { kind: 'modern', name: 'modern-glass-warm', wall: C(35, 0.06, 0.74), frame: C(30, 0.05, 0.42), shutter: frameDark, sign: C(20, 0.5, 0.45), lit: true, litChance: 0.55 },

    /* (d) PLAIN RENDERED — bare concrete/wash, simple windows */
    { kind: 'plain', name: 'plain-concrete', wall: C(30, 0.03, 0.6), frame: frameDark, shutter: frameDark, sign: C(210, 0.3, 0.4), lit: true, litChance: 0.3 },
    { kind: 'plain', name: 'plain-wash', wall: C(40, 0.08, 0.7), frame: C(30, 0.1, 0.35), shutter: shutterBrown, sign: C(0, 0.45, 0.42), lit: true, litChance: 0.3 },
  ];
  return specs;
}

/* ============================ public factory ============================= */

export function createHanoiFacades(THREE_arg) {
  // Accept THREE passed in (worldHanoi style) but fall back to the imported one.
  const T = THREE_arg || THREE;

  const tileWidth = 4; // metres a tile spans horizontally (one structural bay)
  const tileHeight = 9.9; // metres vertically (3 floors @ 3.3 m)

  const textures = [];
  const materials = [];
  const ownedGeoms = [];
  const ownedMats = []; // roof-detail shared materials (disposed separately)

  /** Wrap a canvas as a tiling texture. The integration overrides repeat per
   *  building (in metres), but we seed sensible defaults + sRGB/mipmaps here. */
  function makeTex(canvas, srgb) {
    const t = new T.CanvasTexture(canvas);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = T.LinearMipmapLinearFilter;
    t.magFilter = T.LinearFilter;
    if (srgb) t.colorSpace = T.SRGBColorSpace;
    t.needsUpdate = true;
    textures.push(t);
    return t;
  }

  const specs = buildSpecs();

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const albedoC = makeCanvas(TILE_W_PX, TILE_H_PX);
    const emissiveC = makeCanvas(TILE_W_PX, TILE_H_PX);
    const roughC = makeCanvas(TILE_W_PX, TILE_H_PX);
    const actx = albedoC.getContext('2d');
    const ectx = emissiveC.getContext('2d');
    const rctx = roughC.getContext('2d');

    // deterministic per-variant seed
    const rng = mulberry32(0x9e3779b9 ^ (i * 2654435761));
    drawArchetype(actx, ectx, rctx, spec, rng);

    const map = makeTex(albedoC, true);
    const emissiveMap = makeTex(emissiveC, true);
    const roughnessMap = makeTex(roughC, false);

    const mat = new T.MeshStandardMaterial({
      map,
      emissiveMap,
      roughnessMap,
      color: 0xffffff,
      emissive: 0xffffff, // emissiveMap modulates this; warm tint baked in the map
      emissiveIntensity: spec.kind === 'modern' ? 0.7 : 0.85,
      roughness: 1.0, // multiplied by roughnessMap
      metalness: 0.0,
    });
    mat.name = 'hanoi-' + spec.name;
    // help reflections read on the glassy bits
    mat.envMapIntensity = spec.kind === 'modern' ? 1.4 : 0.9;
    materials.push(mat);
  }

  // Index ranges for pickVariant (must match buildSpecs ordering):
  const TUBE = [0, 1, 2, 3, 4, 5, 6];
  const COLONIAL = [7, 8, 9];
  const MODERN = [10, 11];
  const PLAIN = [12, 13];

  /**
   * Deterministically pick a material index from a seed and the building height.
   *   short  (≤ ~14 m, 1–4 floors) → tube house (occasionally plain)
   *   mid    (~14–28 m)            → colonial / plain (some tube)
   *   tall   (> ~28 m)             → modern glass (some colonial)
   * seed01 ∈ [0,1) spreads colour/variant choice.
   */
  function pickVariant(seed01, heightMeters) {
    const s = ((seed01 % 1) + 1) % 1; // normalise to [0,1)
    const h = heightMeters || 7;
    let pool;
    if (h <= 14) {
      pool = s < 0.85 ? TUBE : PLAIN;
    } else if (h <= 28) {
      pool = s < 0.45 ? COLONIAL : s < 0.75 ? PLAIN : TUBE;
    } else {
      pool = s < 0.7 ? MODERN : COLONIAL;
    }
    const idx = pool[Math.floor(s * 997) % pool.length];
    return idx;
  }

  /* ----------------------- shared roof-detail materials ------------------- */
  // A couple of cheap shared materials reused across every roof topper.
  const parapetMat = new T.MeshStandardMaterial({ color: 0x8d8377, roughness: 0.95, metalness: 0.0 });
  const tankMat = new T.MeshStandardMaterial({ color: 0x2f6fb0, roughness: 0.6, metalness: 0.1 }); // blue plastic water tank
  const boxMat = new T.MeshStandardMaterial({ color: 0x9a9286, roughness: 0.9, metalness: 0.0 });   // access box / render
  const acMat = new T.MeshStandardMaterial({ color: 0xcfcdc6, roughness: 0.55, metalness: 0.4 });    // AC / metal
  const lineMat = new T.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9, metalness: 0.0 });   // laundry line
  const clothMat = new T.MeshStandardMaterial({ color: 0xc8c2b4, roughness: 0.95, metalness: 0.0, side: T.DoubleSide }); // laundry
  const tileMat = new T.MeshStandardMaterial({ color: 0x9c5236, roughness: 0.85, metalness: 0.0 });  // pitched-cap terracotta
  ownedMats.push(parapetMat, tankMat, boxMat, acMat, lineMat, clothMat, tileMat);

  // shared unit geometries (cloned/scaled per use, never mutated)
  const unitBox = new T.BoxGeometry(1, 1, 1);
  const unitCyl = new T.CylinderGeometry(0.5, 0.5, 1, 14);
  ownedGeoms.push(unitBox, unitCyl);

  /**
   * Build a cheap rooftop topper for ONE building. `footprintPoly` is
   * [[x,z],...] in WORLD metres; the returned Object3D is placed at y=0 by the
   * caller-supplied translation (we author it so the parapet sits at
   * y=heightMeters and props stand above it). Returns null for tiny footprints.
   */
  function buildRoofDetail(footprintPoly, heightMeters, seed01) {
    if (!footprintPoly || footprintPoly.length < 3) return null;
    const h = heightMeters || 7;
    const rng = mulberry32(((seed01 * 1e6) | 0) ^ 0x85ebca6b);

    // centroid + rough size
    let cx = 0, cz = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of footprintPoly) {
      cx += p[0]; cz += p[1];
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]);
    }
    cx /= footprintPoly.length; cz /= footprintPoly.length;
    const spanX = maxX - minX, spanZ = maxZ - minZ;
    const minSpan = Math.min(spanX, spanZ);
    if (minSpan < 2.2) return null; // too small to bother

    const group = new T.Group();

    /* ---- parapet ring tracing the footprint top edge ---- */
    // Build a thin extruded ribbon following the polygon edges. World coords use
    // x=east, z=south; the footprint poly is in the same metric space the prisms
    // were extruded from (worldHanoi feeds -z into the Shape, so here we trace the
    // raw poly and the group is added in WORLD space at y=h).
    const ph = 0.55; // parapet height
    const pw = 0.18; // parapet thickness
    const pos = [];
    const idx = [];
    const n = footprintPoly.length;
    let base = 0;
    for (let i = 0; i < n; i++) {
      const a = footprintPoly[i];
      const b = footprintPoly[(i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len, nz = dx / len; // outward-ish normal
      // inner & outer, bottom & top → a wall ribbon segment
      const ax0 = a[0], az0 = a[1];
      const bx0 = b[0], bz0 = b[1];
      const ax1 = a[0] - nx * pw, az1 = a[1] - nz * pw;
      const bx1 = b[0] - nx * pw, bz1 = b[1] - nz * pw;
      // 8 verts (bottom y=0, top y=ph) — but we want it ABOVE roof, so y=0..ph
      pos.push(ax0, 0, az0,  bx0, 0, bz0,  ax0, ph, az0,  bx0, ph, bz0);
      pos.push(ax1, 0, az1,  bx1, 0, bz1,  ax1, ph, az1,  bx1, ph, bz1);
      // outer face
      idx.push(base + 0, base + 2, base + 1, base + 1, base + 2, base + 3);
      // inner face
      idx.push(base + 4, base + 5, base + 6, base + 5, base + 7, base + 6);
      // top cap
      idx.push(base + 2, base + 6, base + 3, base + 3, base + 6, base + 7);
      base += 8;
    }
    if (pos.length) {
      const pg = new T.BufferGeometry();
      pg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      pg.setIndex(idx);
      pg.computeVertexNormals();
      ownedGeoms.push(pg);
      const ring = new T.Mesh(pg, parapetMat);
      ring.position.y = h;
      ring.castShadow = true; ring.receiveShadow = true;
      group.add(ring);
    }

    // helper to add a boxy prop at (lx,lz) offset from centroid, sized w×hh×d
    const addBox = (lx, lz, w, hh, d, mat, yBase) => {
      const m = new T.Mesh(unitBox, mat);
      m.scale.set(w, hh, d);
      m.position.set(cx + lx, (yBase != null ? yBase : h) + hh / 2 + 0.02, cz + lz);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
      return m;
    };
    const addCyl = (lx, lz, r, hh, mat, yBase) => {
      const m = new T.Mesh(unitCyl, mat);
      m.scale.set(r * 2, hh, r * 2);
      m.position.set(cx + lx, (yBase != null ? yBase : h) + hh / 2 + 0.02, cz + lz);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
      return m;
    };

    // keep props inside the footprint bbox with margin
    const mx = Math.max(0.4, spanX * 0.5 - 1.0);
    const mz = Math.max(0.4, spanZ * 0.5 - 1.0);
    const jx = () => (rng() - 0.5) * 2 * mx;
    const jz = () => (rng() - 0.5) * 2 * mz;

    /* ---- water tank (very common on Hanoi roofs) ---- */
    if (rng() < 0.6 && minSpan > 3) {
      // stand on a little steel frame (a thin box) + the cylindrical tank
      const fx = jx(), fz = jz();
      addBox(fx, fz, 1.1, 0.5, 1.1, acMat, h + 0.55);
      addCyl(fx, fz, 0.45, 1.0, tankMat, h + 1.05);
    }

    /* ---- rooftop access box / stairwell head ---- */
    if (rng() < 0.55 && minSpan > 3.2) {
      const w = 1.6 + rng() * 1.2, d = 1.6 + rng() * 1.0, hh = 1.8 + rng() * 0.8;
      const box = addBox(jx() * 0.5, jz() * 0.5, w, hh, d, boxMat);
      // little flat cap
      const cap = new T.Mesh(unitBox, parapetMat);
      cap.scale.set(w + 0.3, 0.12, d + 0.3);
      cap.position.set(box.position.x, h + hh + 0.06, box.position.z);
      cap.castShadow = true; group.add(cap);
    }

    /* ---- 1–2 AC condensers ---- */
    const acN = rng() < 0.5 ? 1 : rng() < 0.7 ? 2 : 0;
    for (let i = 0; i < acN; i++) {
      addBox(jx(), jz(), 0.7, 0.45, 0.4, acMat);
    }

    /* ---- hanging laundry lines ---- */
    if (rng() < 0.5 && spanX > 3) {
      const ly = h + 0.9 + rng() * 0.4;
      const lz = jz() * 0.6;
      const x0 = cx - spanX * 0.4, x1 = cx + spanX * 0.4;
      // line
      const lineGeo = new T.CylinderGeometry(0.015, 0.015, x1 - x0, 5);
      ownedGeoms.push(lineGeo);
      const line = new T.Mesh(lineGeo, lineMat);
      line.rotation.z = Math.PI / 2;
      line.position.set((x0 + x1) / 2, ly, cz + lz);
      group.add(line);
      // a few cloths
      const cN = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < cN; i++) {
        const t = (i + 0.5) / cN;
        const cw = 0.3 + rng() * 0.25, ch = 0.4 + rng() * 0.3;
        const clothGeo = new T.PlaneGeometry(cw, ch);
        ownedGeoms.push(clothGeo);
        const cloth = new T.Mesh(clothGeo, clothMat);
        cloth.position.set(x0 + (x1 - x0) * t, ly - ch / 2 - 0.02, cz + lz);
        group.add(cloth);
      }
    }

    /* ---- occasional small pitched terracotta cap (older houses) ---- */
    if (rng() < 0.22 && minSpan > 3.5) {
      const w = Math.min(spanX, 5) * 0.7, d = Math.min(spanZ, 5) * 0.7;
      const capGeo = new T.CylinderGeometry(0.0, Math.max(w, d) * 0.6, 1.0 + rng() * 0.6, 4);
      ownedGeoms.push(capGeo);
      const cap = new T.Mesh(capGeo, tileMat);
      cap.rotation.y = Math.PI / 4;
      cap.position.set(cx + jx() * 0.4, h + 0.55, cz + jz() * 0.4);
      cap.castShadow = true; group.add(cap);
    }

    return group;
  }

  /** Free every geometry, material and canvas-texture this module created. */
  function dispose() {
    for (const t of textures) {
      // release the backing canvas so OffscreenCanvas memory is freed promptly
      if (t.image && typeof t.image === 'object') {
        if ('width' in t.image) { try { t.image.width = 0; t.image.height = 0; } catch (_) {} }
      }
      t.dispose();
    }
    for (const m of materials) m.dispose();
    for (const m of ownedMats) m.dispose();
    for (const g of ownedGeoms) g.dispose();
    textures.length = 0;
    materials.length = 0;
    ownedMats.length = 0;
    ownedGeoms.length = 0;
  }

  return {
    tileWidth,
    tileHeight,
    materials,
    pickVariant,
    buildRoofDetail,
    dispose,
  };
}
