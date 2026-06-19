// 2D Admin Map Editor (v1). Offline-safe & admin-gated:
//   • Guests / non-admins see a permission prompt (never crashes).
//   • Loads map veyra-central (api.getMapBySlug → id), its instances
//     (api.getMapInstances) and the item library (api.getItems) as a palette.
//   • A FORM places an instance (pick item, pos x/z, rotation y, scale, layer →
//     api.createMapInstance). A 2D TOP-DOWN <canvas> plots every instance as a
//     dot coloured by layer; clicking a dot selects it for edit
//     (api.updateMapInstance) or delete (api.deleteMapInstance).
//   • A Publish button calls api.publishMap.
//   • Every api.* call is wrapped in try/catch; on load failure the editor is
//     disabled with an offline message + retry. Writes are OPTIMISTIC with
//     rollback on error.
//
// NOTE: instance writes only succeed while the map is a DRAFT. veyra-central is
// typically published, so the server returns 404/409 — we degrade gracefully
// (mapEditorDraftNote banner + optimistic-with-rollback flash). A future server
// admin "GET /maps/:slug?draft=1" route would let the editor round-trip a draft.
//
// v1 is form-based; full 3D drag-drop placement is a FUTURE enhancement.
import React from 'react';
import { VEYRA } from '../../data';
import { Glass, Btn, Ic } from '../../components/ui';
import { HudDock } from '../../components/hud';
import { api } from '../../lib/api/client';
import type { ApiItem, ApiMapInstance, MapInstanceDto } from '../../lib/api/client';
import type { ScreenProps } from '../../lib/game/types';
import type { Lang, Localized } from '../../data/types';

const { tx } = VEYRA;
const MAP_SLUG = 'veyra-central';

type Layer = 'ground' | 'roads' | 'buildings' | 'props' | 'skyline';
const LAYERS: Layer[] = ['ground', 'roads', 'buildings', 'props', 'skyline'];

// A placed instance with a STABLE client-side id (`_cid`). Selection, the canvas
// hit-test, and update/delete all key on `_cid`, never on the array index — so a
// filtered/reordered list can't make an edit target the wrong row. `_cid` is
// client-only and is never put in an API DTO (those are built via buildDto()).
type InstRow = ApiMapInstance & { _cid: string };
let cidSeq = 0;
function newCid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `cid-${Date.now()}-${cidSeq++}`;
}
function withCid(inst: ApiMapInstance): InstRow {
  return { ...inst, _cid: newCid() };
}

// Distinct dot colour per layer for the top-down preview.
const LAYER_HUE: Record<Layer, string> = {
  ground: '#7c8a99',
  roads: '#caa15a',
  buildings: '#5a8fca',
  props: '#6ec07a',
  skyline: '#b07ad0',
};
function layerColor(layer?: string): string {
  return (layer && LAYER_HUE[layer as Layer]) || '#9aa4ad';
}

// Canvas world half-extent (world units mapped to the square canvas). The map
// outer radius is ~ this; instances outside still clamp into view.
const WORLD_HALF = 60;
const CANVAS_PX = 320;

function itemName(it: ApiItem, lang: Lang): string {
  if (it.name && typeof it.name === 'object') return tx(it.name as Localized, lang) || it.key || '';
  if (typeof it.name === 'string') return it.name;
  return it.key || it._id || '';
}
function itemId(it: ApiItem): string {
  return it._id || it.id || '';
}
function num(v: number | undefined, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// world (x or z) → canvas pixel
function worldToPx(w: number): number {
  const clamped = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, w));
  return ((clamped + WORLD_HALF) / (WORLD_HALF * 2)) * CANVAS_PX;
}

export function MapEditorScreen({ g }: ScreenProps) {
  const t = g.t;
  const lang = g.lang;

  const [mapId, setMapId] = React.useState<string | null>(null);
  const [instances, setInstances] = React.useState<InstRow[]>([]);
  const [items, setItems] = React.useState<ApiItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [offline, setOffline] = React.useState(false);
  const [draftNote, setDraftNote] = React.useState(false);

  // Form state
  const [selItem, setSelItem] = React.useState<string>(''); // item _id
  const [posX, setPosX] = React.useState('0');
  const [posZ, setPosZ] = React.useState('0');
  const [rotY, setRotY] = React.useState('0');
  const [scale, setScale] = React.useState('1');
  const [layer, setLayer] = React.useState<Layer>('props');

  // Selected placed instance (for edit / delete)
  const [selInst, setSelInst] = React.useState<string | null>(null);

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const isAdmin = g.auth.isAdmin;

  const load = React.useCallback(async () => {
    if (!isAdmin) { setLoading(false); return; }
    setLoading(true);
    setOffline(false);
    setDraftNote(false);
    try {
      const map = await api.getMapBySlug(MAP_SLUG);
      const id = (map && (map._id || map.id)) || null;
      if (!id) { setDraftNote(true); setMapId(null); }
      else {
        setMapId(id);
        try {
          const list = await api.getMapInstances(id);
          setInstances(list.map(withCid));
        } catch {
          // Published-read may 404 if the resolved id maps to a draft, etc.
          setInstances([]);
          setDraftNote(true);
        }
      }
      try {
        const lib = await api.getItems();
        setItems(lib);
      } catch {
        setItems([]);
      }
    } catch {
      // Map read 404 (draft) or true outage. If we have a token+role assume the
      // map is just a draft (editable best-effort); otherwise show offline.
      setOffline(true);
      setMapId(null);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  React.useEffect(() => { void load(); }, [load]);

  // ── draw the top-down preview ──────────────────────────────────────────────
  React.useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    cv.width = CANVAS_PX * dpr;
    cv.height = CANVAS_PX * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX);

    // backdrop
    ctx.fillStyle = '#11161c';
    ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const p = (i / 6) * CANVAS_PX;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, CANVAS_PX); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(CANVAS_PX, p); ctx.stroke();
    }
    // origin crosshair
    const o = worldToPx(0);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.moveTo(o, 0); ctx.lineTo(o, CANVAS_PX); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, o); ctx.lineTo(CANVAS_PX, o); ctx.stroke();

    // dots
    instances.forEach((inst) => {
      const px = worldToPx(num(inst.transform?.pos?.x));
      const pz = worldToPx(num(inst.transform?.pos?.z));
      const selected = inst._cid === selInst;
      ctx.beginPath();
      ctx.arc(px, pz, selected ? 8 : 5, 0, Math.PI * 2);
      ctx.fillStyle = layerColor(inst.layer);
      ctx.fill();
      if (selected) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    });
  }, [instances, selInst]);

  // hit-test a canvas click → nearest dot within 12px
  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * CANVAS_PX;
    const cy = ((e.clientY - rect.top) / rect.height) * CANVAS_PX;
    let best: { d: number; inst: InstRow } | null = null;
    instances.forEach((inst) => {
      const px = worldToPx(num(inst.transform?.pos?.x));
      const pz = worldToPx(num(inst.transform?.pos?.z));
      const d = Math.hypot(px - cx, pz - cy);
      if (d <= 12 && (!best || d < best.d)) best = { d, inst };
    });
    if (best) {
      const b = best as { inst: InstRow };
      setSelInst(b.inst._cid);
      // Hydrate the form with the selected instance so edits round-trip.
      const inst = b.inst;
      setSelItem(inst.itemId || '');
      setPosX(String(num(inst.transform?.pos?.x)));
      setPosZ(String(num(inst.transform?.pos?.z)));
      setRotY(String(num(inst.transform?.rot?.y)));
      setScale(String(num(inst.transform?.scale, 1)));
      setLayer((inst.layer as Layer) || 'props');
    } else {
      setSelInst(null);
    }
  };

  const buildDto = (): MapInstanceDto => ({
    itemId: selItem,
    transform: {
      pos: { x: Number(posX) || 0, z: Number(posZ) || 0 },
      rot: { y: Number(rotY) || 0 },
      scale: Number(scale) || 1,
    },
    layer,
  });

  // ── add (optimistic) ──
  const addInstance = async () => {
    if (!selItem || !mapId) return;
    const dto = buildDto();
    const optimistic: InstRow = {
      _cid: newCid(),
      // No `_id` yet — until the server reconciles a real one, this row is not
      // editable/deletable (guarded by `selectedHasServerId`).
      itemId: dto.itemId,
      transform: { pos: { x: dto.transform!.pos!.x!, z: dto.transform!.pos!.z! }, rot: { y: dto.transform!.rot!.y }, scale: dto.transform!.scale },
      layer: dto.layer,
    };
    const prev = instances;
    setInstances((s) => [...s, optimistic]); // optimistic
    try {
      const created = await api.createMapInstance(mapId, dto);
      // Reconcile the optimistic row with the server doc, keeping the stable
      // _cid and adopting the server `_id` so later edit/delete target it.
      setInstances((s) => s.map((x) => (x._cid === optimistic._cid ? { ...optimistic, ...created, _cid: optimistic._cid } : x)));
      g.flash(t('instanceAdded'));
    } catch {
      setInstances(prev); // roll back
      setDraftNote(true); // most likely: published map / draft-only write
      g.flash(t('saveFailed'));
    }
  };

  // Resolve the currently-selected row (by stable _cid).
  const selectedRow = selInst ? instances.find((x) => x._cid === selInst) : undefined;
  // Edit/delete only round-trip once the row has a real server `_id`. An
  // unreconciled optimistic add (no _id) would 404 on the synthetic id.
  const selectedHasServerId = !!selectedRow?._id;

  // ── update selected (optimistic) ──
  const updateInstance = async () => {
    if (!selInst || !mapId) return;
    const serverId = selectedRow?._id;
    if (!serverId) return; // not yet reconciled — guarded in the UI too
    const dto = buildDto();
    const prev = instances;
    setInstances((s) =>
      s.map((x) =>
        x._cid === selInst
          ? { ...x, itemId: dto.itemId, layer: dto.layer, transform: { pos: { x: dto.transform!.pos!.x!, z: dto.transform!.pos!.z! }, rot: { y: dto.transform!.rot!.y }, scale: dto.transform!.scale } }
          : x,
      ),
    );
    try {
      await api.updateMapInstance(mapId, serverId, dto);
      g.flash(t('orderUpdated'));
    } catch {
      setInstances(prev); // roll back
      setDraftNote(true);
      g.flash(t('saveFailed'));
    }
  };

  // ── delete selected (optimistic) ──
  const deleteInstance = async () => {
    if (!selInst || !mapId) return;
    const serverId = selectedRow?._id;
    if (!serverId) return; // not yet reconciled
    if (typeof window !== 'undefined' && !window.confirm(t('confirmDelete'))) return;
    const prev = instances;
    const cid = selInst;
    setInstances((s) => s.filter((x) => x._cid !== cid)); // optimistic
    setSelInst(null);
    try {
      await api.deleteMapInstance(mapId, serverId);
      g.flash(t('instanceDeleted'));
    } catch {
      setInstances(prev); // roll back
      setDraftNote(true);
      g.flash(t('saveFailed'));
    }
  };

  // ── publish ──
  const publish = async () => {
    if (!mapId) return;
    try {
      await api.publishMap(mapId);
      g.flash(t('mapPublished'));
    } catch {
      g.flash(t('saveFailed'));
    }
  };

  // ── guard: not an admin ──
  if (!isAdmin) {
    return (
      <div className="v-screen v-light">
        <div className="v-topbar v-topbar-light">
          <button className="v-iconbtn" onClick={() => g.go('world')} aria-label={t('aBack')}><Ic name="chevL" /></button>
          <span className="v-topbar-title-l">{t('mapEditor')}</span>
          <span style={{ width: 38 }} />
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Glass className="v-card" style={{ maxWidth: 360, textAlign: 'center', padding: 28, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
            <Ic name="shield" size={36} />
            <p style={{ margin: 0, fontWeight: 600, color: 'var(--text)' }}>{t('adminMap')}</p>
            <Btn variant="primary" size="lg" icon="user" onClick={() => g.openAuth()}>{t('signIn')}</Btn>
          </Glass>
        </div>
        <HudDock g={g} active="admin" />
      </div>
    );
  }

  const fieldRow: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap' };
  const fieldHalf: React.CSSProperties = { flex: 1, minWidth: 120 };
  const canAdd = !!selItem && !!mapId;

  return (
    <div className="v-screen v-light">
      <div className="v-topbar v-topbar-light">
        <button className="v-iconbtn" onClick={() => g.go('world')} aria-label={t('aBack')}><Ic name="chevL" /></button>
        <span className="v-topbar-title-l">{t('mapEditor')}</span>
        <button className="v-iconbtn" onClick={() => void load()} aria-label={t('loadingMap')}><Ic name="globe" /></button>
      </div>

      <div className="v-quest-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
        {loading && (
          <Glass className="v-card" role="status" aria-live="polite" style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>{t('loadingMap')}</Glass>
        )}

        {!loading && offline && (
          <Glass className="v-card" role="status" aria-live="polite" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', textAlign: 'center' }}>
            <Ic name="globe" size={28} />
            <p style={{ margin: 0, color: 'var(--muted)' }}>{t('loadFailed')}</p>
            <Btn variant="soft" size="sm" icon="globe" onClick={() => void load()}>{t('loadingMap')}</Btn>
          </Glass>
        )}

        {!loading && !offline && (
          <>
            {draftNote && (
              <Glass className="v-card" role="status" aria-live="polite" style={{ padding: 14, color: 'var(--muted)', display: 'flex', gap: 10, alignItems: 'center' }}>
                <Ic name="shield" size={18} />
                <span style={{ fontSize: 13 }}>{t('mapEditorDraftNote')}</span>
              </Glass>
            )}

            {/* Top-down preview */}
            <Glass className="v-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
              <div style={{ alignSelf: 'flex-start', fontWeight: 700, color: 'var(--text)' }}>{t('adminMap')}</div>
              <canvas
                ref={canvasRef}
                onClick={onCanvasClick}
                role="img"
                aria-label={t('adminMap')}
                style={{ width: '100%', maxWidth: CANVAS_PX, aspectRatio: '1 / 1', borderRadius: 14, border: '1.5px solid var(--line)', cursor: 'crosshair', touchAction: 'manipulation' }}
              />
              {/* layer legend */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                {LAYERS.map((l) => (
                  <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: layerColor(l) }} />
                    {l}
                  </span>
                ))}
              </div>
              {instances.length === 0 && (
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>{t('noInstances')}</p>
              )}
            </Glass>

            {/* Palette */}
            <Glass className="v-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontWeight: 700, color: 'var(--text)' }}>{t('palette')}</div>
              {items.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>{t('selectItem')}</p>
              ) : (
                <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
                  {items.map((it) => {
                    const id = itemId(it);
                    const on = id === selItem;
                    const thumb = it.asset?.thumbnail?.url;
                    return (
                      <button
                        key={id || it.key}
                        onClick={() => { setSelItem(id); setSelInst(null); }}
                        aria-pressed={on}
                        aria-label={itemName(it, lang)}
                        style={{
                          flex: '0 0 auto', width: 92, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center',
                          padding: 8, borderRadius: 12, cursor: 'pointer', background: on ? 'var(--paper-2)' : 'transparent',
                          border: on ? '2px solid var(--accent, #5a8fca)' : '1.5px solid var(--line)',
                        }}
                      >
                        <span style={{ width: 60, height: 60, borderRadius: 10, overflow: 'hidden', background: 'var(--paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)' }}>
                          {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                          ) : (
                            <Ic name="hanger" size={22} />
                          )}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{itemName(it, lang)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Glass>

            {/* Placement / edit form */}
            <Glass className="v-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontWeight: 700, color: 'var(--text)' }}>{selInst ? t('deleteInstance') : t('addInstance')}</div>

              {!selItem && <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>{t('selectItem')}</p>}

              <div style={fieldRow}>
                <label className="v-field" style={fieldHalf}>
                  <span className="v-field-label">{t('posX')}</span>
                  <input className="v-input" type="number" inputMode="decimal" value={posX} aria-label={t('posX')}
                         onChange={(e) => setPosX(e.target.value)} />
                </label>
                <label className="v-field" style={fieldHalf}>
                  <span className="v-field-label">{t('posZ')}</span>
                  <input className="v-input" type="number" inputMode="decimal" value={posZ} aria-label={t('posZ')}
                         onChange={(e) => setPosZ(e.target.value)} />
                </label>
              </div>
              <div style={fieldRow}>
                <label className="v-field" style={fieldHalf}>
                  <span className="v-field-label">{t('rotationY')}</span>
                  <input className="v-input" type="number" inputMode="decimal" value={rotY} aria-label={t('rotationY')}
                         onChange={(e) => setRotY(e.target.value)} />
                </label>
                <label className="v-field" style={fieldHalf}>
                  <span className="v-field-label">{t('scale')}</span>
                  <input className="v-input" type="number" inputMode="decimal" min={0} step={0.1} value={scale} aria-label={t('scale')}
                         onChange={(e) => setScale(e.target.value)} />
                </label>
              </div>
              <label className="v-field">
                <span className="v-field-label">{t('layer')}</span>
                <select className="v-input" value={layer} aria-label={t('layer')}
                        onChange={(e) => setLayer(e.target.value as Layer)}>
                  {LAYERS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {selInst ? (
                  <>
                    <Btn variant="primary" size="lg" icon="check"
                         disabled={!canAdd || !selectedHasServerId}
                         onClick={() => void updateInstance()}>
                      {t('save')}
                    </Btn>
                    <Btn variant="ghost-d" size="lg" icon="close"
                         disabled={!selectedHasServerId}
                         onClick={() => void deleteInstance()}>{t('deleteInstance')}</Btn>
                    <Btn variant="ghost-d" size="lg" onClick={() => setSelInst(null)}>{t('cancel')}</Btn>
                  </>
                ) : (
                  <Btn variant="primary" size="lg" icon="plus" full
                       disabled={!canAdd}
                       onClick={() => void addInstance()}>
                    {t('addToMap')}
                  </Btn>
                )}
              </div>
            </Glass>

            {/* Publish */}
            <Glass className="v-card" style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
              <Btn variant="primary" size="lg" icon="check" full
                   disabled={!mapId}
                   onClick={() => void publish()}>
                {t('publishMap')}
              </Btn>
            </Glass>
          </>
        )}
      </div>

      <HudDock g={g} active="admin" />
    </div>
  );
}
