// @ts-nocheck -- adaptive post-processing (EffectComposer) pipeline
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';

/**
 * Build an adaptive post-processing pipeline for an outdoor street scene.
 *
 * The look is intentionally SUBTLE and grounded:
 *  - SSAO adds contact-shadow realism where geometry meets geometry.
 *  - Bloom uses a HIGH threshold + LOW strength so it only "kisses" genuinely
 *    bright / emissive surfaces (lamps, sun-hit glass) — never a glowy haze.
 *  - FXAA + a faint vignette finish the frame.
 *
 * Everything past RenderPass is gated by the device `quality` config. On the
 * low tier (`!quality.enablePost`) we return a passthrough that just calls
 * `renderer.render(scene, camera)` so no composer cost is paid at all.
 *
 * TONE MAPPING ORDERING (important):
 *   The environment/integrator sets `renderer.toneMapping = ACESFilmicToneMapping`.
 *   In the composer path, OutputPass is what actually APPLIES that tone mapping
 *   plus the sRGB color-space conversion at the end of the chain. We therefore
 *   include OutputPass and rely on `renderer.toneMapping` already being set —
 *   we do NOT tone-map anywhere else, to avoid double-applying it.
 *
 * @returns { composer, render, setSize, setBloom, dispose }
 */
export function createComposer(renderer, scene, camera, { quality } = {}) {
  const q = quality || {};

  // --- low tier: no composer, plain forward render --------------------------
  if (!q.enablePost) {
    return {
      composer: null,
      render() {
        renderer.render(scene, camera);
      },
      setSize() {
        /* nothing extra to resize on the passthrough path */
      },
      setPixelRatio() {
        /* passthrough renders straight through the renderer, whose pixel ratio the
           caller sets directly — nothing extra to do here */
      },
      setBloom() {
        /* no bloom without a composer — no-op */
      },
      dispose() {
        /* nothing allocated — no-op */
      },
    };
  }

  // initial backing-buffer size (CSS pixels; passes that need device pixels
  // multiply by renderer.getPixelRatio() themselves below).
  const size = renderer.getSize(new THREE.Vector2());
  let w = Math.max(1, size.x);
  let h = Math.max(1, size.y);

  const composer = new EffectComposer(renderer);
  composer.setSize(w, h);

  // refs we may need to touch on resize / runtime tweaks
  let ssaoPass = null;
  let bloomPass = null;
  let fxaaPass = null;

  // 1. base scene render -----------------------------------------------------
  composer.addPass(new RenderPass(scene, camera));

  // 2. SSAO (high tier only) — subtle contact shadows ------------------------
  if (q.enableSSAO) {
    ssaoPass = new SSAOPass(scene, camera, w, h);
    // Small kernel: tight, local occlusion rather than a broad dark wash.
    ssaoPass.kernelRadius = 8;
    // Tuned for a meters-scale scene (world units == metres).
    ssaoPass.minDistance = 0.0015;
    ssaoPass.maxDistance = 0.12;
    // Beauty output (default) — NOT the AO-only / depth debug views.
    ssaoPass.output = SSAOPass.OUTPUT.Default;
    composer.addPass(ssaoPass);
  }

  // 3. Bloom — only bright / emissive pixels ---------------------------------
  if (q.enableBloom) {
    // strength 0.25 (low), radius 0.4, threshold 0.9 (high) => only lamps /
    // sun-hit glass cross the threshold and bloom; the scene stays grounded.
    bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.25, 0.4, 0.8);
    composer.addPass(bloomPass);
  }

  // 4. OutputPass — applies renderer.toneMapping + sRGB conversion -----------
  //    Placed after the HDR-domain passes (SSAO/bloom) and before the
  //    LDR finishing passes (AA / vignette). See header note on tone mapping.
  composer.addPass(new OutputPass());

  // 5. FXAA — cheap anti-aliasing in device pixels ---------------------------
  fxaaPass = new ShaderPass(FXAAShader);
  applyFxaaResolution(fxaaPass, w, h);
  composer.addPass(fxaaPass);

  // 6. Vignette — very subtle edge darkening ---------------------------------
  const vignettePass = new ShaderPass(VignetteShader);
  vignettePass.uniforms.offset.value = 0.95;
  vignettePass.uniforms.darkness.value = 0.6;
  composer.addPass(vignettePass);

  // --- helpers --------------------------------------------------------------
  function applyFxaaResolution(pass, width, height) {
    const dpr = renderer.getPixelRatio();
    pass.material.uniforms.resolution.value.set(
      1 / (width * dpr),
      1 / (height * dpr),
    );
  }

  return {
    composer,

    render(dt) {
      composer.render(dt);
    },

    setSize(width, height) {
      w = Math.max(1, width);
      h = Math.max(1, height);
      composer.setSize(w, h);
      if (ssaoPass) ssaoPass.setSize(w, h);
      if (bloomPass) bloomPass.setSize(w, h);
      if (fxaaPass) applyFxaaResolution(fxaaPass, w, h);
    },

    // Dynamic-resolution hook. EffectComposer caches its own pixel ratio at
    // construction and does NOT track renderer.setPixelRatio(), so changing the
    // backing-buffer resolution at runtime must go through composer.setPixelRatio()
    // (which resizes RT1/RT2 + every pass to width×height×ratio). The caller sets the
    // renderer's pixel ratio separately for the non-composed passes (e.g. Water).
    setPixelRatio(pr) {
      const p = Number(pr);
      if (!Number.isFinite(p) || p <= 0) return;
      composer.setPixelRatio(p);
      // FXAA's resolution uniform reads renderer.getPixelRatio() (already updated by
      // the caller), so re-derive it against the current CSS size.
      if (fxaaPass) applyFxaaResolution(fxaaPass, w, h);
    },

    // Runtime bloom tweak, used at night to lift lamp glow a touch.
    // Clamp to a sane, still-subtle range so it never becomes a bloom-fest.
    setBloom(strength) {
      if (!bloomPass) return;
      const s = Number(strength);
      if (!Number.isFinite(s)) return;
      bloomPass.strength = Math.max(0, Math.min(1.5, s));
    },

    dispose() {
      composer?.dispose();
      // Dispose any pass that exposes a dispose() (SSAO/bloom hold render
      // targets; EffectComposer.dispose only frees its own RTs).
      for (const pass of composer?.passes || []) {
        if (pass && typeof pass.dispose === 'function') pass.dispose();
      }
      ssaoPass = null;
      bloomPass = null;
      fxaaPass = null;
    },
  };
}
