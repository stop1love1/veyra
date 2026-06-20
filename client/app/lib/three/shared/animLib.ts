// @ts-nocheck -- animation clip library: load + cache skeletal clip GLBs by name.
//
// RPM characters share a Mixamo-compatible skeleton, so animation clips authored
// for that rig (the open-source Ready Player Me animation library) play directly on
// any RPM avatar's AnimationMixer — no per-bone retargeting needed. This module
// loads each clip GLB ONCE (keyed by logical name), caches the THREE.AnimationClip,
// and hands it out. Loads are deduped so the same clip never fetches twice.
//
//   animLib.loadClips({ idle: '/models/rpm/animations/idle.glb', ... })  // → Promise
//   animLib.getClip('idle')   // → THREE.AnimationClip | null
//
// The loader is injectable so the cache logic is unit-testable without a browser.

import { getSharedGltfLoader } from './loaderSingleton';

class AnimationLibrary {
  constructor() {
    this.cache = new Map();    // name -> THREE.AnimationClip
    this.loading = new Map();  // name -> Promise (in-flight, dedupe)
  }

  hasClip(name) { return this.cache.has(name); }
  getClip(name) { return this.cache.get(name) || null; }

  /**
   * Load every (name → url) not already cached or in flight. Resolves when all
   * settle; individual failures log + resolve (a missing clip never rejects the
   * batch — the state machine just falls back to idle). `loader` is injectable.
   */
  async loadClips(nameToUrl, loader) {
    loader = loader || getSharedGltfLoader();
    const jobs = [];
    for (const name in nameToUrl) {
      if (this.cache.has(name) || this.loading.has(name)) { jobs.push(this.loading.get(name)); continue; }
      const url = nameToUrl[name];
      const p = new Promise((resolve) => {
        loader.load(
          url,
          (gltf) => {
            const clip = gltf && gltf.animations && gltf.animations[0];
            if (clip) { clip.name = name; this.cache.set(name, clip); }
            else console.warn('[animLib] no animation in', url);
            resolve();
          },
          undefined,
          (err) => { console.warn('[animLib] failed to load', url, err); resolve(); },
        );
      });
      const tracked = p.finally(() => this.loading.delete(name));
      this.loading.set(name, tracked);
      jobs.push(tracked);
    }
    await Promise.all(jobs.filter(Boolean));
  }

  dispose() { this.cache.clear(); this.loading.clear(); }
}

export const animLib = new AnimationLibrary();
export { AnimationLibrary };
