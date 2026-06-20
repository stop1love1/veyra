// @ts-nocheck -- shared GLTF + DRACO loaders (one decoder worker for the whole app).
//
// RPM avatars and the citykit GLBs are draco-compressed, so the GLTFLoader needs a
// DRACOLoader. We create ONE of each, lazily, and share them: the decoder WASM
// worker is expensive to spin up, and three.js queues concurrent loads on a single
// loader fine. The decoder files are served from /draco/ (see scripts/copy-draco.js).

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const DRACO_PATH =
  (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_DRACO_PATH) || '/draco/';

let _gltf = null;
let _draco = null;

export function getSharedDracoLoader() {
  if (!_draco) {
    _draco = new DRACOLoader();
    _draco.setDecoderPath(DRACO_PATH);
    _draco.preload();   // start the decoder worker early
  }
  return _draco;
}

export function getSharedGltfLoader() {
  if (!_gltf) {
    _gltf = new GLTFLoader();
    _gltf.setDRACOLoader(getSharedDracoLoader());
  }
  return _gltf;
}

export function disposeSharedLoaders() {
  if (_draco) { try { _draco.dispose(); } catch (_) {} _draco = null; }
  _gltf = null;
}
