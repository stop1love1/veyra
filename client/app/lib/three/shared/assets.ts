// @ts-nocheck -- GLB kit loader / cache for the Kenney City Kit (CC0) low-poly world.
//
// createKitLoader() -> { preload(names), get(name), has(name),
//                        preloadUrls(urls), getByUrl(url), hasUrl(url), dispose() }
//   - names look like `road:straight`, `road:roundabout`, `build:building-a`,
//     `build:building-skyscraper-b`, `build:detail-awning`.
//   - The prefix selects the served folder:
//       road:  -> /models/citykit-roads/road-<rest>.glb   (or light-/tile- specials)
//       build: -> /models/citykit/<rest>.glb
//   - preload loads each unique GLB once, caches its root scene, flags meshes
//     for shadows. get(name) returns a cheap clone(true) (three sharing geometry
//     + materials). dispose() frees the cached geometry / materials / maps.
//
// URL path (data-driven maps, see docs/server/DESIGN.md §5.3): the same cache
// also accepts absolute/asset URLs directly, so a server-published map can
// reference GLBs by URL. preloadUrls(urls)/getByUrl(url) mirror preload/get but
// key the cache by the resolved URL instead of a logical `prefix:rest` name.
// Both APIs share one cache + one dispose, so mapLoader can reuse this loader
// without touching the existing road:/build: callers.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ROAD_DIR = '/models/citykit-roads/';
const CITY_DIR = '/models/citykit/';

// Resolve a logical name -> served URL.
function resolvePath(name) {
  const i = name.indexOf(':');
  const prefix = i >= 0 ? name.slice(0, i) : 'build';
  const rest = i >= 0 ? name.slice(i + 1) : name;
  if (prefix === 'road') {
    // light-square / tile-low / road-side / construction-barrier etc. are passed
    // through directly when they already carry their own family prefix (they live
    // in the roads folder under their own name); bare names get `road-`.
    if (rest.startsWith('light-') || rest.startsWith('tile-') || rest.startsWith('road-')
        || rest.startsWith('construction-') || rest.startsWith('sign-') || rest.startsWith('bridge-')) {
      return ROAD_DIR + rest + '.glb';
    }
    return ROAD_DIR + 'road-' + rest + '.glb';
  }
  // build: buildings + details live in /models/citykit/
  return CITY_DIR + rest + '.glb';
}

// Is this token already a URL/asset path (vs a logical `prefix:rest` name)?
// Anything that looks like an http(s) URL, a protocol-relative URL, or a rooted
// path is treated as a direct URL; logical names contain a single `:` family
// prefix and otherwise no slash.
function looksLikeUrl(token) {
  return /^(https?:)?\/\//.test(token) || token.startsWith('/') || token.startsWith('./') || token.startsWith('../');
}

export function createKitLoader() {
  const loader = new GLTFLoader();
  const cache = new Map(); // key (name OR url) -> THREE.Object3D (cached root scene)

  function flagShadows(root) {
    root.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    return root;
  }

  // Load a single GLB by its already-resolved URL, caching under `key`.
  function loadUrl(key, url) {
    if (cache.has(key)) return Promise.resolve();
    return new Promise((res, rej) => {
      loader.load(url, (gltf) => { cache.set(key, flagShadows(gltf.scene)); res(); }, undefined, rej);
    });
  }

  function loadOne(name) {
    return loadUrl(name, resolvePath(name));
  }

  function getClone(key) {
    const root = cache.get(key);
    if (!root) throw new Error('kit: asset not preloaded: ' + key);
    return root.clone(true);
  }

  return {
    preload(names) {
      const unique = Array.from(new Set(names || []));
      // allSettled so a single 404 doesn't fail the whole batch; build() skips
      // any asset that didn't load via has().
      return Promise.allSettled(unique.map(loadOne)).then(() => undefined);
    },
    // Returns a ready-to-place clone. clone(true) shares geometry + materials,
    // so each placed piece is cheap.
    get(name) { return getClone(name); },
    has(name) { return cache.has(name); },

    // ── URL path (data-driven maps) ────────────────────────────────────────
    // Preload a batch of GLB URLs. Each url is cached under the url itself, so
    // getByUrl(url)/hasUrl(url) read it back. Bare logical names passed here are
    // resolved via resolvePath, so callers may mix the two if convenient.
    preloadUrls(urls) {
      const unique = Array.from(new Set(urls || []));
      return Promise.allSettled(
        unique.map((u) => loadUrl(u, looksLikeUrl(u) ? u : resolvePath(u))),
      ).then(() => undefined);
    },
    getByUrl(url) { return getClone(url); },
    hasUrl(url) { return cache.has(url); },

    dispose() {
      cache.forEach((root) => {
        root.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
              if (m.map) m.map.dispose();
              m.dispose();
            });
          }
        });
      });
      cache.clear();
    },
  };
}
