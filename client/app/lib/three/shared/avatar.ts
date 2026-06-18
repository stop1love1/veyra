// @ts-nocheck -- shared detailed avatar used by the gate, store and world player.
import * as THREE from 'three';
import { hsl, SKINS } from './helpers';

// cfg: { hue, skinColor?, style?, hairLight? }
// Returns { group, mats, parts, acc, setStyle }. Accessories (cap / tunic) are
// created visible; pass cfg.style to apply the toggle, or call setStyle() later.
export function buildAvatar(cfg = {}) {
  const hue = cfg.hue != null ? cfg.hue : 184;
  const hairLight = cfg.hairLight != null ? cfg.hairLight : 0.2;

  const grp = new THREE.Group();
  const clothMat = new THREE.MeshStandardMaterial({ color: hsl(hue, .55, .52), roughness: .8 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: hsl(hue, .35, .3), roughness: .85 });
  const skinMat = new THREE.MeshStandardMaterial({ color: cfg.skinColor || SKINS[1], roughness: .9 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hsl(hue, .4, hairLight), roughness: 1 });

  const cap = (r, len, m) => { const x = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), m); x.castShadow = true; return x; };
  const torso = cap(.26, .5, clothMat); torso.position.y = 1.05; grp.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.26, 18, 18), skinMat); head.position.y = 1.62; head.castShadow = true; grp.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(.285, 16, 16, 0, Math.PI * 2, 0, Math.PI * .62), hairMat);
  hair.position.set(0, 1.66, -.02); grp.add(hair);

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

  const avatar = {
    group: grp,
    mats: { clothMat, pantsMat, skinMat, hairMat },
    parts: { armL, armR, legL, legR, torso, head, hair },
    acc: { capHat, tunic },
    setStyle(style) { capHat.visible = style === 'street'; tunic.visible = style === 'soft'; },
  };
  if (cfg.style != null) avatar.setStyle(cfg.style);
  return avatar;
}
