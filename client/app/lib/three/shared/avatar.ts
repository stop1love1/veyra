// @ts-nocheck -- shared detailed avatar used by the gate, store, world player,
// remote players and the character-setup preview.
//
// The avatar is AGE-PARAMETRIC and EXPRESSIVE: one rig whose body proportions are
// driven by an age (slider 6–70), with a real face (eyes that blink, brows, a
// mouth that smiles / frowns / gapes) and basic emotes (wave, celebrate). The
// limb/torso interface (`parts`) is unchanged, so the world loop's existing
// walk / run / jump / sit animation keeps working — buildAvatar only ADDS a head
// group with the face plus an `update(dt, state)` driving blink / idle / emotes.
//
//   buildAvatar(cfg) -> {
//     group, mats, parts, acc, face, gait,
//     setStyle, setHue, setAge, setExpression, playEmote, update(dt, state)
//   }
//   cfg: { hue, skinColor?, style?, hairLight?, age? }
//
// All procedural geometry — no external assets. 1 world unit ≈ 1 metre.
import * as THREE from 'three';
import { hsl, SKINS } from './helpers';

/* ============================ pure, testable logic ======================== */

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Body proportions as a function of age. Pure (no THREE) so it can be unit-tested.
 *  - growth (childhood → adult, full by ~20) shrinks the child + enlarges the head
 *  - aging  (50 → 70) greys the hair, adds a slight stoop, slows the cadence
 */
export function ageProportions(age) {
  const a = clamp(age == null ? 24 : age, 4, 90);
  const growth = clamp((a - 6) / (20 - 6), 0, 1);   // 0 at 6yo, 1 by 20yo
  const aging = clamp((a - 50) / 20, 0, 1);         // 0 until 50, 1 by 70
  return {
    age: a,
    bodyScale: lerp(0.66, 1.0, growth),   // ≈1.15 m at 6 → ≈1.75 m adult
    headRatio: lerp(1.35, 1.0, growth),   // relatively larger child head
    aging,
    stoop: aging * 0.17,                  // forward torso/neck tilt (radians)
    hairGrey: aging,                      // 0..1 toward grey
    idleRate: lerp(1.15, 0.85, growth) * lerp(1, 0.8, aging),   // blink/look cadence
    stepRate: lerp(1.28, 1.0, growth) * lerp(1, 0.82, aging),   // walk cadence factor
    swingAmt: lerp(1.22, 1.0, growth) * lerp(1, 0.78, aging),   // limb swing scale
  };
}

/**
 * Facial-expression presets. Each is a target the face eases toward.
 *   eyeOpen  : 0 (shut) .. 1.4 (wide)
 *   browY    : vertical brow offset (m), + = raised
 *   browTilt : inner-end tilt (rad), + = inner UP (sad), − = inner DOWN (angry)
 *   mouth    : 'smile' | 'frown' | 'flat' | 'open'  (which mouth mesh shows)
 */
export const EXPRESSIONS = {
  neutral:   { eyeOpen: 1.0, browY: 0.0,   browTilt: 0.0,  mouth: 'flat' },
  happy:     { eyeOpen: 0.82, browY: 0.004, browTilt: 0.02, mouth: 'smile' },
  surprised: { eyeOpen: 1.35, browY: 0.018, browTilt: 0.0,  mouth: 'open' },
  sad:       { eyeOpen: 0.85, browY: 0.004, browTilt: 0.10, mouth: 'frown' },
  angry:     { eyeOpen: 0.95, browY: -0.012, browTilt: -0.12, mouth: 'frown' },
};

/** Emote clips: duration (s) and which expression they wear. */
export const EMOTES = {
  wave:      { dur: 2.2, expr: 'happy' },
  celebrate: { dur: 2.6, expr: 'happy' },
};

/* ================================ the avatar ============================== */

// cfg: { hue, skinColor?, style?, hairLight?, age? }
export function buildAvatar(cfg = {}) {
  const hue = cfg.hue != null ? cfg.hue : 184;
  const hairLight = cfg.hairLight != null ? cfg.hairLight : 0.2;

  const grp = new THREE.Group();
  const clothMat = new THREE.MeshStandardMaterial({ color: hsl(hue, .55, .52), roughness: .8 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: hsl(hue, .35, .3), roughness: .85 });
  const skinMat = new THREE.MeshStandardMaterial({ color: cfg.skinColor || SKINS[1], roughness: .9 });
  const hairBase = new THREE.Color().setHSL(hue / 360, .4, hairLight);
  const hairMat = new THREE.MeshStandardMaterial({ color: hairBase.clone(), roughness: 1 });
  // Face materials.
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf7f7f2, roughness: .5 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: hsl(25, .5, .12), roughness: .5 });
  const browMat = new THREE.MeshStandardMaterial({ color: hairBase.clone(), roughness: 1 });
  const mouthMat = new THREE.MeshStandardMaterial({ color: hsl(2, .45, .32), roughness: .7 });
  const mouthDarkMat = new THREE.MeshStandardMaterial({ color: hsl(2, .5, .12), roughness: .8 });

  const cap = (r, len, m) => { const x = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), m); x.castShadow = true; return x; };
  const torso = cap(.26, .5, clothMat); torso.position.y = 1.05; grp.add(torso);

  // ── Head group: head + hair + face. Scaled by headRatio (child head) and the
  //    whole thing carries the face so it turns/tilts together on look-around. ──
  const headGroup = new THREE.Group();
  const HEAD_BASE_Y = 1.62;
  headGroup.position.y = HEAD_BASE_Y;
  grp.add(headGroup);

  const head = new THREE.Mesh(new THREE.SphereGeometry(.26, 18, 18), skinMat);
  head.castShadow = true; headGroup.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(.285, 16, 16, 0, Math.PI * 2, 0, Math.PI * .62), hairMat);
  hair.position.set(0, .04, -.02); headGroup.add(hair);

  // Face features sit on the +z front of the head (the avatar faces +z).
  const FZ = .235;            // how far forward the face sits
  const EX = .098, EY = .03;  // eye spacing / height
  const eyeGeo = new THREE.SphereGeometry(.045, 10, 10);
  const pupilGeo = new THREE.SphereGeometry(.022, 8, 8);
  const mkEye = (sx) => {
    const g = new THREE.Group(); g.position.set(sx * EX, EY, FZ);
    const w = new THREE.Mesh(eyeGeo, eyeWhiteMat); w.scale.set(1, 1, .6); g.add(w);
    const p = new THREE.Mesh(pupilGeo, pupilMat); p.position.z = .03; g.add(p);
    headGroup.add(g); return g;
  };
  const eyeL = mkEye(-1), eyeR = mkEye(1);

  const browGeo = new THREE.BoxGeometry(.085, .016, .02);
  const BROW_Y = .088;
  const mkBrow = (sx) => { const b = new THREE.Mesh(browGeo, browMat); b.position.set(sx * EX, BROW_Y, FZ + .01); headGroup.add(b); return b; };
  const browL = mkBrow(-1), browR = mkBrow(1);

  // Mouth: four cheap meshes crossfaded by expression (smile ∪ / frown ∩ / flat
  // bar / open O). Only the active one scales in; the rest scale to ~0.
  const MY = -.085;          // mouth height on the face
  const arcGeo = new THREE.TorusGeometry(.05, .013, 6, 14, Math.PI);  // half-arc
  const mouthSmile = new THREE.Mesh(arcGeo, mouthMat); mouthSmile.position.set(0, MY - .01, FZ); mouthSmile.rotation.z = Math.PI; // ∪
  const mouthFrown = new THREE.Mesh(arcGeo, mouthMat); mouthFrown.position.set(0, MY + .02, FZ);                                  // ∩
  const mouthFlat = new THREE.Mesh(new THREE.BoxGeometry(.085, .016, .02), mouthMat); mouthFlat.position.set(0, MY, FZ);
  const mouthOpen = new THREE.Mesh(new THREE.SphereGeometry(.035, 10, 10), mouthDarkMat); mouthOpen.position.set(0, MY, FZ - .005); mouthOpen.scale.set(1, 1.15, .6);
  const mouths = { smile: mouthSmile, frown: mouthFrown, flat: mouthFlat, open: mouthOpen };
  for (const k in mouths) { mouths[k].scale.multiplyScalar(0.001); headGroup.add(mouths[k]); }
  mouthFlat.scale.set(1, 1, 1);   // start neutral

  function limb(x, y, r, len, m) {
    const p = new THREE.Group(); p.position.set(x, y, 0);
    const mm = cap(r, len, m); mm.position.y = -(len / 2 + r); p.add(mm); grp.add(p); return p;
  }
  const armL = limb(-.33, 1.28, .08, .4, clothMat), armR = limb(.33, 1.28, .08, .4, clothMat);
  const legL = limb(-.13, .78, .1, .42, pantsMat), legR = limb(.13, .78, .1, .42, pantsMat);
  [armL, armR].forEach(a => { const h = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 8), skinMat); h.position.y = -.62; a.add(h); });
  [legL, legR].forEach(l => { const f = new THREE.Mesh(new THREE.BoxGeometry(.18, .12, .3), pantsMat); f.position.set(0, -.66, .06); f.castShadow = true; l.add(f); });

  // style accessories (created visible; toggle via setStyle / cfg.style)
  const capHat = new THREE.Group();
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(.27, .29, .22, 14), clothMat); crown.position.y = 1.86;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(.46, .06, .32), clothMat); visor.position.set(0, 1.78, .26);
  capHat.add(crown, visor); grp.add(capHat);
  const tunic = new THREE.Mesh(new THREE.ConeGeometry(.46, .7, 16, 1, true), clothMat); tunic.position.y = .78; grp.add(tunic);

  // ── Live face / idle / emote state (driven by update) ─────────────────────
  const gait = { stepRate: 1, swingAmt: 1 };
  const f = {
    // eased expression values
    eyeOpen: 1, browY: 0, browTilt: 0, mouth: 'flat', mouthMix: { smile: 0, frown: 0, flat: 1, open: 0 },
    target: 'neutral',
    // blink
    blinkTimer: 1.5 + Math.random() * 3, blink: 1,   // blink: 1 = open, dips to 0
    // idle look-around
    lookTimer: 2 + Math.random() * 3, lookYaw: 0, lookPitch: 0, tgtYaw: 0, tgtPitch: 0,
    // emote
    emote: null, emoteT: 0,
    // age-driven idle speed
    idleRate: 1,
  };

  function setExpression(name) { f.target = EXPRESSIONS[name] ? name : 'neutral'; }
  function playEmote(name) { if (EMOTES[name]) { f.emote = name; f.emoteT = 0; } }

  function setHue(h) {
    clothMat.color.copy(hsl(h, .55, .52));
    pantsMat.color.copy(hsl(h, .35, .3));
    const hb = new THREE.Color().setHSL(h / 360, .4, hairLight);
    hairBase.copy(hb);
    applyAge(curAge);   // re-derive greyed hair from the new base
  }

  let curAge = cfg.age != null ? cfg.age : 24;
  function applyAge(age) {
    curAge = age;
    const p = ageProportions(age);
    grp.scale.setScalar(p.bodyScale);
    headGroup.scale.setScalar(p.headRatio);
    // Stoop: tilt the torso + head forward a touch when elderly.
    torso.rotation.x = p.stoop * 0.6;
    headGroup.rotation.x = p.stoop;        // base tilt (look-around adds to this)
    // Grey the hair toward a desaturated light tone with age.
    const grey = new THREE.Color().setHSL(0.09, 0.05, 0.72);
    hairMat.color.copy(hairBase).lerp(grey, p.hairGrey);
    browMat.color.copy(hairMat.color);
    gait.stepRate = p.stepRate; gait.swingAmt = p.swingAmt;
    f.idleRate = p.idleRate;
    f.baseHeadTilt = p.stoop;
  }
  function setAge(age) { applyAge(age); }

  // Per-frame: blink, ease the expression, idle look-around, run emotes. Called
  // by the world loop AFTER its own limb/torso pose so this layers on top.
  // state: { moving?, grounded? }
  function update(dt, state) {
    state = state || {};
    const moving = !!state.moving;
    dt = Math.min(0.05, dt || 0);
    const rate = f.idleRate || 1;

    // Emote lifecycle (cancels the moment the player walks).
    if (f.emote) {
      if (moving) { f.emote = null; }
      else {
        f.emoteT += dt;
        if (f.emoteT >= EMOTES[f.emote].dur) f.emote = null;
      }
    }
    const emoteExpr = f.emote ? EMOTES[f.emote].expr : null;

    // ── Blink: quick dip every few seconds (faster when young). ──
    f.blinkTimer -= dt * rate;
    if (f.blinkTimer <= 0) { f.blinkTimer = 2.4 + Math.random() * 3.2; f.blink = 0; }
    // recover the lid toward open
    f.blink = Math.min(1, f.blink + dt * 9);
    if (f.blink < 1 && f.blinkTimer > 2) f.blink = Math.max(0, f.blink - dt * 18); // brief close at the start

    // ── Ease toward the active expression preset. ──
    const want = EXPRESSIONS[emoteExpr || f.target] || EXPRESSIONS.neutral;
    const k = Math.min(1, dt * 9);
    f.eyeOpen += (want.eyeOpen - f.eyeOpen) * k;
    f.browY += (want.browY - f.browY) * k;
    f.browTilt += (want.browTilt - f.browTilt) * k;
    for (const m in f.mouthMix) f.mouthMix[m] += ((want.mouth === m ? 1 : 0) - f.mouthMix[m]) * k;

    // Apply eyes (blink multiplies the eased openness).
    const open = Math.max(0.04, f.eyeOpen * f.blink);
    eyeL.scale.y = open; eyeR.scale.y = open;
    // Apply brows.
    browL.position.y = BROW_Y + f.browY; browR.position.y = BROW_Y + f.browY;
    browL.rotation.z = f.browTilt; browR.rotation.z = -f.browTilt;
    // Apply mouth crossfade.
    for (const m in mouths) { const s = Math.max(0.001, f.mouthMix[m]); mouths[m].scale.setScalar(s); }
    mouthFlat.scale.set(Math.max(0.001, f.mouthMix.flat), Math.max(0.001, f.mouthMix.flat), 1);
    mouthOpen.scale.set(f.mouthMix.open, f.mouthMix.open * 1.15, f.mouthMix.open * .6);

    // ── Idle look-around (only when standing still and not emoting). ──
    if (moving || f.emote) { f.tgtYaw = 0; f.tgtPitch = 0; }
    else {
      f.lookTimer -= dt * rate;
      if (f.lookTimer <= 0) {
        f.lookTimer = 1.6 + Math.random() * 3.5;
        f.tgtYaw = (Math.random() - 0.5) * 0.7;
        f.tgtPitch = (Math.random() - 0.5) * 0.28;
      }
    }
    f.lookYaw += (f.tgtYaw - f.lookYaw) * Math.min(1, dt * 3);
    f.lookPitch += (f.tgtPitch - f.lookPitch) * Math.min(1, dt * 3);
    headGroup.rotation.y = f.lookYaw;
    headGroup.rotation.x = (f.baseHeadTilt || 0) + f.lookPitch;

    // ── Idle breathing: a tiny chest rise when standing. ──
    const breath = moving ? 0 : Math.sin(performance.now() * 0.0016) * 0.012;
    torso.scale.y = 1 + breath;

    // ── Emote arm poses (override the loop's rested arms while playing). ──
    if (f.emote) {
      const tt = f.emoteT;
      if (f.emote === 'wave') {
        // Right arm up, hand waggling side to side.
        armR.rotation.z = -2.1;
        armR.rotation.x = Math.sin(tt * 12) * 0.5;
        armL.rotation.x = 0;
      } else if (f.emote === 'celebrate') {
        // Both arms up, a little alternating pump + a bounce.
        armL.rotation.z = 1.9; armR.rotation.z = -1.9;
        const pump = Math.sin(tt * 9) * 0.3;
        armL.rotation.x = -1.4 + pump; armR.rotation.x = -1.4 - pump;
        grp.position.y = (grp.userData._baseY || grp.position.y);
      }
    } else {
      // Release any emote-only roll so the loop's swing reads cleanly again.
      armL.rotation.z = 0; armR.rotation.z = 0;
    }
  }

  const avatar = {
    group: grp,
    mats: { clothMat, pantsMat, skinMat, hairMat },
    parts: { armL, armR, legL, legR, torso, head, hair, headGroup },
    face: { eyeL, eyeR, browL, browR, mouths },
    acc: { capHat, tunic },
    gait,
    setStyle(style) { capHat.visible = style === 'street'; tunic.visible = style === 'soft'; },
    setHue, setAge, setExpression, playEmote, update,
    get age() { return curAge; },
    isEmoting() { return !!f.emote; },
  };
  applyAge(curAge);
  if (cfg.style != null) avatar.setStyle(cfg.style);
  return avatar;
}
