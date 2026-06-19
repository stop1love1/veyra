// @ts-nocheck -- realistic storefront / building builder
//
// buildings.ts — TRUE-TO-LIFE storefronts for a modern outdoor commercial street.
// Large recessed glass shopfronts, metal mullions, real doors, awnings, illuminated
// signs, plaster/concrete/brick upper floors with punched windows, real cornices /
// parapets, plus setbacks, bays, balconies and corner piers — so a *row* of these
// reads as a varied street, not a copy-paste loop.
//
//   const B = createBuildings(mats);
//   const { group, footprint, entrance, markerAnchor } = B.storefront({ ... });
//
// The material library `mats` is passed in (never imported). Everything below uses
// 1 unit ≈ 1 metre. The façade faces +Z (the street side); the group sits at origin.
//
// PUBLIC API is unchanged:
//   storefront({ width, depth, floors, hue, real, name, signHue })
//     -> { group, footprint:{w,d}, entrance:Vector3, markerAnchor:Vector3 }

import * as THREE from 'three';
import { hsl } from './helpers';

// ── Module-level shared geometries ────────────────────────────────────────────
// A storefront street can contain dozens of buildings. To keep draw-calls and GPU
// memory modest we reuse a handful of unit-sized geometries and scale instances per
// use (boxes are uniform so non-uniform scale is visually exact, lighting aside).
// One BoxGeometry shared across hundreds of meshes ⇒ tiny memory, and identical
// (geometry, material) pairs let three.js auto-instance/batch where possible.
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
// A unit cylinder (radius 0.5, height 1, +Y) reused for railing balusters / posts.
const UNIT_CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);

/** Add a unit-box mesh scaled to (w,h,d) at (x,y,z) into `parent`. */
function box(parent, mat, w, h, d, x, y, z, shadow) {
  const m = new THREE.Mesh(UNIT_BOX, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  if (shadow) { m.castShadow = true; m.receiveShadow = true; }
  parent.add(m);
  return m;
}

// ── Deterministic PRNG ─────────────────────────────────────────────────────────
// All variation is seeded from opts (hue + width + depth + floors) so a row of
// buildings looks varied but is fully reproducible frame-to-frame and across
// reloads. mulberry32 over a hashed seed gives a cheap, well-distributed stream.
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(...nums) {
  let h = 2166136261 >>> 0;
  for (const n of nums) {
    h ^= Math.round((n || 0) * 1000) & 0xffffffff;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Archetype ids. Selected by seed in pickArchetype().
const ARCH = {
  FLAT_MODERN: 0,   // A. full-height glass curtain ground floor, slim mullions, flat parapet
  AWNING_SHOP: 1,   // B. bulkhead + recessed glazed shopfront + fabric awning + projecting fascia/blade sign
  MASONRY: 2,       // C. brick/concrete façade, punched window grid, projecting cornice + string courses
  SETBACK: 3,       // D. upper floor stepped back with roof terrace + parapet/planters
  BAY_BALCONY: 4,   // E. projecting bay window or balcony with railings on an upper floor
  CORNER_ANCHOR: 5, // F. taller, prominent vertical massing with corner piers (when floors is high)
};

export function createBuildings(mats) {
  // ── Instanced punched-window grid ──────────────────────────────────────────
  // Rather than N tiny meshes (a glass pane + frame each), we draw the whole window
  // field with just TWO instanced meshes: one of glass panes, one of a thin "frame
  // ring" proxy sat just behind. So an entire multi-floor façade of windows costs
  // 2 draw calls regardless of count. `arrange` lets us do grid / ribbon / strips.
  function addWindowGrid(group, opts) {
    const {
      cols, rows, x0, y0, dx, dy, paneW, paneH, z, depthInset,
      glassMat = mats.glassDark, frameMat = mats.metalFrame, inset = 0.16,
    } = opts;
    const count = cols * rows;
    if (count <= 0) return;

    const glass = new THREE.InstancedMesh(UNIT_BOX, glassMat, count);
    const frame = new THREE.InstancedMesh(UNIT_BOX, frameMat, count);
    glass.castShadow = false; glass.receiveShadow = false;
    frame.castShadow = true; frame.receiveShadow = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sGlass = new THREE.Vector3(paneW, paneH, 0.06);
    const sFrame = new THREE.Vector3(paneW + inset, paneH + inset, 0.05);
    const p = new THREE.Vector3();
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = x0 + c * dx;
        const py = y0 + r * dy;
        p.set(px, py, z - depthInset);
        m.compose(p, q, sGlass); glass.setMatrixAt(i, m);
        p.set(px, py, z - depthInset - 0.04);
        m.compose(p, q, sFrame); frame.setMatrixAt(i, m);
        i++;
      }
    }
    glass.instanceMatrix.needsUpdate = true;
    frame.instanceMatrix.needsUpdate = true;
    group.add(frame); // frame first (behind), glass in front
    group.add(glass);
  }

  // ── A railing made of two instanced meshes (posts + rails) ──────────────────
  // Used for balconies / roof terraces; costs 2 draw calls for the whole run.
  function addRailing(group, opts) {
    const { x0, x1, y, z, h = 0.95, postEvery = 0.32, mat = mats.metalFrame } = opts;
    const span = Math.abs(x1 - x0);
    const n = Math.max(2, Math.round(span / postEvery));
    const posts = new THREE.InstancedMesh(UNIT_CYL, mat, n + 1);
    posts.castShadow = true;
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion();
    const sPost = new THREE.Vector3(0.035, h, 0.035); const p = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      const px = x0 + (span * i) / n;
      p.set(px, y + h / 2, z);
      m.compose(p, q, sPost); posts.setMatrixAt(i, m);
    }
    posts.instanceMatrix.needsUpdate = true;
    group.add(posts);
    // top + mid rails (2 boxes)
    box(group, mat, span, 0.06, 0.06, (x0 + x1) / 2, y + h, z, true);
    box(group, mat, span, 0.04, 0.04, (x0 + x1) / 2, y + h * 0.5, z, false);
  }

  // ── Recessed glazed shopfront (the readable, realistic ground floor) ────────
  // Shared by most archetypes so the "shop you can look into" reads everywhere.
  // Returns the chosen door X so callers can compute `entrance`.
  function buildShopfront(group, p) {
    const {
      width, groundH, front, bodyMat, rng,
      inset = 0.4, bulkheadH = 0.55, transomDrop = 0.55,
    } = p;
    const hw = width / 2;
    const pierW = Math.max(0.35, width * 0.05);
    const bayW = width - pierW * 2;
    const transomH = groundH - transomDrop;
    const glassBottom = bulkheadH;
    const glassTop = transomH;
    const glassH = glassTop - glassBottom;
    const glassZ = front - inset;
    const revealMat = mats.concrete;

    // Reveal soffit + side returns (so the set-back reads as real depth).
    box(group, revealMat, bayW, 0.18, inset, 0, transomH, front - inset / 2, true);
    box(group, revealMat, 0.14, glassH, inset, -bayW / 2 + 0.07, glassBottom + glassH / 2, front - inset / 2, true);
    box(group, revealMat, 0.14, glassH, inset, bayW / 2 - 0.07, glassBottom + glassH / 2, front - inset / 2, true);

    // Side piers (full ground-floor height).
    box(group, bodyMat, pierW, groundH, 0.2, -hw + pierW / 2, groundH / 2, front - 0.1, true);
    box(group, bodyMat, pierW, groundH, 0.2, hw - pierW / 2, groundH / 2, front - 0.1, true);

    // Bulkhead / stallriser + the big dark-glass pane.
    box(group, mats.steelDark, bayW, bulkheadH, 0.16, 0, bulkheadH / 2, glassZ, true);
    box(group, mats.glassDark, bayW - 0.1, glassH, 0.05, 0, glassBottom + glassH / 2, glassZ, false);

    // Mullions: verticals scaled to width + transom/sill rails.
    const vMull = Math.max(2, Math.min(6, Math.round(bayW / 1.8)));
    const mullT = 0.09;
    for (let i = 0; i <= vMull; i++) {
      const mx = -bayW / 2 + (bayW * i) / vMull;
      box(group, mats.metalFrame, mullT, glassH, 0.12, mx, glassBottom + glassH / 2, glassZ + 0.04, false);
    }
    box(group, mats.metalFrame, bayW, mullT, 0.12, 0, glassTop, glassZ + 0.04, false);
    box(group, mats.metalFrame, bayW, mullT, 0.12, 0, glassBottom, glassZ + 0.04, false);
    if (glassH > 2.6) box(group, mats.metalFrame, bayW, mullT, 0.12, 0, glassBottom + glassH * 0.5, glassZ + 0.04, false);

    // Door: vary side AND size (single vs wide double-leaf), deterministic.
    const doubleDoor = rng() < 0.4;
    const doorW = doubleDoor ? 1.7 : 1.1;
    const doorH = 2.1;
    const doorSide = rng() < 0.5 ? -1 : 1;
    const centred = doubleDoor && rng() < 0.5;
    const doorX = centred ? 0 : doorSide * (bayW / 2 - doorW / 2 - 0.25);
    const doorZ = glassZ + 0.03;
    box(group, mats.metalFrame, doorW + 0.12, doorH + 0.12, 0.1, doorX, doorH / 2 + 0.04, doorZ + 0.02, true);
    box(group, mats.glassDark, doorW - 0.08, doorH - 0.18, 0.06, doorX, doorH / 2 + 0.02, doorZ + 0.06, false);
    if (doubleDoor) box(group, mats.metalFrame, 0.06, doorH - 0.18, 0.07, doorX, doorH / 2 + 0.02, doorZ + 0.07, false);
    const handleX = doubleDoor ? doorX : doorX + doorSide * (doorW / 2 - 0.18);
    box(group, mats.steelDark, 0.05, 0.7, 0.05, handleX, doorH / 2, doorZ + 0.12, false);

    return { doorX, doorH, transomH, glassTop };
  }

  // ── Fabric awning (varied: straight box vs sloped, varied colour) ───────────
  function addAwning(group, p) {
    const { width, front, atY, signHue, hue, rng } = p;
    // Awning colour: mostly the sign/brand hue, sometimes a neutral canvas tone.
    const useNeutral = rng() < 0.3;
    const awningMat = useNeutral
      ? new THREE.MeshStandardMaterial({ color: hsl((hue + 30) % 360, 0.08, 0.42), roughness: 0.92, metalness: 0 })
      : mats.plaster(signHue != null ? signHue : hue);
    const drop = 0.8 + rng() * 0.5;
    const tilt = -0.28 - rng() * 0.18;
    const aw = new THREE.Mesh(UNIT_BOX, awningMat);
    aw.scale.set(width - 0.2, 0.16, drop);
    aw.position.set(0, atY + 0.45, front + drop * 0.42);
    aw.rotation.x = tilt;
    aw.castShadow = true; aw.receiveShadow = true;
    group.add(aw);
    // valance lip
    box(group, mats.steelDark, width - 0.2, 0.22, 0.06, 0, atY + 0.18, front + drop * 0.78, true);
  }

  // ── Fascia signage band + sign (fascia OR projecting blade) ─────────────────
  function addSign(group, p) {
    const { width, front, fasciaY, name, signHue, real, rng } = p;
    // Fascia band (signage zone).
    box(group, mats.steelDark, width, 0.56, 0.12, 0, fasciaY, front + 0.04, true);
    if (!name) return;
    const blade = rng() < 0.45; // projecting blade sign vs flat fascia sign
    if (blade) {
      // A perpendicular blade sign on a slim bracket near one pier.
      const side = rng() < 0.5 ? -1 : 1;
      const bx = side * (width / 2 - 0.5);
      const sign = mats.makeSign(name, { width: 1.6, hue: signHue });
      sign.rotation.y = side * Math.PI / 2;       // face down the street
      sign.position.set(bx, fasciaY + 0.55, front + 0.7);
      if (real) sign.scale.multiplyScalar(1.12);
      group.add(sign);
      // bracket arm
      box(group, mats.metalFrame, 0.06, 0.06, 0.9, bx, fasciaY + 0.55, front + 0.35, true);
    } else {
      const sign = mats.makeSign(name, { width: width * 0.7, hue: signHue });
      sign.position.set(0, fasciaY, front + 0.14);
      if (real) sign.scale.multiplyScalar(1.18);
      group.add(sign);
    }
  }

  // ── Roofline: cornice / parapet variants. Returns top y of the cap. ─────────
  function addRoofline(group, p) {
    const { width, depth, totalH, front, bodyMat, style } = p;
    const revealMat = mats.concrete;
    if (style === 'cornice') {
      // Projecting moulded cornice (masonry feel): a wide overhang + a parapet band.
      box(group, revealMat, width + 0.4, 0.3, depth + 0.4, 0, totalH + 0.15, 0, true);
      box(group, bodyMat, width, 0.5, 0.3, 0, totalH + 0.55, front - 0.15, true);
      return totalH + 0.8;
    }
    if (style === 'capband') {
      // Slim modern cap band, almost flush — for flat-modern silhouettes.
      box(group, mats.steelDark, width + 0.12, 0.16, depth + 0.12, 0, totalH + 0.08, 0, true);
      return totalH + 0.16;
    }
    // default 'parapet': thin cornice + a taller street-side parapet.
    box(group, revealMat, width + 0.3, 0.22, depth + 0.3, 0, totalH + 0.11, 0, true);
    box(group, bodyMat, width, 0.45, 0.3, 0, totalH + 0.45, front - 0.15, true);
    return totalH + 0.68;
  }

  // ── String course (floor line) ──────────────────────────────────────────────
  function addStringCourse(group, width, y, front) {
    box(group, mats.concrete, width, 0.14, 0.1, 0, y, front + 0.03, true);
  }

  // Pick an upper-floor window arrangement and draw it. `pattern` chosen by caller.
  function addUpperWindows(group, p) {
    const { width, groundH, upperH, upperFloors, front, pattern, rng } = p;
    if (upperFloors <= 0) return;
    const margin = 0.7;
    const usable = width - margin * 2;
    const firstRowY = groundH + upperH * 0.5;

    if (pattern === 'ribbon') {
      // Continuous horizontal ribbon glazing per floor (wide, short panes, no gaps).
      const cols = Math.max(3, Math.min(10, Math.round(width / 1.3)));
      const dx = usable / cols;
      addWindowGrid(group, {
        cols, rows: upperFloors, x0: -usable / 2 + dx / 2, y0: firstRowY,
        dx, dy: upperH, paneW: dx * 0.92, paneH: Math.min(upperH * 0.5, 1.4),
        z: front, depthInset: 0.1, inset: 0.06,
      });
    } else if (pattern === 'strips') {
      // Tall vertical window strips (slender, full-floor height).
      const cols = Math.max(2, Math.min(6, Math.round(width / 2.4)));
      const dx = usable / cols;
      addWindowGrid(group, {
        cols, rows: upperFloors, x0: -usable / 2 + dx / 2, y0: firstRowY,
        dx, dy: upperH, paneW: Math.min(dx * 0.45, 0.9), paneH: upperH * 0.74,
        z: front, depthInset: 0.12,
      });
    } else {
      // Punched grid (classic masonry / plaster). Column count tied to width.
      const cols = Math.max(2, Math.min(8, Math.round(width / 1.9 + (rng() - 0.5))));
      const dx = usable / cols;
      addWindowGrid(group, {
        cols, rows: upperFloors, x0: -usable / 2 + dx / 2, y0: firstRowY,
        dx, dy: upperH, paneW: Math.min(dx * 0.62, 1.25), paneH: Math.min(upperH * 0.6, 1.7),
        z: front, depthInset: 0.12,
      });
    }
  }

  // ── Seed → archetype selection ──────────────────────────────────────────────
  // Tall buildings bias toward the corner anchor; otherwise spread evenly across
  // the five street archetypes. Deterministic given the seeded rng.
  function pickArchetype(rng, floors, real) {
    if (floors >= 4 && rng() < 0.7) return ARCH.CORNER_ANCHOR;
    const r = rng();
    if (r < 0.2) return ARCH.FLAT_MODERN;
    if (r < 0.44) return ARCH.AWNING_SHOP;
    if (r < 0.66) return ARCH.MASONRY;
    if (r < 0.84) return ARCH.SETBACK;
    return ARCH.BAY_BALCONY;
  }

  /**
   * Build one realistic storefront.
   * opts = { width=8, depth=7, floors, hue, real=false, name, signHue }
   */
  function storefront(opts = {}) {
    const o = opts || {};
    const width = o.width != null ? o.width : 8;
    const depth = o.depth != null ? o.depth : 7;
    const hue = o.hue != null ? o.hue : 210;
    const signHue = o.signHue != null ? o.signHue : hue;
    const real = !!o.real;
    const name = o.name;

    // ── Deterministic variation ─────────────────────────────────────────────
    const rng = makeRng(hashSeed(hue, width, depth, o.floors || 0, real ? 7 : 0));

    // Floor count: respect caller, else pick 2–4 (flagships read taller).
    let floors = o.floors != null ? o.floors
      : (real ? 3 + (rng() < 0.4 ? 1 : 0) : 2 + Math.floor(rng() * 3));
    floors = Math.max(1, Math.min(6, floors));

    const archetype = pickArchetype(rng, floors, real);

    // Storey heights. Flagships / anchors get a taller ground floor.
    const groundH = (real || archetype === ARCH.CORNER_ANCHOR) ? 4.4 : 3.8;
    const upperH = 3.2;
    const upperFloors = floors - 1;
    const totalH = groundH + upperFloors * upperH;

    // Façade material per archetype (so silhouette + skin both vary).
    let bodyMat;
    if (archetype === ARCH.MASONRY) {
      bodyMat = rng() < 0.6 ? mats.brick : mats.concrete;
    } else if (archetype === ARCH.FLAT_MODERN) {
      bodyMat = rng() < 0.5 ? mats.concrete : mats.plaster(hue);
    } else {
      const f = rng();
      bodyMat = f < 0.62 ? mats.plaster(hue) : (f < 0.84 ? mats.concrete : mats.brick);
    }

    const group = new THREE.Group();
    const hw = width / 2;
    const hd = depth / 2;
    const front = hd;             // +Z street face plane

    // ── Body shell ───────────────────────────────────────────────────────────
    box(group, bodyMat, width, totalH, depth, 0, totalH / 2, 0, true);

    // ── Ground-floor shopfront (shared, readable) ─────────────────────────────
    // Flat-modern uses a deeper full-height glass bay (smaller bulkhead/transom).
    const sfParams = archetype === ARCH.FLAT_MODERN
      ? { width, groundH, front, bodyMat, rng, inset: 0.55, bulkheadH: 0.3, transomDrop: 0.35 }
      : { width, groundH, front, bodyMat, rng, inset: 0.4, bulkheadH: 0.55, transomDrop: 0.55 };
    const sf = buildShopfront(group, sfParams);

    // ── Per-archetype façade composition ──────────────────────────────────────
    const fasciaY = groundH - 0.28;
    let rooflineStyle = 'parapet';
    let windowPattern = 'grid';

    switch (archetype) {
      case ARCH.FLAT_MODERN: {
        // Slim curtain wall above, ribbon glazing, near-flush cap band, no awning.
        windowPattern = 'ribbon';
        rooflineStyle = 'capband';
        addSign(group, { width, front, fasciaY, name, signHue, real, rng });
        break;
      }
      case ARCH.AWNING_SHOP: {
        // Fabric awning + projecting fascia/blade sign; punched/strip windows above.
        windowPattern = rng() < 0.5 ? 'grid' : 'strips';
        rooflineStyle = 'parapet';
        addAwning(group, { width, front, atY: sf.transomH, signHue, hue, rng });
        addSign(group, { width, front, fasciaY, name, signHue, real, rng });
        break;
      }
      case ARCH.MASONRY: {
        // Brick/concrete, punched grid, string courses each floor, projecting cornice.
        windowPattern = 'grid';
        rooflineStyle = 'cornice';
        addSign(group, { width, front, fasciaY, name, signHue, real, rng });
        for (let f = 1; f < floors; f++) addStringCourse(group, width, groundH + (f - 1) * upperH + 0.02, front);
        break;
      }
      case ARCH.SETBACK: {
        // Upper-most floor stepped back, leaving a roof terrace with railing + planters.
        windowPattern = rng() < 0.5 ? 'grid' : 'ribbon';
        rooflineStyle = 'parapet';
        addAwning(group, { width, front, atY: sf.transomH, signHue, hue, rng });
        addSign(group, { width, front, fasciaY, name, signHue, real, rng });
        break;
      }
      case ARCH.BAY_BALCONY: {
        // Projecting bay window OR a balcony on an upper floor.
        windowPattern = 'grid';
        rooflineStyle = 'parapet';
        addAwning(group, { width, front, atY: sf.transomH, signHue, hue, rng });
        addSign(group, { width, front, fasciaY, name, signHue, real, rng });
        break;
      }
      case ARCH.CORNER_ANCHOR: {
        // Taller prominent massing: full-height corner piers, vertical window strips.
        windowPattern = 'strips';
        rooflineStyle = 'cornice';
        addSign(group, { width, front, fasciaY, name, signHue, real, rng });
        // Corner piers (read as structural verticals expressing the height).
        const pw = Math.max(0.5, width * 0.07);
        box(group, bodyMat, pw, totalH, 0.34, -hw + pw / 2, totalH / 2, front + 0.04, true);
        box(group, bodyMat, pw, totalH, 0.34, hw - pw / 2, totalH / 2, front + 0.04, true);
        // a slim vertical brow/fin centred at the top to accent the anchor
        box(group, mats.steelDark, 0.18, totalH - groundH, 0.4, 0, groundH + (totalH - groundH) / 2, front + 0.06, true);
        break;
      }
    }

    // ── Upper-floor windows (skips the top floor for SETBACK; drawn below) ─────
    if (upperFloors > 0) {
      const winFloors = archetype === ARCH.SETBACK ? upperFloors - 1 : upperFloors;
      if (winFloors > 0) {
        addUpperWindows(group, {
          width, groundH, upperH, upperFloors: winFloors, front, pattern: windowPattern, rng,
        });
      }
      // String course between ground and first upper floor (all but masonry, which
      // already drew its own per-floor courses).
      if (archetype !== ARCH.MASONRY) addStringCourse(group, width, groundH + 0.02, front);
    }

    // ── SETBACK: carve the top floor back + add terrace railing & planters ─────
    let effectiveTotalH = totalH;
    if (archetype === ARCH.SETBACK && upperFloors >= 1) {
      const terraceY = groundH + (upperFloors - 1) * upperH; // top of the lower mass
      const setW = width - 1.6;                              // stepped-back upper box
      const setD = depth - 1.4;
      const setFront = setD / 2;
      // The slimmer top-floor volume, pushed back from the street.
      box(group, bodyMat, setW, upperH, setD, 0, terraceY + upperH / 2, -(depth - setD) / 2, true);
      // its glazing (a short ribbon)
      const setCols = Math.max(2, Math.round(setW / 1.6));
      const setUsable = setW - 1.6;
      addWindowGrid(group, {
        cols: setCols, rows: 1,
        x0: -setUsable / 2, y0: terraceY + upperH * 0.55,
        dx: setUsable / (setCols - 1),
        dy: upperH, paneW: Math.min(1.2, setW / 4), paneH: upperH * 0.5,
        z: setFront, depthInset: 0.1,
      });
      // Roof-terrace deck cap + a street-side railing + a couple of planters.
      box(group, mats.concrete, width, 0.14, depth, 0, terraceY + 0.07, 0, true);
      addRailing(group, { x0: -hw + 0.4, x1: hw - 0.4, y: terraceY + 0.14, z: front - 0.25 });
      const planterMat = mats.plaster((hue + 40) % 360);
      box(group, planterMat, 0.7, 0.45, 0.5, -hw + 0.9, terraceY + 0.36, front - 0.5, true);
      box(group, planterMat, 0.7, 0.45, 0.5, hw - 0.9, terraceY + 0.36, front - 0.5, true);
      // greenery blobs in the planters
      const leaf = new THREE.MeshStandardMaterial({ color: hsl(130, 0.3, 0.32), roughness: 0.9, metalness: 0 });
      box(group, leaf, 0.5, 0.4, 0.4, -hw + 0.9, terraceY + 0.74, front - 0.5, true);
      box(group, leaf, 0.5, 0.4, 0.4, hw - 0.9, terraceY + 0.74, front - 0.5, true);
      effectiveTotalH = terraceY + upperH; // roofline caps the stepped-back top volume
    }

    // ── BAY_BALCONY: projecting bay window OR balcony on a chosen upper floor ──
    if (archetype === ARCH.BAY_BALCONY && upperFloors >= 1) {
      const floorIdx = 1 + Math.floor(rng() * upperFloors); // 1..upperFloors
      const fy = groundH + (floorIdx - 1) * upperH;          // base of that floor
      if (rng() < 0.5) {
        // Projecting bay window: a shallow glazed box cantilevered from the façade.
        const bw = Math.min(width * 0.5, 3.0);
        const bd = 0.8;
        const by = fy + upperH * 0.5;
        box(group, bodyMat, bw + 0.2, upperH * 0.92, bd, 0, by, front + bd / 2, true); // bay body
        // glazing on the three exposed faces (front + 2 returns), instanced cheaply
        const bayGlass = new THREE.InstancedMesh(UNIT_BOX, mats.glassDark, 3);
        const m = new THREE.Matrix4(); const q = new THREE.Quaternion();
        const s = new THREE.Vector3(bw * 0.9, upperH * 0.62, 0.06); const pp = new THREE.Vector3();
        pp.set(0, by, front + bd + 0.01); m.compose(pp, q, s); bayGlass.setMatrixAt(0, m);
        const sSide = new THREE.Vector3(0.06, upperH * 0.62, bd * 0.8);
        pp.set(-(bw / 2 + 0.08), by, front + bd / 2); m.compose(pp, q, sSide); bayGlass.setMatrixAt(1, m);
        pp.set(bw / 2 + 0.08, by, front + bd / 2); m.compose(pp, q, sSide); bayGlass.setMatrixAt(2, m);
        bayGlass.instanceMatrix.needsUpdate = true; group.add(bayGlass);
        // a little capping ledge
        box(group, mats.concrete, bw + 0.34, 0.12, bd + 0.16, 0, fy + upperH * 0.96, front + bd / 2, true);
      } else {
        // Balcony: a thin slab + railing projecting from a set of French doors.
        const balW = Math.min(width * 0.6, 3.4);
        box(group, mats.concrete, balW, 0.14, 0.9, 0, fy + 0.07, front + 0.45, true); // slab
        addRailing(group, { x0: -balW / 2, x1: balW / 2, y: fy + 0.14, z: front + 0.85 });
        // French doors (two tall glass leaves) in the façade behind the balcony
        const fdGlass = new THREE.InstancedMesh(UNIT_BOX, mats.glassDark, 2);
        const m = new THREE.Matrix4(); const q = new THREE.Quaternion();
        const s = new THREE.Vector3(0.7, upperH * 0.7, 0.05); const pp = new THREE.Vector3();
        pp.set(-0.45, fy + upperH * 0.42, front + 0.02); m.compose(pp, q, s); fdGlass.setMatrixAt(0, m);
        pp.set(0.45, fy + upperH * 0.42, front + 0.02); m.compose(pp, q, s); fdGlass.setMatrixAt(1, m);
        fdGlass.instanceMatrix.needsUpdate = true; group.add(fdGlass);
      }
    }

    // ── Roofline (parapet / cornice / cap band) over the effective top ────────
    const capTop = addRoofline(group, {
      width, depth, totalH: effectiveTotalH, front, bodyMat, style: rooflineStyle,
    });

    // ── Return values (all in the group's LOCAL space) ────────────────────────
    const footprint = { w: width, d: depth };
    const entrance = new THREE.Vector3(sf.doorX, sf.doorH / 2, front + 0.05);
    // Marker floats above the actual top cap so it always reads as "enter here",
    // regardless of which massing/roofline this building got.
    const markerAnchor = new THREE.Vector3(0, capTop + (real ? 1.4 : 1.0), 0);

    return { group, footprint, entrance, markerAnchor };
  }

  return { storefront };
}
