// @ts-nocheck -- one entry point for building a player/remote/NPC avatar.
//
// createAvatar(cfg) returns a GLB (Ready Player Me) avatar when a `url` is given and
// can be initialised, otherwise the procedural avatar — both expose the SAME API
// (group, parts, gait, setExpression, playEmote, isEmoting, update, applySit,
// dispose, kind). The GLB streams in async and falls back to procedural internally
// on a load error, so the caller always gets a valid, visible avatar synchronously.

import { buildAvatar } from './avatar';
import { buildGlbAvatar } from './glbAvatar';

// cfg: { url?, hue?, style?, age?, animBaseUrl?, onReady? }
export function createAvatar(cfg = {}) {
  if (cfg.url) {
    try {
      return buildGlbAvatar(cfg);
    } catch (e) {
      console.warn('[avatar] GLB avatar init failed, using procedural:', e);
    }
  }
  const av = buildAvatar(cfg);
  av.kind = 'procedural';
  if (!av.applySit) av.applySit = () => {};
  if (!av.dispose) av.dispose = () => {};   // uniform interface; procedural frees via scene walk
  return av;
}
