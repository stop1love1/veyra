// @ts-nocheck -- Ready Player Me (rigged GLB) avatar with skeletal actions + ARKit
// facial expressions. Mirrors the procedural buildAvatar interface so the world
// loop, preview and remotes can use either via avatarFactory.createAvatar.
//
//   buildGlbAvatar({ url, hue?, style?, age?, animBaseUrl?, onReady? }) -> Avatar
//
// The avatar object is returned SYNCHRONOUSLY; the GLB streams in async and its
// meshes appear in `group` when ready. On any load failure it transparently
// becomes a procedural avatar (kind flips to 'procedural', `parts` becomes the real
// meshes) so the player is never invisible. 1 world unit ≈ 1 metre.
//
// The pure logic (expression→morph map, locomotion state machine, blink, morph
// lerp) is exported separately and unit-tested without THREE / a browser.

import * as THREE from 'three';
import { getSharedGltfLoader } from './loaderSingleton';
import { animLib } from './animLib';
import { buildAvatar } from './avatar';

/* ============================ pure, testable logic ======================== */

// ARKit blendshape influences per expression (RPM heads carry these morphs on the
// Wolf3D_Head / Wolf3D_Teeth meshes). Missing morphs are silently skipped.
export const EXPRESSION_MORPHS = {
  neutral: {},
  happy: {
    mouthSmileLeft: 0.7, mouthSmileRight: 0.7,
    cheekSquintLeft: 0.3, cheekSquintRight: 0.3,
    eyeSquintLeft: 0.2, eyeSquintRight: 0.2,
  },
  surprised: {
    eyeWideLeft: 0.9, eyeWideRight: 0.9,
    browOuterUpLeft: 0.6, browOuterUpRight: 0.6, browInnerUp: 0.5,
    jawOpen: 0.4,
  },
  sad: {
    browInnerUp: 0.6, browDownLeft: 0.3, browDownRight: 0.3,
    eyeSquintLeft: 0.4, eyeSquintRight: 0.4,
    mouthFrownLeft: 0.5, mouthFrownRight: 0.5,
  },
  angry: {
    browDownLeft: 0.8, browDownRight: 0.8,
    noseSneerLeft: 0.3, noseSneerRight: 0.3,
    eyeSquintLeft: 0.3, eyeSquintRight: 0.3,
    mouthPressLeft: 0.2, mouthPressRight: 0.2,
  },
};

export const BLINK_INTERVAL = 3.4;   // base seconds between blinks

// Emote → animation-clip name (handles the legacy 'celebrate' alias).
export const EMOTE_CLIP = {
  wave: 'wave', celebrate: 'dance', dance: 'dance', bow: 'bow', clap: 'clap',
  point: 'point', 'arms-crossed': 'arms-crossed', think: 'think',
};

// Default logical-name → file map for the bundled/vendored RPM animation pack.
export const ANIM_FILES = {
  idle: 'idle.glb', walk: 'walk.glb', run: 'run.glb', sit: 'sit.glb',
  wave: 'wave.glb', dance: 'dance.glb', bow: 'bow.glb', clap: 'clap.glb',
  point: 'point.glb', 'arms-crossed': 'arms-crossed.glb', think: 'think.glb',
};

export function animUrls(base) {
  const b = (base || '/models/rpm/animations/').replace(/\/?$/, '/');
  const out = {};
  for (const name in ANIM_FILES) out[name] = b + ANIM_FILES[name];
  return out;
}

/**
 * Pick the locomotion state. Pure. `current` lets us model the emote hold:
 * while emoting we stay until the clip ends or the player walks.
 */
export function selectLocoState(current, state, emoteElapsed, emoteDuration) {
  state = state || {};
  const loco = state.sitting ? 'sit' : (state.running && state.moving) ? 'run' : state.moving ? 'walk' : 'idle';
  if (current === 'emote') {
    if (state.moving) return loco;                 // movement cancels the emote
    if (emoteElapsed >= emoteDuration) return loco; // emote finished
    return 'emote';
  }
  return loco;
}

/** Advance the auto-blink. Pure; returns a NEW state (blink 1=open, 0=closed). */
export function tickBlink(state, dt) {
  let timer = state.timer - dt;
  let blink = Math.min(1, state.blink + dt * 9);   // recover toward open
  if (timer <= 0) { timer = BLINK_INTERVAL; blink = 0; }   // snap shut, then recover
  return { timer, blink };
}

/**
 * Lerp every morph in each mesh's dictionary toward its target influence (0 when
 * absent from `targets`). Tolerates plain-object meshes → unit-testable. `eyeBlink*`
 * is intentionally NOT driven here (the caller sets it directly for a snappy blink).
 */
export function applyMorphs(meshes, targets, dt) {
  const k = 1 - Math.exp(-dt * 9);   // caller clamps dt; pure lerp here
  for (const mesh of meshes) {
    const dict = mesh.morphTargetDictionary, infl = mesh.morphTargetInfluences;
    if (!dict || !infl) continue;
    for (const name in dict) {
      if (name === 'eyeBlinkLeft' || name === 'eyeBlinkRight') continue;
      const idx = dict[name];
      const tgt = targets[name] != null ? targets[name] : 0;
      infl[idx] += (tgt - infl[idx]) * k;
    }
  }
}

/* ================================ the avatar ============================== */

export function buildGlbAvatar(cfg = {}) {
  const group = new THREE.Group();
  const gait = { stepRate: 1, swingAmt: 1 };

  // A no-op `parts` so any stray loop write (legL.rotation.x = …) is harmless on
  // the GLB path; replaced by the REAL procedural parts if we fall back.
  const noopParts = makeNoopParts();
  let _parts = noopParts;

  let disposed = false, loaded = false, failed = false, fallback = null;
  let mixer = null, mixerRoot = null, curAction = null, loco = 'idle';
  let morphMeshes = [], eyeBlink = [];
  let emote = null, emoteT = 0, emoteDur = 0;
  let exprTarget = 'neutral';
  let blink = { timer: 1.5 + Math.random() * 2, blink: 1 };

  let resolveReady;
  const readyP = new Promise((r) => { resolveReady = r; });

  const avatar = {
    kind: 'glb',
    group,
    get parts() { return _parts; },
    gait,
    mats: {},
    setExpression, playEmote, isEmoting, update, applySit, dispose,
    get ready() { return readyP; },
  };

  if (cfg.url) getSharedGltfLoader().load(cfg.url, onLoad, undefined, onError);
  else onError(new Error('no avatar url'));

  function onLoad(gltf) {
    if (disposed) return;
    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) return onError(new Error('empty gltf'));
    // Drop the model so its feet sit at group y=0.
    const box = new THREE.Box3().setFromObject(root);
    root.position.y -= box.min.y;
    root.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
        if (o.morphTargetDictionary && o.morphTargetInfluences) morphMeshes.push(o);
      }
    });
    group.add(root);
    if (!morphMeshes.length) console.warn('[glbAvatar] no morph meshes — facial expressions disabled');
    // Precompute blink morph indices per mesh.
    eyeBlink = morphMeshes.map((m) => ({
      infl: m.morphTargetInfluences,
      li: m.morphTargetDictionary.eyeBlinkLeft ?? -1,
      ri: m.morphTargetDictionary.eyeBlinkRight ?? -1,
    }));
    mixer = new THREE.AnimationMixer(root);
    mixerRoot = root;            // mixer caches by THIS root → uncache the same in dispose()
    loaded = true;
    // `ready` resolves once clips are loaded and idle is playing (fully operational),
    // not merely when the mesh is attached. loadClips always settles (per-clip errors
    // resolve), so this never hangs.
    animLib.loadClips(animUrls(cfg.animBaseUrl)).then(() => {
      if (disposed) return;
      transitionTo('idle', 0);
      cfg.onReady && cfg.onReady();
      resolveReady();
    });
  }

  function onError(err) {
    if (disposed) return;
    if (cfg.url) console.warn('[glbAvatar] GLB load failed → procedural fallback:', err && err.message);
    failed = true;
    fallback = buildAvatar({ hue: cfg.hue, style: cfg.style, age: cfg.age });
    while (fallback.group.children.length) group.add(fallback.group.children[0]);  // adopt the meshes
    _parts = fallback.parts;
    avatar.kind = 'procedural';            // the world loop will now drive parts + applySitPose
    gait.stepRate = fallback.gait.stepRate; gait.swingAmt = fallback.gait.swingAmt;
    resolveReady();
  }

  function transitionTo(name, fade, loop = true) {
    if (!mixer) return;
    const clip = animLib.getClip(name);
    if (!clip) return;                     // missing clip → keep the current action
    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.play();
    if (curAction && curAction !== action) action.crossFadeFrom(curAction, fade || 0.25, false);
    else if (fade) action.fadeIn(fade);
    curAction = action;
    if (loop) loco = name;
  }

  function locoFor(state) { return selectLocoState('idle', state, 0, 0); }

  function update(dt, state) {
    if (failed && fallback) { fallback.update(dt, state); return; }
    if (!loaded) return;
    dt = Math.min(0.05, dt || 0);
    state = state || {};

    if (emote) {
      emoteT += dt;
      if (state.moving || emoteT >= emoteDur) { emote = null; transitionTo(locoFor(state), 0.18); }
    } else {
      const n = locoFor(state);
      if (n !== loco) transitionTo(n, 0.25);
    }

    if (mixer) mixer.update(dt);

    if (morphMeshes.length) {
      applyMorphs(morphMeshes, EXPRESSION_MORPHS[exprTarget] || EXPRESSION_MORPHS.neutral, dt);
      blink = tickBlink(blink, dt);
      const closed = 1 - blink.blink;
      for (const b of eyeBlink) { if (b.li >= 0) b.infl[b.li] = closed; if (b.ri >= 0) b.infl[b.ri] = closed; }
    }
  }

  function setExpression(name) {
    if (failed && fallback) return fallback.setExpression(name);
    if (EXPRESSION_MORPHS[name]) exprTarget = name;
  }

  function playEmote(name) {
    if (failed && fallback) return fallback.playEmote(name);
    if (!loaded) return;
    const clipName = EMOTE_CLIP[name] || name;
    const clip = animLib.getClip(clipName);
    if (!clip) return;                     // emote clip not available → ignore
    emote = clipName; emoteT = 0; emoteDur = Math.max(0.8, clip.duration || 2.2);
    transitionTo(clipName, 0.15, false);
    exprTarget = 'happy';
  }

  function isEmoting() { return failed && fallback ? fallback.isEmoting() : !!emote; }

  function applySit(on) {
    // The locomotion SM already drives 'sit' from state.sitting in update(); this
    // hook stays for symmetry with the procedural path (and future sit tuning).
  }

  function dispose() {
    disposed = true;
    if (mixer) { try { mixer.stopAllAction(); mixer.uncacheRoot(mixerRoot || group); } catch (_) {} }
    group.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.geometry?.dispose?.();
        const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose?.());
      }
    });
    if (fallback) fallback.dispose?.();
  }

  return avatar;
}

// A `parts` stand-in whose nested rotation/position/scale writes are discarded, so
// the world loop's procedural pose code is a harmless no-op on the GLB path.
function makeNoopParts() {
  const sink = new Proxy({}, {
    get(_, k) {
      if (k === 'setScalar' || k === 'set' || k === 'copy') return () => {};
      if (k === 'rotation' || k === 'position' || k === 'scale') return sink;
      return 0;
    },
    set() { return true; },
  });
  return { legL: sink, legR: sink, armL: sink, armR: sink, torso: sink, head: sink, hair: sink, headGroup: sink };
}
