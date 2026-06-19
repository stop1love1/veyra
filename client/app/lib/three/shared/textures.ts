// @ts-nocheck -- CC0 texture/HDRI loader with graceful (null) fallback.
//
// createTextureLoader() -> { loadColorTex, loadDataTex, loadPBR, loadHDR, dispose }
//   Every loader resolves to `null` (never rejects) on failure so callers can
//   fall back to their procedural path. All loaded textures are tracked and
//   freed by dispose(). 1 world unit ~= 1 metre; `repeat` is in metres⁻¹.

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export function createTextureLoader({ anisotropy = 4 } = {}) {
  const texLoader = new THREE.TextureLoader();
  const rgbe = new RGBELoader();
  const tracked = [];
  const track = (t) => { if (t) tracked.push(t); return t; };

  // sRGB colour texture; resolves null on error.
  function loadColorTex(url, repeat = [1, 1]) {
    return new Promise((res) => {
      texLoader.load(url, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]);
        t.anisotropy = anisotropy; res(track(t));
      }, undefined, () => res(null));
    });
  }

  // Linear data texture (normal / roughness); resolves null on error.
  function loadDataTex(url, repeat = [1, 1]) {
    return new Promise((res) => {
      texLoader.load(url, (t) => {
        t.colorSpace = THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]);
        t.anisotropy = anisotropy; res(track(t));
      }, undefined, () => res(null));
    });
  }

  // A PBR set in a directory (color.jpg/normal.jpg/rough.jpg). Returns
  // { map, normalMap, roughnessMap } — any field may be null.
  async function loadPBR(dir, repeat = [1, 1]) {
    const [map, normalMap, roughnessMap] = await Promise.all([
      loadColorTex(dir + '/color.jpg', repeat),
      loadDataTex(dir + '/normal.jpg', repeat),
      loadDataTex(dir + '/rough.jpg', repeat),
    ]);
    return { map, normalMap, roughnessMap };
  }

  // Equirect HDR → PMREM env texture. Returns { envTex, rt } or null.
  // The caller owns rt and must dispose it (dispose() here frees only textures).
  function loadHDR(url, renderer) {
    return new Promise((res) => {
      rgbe.load(url, (hdr) => {
        const pmrem = new THREE.PMREMGenerator(renderer);
        pmrem.compileEquirectangularShader();
        const rt = pmrem.fromEquirectangular(hdr);
        hdr.dispose(); pmrem.dispose();
        res({ envTex: rt.texture, rt });
      }, undefined, () => res(null));
    });
  }

  function dispose() { for (const t of tracked) { try { t.dispose(); } catch (_) {} } tracked.length = 0; }

  return { loadColorTex, loadDataTex, loadPBR, loadHDR, dispose };
}
