// @ts-nocheck -- ported vanilla three.js engine; internals intentionally untyped
// world.ts — Veyra walkable 3D world (three.js ES module).
// createVeyraWorld(container, opts) -> { dispose, recenter }
// opts: { playerHue, lite, shops:[{id,hue,name}], onProximity(shop|null) }

import * as THREE from 'three';
import { buildAvatar } from './shared/avatar';

export function createVeyraWorld(container, opts) {
  opts = opts || {};
  const shopsIn = opts.shops || [];
  const lite = !!opts.lite;
  const playerHue = opts.playerHue != null ? opts.playerHue : 184;

  const W = () => container.clientWidth || 390;
  const H = () => container.clientHeight || 700;

  // ── Renderer ─────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: !lite, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1 : 2));
  renderer.setSize(W(), H());
  renderer.shadowMap.enabled = !lite;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  // ── Scene ────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#c7efe6', 74, 170);

  const camera = new THREE.PerspectiveCamera(46, W() / H(), 0.1, 600);
  camera.position.set(0, 9, 12);

  // ── Sky dome (vertical gradient, weather-driven) ─────────
  const skyU = { top: { value: new THREE.Color('#2bb6d6') }, bot: { value: new THREE.Color('#c7efe6') } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 18), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 bot; void main(){ float h = clamp(normalize(vP).y*0.5+0.5, 0.0, 1.0); gl_FragColor = vec4(mix(bot, top, smoothstep(0.0,0.92,h)), 1.0); }',
  }));
  scene.add(sky);
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(16, 32), new THREE.MeshBasicMaterial({ color: '#fff3d0', transparent: true, opacity: .9, fog: false, depthWrite: false }));
  sunDisc.position.set(-130, 95, -170); sunDisc.lookAt(0, 0, 0); scene.add(sunDisc);

  // ── Lights ───────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight('#e2fbf3', '#2f5e57', 1.28);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff7e8', 1.28);
  sun.position.set(40, 72, 34);
  if (!lite) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const d = 42;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 220;
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 4;
  }
  scene.add(sun);
  const amb = new THREE.AmbientLight('#cfeee8', 0.38); scene.add(amb);

  // ── Weather (clear → sunset → cloudy → rain, looping) ────
  const WEATHER = [
    { id: 'clear',  top: '#27a9d4', bot: '#cdeee6', fog: '#cdeee6', sun: '#fff6e0', sunI: 1.42, ambI: .4,  hemiI: 1.3,  cloud: .4,  rain: 0, sunC: '#fff3d0', sunO: .95 },
    { id: 'sunset', top: '#3a4f93', bot: '#ffb07a', fog: '#f3c79e', sun: '#ffd29a', sunI: 1.12, ambI: .46, hemiI: 1.08, cloud: .5,  rain: 0, sunC: '#ffc878', sunO: 1 },
    { id: 'cloudy', top: '#8198a2', bot: '#d4dcdb', fog: '#cfd8d6', sun: '#e9edee', sunI: .68, ambI: .56, hemiI: 1.16, cloud: .96, rain: 0, sunC: '#dfe6e6', sunO: .22 },
    { id: 'rain',   top: '#44606b', bot: '#92a5a7', fog: '#90a3a4', sun: '#c0caca', sunI: .48, ambI: .5,  hemiI: 1.02, cloud: 1,   rain: 1, sunC: '#aab4b5', sunO: 0 },
  ];
  WEATHER.forEach(w => { w._top = new THREE.Color(w.top); w._bot = new THREE.Color(w.bot); w._fog = new THREE.Color(w.fog); w._sun = new THREE.Color(w.sun); w._sunC = new THREE.Color(w.sunC); });
  let wIdx = Math.floor(Math.random() * WEATHER.length), wNext = (wIdx + 1) % WEATHER.length, wT = 0;
  const wDur = 26, wFade = 6;

  // clouds
  const cloudCv = document.createElement('canvas'); cloudCv.width = cloudCv.height = 128;
  { const cx = cloudCv.getContext('2d'); const gr = cx.createRadialGradient(64, 64, 8, 64, 64, 62); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, 128, 128); }
  const cloudTex = new THREE.CanvasTexture(cloudCv);
  const clouds = [];
  for (let i = 0; i < (lite ? 4 : 8); i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(46, 26), new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: .5 }));
    m.rotation.x = -Math.PI / 2; const a = Math.random() * 6.28, r = 30 + Math.random() * 110;
    m.position.set(Math.cos(a) * r, 52 + Math.random() * 20, Math.sin(a) * r); m.scale.setScalar(.7 + Math.random() * 1.6);
    clouds.push(m); scene.add(m);
  }

  // rain
  const rainN = lite ? 0 : 520; let rainPts = null;
  if (rainN) {
    const pg = new THREE.BufferGeometry(), pos = new Float32Array(rainN * 3);
    for (let i = 0; i < rainN; i++) { pos[i * 3] = (Math.random() - .5) * 90; pos[i * 3 + 1] = Math.random() * 44; pos[i * 3 + 2] = (Math.random() - .5) * 90; }
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rainPts = new THREE.Points(pg, new THREE.PointsMaterial({ color: '#d4e8ea', size: .5, transparent: true, opacity: 0, depthWrite: false, fog: true }));
    rainPts.visible = false; scene.add(rainPts);
  }

  const hsl = (h, s, l) => new THREE.Color().setHSL(h / 360, s, l);
  const SKINS_W = ['#f1c9a5', '#e0a878', '#c9854f', '#8d5a36'];

  // reusable simple person (for wandering NPCs)
  function makePerson(hue, skinColor) {
    const grp = new THREE.Group();
    const clothM = new THREE.MeshStandardMaterial({ color: hsl(hue, .5, .5), roughness: .8 });
    const pantsM = new THREE.MeshStandardMaterial({ color: hsl(hue, .35, .28), roughness: .85 });
    const skinM = new THREE.MeshStandardMaterial({ color: skinColor || '#e8b894', roughness: .9 });
    const hairM = new THREE.MeshStandardMaterial({ color: hsl(hue, .4, .2), roughness: 1 });
    const cap = (r, len, m) => { const x = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 5, 10), m); x.castShadow = true; return x; };
    const torso = cap(.24, .46, clothM); torso.position.y = 1.0; grp.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.24, 14, 14), skinM); head.position.y = 1.55; head.castShadow = true; grp.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(.265, 12, 12, 0, Math.PI * 2, 0, Math.PI * .62), hairM); hair.position.set(0, 1.59, -.02); grp.add(hair);
    function limb(x, y, r, len, m) { const p = new THREE.Group(); p.position.set(x, y, 0); const mm = cap(r, len, m); mm.position.y = -(len / 2 + r); p.add(mm); grp.add(p); return p; }
    const legL = limb(-.12, .72, .09, .4, pantsM), legR = limb(.12, .72, .09, .4, pantsM);
    const armL = limb(-.3, 1.22, .075, .38, clothM), armR = limb(.3, 1.22, .075, .38, clothM);
    return { group: grp, parts: { legL, legR, armL, armR, torso } };
  }
  function makeBlob(r) {
    const b = new THREE.Mesh(new THREE.CircleGeometry(r || .42, 16), new THREE.MeshBasicMaterial({ color: '#10302d', transparent: true, opacity: .22 }));
    b.rotation.x = -Math.PI / 2; b.position.y = .04; scene.add(b); return b;
  }

  // ── Ground ───────────────────────────────────────────────
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(230, 96),
    new THREE.MeshStandardMaterial({ color: '#54b89c', roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  const extraBlocks = [];   // non-building colliders (lake, event stage, props)
  const PLAZA_R = 60;

  // plaza (flat, flush with ground — no step) — doubled size
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(PLAZA_R, 96),
    new THREE.MeshStandardMaterial({ color: '#e9f4ed', roughness: .9 })
  );
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.02; plaza.receiveShadow = true;
  scene.add(plaza);
  const plazaRing = new THREE.Mesh(
    new THREE.TorusGeometry(PLAZA_R - 4, 0.25, 8, 120),
    new THREE.MeshStandardMaterial({ color: hsl(playerHue, .5, .6), roughness: .6 })
  );
  plazaRing.rotation.x = -Math.PI / 2; plazaRing.position.y = 0.06;
  scene.add(plazaRing);

  // ── 5 grand avenues radiating into the plaza ────────────
  const ROAD_BASE = Math.PI / 2;             // road 0 points +Z (the arrival road)
  const ROAD_STEP = Math.PI * 2 / 5;
  const roadMat = new THREE.MeshStandardMaterial({ color: '#cad5cc', roughness: .95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const lineMat = new THREE.MeshStandardMaterial({ color: '#eef4ee', roughness: .8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  function road(a) {
    const inner = PLAZA_R - 9, outer = 152, len = outer - inner, g = new THREE.Group();
    g.rotation.y = Math.PI / 2 - a;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(13, len), roadMat);
    plane.rotation.x = -Math.PI / 2; plane.position.set(0, 0.012, inner + len / 2); plane.receiveShadow = true;
    g.add(plane);
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(.7, len - 6), lineMat);
    dash.rotation.x = -Math.PI / 2; dash.position.set(0, 0.03, inner + len / 2); g.add(dash);
    // rounded junction flare blending the avenue into the plaza edge
    const flare = new THREE.Mesh(new THREE.CircleGeometry(13, 36), roadMat);
    flare.rotation.x = -Math.PI / 2; flare.position.set(0, 0.013, PLAZA_R - 7);
    g.add(flare);
    scene.add(g);
  }
  for (let k = 0; k < 5; k++) road(ROAD_BASE + k * ROAD_STEP);

  // tidy lawns, one in each open wedge (lake & fountain occupy two others)
  const grassMat = new THREE.MeshStandardMaterial({ color: '#8ed9bb', roughness: 1 });
  [0, 3, 4].forEach(k => {
    const a = ROAD_BASE + (k + 0.5) * ROAD_STEP;
    const gr = new THREE.Mesh(new THREE.CircleGeometry(11, 36), grassMat);
    gr.rotation.x = -Math.PI / 2; gr.position.set(Math.cos(a) * 33, 0.025, Math.sin(a) * 33);
    gr.receiveShadow = true; scene.add(gr);
  });

  // ── Lake (off to one side of the plaza) ──────────────────
  (function makeLake() {
    const la = ROAD_BASE + 1.5 * ROAD_STEP, lr = 34;
    const lx = Math.cos(la) * lr, lz = Math.sin(la) * lr;
    const water = new THREE.Mesh(new THREE.CircleGeometry(14, 56),
      new THREE.MeshStandardMaterial({ color: '#3aa6d6', roughness: .1, metalness: .4, transparent: true, opacity: .92 }));
    water.rotation.x = -Math.PI / 2; water.position.set(lx, 0.04, lz); scene.add(water);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(14, .55, 10, 64),
      new THREE.MeshStandardMaterial({ color: '#bcae93', roughness: .9 }));
    rim.rotation.x = -Math.PI / 2; rim.position.set(lx, 0.16, lz); rim.castShadow = true; scene.add(rim);
    extraBlocks.push({ pos: new THREE.Vector3(lx, 0, lz), r: 14.6 });
  })();

  // soft ground fade ring
  const skirt = new THREE.Mesh(
    new THREE.RingGeometry(222, 230, 96),
    new THREE.MeshBasicMaterial({ color: '#1b574f', transparent: true, opacity: 1 })
  );
  skirt.rotation.x = -Math.PI / 2; skirt.position.y = 0.02;
  scene.add(skirt);

  // ── Shops lining the avenues (scales to many storefronts) ─
  const shopObjs = [];
  const buildingBlocks = [];
  const billboards = [];
  function makeShopSign(text) {
    const cv = document.createElement('canvas'); cv.width = 340; cv.height = 88;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(12,30,30,.86)';
    const r = 22, x = 6, y = 6, w = 328, h = 76;
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); c.fill();
    c.fillStyle = '#eafcf8'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '600 34px "Space Grotesk", system-ui, sans-serif';
    c.fillText(text.length > 20 ? text.slice(0, 19) + '\u2026' : text, 170, 46);
    const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
    return new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.45), new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false }));
  }
  const avenues = [];
  for (let k = 0; k < 5; k++) avenues.push(ROAD_BASE + k * ROAD_STEP);
  const LAT = 11;                                  // lateral offset from road centre
  const LOT_D = lite ? [70, 90, 110] : [70, 84, 98, 112, 126];   // storefront depth steps per avenue

  function buildStore(x, z, rx, rz, hue, real, info) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.lookAt(rx, 0, rz);                             // shopfront faces the avenue
    const h = real ? 3.2 : 2.6 + (Math.abs((x * 13 + z * 7) % 7)) * 0.3;
    const bodyMat = new THREE.MeshStandardMaterial({ color: real ? '#f3f6f2' : hsl(hue, .12, .8), roughness: .85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: hsl(hue, .5, real ? .56 : .5), roughness: .6 });
    const accMat = new THREE.MeshStandardMaterial({ color: hsl(hue, .42, .34), roughness: .8 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.6, h, 4), bodyMat);
    body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true; g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 1.6, 4), roofMat);
    roof.position.y = h + .8; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(4.8, .5, 1.1), roofMat);
    awning.position.set(0, Math.min(2.5, h - .6), 2.3); g.add(awning);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.1, .2), accMat);
    door.position.set(0, 1.05, 2.02); g.add(door);
    const winMat = new THREE.MeshStandardMaterial({ color: hsl(hue, .35, .8), roughness: .3, metalness: .1 });
    [-1.4, 1.4].forEach(wx => { const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, .15), winMat); win.position.set(wx, 1.7, 2.02); g.add(win); });
    buildingBlocks.push({ pos: new THREE.Vector3(x, 0, z), r: 3.0 });
    if (real) {
      const marker = new THREE.Mesh(new THREE.TorusGeometry(.62, .1, 8, 24), new THREE.MeshBasicMaterial({ color: hsl(hue, .6, .55) }));
      marker.position.set(0, 6.3, 0); g.add(marker);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, 34, 16, 1, true), new THREE.MeshBasicMaterial({ color: hsl(hue, .6, .6), transparent: true, opacity: .16, side: THREE.DoubleSide }));
      beam.position.set(0, 17, 0); g.add(beam);
      shopObjs.push({ id: info.id, name: info.name, type: 'shop', trig: 4.6, hue, pos: new THREE.Vector3(x, 0, z), marker, markerBaseY: 6.3, beam });
      const sign = makeShopSign(info.name); sign.position.set(x, h + 2.5, z); scene.add(sign); billboards.push(sign);
    }
    scene.add(g);
  }

  // real interactive shops — near the plaza, one per avenue (1..4)
  const realSpots = shopsIn.map((s, i) => {
    const a = avenues[(i % 4) + 1];
    const d = 70, side = i % 2 === 0 ? 1 : -1;
    const px = -Math.sin(a), pz = Math.cos(a);
    return { x: Math.cos(a) * d + px * side * LAT, z: Math.sin(a) * d + pz * side * LAT, rx: Math.cos(a) * d, rz: Math.sin(a) * d, shop: s };
  });
  realSpots.forEach(sp => buildStore(sp.x, sp.z, sp.rx, sp.rz, sp.shop.hue, true, sp.shop));

  // generic storefronts filling both sides of every avenue (other sellers — shows scale)
  const GEN_HUES = [184, 150, 210, 250, 30, 95, 305, 46, 120, 265, 18, 330];
  let gi = 0;
  avenues.forEach(a => {
    const px = -Math.sin(a), pz = Math.cos(a);
    LOT_D.forEach(d => { [-1, 1].forEach(side => {
      const x = Math.cos(a) * d + px * side * LAT, z = Math.sin(a) * d + pz * side * LAT;
      if (realSpots.some(sp => Math.hypot(sp.x - x, sp.z - z) < 6)) return;
      buildStore(x, z, Math.cos(a) * d, Math.sin(a) * d, GEN_HUES[gi++ % GEN_HUES.length], false);
    }); });
  });

  // ── Fountain (plaza centerpiece) ─────────────────────────
  function makeFountain() {
    const g = new THREE.Group();
    const stoneM = new THREE.MeshStandardMaterial({ color: '#c2b497', roughness: .9 });
    const waterM = new THREE.MeshStandardMaterial({ color: hsl(playerHue, .5, .62), roughness: .15, metalness: .25, transparent: true, opacity: .82 });
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.35, .6, 28), stoneM); basin.position.y = .3; basin.castShadow = true; basin.receiveShadow = true; g.add(basin);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(1.85, 1.85, .22, 28), waterM); water.position.y = .56; g.add(water);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(.32, .42, 1.4, 14), stoneM); stem.position.y = 1.15; g.add(stem);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(.85, .5, .32, 18), stoneM); bowl.position.y = 1.95; g.add(bowl);
    const topWater = new THREE.Mesh(new THREE.CylinderGeometry(.72, .72, .1, 18), waterM); topWater.position.y = 2.12; g.add(topWater);
    g.position.set(Math.cos(ROAD_BASE + 2.5 * ROAD_STEP) * 38, 0, Math.sin(ROAD_BASE + 2.5 * ROAD_STEP) * 38);
    scene.add(g); return g;
  }
  makeFountain();
  extraBlocks.push({ pos: new THREE.Vector3(Math.cos(ROAD_BASE + 2.5 * ROAD_STEP) * 38, 0, Math.sin(ROAD_BASE + 2.5 * ROAD_STEP) * 38), r: 3 });

  // ── Event stage at the heart of the plaza ────────────────
  (function eventCentre() {
    const stoneM = new THREE.MeshStandardMaterial({ color: '#dde7dd', roughness: .85 });
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.5, .4, 44), stoneM);
    dais.position.y = .2; dais.receiveShadow = true; dais.castShadow = true; scene.add(dais);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(7, .2, 8, 56), new THREE.MeshStandardMaterial({ color: hsl(playerHue, .55, .55), roughness: .5 }));
    trim.rotation.x = -Math.PI / 2; trim.position.y = .42; scene.add(trim);
    extraBlocks.push({ pos: new THREE.Vector3(0, 0, 0), r: 7.7 });
    const poleM = new THREE.MeshStandardMaterial({ color: '#8a6038', roughness: .8 });
    [-5, 5].forEach(px => { const p = new THREE.Mesh(new THREE.CylinderGeometry(.18, .22, 6.2, 10), poleM); p.position.set(px, 3.1, 0); p.castShadow = true; scene.add(p); });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(11, .42, .42), poleM); beam.position.set(0, 6, 0); scene.add(beam);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.1), new THREE.MeshStandardMaterial({ color: hsl(playerHue, .5, .55), roughness: .8, side: THREE.DoubleSide }));
    banner.position.set(0, 4.9, 0); scene.add(banner);
    [-5, 5].forEach(px => { const l = new THREE.Mesh(new THREE.SphereGeometry(.42, 12, 12), new THREE.MeshStandardMaterial({ color: '#ffd98a', emissive: '#ffbf52', emissiveIntensity: .85 })); l.position.set(px, 5.5, 0); scene.add(l); });
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * 6.28, px = Math.cos(a) * 9.2, pz = Math.sin(a) * 9.2;
      const planter = new THREE.Mesh(new THREE.CylinderGeometry(.6, .5, .9, 10), poleM); planter.position.set(px, .45, pz); planter.castShadow = true; scene.add(planter);
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(.75, 0), new THREE.MeshStandardMaterial({ color: hsl(140, .4, .5), roughness: 1 })); bush.position.set(px, 1.2, pz); bush.castShadow = true; scene.add(bush);
      extraBlocks.push({ pos: new THREE.Vector3(px, 0, pz), r: .95 });
    }
  })();

  // ── Interaction points: quest board + cart kiosk ─────────
  function makeQuestBoard(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const woodM = new THREE.MeshStandardMaterial({ color: '#7c5a3a', roughness: .9 });
    [-.85, .85].forEach(px => { const p = new THREE.Mesh(new THREE.CylinderGeometry(.1, .12, 2.5, 8), woodM); p.position.set(px, 1.25, 0); p.castShadow = true; g.add(p); });
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.55, .16), new THREE.MeshStandardMaterial({ color: '#cdac80', roughness: .95 }));
    board.position.set(0, 2.05, 0); board.castShadow = true; g.add(board);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.5, .14, .2), woodM); frame.position.set(0, 2.85, 0); g.add(frame);
    [['#eafcf8', -.55, .15, -.12], ['#ffe7a8', .55, -.08, .14], ['#cdece4', .02, .42, .05]].forEach(([c, nx, ny, rz]) => {
      const n = new THREE.Mesh(new THREE.PlaneGeometry(.55, .66), new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
      n.position.set(nx, 2.05 + ny, .1); n.rotation.z = rz; g.add(n);
    });
    const marker = new THREE.Mesh(new THREE.TorusGeometry(.5, .09, 8, 22), new THREE.MeshBasicMaterial({ color: hsl(45, .85, .62) }));
    marker.position.set(0, 3.55, 0); g.add(marker);
    const bang = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, .42, 8), new THREE.MeshBasicMaterial({ color: hsl(45, .85, .62) })); bang.position.set(0, 3.58, 0); g.add(bang);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(.08, 8, 8), new THREE.MeshBasicMaterial({ color: hsl(45, .85, .62) })); dot.position.set(0, 3.28, 0); g.add(dot);
    scene.add(g); g.lookAt(0, 0, 0);
    return marker;
  }
  function makeKiosk(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const woodM = new THREE.MeshStandardMaterial({ color: '#8a6038', roughness: .9 });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 1.1), new THREE.MeshStandardMaterial({ color: '#c79a64', roughness: .9 }));
    counter.position.set(0, .55, 0); counter.castShadow = true; counter.receiveShadow = true; g.add(counter);
    [[-1.2, -.45], [1.2, -.45], [-1.2, .45], [1.2, .45]].forEach(([px, pz]) => { const p = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, 2.5, 8), woodM); p.position.set(px, 1.25, pz); p.castShadow = true; g.add(p); });
    const awn = new THREE.Group(); awn.position.set(0, 2.5, .1); awn.rotation.x = -.14;
    awn.add(new THREE.Mesh(new THREE.BoxGeometry(2.9, .14, 1.4), new THREE.MeshStandardMaterial({ color: hsl(playerHue, .5, .55), roughness: .7 })));
    const edge = new THREE.Mesh(new THREE.BoxGeometry(2.9, .34, .1), new THREE.MeshStandardMaterial({ color: '#eafcf8', roughness: .8 })); edge.position.set(0, -.2, .7); awn.add(edge);
    g.add(awn);
    const boxM = new THREE.MeshStandardMaterial({ color: hsl(playerHue, .45, .62), roughness: .7 });
    [[-.5, 1.28, 0, .5], [.42, 1.22, .12, .44], [.05, 1.6, -.08, .34]].forEach(([bx, by, bz, s]) => { const b = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), boxM); b.position.set(bx, by, bz); b.castShadow = true; g.add(b); });
    const marker = new THREE.Mesh(new THREE.TorusGeometry(.5, .09, 8, 22), new THREE.MeshBasicMaterial({ color: hsl(playerHue, .6, .6) })); marker.position.set(0, 3.35, 0); g.add(marker);
    scene.add(g); g.lookAt(0, 0, 0);
    return marker;
  }
  const qbMarker = makeQuestBoard(-18, 12);
  const kioskMarker = makeKiosk(18, 12);
  const pois = [
    { id: 'quests', type: 'quests', name: 'Quests', trig: 3.6, pos: new THREE.Vector3(-18, 0, 12), marker: qbMarker, markerBaseY: 3.55, solid: 1.3 },
    { id: 'cart', type: 'cart', name: 'Cart', trig: 3.6, pos: new THREE.Vector3(18, 0, 12), marker: kioskMarker, markerBaseY: 3.35, solid: 1.5 },
  ];
  const interactables = shopObjs.concat(pois);
  const blockers = buildingBlocks
    .concat(extraBlocks)
    .concat(pois.map(p => ({ pos: p.pos, r: p.solid })));

  // ── Benches around the fountain ──────────────────────────
  function bench(x, z, rot) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot;
    const wM = new THREE.MeshStandardMaterial({ color: '#9a7a52', roughness: .9 });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.5, .12, .5), wM); seat.position.y = .5; seat.castShadow = true; g.add(seat);
    const backR = new THREE.Mesh(new THREE.BoxGeometry(1.5, .5, .1), wM); backR.position.set(0, .78, -.2); g.add(backR);
    [-.6, .6].forEach(lx => { const lg = new THREE.Mesh(new THREE.BoxGeometry(.12, .5, .42), wM); lg.position.set(lx, .25, 0); g.add(lg); });
    decoGroupSafe(g);
  }

  // ── Decorations: trees, lamps, planters ─────────────────
  const decoGroup = new THREE.Group(); scene.add(decoGroup);
  function decoGroupSafe(g) { decoGroup.add(g); }
  function tree(x, z, scl) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(scl);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.18, .24, 1.2, 6),
      new THREE.MeshStandardMaterial({ color: '#8a6a4a', roughness: 1 }));
    trunk.position.y = .6; trunk.castShadow = true; g.add(trunk);
    const leafMat = new THREE.MeshStandardMaterial({ color: hsl(150, .35, .5), roughness: 1 });
    [[0, 1.7, 1.1], [.5, 2.3, .8], [-.4, 2.4, .7]].forEach(([dx, dy, r]) => {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leafMat);
      m.position.set(dx, dy, 0); m.castShadow = true; g.add(m);
    });
    decoGroup.add(g);
  }
  function lamp(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.07, .09, 3, 8),
      new THREE.MeshStandardMaterial({ color: '#3a4d4a', roughness: .7 }));
    pole.position.y = 1.5; pole.castShadow = true; g.add(pole);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(.22, 12, 12),
      new THREE.MeshStandardMaterial({ color: '#fff4d6', emissive: '#ffe7a8', emissiveIntensity: .8 }));
    orb.position.y = 3.05; g.add(orb);
    decoGroup.add(g);
  }
  const treeN = lite ? 10 : 18;
  for (let i = 0; i < treeN; i++) {
    const a = (i / treeN) * Math.PI * 2 + (Math.random() - .5) * .4, r = 106 + Math.random() * 30;
    tree(Math.cos(a) * r, Math.sin(a) * r, 1 + Math.random() * .9);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + .4;
    lamp(Math.cos(a) * 54, Math.sin(a) * 54);
  }

  // ── Character (shared avatar builder) ────────────────────
  const av = buildAvatar({ hue: playerHue, skinColor: '#e8b894', hairLight: 0.22, style: 'minimal' });
  const player = av.group;
  const parts = av.parts;
  const torso = parts.torso;

  scene.add(player);
  player.position.set(0, 0, 16);
  player.rotation.y = Math.PI;
  camera.position.set(0, 20, 40);

  // blob shadow (visible even with shadows off)
  const blob = new THREE.Mesh(new THREE.CircleGeometry(.5, 20),
    new THREE.MeshBasicMaterial({ color: '#1c3b38', transparent: true, opacity: .26 }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = .05; scene.add(blob);

  // ── Wandering NPCs (life in the world) ─────────────────
  const npcs = [];
  const NPC_HUES = [20, 305, 46, 265, 170, 120];
  function wanderTarget() { const a = Math.random() * Math.PI * 2, r = 9 + Math.random() * 48; return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r); }
  function makeEmote(kind) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 96; const c = cv.getContext('2d');
    c.fillStyle = 'rgba(255,255,255,.96)'; c.beginPath(); c.arc(48, 40, 34, 0, 7); c.fill();
    c.beginPath(); c.moveTo(36, 66); c.lineTo(48, 82); c.lineTo(60, 66); c.closePath(); c.fill();
    c.fillStyle = kind === 'coin' ? '#f0b53e' : kind === 'heart' ? '#ff6f8e' : kind === 'chat' ? '#16b6e0' : '#15c6a8';
    c.font = '46px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const g = kind === 'coin' ? '\u00a4' : kind === 'heart' ? '\u2665' : kind === 'chat' ? '\u2026' : '\u25cf';
    c.fillText(g, 48, 41);
    const tex = new THREE.CanvasTexture(cv);
    return new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, depthTest: false }));
  }
  // No fake crowd — other people in the plaza will be REAL users (none seeded).
  for (let i = 0; i < 0; i++) {
    const p = makePerson(NPC_HUES[i % NPC_HUES.length], SKINS_W[i % 4]);
    const a = (i / 6) * Math.PI * 2, r = 5 + Math.random() * 6;
    p.group.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    scene.add(p.group);
    const emote = makeEmote(['shop', 'coin', 'heart', 'chat'][i % 4]); emote.visible = false; scene.add(emote); billboards.push(emote);
    npcs.push({ group: p.group, parts: p.parts, target: wanderTarget(), phase: Math.random() * 6, blob: makeBlob(.38), state: 'walk', idleT: 0, emote });
  }

  // ── Collectible coins ──────────────────────────────
  const coins = [];
  const coinMat = new THREE.MeshStandardMaterial({ color: '#f3cd84', emissive: '#caa14a', emissiveIntensity: .5, metalness: .5, roughness: .35 });
  function spawnCoin(x, z) {
    const g = new THREE.Group(); g.position.set(x, .95, z);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(.34, .34, .07, 18), coinMat); c.rotation.x = Math.PI / 2; g.add(c);
    scene.add(g); coins.push({ g, base: .95, x, z });
  }
  for (let i = 0; i < (lite ? 10 : 20); i++) {
    const a = Math.random() * Math.PI * 2, r = 16 + Math.random() * 116;
    spawnCoin(Math.cos(a) * r, Math.sin(a) * r);
  }

  // ── Input: keyboard ──────────────────────────────────────
  const keys = {};
  const onKey = (e, down) => {
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys[k] = down; e.preventDefault(); }
  };
  const kd = e => onKey(e, true), ku = e => onKey(e, false);
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);

  // ── Input: virtual joystick ──────────────────────────────
  const joy = { active: false, id: null, x: 0, y: 0 };
  const base = document.createElement('div'); base.className = 'v-joy-base';
  const knob = document.createElement('div'); knob.className = 'v-joy-knob';
  base.appendChild(knob); container.appendChild(base);
  const R = 52;
  function joyStart(e) {
    joy.active = true; joy.id = e.pointerId;
    const r = base.getBoundingClientRect();
    joy.cx = r.left + r.width / 2; joy.cy = r.top + r.height / 2;
    base.setPointerCapture(e.pointerId); joyMove(e);
  }
  function joyMove(e) {
    if (!joy.active || e.pointerId !== joy.id) return;
    let dx = e.clientX - joy.cx, dy = e.clientY - joy.cy;
    const d = Math.hypot(dx, dy) || 1;
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    joy.x = dx / R; joy.y = dy / R;
  }
  function joyEnd(e) {
    if (e.pointerId !== joy.id) return;
    joy.active = false; joy.x = 0; joy.y = 0; knob.style.transform = 'translate(0,0)';
  }
  base.addEventListener('pointerdown', joyStart);
  base.addEventListener('pointermove', joyMove);
  base.addEventListener('pointerup', joyEnd);
  base.addEventListener('pointercancel', joyEnd);

  // ── Orbit camera (drag to rotate 360°, pinch / wheel to zoom) ─
  let camYaw = 0, camElev = 0.6, camDist = 70;
  const dom = renderer.domElement;
  const orbit = { pointers: new Map(), lastDist: 0 };
  function camDown(e) { orbit.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { dom.setPointerCapture(e.pointerId); } catch (_) {} }
  function camMove(e) {
    if (!orbit.pointers.has(e.pointerId)) return;
    const prev = orbit.pointers.get(e.pointerId);
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    orbit.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (orbit.pointers.size >= 2) {
      const pts = [...orbit.pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (orbit.lastDist) camDist = Math.max(12, Math.min(185, camDist - (d - orbit.lastDist) * 0.12));
      orbit.lastDist = d;
    } else {
      camYaw -= dx * 0.007;
      camElev = Math.max(0.16, Math.min(1.32, camElev + dy * 0.005));
    }
  }
  function camUp(e) { orbit.pointers.delete(e.pointerId); if (orbit.pointers.size < 2) orbit.lastDist = 0; }
  dom.addEventListener('pointerdown', camDown);
  dom.addEventListener('pointermove', camMove);
  dom.addEventListener('pointerup', camUp);
  dom.addEventListener('pointercancel', camUp);
  const onWheel = (e) => { camDist = Math.max(12, Math.min(185, camDist + e.deltaY * 0.05)); e.preventDefault(); };
  dom.addEventListener('wheel', onWheel, { passive: false });

  // ── Minimap ──────────────────────────────────────────────
  const mini = document.createElement('canvas');
  mini.className = 'v-minimap'; mini.width = 120; mini.height = 120;
  container.appendChild(mini); mini.style.display = 'none';
  const mctx = mini.getContext('2d');
  const dotColor = (it) => it.type === 'shop' ? '#' + hsl(it.hue, .6, .62).getHexString()
    : it.type === 'quests' ? '#f0c860' : '#7fe0d0';
  function drawMinimap() {
    const px = player.position.x, pz = player.position.z;
    mctx.clearRect(0, 0, 120, 120);
    mctx.save();
    mctx.beginPath(); mctx.arc(60, 60, 57, 0, 7); mctx.closePath();
    mctx.fillStyle = 'rgba(9,26,26,.62)'; mctx.fill(); mctx.clip();
    const sc = 57 / 175;
    interactables.forEach(it => {
      const dx = it.pos.x - px, dz = it.pos.z - pz;
      const ang = Math.atan2(dx, dz) - (camYaw + Math.PI);
      let d = Math.hypot(dx, dz) * sc; d = Math.min(d, 53);
      const sx = 60 + Math.sin(ang) * d, sy = 60 - Math.cos(ang) * d;
      mctx.fillStyle = dotColor(it);
      mctx.beginPath(); mctx.arc(sx, sy, it.type === 'shop' ? 4.5 : 3.5, 0, 7); mctx.fill();
    });
    mctx.restore();
    // player arrow (always up = camera-forward)
    mctx.fillStyle = '#eafcf8';
    mctx.beginPath(); mctx.moveTo(60, 52); mctx.lineTo(55, 65); mctx.lineTo(60, 61); mctx.lineTo(65, 65); mctx.closePath(); mctx.fill();
  }

  // ── Loop ─────────────────────────────────────────────────
  const SPEED = 6.6;
  const camTarget = new THREE.Vector3();
  let phase = 0, near = null, raf = 0, last = performance.now(), running = true;
  const tmp = new THREE.Vector3();

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;

    // input vector (screen → world): up = -Z
    let ix = 0, iz = 0;
    if (keys['w'] || keys['arrowup']) iz -= 1;
    if (keys['s'] || keys['arrowdown']) iz += 1;
    if (keys['a'] || keys['arrowleft']) ix -= 1;
    if (keys['d'] || keys['arrowright']) ix += 1;
    ix += joy.x; iz += joy.y;
    let mag = Math.hypot(ix, iz);
    const moving = mag > 0.08;
    if (mag > 1) { ix /= mag; iz /= mag; mag = 1; }

    if (moving) {
      // movement relative to camera yaw
      const fwdX = -Math.sin(camYaw), fwdZ = -Math.cos(camYaw);
      const rgtX = Math.cos(camYaw), rgtZ = -Math.sin(camYaw);
      const mvx = rgtX * ix + fwdX * (-iz);
      const mvz = rgtZ * ix + fwdZ * (-iz);
      player.position.x += mvx * SPEED * dt;
      player.position.z += mvz * SPEED * dt;
      // bounds
      const pr = Math.hypot(player.position.x, player.position.z);
      if (pr > 150) { player.position.x *= 150 / pr; player.position.z *= 150 / pr; }
      // block walking into buildings / fountain / kiosks
      blockers.forEach(b => {
        const dx = player.position.x - b.pos.x, dz = player.position.z - b.pos.z;
        const dd = Math.hypot(dx, dz) || 1;
        if (dd < b.r) { player.position.x = b.pos.x + dx / dd * b.r; player.position.z = b.pos.z + dz / dd * b.r; }
      });
      // face direction of travel
      const targetRot = Math.atan2(mvx, mvz);
      let cur = player.rotation.y;
      let diff = ((targetRot - cur + Math.PI) % (Math.PI * 2)) - Math.PI;
      player.rotation.y = cur + diff * Math.min(1, dt * 12);
    }

    // walk animation
    const sp = moving ? mag : 0;
    phase += dt * (6 + sp * 4) * (moving ? 1 : 0);
    const swing = moving ? 0.7 * sp : 0;
    const ease = (p, v) => p.rotation.x += (v - p.rotation.x) * Math.min(1, dt * 14);
    ease(parts.legL, Math.sin(phase) * swing);
    ease(parts.legR, -Math.sin(phase) * swing);
    ease(parts.armL, -Math.sin(phase) * swing * 0.7);
    ease(parts.armR, Math.sin(phase) * swing * 0.7);
    // little body bob
    torso.position.y = 1.05 + (moving ? Math.abs(Math.sin(phase)) * 0.04 : 0);

    blob.position.set(player.position.x, .05, player.position.z);

    // camera follow (orbit position from yaw / elevation / distance)
    const offX = camDist * Math.cos(camElev) * Math.sin(camYaw);
    const offZ = camDist * Math.cos(camElev) * Math.cos(camYaw);
    const offY = camDist * Math.sin(camElev);
    camTarget.set(player.position.x + offX, player.position.y + offY, player.position.z + offZ);
    camera.position.lerp(camTarget, Math.min(1, dt * 6));
    tmp.set(player.position.x, player.position.y + 1.4, player.position.z);
    camera.lookAt(tmp);

    // markers spin / bob
    const t = now / 1000;
    interactables.forEach((it, i) => {
      if (!it.marker) return;
      it.marker.rotation.z = t * 1.2 + i;
      it.marker.position.y = it.markerBaseY + Math.sin(t * 1.6 + i) * 0.15;
    });
    plazaRing.rotation.z = t * 0.15;
    for (let bi = 0; bi < billboards.length; bi++) billboards[bi].quaternion.copy(camera.quaternion);

    // ── weather + sky drive ──
    wT += dt;
    const wk = Math.max(0, Math.min(1, (wT - (wDur - wFade)) / wFade));
    const WA = WEATHER[wIdx], WB = WEATHER[wNext];
    skyU.top.value.lerpColors(WA._top, WB._top, wk);
    skyU.bot.value.lerpColors(WA._bot, WB._bot, wk);
    scene.fog.color.lerpColors(WA._fog, WB._fog, wk);
    sun.color.lerpColors(WA._sun, WB._sun, wk);
    sun.intensity = WA.sunI + (WB.sunI - WA.sunI) * wk;
    amb.intensity = WA.ambI + (WB.ambI - WA.ambI) * wk;
    hemi.intensity = WA.hemiI + (WB.hemiI - WA.hemiI) * wk;
    sunDisc.material.color.lerpColors(WA._sunC, WB._sunC, wk);
    sunDisc.material.opacity = WA.sunO + (WB.sunO - WA.sunO) * wk;
    const cloudA = WA.cloud + (WB.cloud - WA.cloud) * wk;
    const rainA = WA.rain + (WB.rain - WA.rain) * wk;
    sky.position.copy(camera.position);
    sunDisc.position.set(camera.position.x - 150, 100, camera.position.z - 190);
    sunDisc.lookAt(camera.position);
    clouds.forEach(c => { c.material.opacity = cloudA * 0.7; c.position.x += dt * 1.6; if (c.position.x > 160) c.position.x = -160; });
    if (rainPts) {
      rainPts.visible = rainA > 0.04;
      if (rainPts.visible) {
        const arr = rainPts.geometry.attributes.position.array;
        for (let i = 0; i < rainN; i++) { arr[i * 3 + 1] -= dt * 42; if (arr[i * 3 + 1] < 0) { arr[i * 3 + 1] = 44; arr[i * 3] = (Math.random() - .5) * 90; arr[i * 3 + 2] = (Math.random() - .5) * 90; } }
        rainPts.geometry.attributes.position.needsUpdate = true;
        rainPts.position.set(player.position.x, 0, player.position.z);
        rainPts.material.opacity = rainA * 0.6;
      }
    }
    if (wT >= wDur) { wIdx = wNext; wNext = (wNext + 1) % WEATHER.length; wT = 0; }

    // wandering NPCs — clear states: walk to a spot, stop, wave with an intent bubble, move on
    npcs.forEach(n => {
      const np = n.group.position;
      if (n.state === 'walk') {
        const dx = n.target.x - np.x, dz = n.target.z - np.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.6) { n.state = 'idle'; n.idleT = 1.8 + Math.random() * 2.6; n.emote.visible = true; }
        else {
          const nsp = 1.7;
          np.x += dx / d * nsp * dt; np.z += dz / d * nsp * dt;
          const tr = Math.atan2(dx, dz);
          let diff = ((tr - n.group.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
          n.group.rotation.y += diff * Math.min(1, dt * 6);
          n.phase += dt * 8; const sw = .55;
          n.parts.legL.rotation.x = Math.sin(n.phase) * sw;
          n.parts.legR.rotation.x = -Math.sin(n.phase) * sw;
          n.parts.armL.rotation.x = -Math.sin(n.phase) * sw * .7;
          n.parts.armR.rotation.x = Math.sin(n.phase) * sw * .7;
        }
      } else {
        n.idleT -= dt;
        n.parts.legL.rotation.x += (0 - n.parts.legL.rotation.x) * Math.min(1, dt * 8);
        n.parts.legR.rotation.x += (0 - n.parts.legR.rotation.x) * Math.min(1, dt * 8);
        n.parts.armL.rotation.x += (0 - n.parts.armL.rotation.x) * Math.min(1, dt * 8);
        n.parts.armR.rotation.x = -1.0 - Math.abs(Math.sin(t * 6)) * 0.5;
        n.group.rotation.y += Math.sin(t * 1.4) * dt * 0.8;
        if (n.idleT <= 0) { n.state = 'walk'; n.target = wanderTarget(); n.emote.visible = false; }
      }
      n.blob.position.set(np.x, .04, np.z);
      n.emote.position.set(np.x, 2.5 + Math.sin(t * 3 + np.x) * 0.08, np.z);
    });

    // coins: spin, bob, pickup
    for (let ci = coins.length - 1; ci >= 0; ci--) {
      const co = coins[ci];
      co.g.rotation.y += dt * 2.6;
      co.g.position.y = co.base + Math.sin(t * 2 + ci) * 0.12;
      const cd = Math.hypot(player.position.x - co.x, player.position.z - co.z);
      if (cd < 1.4) { scene.remove(co.g); coins.splice(ci, 1); opts.onCoin && opts.onCoin(5); }
    }

    // proximity (shops + POIs)
    let best = null, bestD = Infinity;
    interactables.forEach(it => {
      const d = Math.hypot(player.position.x - it.pos.x, player.position.z - it.pos.z);
      if (d < (it.trig || 4) && d < bestD) { bestD = d; best = it; }
    });
    const id = best ? best.id : null;
    if (id !== (near && near.id)) {
      near = best;
      opts.onProximity && opts.onProximity(best ? { id: best.id, name: best.name, type: best.type } : null);
    }

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  // ── Resize ───────────────────────────────────────────────
  const ro = new ResizeObserver(() => {
    camera.aspect = W() / H(); camera.updateProjectionMatrix();
    renderer.setSize(W(), H());
  });
  ro.observe(container);

  // Pause rendering while the tab is hidden (saves battery on mobile).
  let disposed = false;
  const onVisibility = () => {
    if (disposed) return;
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  };
  document.addEventListener('visibilitychange', onVisibility);

  // ── API ──────────────────────────────────────────────────
  return {
    dispose() {
      disposed = true; running = false; cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
      dom.removeEventListener('pointerdown', camDown); dom.removeEventListener('pointermove', camMove);
      dom.removeEventListener('pointerup', camUp); dom.removeEventListener('pointercancel', camUp);
      dom.removeEventListener('wheel', onWheel);
      renderer.dispose();
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } });
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      if (base.parentNode) base.parentNode.removeChild(base);
      if (mini.parentNode) mini.parentNode.removeChild(mini);
    },
    recenter() { player.position.set(0, 0, 16); player.rotation.y = Math.PI; },
  };
};
