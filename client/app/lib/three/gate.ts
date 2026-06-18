// @ts-nocheck -- ported vanilla three.js engine; internals intentionally untyped
// gate3d.js — Veyra entry: 3D gate + character customization + walk-in. Reads window.THREE.
// window.createVeyraGate(container, opts) -> { dispose, setLook, enter, snapshot }
// opts: { look:{hue,skin,style,name}, onEnter() }

import * as THREE from 'three';

export function createVeyraGate(container, opts) {
  opts = opts || {};
  let look = Object.assign({ hue: 184, skin: 1, style: 'minimal', name: 'Veyra' }, opts.look || {});

  const W = () => container.clientWidth || 390;
  const H = () => container.clientHeight || 700;
  const hsl = (h, s, l) => new THREE.Color().setHSL(h / 360, s, l);
  const SKINS = ['#f1c9a5', '#e0a878', '#c9854f', '#8d5a36'];

  // ── Renderer / scene ─────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W(), H());
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#16383c');
  scene.fog = new THREE.Fog('#16383c', 22, 52);

  const camera = new THREE.PerspectiveCamera(42, W() / H(), 0.1, 200);
  camera.position.set(0, 3.0, 8.4);
  const camLook = new THREE.Vector3(0, 1.5, -3);

  scene.add(new THREE.HemisphereLight('#dff5ee', '#2b524c', 1.05));
  scene.add(new THREE.AmbientLight('#cfeee8', 0.4));
  const sun = new THREE.DirectionalLight('#fff3df', 1.2);
  sun.position.set(-8, 16, 8); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sd = 18; sun.shadow.camera.left = -sd; sun.shadow.camera.right = sd;
  sun.shadow.camera.top = sd; sun.shadow.camera.bottom = -sd;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 60; sun.shadow.bias = -0.0004;
  scene.add(sun);

  // ── Ground + path ────────────────────────────────────────
  const ground = new THREE.Mesh(new THREE.CircleGeometry(50, 48),
    new THREE.MeshStandardMaterial({ color: '#5f9a8c', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  const path = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 30),
    new THREE.MeshStandardMaterial({ color: '#cdd9cf', roughness: .95 }));
  path.rotation.x = -Math.PI / 2; path.position.set(0, 0.02, -6); path.receiveShadow = true; scene.add(path);

  // ── Gate wall ────────────────────────────────────────────
  const GZ = -12;
  const stone = new THREE.MeshStandardMaterial({ color: '#3c5b5a', roughness: .9 });
  const stone2 = new THREE.MeshStandardMaterial({ color: '#324d4c', roughness: .9 });
  function wallSeg(x, w) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 8, 1.4), stone);
    m.position.set(x, 4, GZ); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    // cap
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + .4, .6, 1.8), stone2);
    cap.position.set(x, 8.1, GZ); scene.add(cap);
  }
  wallSeg(-6.5, 7);   // left
  wallSeg(6.5, 7);    // right
  // lintel over opening
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(6.4, 1.6, 1.4), stone2);
  lintel.position.set(0, 7.0, GZ); lintel.castShadow = true; scene.add(lintel);
  // pillars
  [-2.9, 2.9].forEach(px => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(.5, .55, 6.2, 12), stone2);
    p.position.set(px, 3.1, GZ + .2); p.castShadow = true; scene.add(p);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(.34, 14, 14),
      new THREE.MeshStandardMaterial({ color: hsl(look.hue, .6, .6), emissive: hsl(look.hue, .7, .4), emissiveIntensity: .9 }));
    orb.position.set(px, 6.5, GZ + .2); scene.add(orb);
  });

  // ── Gate doors (hinged) ──────────────────────────────────
  const doorMat = new THREE.MeshStandardMaterial({ color: '#274240', roughness: .7, metalness: .2 });
  const trimMat = new THREE.MeshStandardMaterial({ color: hsl(look.hue, .45, .5), roughness: .5, metalness: .3 });
  function door(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 2.7, 0, GZ + .3);   // hinge at outer edge
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.55, 5.6, .28), doorMat);
    panel.position.set(-side * 1.27, 2.9, 0); panel.castShadow = true; pivot.add(panel);
    for (let i = 0; i < 3; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.3, .16, .34), trimMat);
      bar.position.set(-side * 1.27, 1.4 + i * 1.5, 0); pivot.add(bar);
    }
    const knob = new THREE.Mesh(new THREE.SphereGeometry(.16, 10, 10), trimMat);
    knob.position.set(-side * 0.2, 2.9, .2); pivot.add(knob);
    scene.add(pivot); return pivot;
  }
  const doorL = door(-1), doorR = door(1);

  // ── Sign (canvas texture) ────────────────────────────────
  const sCanvas = document.createElement('canvas'); sCanvas.width = 512; sCanvas.height = 150;
  const sctx = sCanvas.getContext('2d');
  function drawSign() {
    sctx.clearRect(0, 0, 512, 150);
    sctx.fillStyle = '#eafcf8';
    sctx.font = '700 92px "Be Vietnam Pro", system-ui, sans-serif';
    sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
    sctx.shadowColor = 'rgba(0,0,0,.4)'; sctx.shadowBlur = 12;
    let ls = 'VEYRA', x = 256 - 4 * 18;
    sctx.fillText('V E Y R A', 256, 80);
  }
  drawSign();
  const signTex = new THREE.CanvasTexture(sCanvas);
  signTex.anisotropy = 4;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.35),
    new THREE.MeshBasicMaterial({ map: signTex, transparent: true }));
  sign.position.set(0, 7.05, GZ + .75); scene.add(sign);
  // glow arch
  const arch = new THREE.Mesh(new THREE.TorusGeometry(2.2, .12, 8, 40, Math.PI),
    new THREE.MeshBasicMaterial({ color: hsl(look.hue, .65, .6) }));
  arch.position.set(0, 7.6, GZ + .7); scene.add(arch);

  // banners
  [-6.5, 6.5].forEach(bx => {
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 4.2),
      new THREE.MeshStandardMaterial({ color: hsl(look.hue, .5, .42), roughness: .8, side: THREE.DoubleSide }));
    ban.position.set(bx, 4.2, GZ + .75); scene.add(ban);
  });

  // ── Decor: torches, trees ────────────────────────────────
  function torch(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.08, .1, 2.6, 8),
      new THREE.MeshStandardMaterial({ color: '#33403e', roughness: .8 }));
    pole.position.y = 1.3; pole.castShadow = true; g.add(pole);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(.24, 10, 10),
      new THREE.MeshStandardMaterial({ color: '#ffe0a0', emissive: '#ffcf6e', emissiveIntensity: 1 }));
    flame.position.y = 2.75; g.add(flame);
    const light = new THREE.PointLight('#ffd27a', .7, 9); light.position.set(x, 2.8, z); scene.add(light);
    scene.add(g); return flame;
  }
  const flames = [torch(-3.4, -3.5), torch(3.4, -3.5), torch(-3.4, GZ + 1.4), torch(3.4, GZ + 1.4)];
  function tree(x, z, s) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s);
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(.16, .22, 1.1, 6),
      new THREE.MeshStandardMaterial({ color: '#7c5e42', roughness: 1 }));
    tr.position.y = .55; tr.castShadow = true; g.add(tr);
    const lm = new THREE.MeshStandardMaterial({ color: hsl(150, .35, .46), roughness: 1 });
    [[0, 1.5, 1], [.4, 2, .7], [-.35, 2.05, .65]].forEach(([dx, dy, r]) => {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), lm);
      m.position.set(dx, dy, 0); m.castShadow = true; g.add(m);
    });
    scene.add(g);
  }
  for (let i = 0; i < 10; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (5 + Math.random() * 7);
    const z = -10 + Math.random() * 12;   // sides only, keep the corridor clear
    tree(x, z, .7 + Math.random() * .7);
  }

  // ── Character builder ────────────────────────────────────
  function buildChar(cfg) {
    const grp = new THREE.Group();
    const clothMat = new THREE.MeshStandardMaterial({ color: hsl(cfg.hue, .55, .52), roughness: .8 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: hsl(cfg.hue, .35, .3), roughness: .85 });
    const skinMat = new THREE.MeshStandardMaterial({ color: cfg.skinColor || SKINS[1], roughness: .9 });
    const hairMat = new THREE.MeshStandardMaterial({ color: hsl(cfg.hue, .4, .2), roughness: 1 });
    const cap = (r, len, mat) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), mat); m.castShadow = true; return m; };
    const torso = cap(.26, .5, clothMat); torso.position.y = 1.05; grp.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.26, 18, 18), skinMat); head.position.y = 1.62; head.castShadow = true; grp.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(.285, 16, 16, 0, Math.PI * 2, 0, Math.PI * .62), hairMat);
    hair.position.set(0, 1.66, -.02); grp.add(hair);
    function limb(x, y, r, len, mat) {
      const p = new THREE.Group(); p.position.set(x, y, 0);
      const m = cap(r, len, mat); m.position.y = -(len / 2 + r); p.add(m); grp.add(p); return p;
    }
    const armL = limb(-.33, 1.28, .08, .4, clothMat), armR = limb(.33, 1.28, .08, .4, clothMat);
    const legL = limb(-.13, .78, .1, .42, pantsMat), legR = limb(.13, .78, .1, .42, pantsMat);
    [armL, armR].forEach(a => { const h = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 8), skinMat); h.position.y = -.62; a.add(h); });
    [legL, legR].forEach(l => { const f = new THREE.Mesh(new THREE.BoxGeometry(.18, .12, .3), pantsMat); f.position.set(0, -.66, .06); f.castShadow = true; l.add(f); });

    // style accessories
    const capHat = new THREE.Group();
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(.27, .29, .22, 14), clothMat); crown.position.y = 1.86;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(.46, .06, .32), clothMat); visor.position.set(0, 1.78, .26);
    capHat.add(crown, visor); grp.add(capHat);
    const tunic = new THREE.Mesh(new THREE.ConeGeometry(.46, .7, 16, 1, true), clothMat);
    tunic.position.y = .78; grp.add(tunic);

    return {
      group: grp, mats: { clothMat, pantsMat, skinMat, hairMat },
      parts: { armL, armR, legL, legR, torso, head, hair },
      acc: { capHat, tunic },
    };
  }

  // player
  const player = buildChar({ hue: look.hue, skinColor: SKINS[look.skin] });
  player.group.position.set(0, 0, 0);
  player.group.rotation.y = 0; // face the camera for customization
  scene.add(player.group);
  const blob = new THREE.Mesh(new THREE.CircleGeometry(.5, 20),
    new THREE.MeshBasicMaterial({ color: '#10302d', transparent: true, opacity: .28 }));
  blob.rotation.x = -Math.PI / 2; blob.position.set(0, .04, 0); scene.add(blob);

  // guard
  const guard = buildChar({ hue: 200, skinColor: SKINS[2] });
  guard.group.position.set(-3.6, 0, GZ + 2.2);
  guard.group.rotation.y = 0.5;
  guard.mats.clothMat.color = hsl(195, .4, .34);
  guard.mats.pantsMat.color = hsl(195, .35, .22);
  scene.add(guard.group);
  // guard hat (tall)
  const ghat = new THREE.Mesh(new THREE.CylinderGeometry(.26, .3, .5, 14), new THREE.MeshStandardMaterial({ color: hsl(195, .45, .28), roughness: .8 }));
  ghat.position.y = 1.95; guard.group.add(ghat);
  // staff
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, 2.4, 8), new THREE.MeshStandardMaterial({ color: '#caa15a', roughness: .6, metalness: .3 }));
  staff.position.set(.4, 1.2, 0); guard.group.add(staff);

  // bystanders (unregistered avatars outside)
  const byStanders = [];
  [[-4.2, -2.2, 130], [4.4, -1.6, 60], [-5.2, 1.4, 30], [5.0, 1.0, 280]].forEach(([x, z, h], i) => {
    const c = buildChar({ hue: h, skinColor: SKINS[i % SKINS.length] });
    c.group.position.set(x, 0, z);
    c.group.rotation.y = Math.random() * Math.PI * 2;
    c.group.scale.setScalar(.96);
    applyStyle(c, ['minimal', 'street', 'soft'][i % 3]);
    scene.add(c.group);
    byStanders.push({ c, ph: Math.random() * 6 });
  });

  function applyStyle(ch, style) {
    ch.acc.capHat.visible = style === 'street';
    ch.acc.tunic.visible = style === 'soft';
  }
  applyStyle(player, look.style);

  // ── setLook (live) ───────────────────────────────────────
  function setLook(next) {
    look = Object.assign(look, next);
    player.mats.clothMat.color = hsl(look.hue, .55, .52);
    player.mats.pantsMat.color = hsl(look.hue, .35, .3);
    player.mats.hairMat.color = hsl(look.hue, .4, .2);
    player.mats.skinMat.color = new THREE.Color(SKINS[look.skin] || SKINS[1]);
    applyStyle(player, look.style);
    // tint gate accents to chosen hue
    trimMat.color = hsl(look.hue, .45, .5);
    arch.material.color = hsl(look.hue, .65, .6);
  }

  // ── Loop + enter animation ───────────────────────────────
  const sstep = (a, b, t) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
  let raf = 0, running = true, last = performance.now();
  let entering = false, et = 0, doneFired = false, phase = 0;
  let camTargetPos = camera.position.clone(), camTargetLook = camLook.clone();

  function frame(now) {
    if (!running) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    const t = now / 1000;

    // idle: gentle breathing + bystanders sway
    player.parts.torso.position.y = 1.05 + Math.sin(t * 1.4) * .015;
    player.parts.armL.rotation.x = Math.sin(t * 1.4) * .04;
    player.parts.armR.rotation.x = -Math.sin(t * 1.4) * .04;
    byStanders.forEach((b, i) => {
      b.c.group.rotation.y += Math.sin(t * .6 + b.ph) * .003;
      b.c.parts.torso.position.y = 1.05 + Math.sin(t * 1.2 + b.ph) * .02;
    });
    guard.parts.head.rotation.y = Math.sin(t * .5) * .25;
    flames.forEach((f, i) => { const s = 1 + Math.sin(t * 9 + i) * .12; f.scale.set(s, s + .1, s); });
    arch.rotation.z = Math.sin(t * .5) * .03;

    if (entering) {
      et += dt;
      // guard raises staff/arm
      const ga = sstep(.2, 1.2, et);
      guard.parts.armR.rotation.x = -ga * 2.2;
      staff.rotation.z = -ga * .5;
      // doors open
      const dOpen = sstep(.7, 2.1, et);
      doorL.rotation.y = dOpen * 2.0;
      doorR.rotation.y = -dOpen * 2.0;
      // player turn to face gate (-z)
      const turn = sstep(1.7, 2.3, et);
      player.group.rotation.y = turn * Math.PI; // 0 -> PI (faces -z, toward gate)
      // walk forward through gate
      if (et > 2.2) {
        const wt = et - 2.2;
        player.group.position.z = -Math.min(wt / 2.4, 1) * 17;
        phase += dt * 12;
        const sw = .7;
        player.parts.legL.rotation.x = Math.sin(phase) * sw;
        player.parts.legR.rotation.x = -Math.sin(phase) * sw;
        player.parts.armL.rotation.x = -Math.sin(phase) * sw * .7;
        player.parts.armR.rotation.x = Math.sin(phase) * sw * .7;
        blob.position.z = player.group.position.z;
      }
      // camera dolly up/forward to watch walk-in
      const cam2 = sstep(2.0, 4.4, et);
      camTargetPos.set(0, 3.0 + cam2 * 2.2, 8.4 - cam2 * 2.5);
      camTargetLook.set(0, 1.5, -3 - cam2 * 8);
      if (et > 4.5 && !doneFired) { doneFired = true; opts.onEnter && opts.onEnter(); }
    } else {
      // subtle idle camera drift
      camTargetPos.set(Math.sin(t * .25) * .4, 3.0, 8.4);
      camTargetLook.set(0, 1.5, -3);
    }

    camera.position.lerp(camTargetPos, Math.min(1, dt * 3));
    camLook.lerp(camTargetLook, Math.min(1, dt * 3));
    camera.lookAt(camLook);

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  const ro = new ResizeObserver(() => {
    camera.aspect = W() / H(); camera.updateProjectionMatrix(); renderer.setSize(W(), H());
  });
  ro.observe(container);

  return {
    setLook,
    enter() { if (!entering) { entering = true; et = 0; } },
    dispose() {
      running = false; cancelAnimationFrame(raf); ro.disconnect();
      renderer.dispose();
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    },
  };
};
