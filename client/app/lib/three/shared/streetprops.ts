// @ts-nocheck -- realistic street furniture library
//
// streetprops.ts — true-to-life street furniture for a modern outdoor
// commercial street. Real-world proportions (1 unit ≈ 1 m), neutral PBR
// materials supplied by the shared material library (`mats`). Every builder
// returns a THREE.Group positioned at the origin; the caller places & rotates.
//
//   createStreetProps(mats) -> {
//     streetlight, bench, planter, bin, bollard, tree,
//     crosswalk, trafficSign, parasol, awning
//   }
//
// Performance notes (mobile budget):
//   - Tree foliage uses an InstancedMesh (one draw call for all leaf blobs).
//   - Crosswalk stripes use an InstancedMesh sharing a single polygonOffset
//     material so the whole crossing is one draw call and never z-fights.

import * as THREE from 'three';

export function createStreetProps(mats) {
  /* ------------------------------------------------------------------ *
   * Shared geometry caches. Builders are called many times across the
   * world, so we reuse a handful of unit primitives and only allocate
   * bespoke geometry where dimensions genuinely differ.
   * ------------------------------------------------------------------ */
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);

  // Trivial emissive material for lamp bulbs only (allowed exception). Shared
  // across every streetlight so they bloom uniformly at night.
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xfff4d6,
    emissive: 0xffe6a8,
    emissiveIntensity: 1.4,
    roughness: 0.4,
  });

  // White road-marking material for crosswalks. polygonOffset pulls the
  // stripes toward the camera so they sit cleanly on the asphalt without
  // z-fighting (allowed exception to "use mats only").
  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0xf2f2ee,
    roughness: 0.8,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });

  /** Mark a mesh as a solid shadow-caster (and optionally a receiver). */
  function solid(mesh, receive = false) {
    mesh.castShadow = true;
    if (receive) mesh.receiveShadow = true;
    return mesh;
  }

  /* ====================================================================
   * streetlight — ~5 m painted-steel pole with a cantilevered arm and a
   * lamp head containing an emissive bulb (no PointLight; the integrator
   * adds those sparingly).
   * ================================================================== */
  function streetlight() {
    const g = new THREE.Group();

    // Cast base + tapered pole.
    const base = solid(new THREE.Mesh(cyl(0.14, 0.2, 0.4, 12), mats.steelDark), true);
    base.position.y = 0.2;
    g.add(base);

    const pole = solid(new THREE.Mesh(cyl(0.08, 0.12, 5.0, 12), mats.steelDark));
    pole.position.y = 2.7;
    g.add(pole);

    // Cantilevered arm reaching over the carriageway.
    const arm = solid(new THREE.Mesh(cyl(0.05, 0.06, 1.4, 8), mats.steelDark));
    arm.rotation.z = Math.PI / 2;
    arm.position.set(0.7, 5.1, 0);
    g.add(arm);

    // Lamp head (slanted housing) at the end of the arm.
    const head = solid(new THREE.Mesh(box(0.5, 0.16, 0.34), mats.steelDark));
    head.position.set(1.4, 5.02, 0);
    head.rotation.z = -0.12;
    g.add(head);

    // Emissive bulb on the underside so it can bloom at night.
    const bulb = new THREE.Mesh(box(0.4, 0.05, 0.26), bulbMat);
    bulb.position.set(1.4, 4.93, 0);
    g.add(bulb);

    return g;
  }

  /* ====================================================================
   * bench — 1.5 m wood-slat seat & back on steel end frames.
   * Seat height ~0.45 m.
   * ================================================================== */
  function bench() {
    const g = new THREE.Group();
    const len = 1.5;

    // Seat: three wooden slats with small gaps.
    const slatGeo = box(len, 0.04, 0.13);
    [-0.16, 0, 0.16].forEach((z) => {
      const s = solid(new THREE.Mesh(slatGeo, mats.wood), true);
      s.position.set(0, 0.45, z);
      g.add(s);
    });

    // Backrest: two angled slats.
    const backGeo = box(len, 0.05, 0.1);
    [0, 0.18].forEach((dy, i) => {
      const b = solid(new THREE.Mesh(backGeo, mats.wood));
      b.position.set(0, 0.62 + dy, -0.24 - i * 0.02);
      b.rotation.x = -0.18;
      g.add(b);
    });

    // Steel end frames (legs + seat support) at each end.
    const legGeo = box(0.05, 0.45, 0.5);
    [-0.66, 0.66].forEach((x) => {
      const frame = solid(new THREE.Mesh(legGeo, mats.steelDark), true);
      frame.position.set(x, 0.225, 0);
      g.add(frame);
    });

    return g;
  }

  /* ====================================================================
   * planter — concrete box trimmed with a wood cap; soil inside. If
   * withTree, drop a small tree/shrub into it. ~0.6 m tall.
   * ================================================================== */
  function planter(withTree = false) {
    const g = new THREE.Group();
    const w = 0.9;

    // Concrete body.
    const body = solid(new THREE.Mesh(box(w, 0.55, w), mats.concrete), true);
    body.position.y = 0.275;
    g.add(body);

    // Wood cap rim.
    const cap = solid(new THREE.Mesh(box(w + 0.06, 0.06, w + 0.06), mats.wood));
    cap.position.y = 0.58;
    g.add(cap);

    // Soil surface (foliage material reads as dark earthy green).
    const soil = new THREE.Mesh(box(w - 0.1, 0.04, w - 0.1), mats.bark);
    soil.position.y = 0.55;
    soil.receiveShadow = true;
    g.add(soil);

    if (withTree) {
      // A compact shrub: trunk + a couple of foliage blobs sized for a box.
      const t = tree(0.5);
      t.position.y = 0.57;
      g.add(t);
    }

    return g;
  }

  /* ====================================================================
   * bin — ~1 m steel litter bin: cylindrical body, banded rim, domed lid
   * with an aperture.
   * ================================================================== */
  function bin() {
    const g = new THREE.Group();

    const body = solid(new THREE.Mesh(cyl(0.26, 0.24, 0.8, 16), mats.steelDark), true);
    body.position.y = 0.4;
    g.add(body);

    // Top rim band.
    const rim = solid(new THREE.Mesh(cyl(0.28, 0.28, 0.08, 16), mats.metalFrame));
    rim.position.y = 0.82;
    g.add(rim);

    // Domed lid (half sphere) with a dark opening at the front.
    const lid = solid(new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mats.steelDark));
    lid.position.y = 0.86;
    g.add(lid);

    const slot = new THREE.Mesh(box(0.24, 0.12, 0.04), mats.metalFrame);
    slot.position.set(0, 0.92, 0.25);
    g.add(slot);

    return g;
  }

  /* ====================================================================
   * bollard — short (~0.9 m) steel post with a reflective collar.
   * ================================================================== */
  function bollard() {
    const g = new THREE.Group();

    const post = solid(new THREE.Mesh(cyl(0.08, 0.09, 0.9, 12), mats.steelDark), true);
    post.position.y = 0.45;
    g.add(post);

    // Rounded cap.
    const cap = solid(new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mats.steelDark));
    cap.position.y = 0.9;
    g.add(cap);

    // Light reflective collar near the top.
    const collar = new THREE.Mesh(cyl(0.085, 0.085, 0.08, 12), mats.metalFrame);
    collar.position.y = 0.78;
    g.add(collar);

    return g;
  }

  /* ====================================================================
   * tree — bark trunk + foliage canopy. The canopy is several icosahedron
   * blobs drawn as a single InstancedMesh to keep draw calls down.
   * scale=1 ≈ a ~5 m street tree.
   * ================================================================== */
  function tree(scale = 1) {
    const g = new THREE.Group();
    g.scale.setScalar(scale);

    // Trunk (slightly tapered).
    const trunk = solid(new THREE.Mesh(cyl(0.16, 0.24, 2.4, 8), mats.bark), true);
    trunk.position.y = 1.2;
    g.add(trunk);

    // Foliage: 4 blobs of varying size, instanced into one draw call.
    const blobs = [
      [0.0, 3.4, 0.0, 1.3],
      [0.7, 3.9, 0.2, 0.95],
      [-0.6, 4.0, -0.3, 0.9],
      [0.1, 4.6, -0.1, 0.8],
    ];
    const leafGeo = new THREE.IcosahedronGeometry(1, 1);
    const canopy = new THREE.InstancedMesh(leafGeo, mats.foliage, blobs.length);
    canopy.castShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    blobs.forEach((b, i) => {
      p.set(b[0], b[1], b[2]);
      // Slight irregular squash so blobs don't read as perfect spheres.
      s.set(b[3], b[3] * 0.92, b[3]);
      m.compose(p, q, s);
      canopy.setMatrixAt(i, m);
    });
    canopy.instanceMatrix.needsUpdate = true;
    g.add(canopy);

    return g;
  }

  /* ====================================================================
   * crosswalk — flat white zebra stripes laid on the road. Stripes lie in
   * the XZ plane at a tiny y offset and use a polygonOffset material to
   * avoid z-fighting. All stripes share one InstancedMesh (1 draw call).
   *   width  → spans across the road (X)
   *   length → distance walked across (Z)
   * ================================================================== */
  function crosswalk(width = 3, length = 6) {
    const g = new THREE.Group();

    const stripeW = 0.45;          // painted stripe width
    const gap = 0.35;              // unpainted gap
    const pitch = stripeW + gap;
    const count = Math.max(1, Math.floor(length / pitch));
    // Centre the band of stripes along Z.
    const span = count * pitch - gap;
    const startZ = -span / 2 + stripeW / 2;

    // Unit stripe plane laid flat; instance transforms position each stripe.
    const stripeGeo = new THREE.PlaneGeometry(width, stripeW);
    const stripes = new THREE.InstancedMesh(stripeGeo, stripeMat, count);
    stripes.receiveShadow = true;
    stripes.renderOrder = 1; // draw after the road as a second guard vs z-fight

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < count; i++) {
      p.set(0, 0.02, startZ + i * pitch);
      m.compose(p, q, s);
      stripes.setMatrixAt(i, m);
    }
    stripes.instanceMatrix.needsUpdate = true;
    g.add(stripes);

    return g;
  }

  /* ====================================================================
   * trafficSign — steel pole with a sign plate. Uses mats.makeSign for a
   * readable face when a label is given; otherwise a plain plate.
   *   kind → label/category ('info', 'stop', 'parking', …)
   * ================================================================== */
  function trafficSign(kind = 'info') {
    const g = new THREE.Group();

    const pole = solid(new THREE.Mesh(cyl(0.04, 0.05, 2.6, 8), mats.steelDark));
    pole.position.y = 1.3;
    g.add(pole);

    // Sign plate: a labelled sign mesh from the material library.
    const plate = mats.makeSign(String(kind).toUpperCase(), { width: 0.7 });
    plate.castShadow = true;
    plate.position.set(0, 2.3, 0.03);
    g.add(plate);

    // Thin backing so the sign reads as a solid plate from behind.
    const back = solid(new THREE.Mesh(box(0.72, 0.24, 0.03), mats.metalFrame));
    back.position.set(0, 2.3, -0.01);
    g.add(back);

    return g;
  }

  /* ====================================================================
   * parasol — café umbrella: steel pole + fabric canopy. The canopy is an
   * 8-gon cone in a muted plaster(hue) tint to read as fabric.
   * ================================================================== */
  function parasol(hue) {
    const g = new THREE.Group();
    const fabric = mats.plaster(hue);

    const pole = solid(new THREE.Mesh(cyl(0.04, 0.05, 2.4, 8), mats.metalFrame));
    pole.position.y = 1.2;
    g.add(pole);

    // Canopy: shallow octagonal cone, open underside.
    const canopy = solid(new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.5, 8, 1, true), fabric));
    canopy.position.y = 2.55;
    canopy.material.side = THREE.DoubleSide;
    g.add(canopy);

    // Scalloped fabric valance hanging from the canopy rim.
    const valance = new THREE.Mesh(cyl(1.6, 1.6, 0.12, 8, true), fabric);
    valance.position.y = 2.28;
    valance.material.side = THREE.DoubleSide;
    g.add(valance);

    // Top finial.
    const finial = solid(new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), mats.metalFrame));
    finial.position.y = 2.82;
    g.add(finial);

    return g;
  }

  /* ====================================================================
   * awning — angled shop awning strip mounted above a storefront. Solid
   * fabric in a muted plaster(hue) tint, with a contrasting valance edge.
   *   width → horizontal span of the awning.
   * ================================================================== */
  function awning(width = 4, hue) {
    const g = new THREE.Group();
    const fabric = mats.plaster(hue);
    const depth = 1.2;

    // Sloping fabric panel (angled down toward the street edge).
    const panel = solid(new THREE.Mesh(box(width, 0.04, depth), fabric));
    panel.material.side = THREE.DoubleSide;
    panel.rotation.x = -0.32;
    panel.position.set(0, 2.5, depth / 2 * Math.cos(0.32));
    g.add(panel);

    // Front valance strip (vertical hanging edge), lighter for contrast.
    const valance = solid(new THREE.Mesh(box(width, 0.28, 0.04), mats.plaster()));
    valance.position.set(0, 2.32, depth * Math.cos(0.32));
    g.add(valance);

    // Two support struts back to the wall.
    const strutGeo = cyl(0.025, 0.025, depth, 6);
    [-width / 2 + 0.2, width / 2 - 0.2].forEach((x) => {
      const strut = solid(new THREE.Mesh(strutGeo, mats.metalFrame));
      strut.rotation.x = Math.PI / 2 - 0.32;
      strut.position.set(x, 2.55, depth / 2 * Math.cos(0.32));
      g.add(strut);
    });

    return g;
  }

  return {
    streetlight,
    bench,
    planter,
    bin,
    bollard,
    tree,
    crosswalk,
    trafficSign,
    parasol,
    awning,
  };
}
