// @ts-nocheck -- lightweight 3D character preview for the setup screen.
//
// createAvatarPreview(container, cfg) -> { setAge, setHue, setStyle, dispose }
//
// Mounts a small self-contained Three.js scene with ONE buildAvatar on a turntable
// under soft studio lighting, frames it on the head/upper body, and runs the
// avatar's own update() so it blinks + idles. It periodically cycles a demo
// expression / wave so the face reads as alive while the player tweaks age / hue /
// style. No postfx, no env HDRI, no shadows — cheap enough for a settings screen.
// 1 world unit ≈ 1 metre. All resources are freed in dispose().

import * as THREE from 'three';
import { createAvatar } from './shared/avatarFactory';
import { hsl } from './shared/helpers';

export function createAvatarPreview(container, cfg = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return { setAge() {}, setHue() {}, setStyle() {}, dispose() {} };  // no WebGL → inert
  }

  const W = () => container.clientWidth || 280;
  const H = () => container.clientHeight || 360;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W(), H());
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, W() / H(), 0.1, 50);
  camera.position.set(0, 1.4, 3.6);
  camera.lookAt(0, 1.25, 0);

  // Soft studio lighting: warm key + cool fill + gentle ambient.
  const key = new THREE.DirectionalLight(0xfff2e0, 2.0); key.position.set(2, 3, 3); scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd6ff, 0.7); fill.position.set(-2.5, 1.5, 1.5); scene.add(fill);
  const hemi = new THREE.HemisphereLight(0xdfeefe, 0x35302a, 0.65); scene.add(hemi);

  // A soft round pedestal so the feet aren't floating.
  const pedGeo = new THREE.CircleGeometry(0.9, 40); pedGeo.rotateX(-Math.PI / 2);
  const pedMat = new THREE.MeshStandardMaterial({ color: hsl(190, 0.12, 0.2), roughness: 0.85, metalness: 0, transparent: true, opacity: 0.55 });
  const pedestal = new THREE.Mesh(pedGeo, pedMat); pedestal.position.y = 0.01; scene.add(pedestal);

  // The character — a Ready Player Me GLB when `url` is set, else procedural. Track
  // the current params so setUrl() can rebuild (GLB ↔ procedural) with them.
  let curHue = cfg.hue, curStyle = cfg.style, curAge = cfg.age, curUrl = cfg.url || '';
  const pivot = new THREE.Group(); scene.add(pivot);
  let avatar = createAvatar({ url: curUrl, hue: curHue, style: curStyle, age: curAge, skinColor: cfg.skinColor });
  pivot.add(avatar.group);

  // Demo liveliness: cycle expression + an occasional wave so the face shows off.
  const EXPR = ['happy', 'neutral', 'surprised', 'happy', 'neutral'];
  let exprI = 0, demoTimer = 1.4;

  let raf = 0, last = performance.now(), disposed = false, spin = true;
  function frame(now) {
    if (disposed) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (spin) pivot.rotation.y += dt * 0.5;                 // slow turntable
    demoTimer -= dt;
    if (demoTimer <= 0) {
      demoTimer = 2.6 + Math.random() * 2.0;
      exprI = (exprI + 1) % EXPR.length;
      avatar.setExpression(EXPR[exprI]);
      if (Math.random() < 0.35) avatar.playEmote('wave');
    }
    avatar.update(dt, { moving: false, grounded: true });
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => { camera.aspect = W() / H(); camera.updateProjectionMatrix(); renderer.setSize(W(), H()); })
    : null;
  if (ro) ro.observe(container);

  return {
    // Procedural-only tweaks (no-op on a GLB avatar, which gets its look from RPM).
    setAge(age) { curAge = age; avatar.setAge && avatar.setAge(age); },
    setHue(hue) { curHue = hue; avatar.setHue && avatar.setHue(hue); },
    setStyle(style) { curStyle = style; avatar.setStyle && avatar.setStyle(style); },
    /** Swap the RPM avatar URL (''/falsy → procedural). Rebuilds the avatar. */
    setUrl(url) {
      if ((url || '') === curUrl) return;
      curUrl = url || '';
      try { avatar.dispose && avatar.dispose(); } catch (_) {}
      if (avatar.group && avatar.group.parent) avatar.group.parent.remove(avatar.group);
      avatar = createAvatar({ url: curUrl, hue: curHue, style: curStyle, age: curAge, skinColor: cfg.skinColor });
      pivot.add(avatar.group);
    },
    /** Pause/resume the turntable (e.g. while the user drags an orbit later). */
    setSpin(on) { spin = !!on; },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      try { avatar.dispose && avatar.dispose(); } catch (_) {}
      if (ro) ro.disconnect();
      scene.traverse((o) => {
        if (o.isMesh || o.isLine) {
          if (o.geometry?.dispose) o.geometry.dispose();
          const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose?.());
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    },
  };
}
