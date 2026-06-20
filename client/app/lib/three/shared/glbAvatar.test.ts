import { describe, it, expect } from 'vitest';
import {
  EXPRESSION_MORPHS, EMOTE_CLIP, ANIM_FILES,
  selectLocoState, tickBlink, applyMorphs, animUrls, BLINK_INTERVAL,
} from './glbAvatar';
import { createAvatar } from './avatarFactory';
import { AnimationLibrary } from './animLib';

// String-indexable views for table-driven assertions (sources are @ts-nocheck JS).
const EM = EXPRESSION_MORPHS as Record<string, Record<string, number>>;

describe('EXPRESSION_MORPHS', () => {
  it('has the five expressions; neutral is empty; influences are 0..1', () => {
    for (const name of ['neutral', 'happy', 'surprised', 'sad', 'angry']) {
      expect(EM[name]).toBeTruthy();
    }
    expect(Object.keys(EM.neutral)).toHaveLength(0);
    for (const name in EM) {
      for (const k in EM[name]) {
        const v = EM[name][k];
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('selectLocoState', () => {
  it('picks locomotion by movement/speed/sitting', () => {
    expect(selectLocoState('idle', { moving: true }, 0, 0)).toBe('walk');
    expect(selectLocoState('idle', { moving: true, running: true }, 0, 0)).toBe('run');
    expect(selectLocoState('walk', {}, 0, 0)).toBe('idle');
    expect(selectLocoState('idle', { sitting: true }, 0, 0)).toBe('sit');
    expect(selectLocoState('sit', { sitting: false }, 0, 0)).toBe('idle');
  });
  it('holds an emote until it ends or the player moves', () => {
    expect(selectLocoState('emote', { moving: false }, 1.0, 2.2)).toBe('emote');
    expect(selectLocoState('emote', { moving: false }, 2.3, 2.2)).toBe('idle');
    expect(selectLocoState('emote', { moving: true }, 0.5, 2.2)).toBe('walk');
  });
});

describe('tickBlink', () => {
  it('snaps shut when the timer expires, then recovers, without mutating input', () => {
    const input = { timer: 0.05, blink: 1 };
    const a = tickBlink(input, 0.1);            // timer crosses 0
    expect(input).toEqual({ timer: 0.05, blink: 1 });  // unchanged
    expect(a.blink).toBe(0);                    // shut
    expect(a.timer).toBeCloseTo(BLINK_INTERVAL, 5);
    let s = a;
    for (let i = 0; i < 10; i++) s = tickBlink(s, 0.02);  // recover
    expect(s.blink).toBeGreaterThan(0.5);
  });
});

describe('applyMorphs', () => {
  it('lerps influences toward targets, zeroes the rest, skips unknown + eyeBlink', () => {
    const mesh = {
      morphTargetDictionary: { mouthSmileLeft: 0, jawOpen: 1, eyeBlinkLeft: 2 },
      morphTargetInfluences: [0, 0.5, 0.4],
    };
    applyMorphs([mesh], { mouthSmileLeft: 0.7, unknownMorph: 0.9 }, 1);
    expect(mesh.morphTargetInfluences[0]).toBeGreaterThan(0.6);   // toward 0.7
    expect(mesh.morphTargetInfluences[1]).toBeLessThan(0.1);      // jawOpen → 0
    expect(mesh.morphTargetInfluences[2]).toBe(0.4);              // eyeBlink untouched
  });
  it('tolerates meshes without morphs', () => {
    expect(() => applyMorphs([{}], { mouthSmileLeft: 1 }, 0.016)).not.toThrow();
  });
});

describe('animUrls / EMOTE_CLIP', () => {
  it('builds clip urls under the base with a single slash', () => {
    const u = animUrls('/models/rpm/animations') as Record<string, string>;
    expect(u.idle).toBe('/models/rpm/animations/idle.glb');
    expect(Object.keys(u)).toEqual(Object.keys(ANIM_FILES));
  });
  it('aliases celebrate → dance', () => {
    expect(EMOTE_CLIP.celebrate).toBe('dance');
    expect(EMOTE_CLIP.wave).toBe('wave');
  });
});

describe('createAvatar fallback', () => {
  it('returns a procedural avatar when no url is given', () => {
    const av = createAvatar({ hue: 184, age: 24 }) as any;
    expect(av.kind).toBe('procedural');
    expect(typeof av.update).toBe('function');
    expect(typeof av.applySit).toBe('function');
    av.dispose();
  });
});

describe('AnimationLibrary cache', () => {
  it('loads each clip url at most once', async () => {
    const lib = new AnimationLibrary();
    let calls = 0;
    const fakeLoader = {
      load(_url: string, onLoad: (g: any) => void) { calls++; onLoad({ animations: [{ duration: 1, name: '' }] }); },
    };
    await lib.loadClips({ idle: '/a/idle.glb' }, fakeLoader);
    await lib.loadClips({ idle: '/a/idle.glb' }, fakeLoader);   // cached → no 2nd load
    expect(calls).toBe(1);
    expect(lib.hasClip('idle')).toBe(true);
  });
});
