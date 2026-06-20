# Inner-map real-world fidelity (inside the fence → recognisably Hoàn Kiếm)

Date: 2026-06-20
Scope (client only, no backend):
- `client/scripts/gen-hanoi.js` — OSM data exporter (Phase 0)
- `client/public/data/hanoi.json` — regenerated data (Phase 0 output)
- `client/app/lib/three/worldHanoi.ts` — world builder + frame loop (Phases 1–4)
- `client/app/lib/three/shared/hanoiFacades.ts` — façade material/variant library (Phases 1–2)
- New `client/app/lib/three/shared/lakefront.ts` — hand-authored per-building profiles (Phase 2)

## Goal

Make the area **inside the perimeter fence** (the ~420 m core around Hoàn Kiếm) read as the
**real place**, not a generic extruded-box city. The fence/playable footprint and the
mobile-first performance envelope (quality tiers low/mid/hi, merged geometry, bounded draw
calls) are **unchanged** — this is about fidelity within the existing budget.

Decided fidelity bar:
- **~91 lakefront-ring buildings** (centroid ≤ 60 m from the lake outline) + the named
  landmarks → **per-building, photo-match** treatment: each one is individually recognisable
  (correct floors, colour, roof, balcony/shutter style, signage; the icons — Bưu điện Bờ Hồ,
  the "Hàm Cá Mập" building at Đông Kinh Nghĩa Thục square, the French banks on the east
  shore, etc.).
- **The remaining ~600 buildings inside the fence** → **procedural-by-zone**: each falls into
  an architectural zone (Old-Quarter tube house / French-colonial / lakeside-low / modern /
  civic-temple) and gets that zone's palette, fenestration, roof and signage. Recognisable as
  the right *kind* of building in the right place, generated from OSM tags + position.

Verified counts (from current `hanoi.json`): 699 buildings ≤ 420 m of origin; 91 within 60 m
of the lake outline; lake centroid ≈ (4, −38), half-axis ≈ 347 m; 15 889 total, 2 749 roads,
375 greens, 1 499 trees.

## Architecture decision

**Zone-driven procedural façades + a hand-authored override table for the lakefront ring.**
This composes with the existing renderer rather than replacing it:
- Building walls are already a merged "wall-soup" bucketed by `facades.pickVariant(hash, h)`
  into `bucketGeoms`, with per-building vertex-colour tint and near-lake cornice/floor ledges
  (`worldHanoi.ts` ~L1020–1100). We extend the **selector** (which bucket + which detail set a
  building gets) from `(hash, h)` to `(zone, tags, h, profile?)`, keeping the merge/draw-call
  discipline intact.
- The lakefront override is a **lookup table** resolved at build time by matching each ring
  building to a recorded reference coordinate (nearest-centroid within a tolerance), so it
  survives a data regen that renumbers the array.

Rejected: per-building hand-built GLBs (breaks geometry merging, too heavy for mobile, months
of work) and pure-procedural-only (fails the "match each lakefront building" requirement).

## Data contract (schema)

`hanoi.json` gains **optional, backward-compatible** fields. Existing consumers
(`getMapSnapshot`, road/tree/green/water builders) are untouched; new fields are read only by
the new façade/POI code and default safely when absent.

```
buildings: [{ poly, h,
  tags?: { levels?, type?, name?, roofShape?, roofColour?, colour?, shop?, amenity? } }]
roads:     [{ pts, w, name?, cls? }]                 // cls = osm highway class
greens:    [{ poly, kind }]                          // kind ∈ lawn|garden|flowerbed|pitch
trees:     [[x,z], …]                                // unchanged
water:     [[[x,z]…]…]                               // unchanged
pois?:     [{ x, z, kind, name? }]                   // kind ∈ statue|memorial|fountain|kiosk|cafe|temple|tower|...
barriers?: [{ pts, kind }]                           // kind ∈ fence|wall|hedge
```

To keep file size bounded, building `tags` and `pois`/`barriers` are only emitted for features
within an **inner radius** (`TAG_R`, default 520 m ≈ just outside the fence); features beyond
that keep the lean poly-only form (they render as the flat outer map anyway).

## Phase 0 — Data enrichment (`gen-hanoi.js`)

1. Extend the Overpass query to also capture POIs and barriers near the core:
   `node/way["amenity"]`, `["shop"]`, `["tourism"]`, `["historic"]`, `["man_made"="tower"]`,
   `node["historic"="memorial"]`/`["tourism"="artwork"]` (Lý Thái Tổ statue, the flower clock,
   Tháp Hoà Phong), `way["amenity"="fountain"]`/`["water"="fountain"]`, `way["barrier"]`.
2. Keep building/road/water/green/tree extraction; **attach the tag subset** above to each
   building/road whose centroid is within `TAG_R`. Derive `levels` from `building:levels`,
   `type` from `building`, `roofShape`/`roofColour` from `roof:shape`/`roof:colour`,
   `colour` from `building:colour`/`colour`, `name`, and any `shop`/`amenity` on the footprint.
3. Add `name` + `cls` to roads (for street-name signage + classification).
4. Emit `pois` (point reduced to `[x,z]` for ways via centroid) and `barriers` (line `pts`).
5. Bump default capture radius so the fenced core is fully tagged; document
   `node scripts/gen-hanoi.js [radius]` and note it hits the live Overpass API.
6. Minimal render hook so the new data is *visible* for review: draw `barriers` as low rails
   and `pois` as placeholder markers (replaced properly in Phases 2–3). Schema round-trips
   through `getMapSnapshot` unchanged.

Output: regenerated `hanoi.json` (larger, still one file). **Acceptance:** existing world still
loads identically; new fields present; `buildings[i].tags` populated for the inner core.

## Phase 1 — Procedural-by-zone façades (the ~600 interior buildings)

1. **Zone classifier** `classifyZone(b, cx, cz)` → one of
   `old-quarter | french | lakeside | modern | civic`:
   - `tags.type` in {church, temple, civic, government, public} → `civic`.
   - tall + large footprint + flat roof + inland → `modern`.
   - within the Old-Quarter wedge (north of the lake, the dense small-footprint warren) and
     narrow frontage → `old-quarter`.
   - French-quarter band (south/east of the lake, larger regular footprints, 4–6 levels) →
     `french`.
   - within ~40 m of the lake outline and low → `lakeside`.
   Position thresholds derived from the lake centroid/axis already computed in `build()`.
2. **Per-zone façade spec** in `hanoiFacades.ts`: palette range, window grid spacing, balcony
   rule (Old-Quarter iron balconies on floors ≥2; French shutters + wrought rail; modern glass
   bands), roof type (Old-Quarter pitched red tile or flat parapet; French mansard/cornice;
   modern flat), and an optional ground-floor **shop band** + **vertical blade sign** for
   commercial Old-Quarter frontages. `pickVariant` is extended to take the zone so each zone
   maps to its own material bucket(s); buckets stay ≤ the current draw-call ceiling.
3. **Roof pass**: extend the existing near-lake roof-detail ranking to add the zone-appropriate
   roof (tiled hip for Old-Quarter/lakeside, mansard for French) on hi/mid; low tier keeps flat
   caps. Reuse `pushLedge` for cornices/string-courses driven by zone, not just radius.
4. Tint stays vertex-colour, but its range is **zone-scoped** (Old-Quarter ochre/teal/mustard
   warren vs. French pale-yellow vs. modern grey-glass) so each district reads distinct.

**Acceptance:** walking the core, districts are visually distinguishable and plausibly Hanoi;
draw calls and frame time within the existing low/mid/hi budgets (verify on the low tier path).

## Phase 2 — Lakefront ring: per-building match (~91 + landmarks)

1. New `shared/lakefront.ts` exporting `LAKEFRONT = [{ ref:[x,z], floors, colour, roof,
   balcony, shutter, signText?, signHue?, notable? }, …]` — hand-authored from real references
   for the buildings fronting the promenade (Đinh Tiên Hoàng east shore banks, Lê Thái Tổ /
   Hàng Khay south, the Đông Kinh Nghĩa Thục square head incl. the "Hàm Cá Mập" block, the
   north Old-Quarter mouth). Icons get `notable` flags wiring extra geometry (clock tower,
   stepped modern massing, colonial pediment).
2. **Resolver** in `build()`: for each ring building (centroid ≤ 60 m of lake outline), match to
   the nearest `LAKEFRONT.ref` within tolerance (~8 m). On match, the building uses the
   authored profile (overriding the Phase-1 zone result): explicit floors/colour/roof, authored
   balcony/shutter detail, and a real `makeSign` storefront sign. Unmatched ring buildings fall
   back to `lakeside`/`old-quarter` zone.
3. Reuse `createBuildings` storefront detailing (`shared/buildings.ts`) where an authored ring
   building wants full recessed-shopfront treatment, attached at the footprint front edge.
4. Make `LAKEFRONT.ref` matching robust to regen by keying on world coordinates (stable across
   OSM array renumbering); log any authored entry that fails to resolve (so data drift is loud,
   per "no silent caps").

**Acceptance:** the ring you actually see while circling the lake matches reference photos
building-by-building; the named icons are individually recognisable.

## Phase 3 — Real content: POIs, gardens, street names

1. Place `pois` from the data: **Lý Thái Tổ statue + plaza** (re-use/verify the existing
   statue), **Tháp Hoà Phong** (lone gate tower on the east shore), lakeside **flower gardens**
   and **flowerbed** greens (kind-aware planting), **fountain(s)**, the **flower clock**, and
   promenade **kiosks/benches** (some already exist — dedupe against current furniture).
2. **Street-name signage**: at the mouth of the main named roads inside the fence, a small
   Vietnamese street-name plate (`makeSign`) from `roads[].name` (Hàng Đào, Cầu Gỗ, Đinh Tiên
   Hoàng, Lê Thái Tổ, Hàng Khay…). Cap count and `log` what's dropped.
3. **Greens by kind**: gardens/flowerbeds get denser, brighter planting than plain lawn so the
   lakeside parks read as the manicured gardens they are.

**Acceptance:** the signature lakeside furniture/landmarks are present and correctly placed;
named streets are labelled in Vietnamese.

## Phase 4 — Geographic accuracy pass

1. Re-anchor the four hand-built landmarks (Ngọc Sơn/Thê Húc already real; Cathedral, Opera,
   Post Office currently at *approximate* promenade offsets per the landmarks spec) to their
   true relative coordinates from OSM, where doing so doesn't collide with footprints.
2. Verify the fence does not bisect a key named street, the lake outline matches OSM, and POIs
   sit on the correct shore. Tune `CITY_R`/landmark clear-radii only if a real placement needs
   it.
3. Visual diff the core against a reference map (screenshot compare); fix the largest mismatches.

**Acceptance:** landmark/POI positions agree with the real relative geography to within a few
metres; nothing important is clipped by the fence.

## Performance & disposal (cross-cutting constraints)

- Keep the merged-geometry / bucketed-material model; **no new per-building materials** — zones
  and the lakefront ring map onto a bounded set of shared façade materials. Target the same
  draw-call ceiling the current builder holds (verify on low tier).
- New detail (roofs, balconies, signage, POI props) is added with shared geometries and, where
  repeated, instancing — mirroring the guard/tree/furniture instancing already in the file.
- All new geometries → `ownedGeoms`; new textures (signs, clock faces) → `ownedTextures` or are
  children of `scene` so `disposeScene` reclaims them. New materials → `localMats`.
- Low tier: zones still apply (palette + roof type) but skip cornices/balcony relief and cap the
  building count exactly as today; lakefront overrides still apply (they're the few you see).

## Risks / mitigations

- **OSM tag sparsity** (many Hanoi buildings lack `building:levels`/`colour`): zone classifier
  must degrade gracefully to position-based defaults; never hard-depend on a tag.
- **Lakefront authoring drift** when `hanoi.json` is regenerated: coordinate-keyed matching +
  loud logging of unresolved entries.
- **File-size growth** from tags/POIs: bound tagging to `TAG_R`; measure and report the new
  `hanoi.json` size; strip tags outside the core.
- **Perf regression** from added relief/signage: gate all relief on hi/mid, instance repeats,
  and re-verify low-tier frame time after each phase.
- **Overpass availability/rate limits** during regen: the script already targets one endpoint;
  document retry/manual rerun; the committed `hanoi.json` is the source of truth if regen fails.

## Out of scope

- Expanding the fence / walkable radius (footprint stays as-is).
- Enterable building interiors (façade fidelity only; landmarks keep visual open/close).
- The flat outer map beyond the fence (unchanged).
- Photo-textured façades / per-building GLB models.
- Backend/server changes.

## Build order

Phase 0 (data) → Phase 1 (zones) → Phase 2 (lakefront ring) → Phase 3 (POIs/streets) →
Phase 4 (geo accuracy). Each phase is independently shippable and gets its own implementation
plan. Phase 0 is the foundation the rest read from.
