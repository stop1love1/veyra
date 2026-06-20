// Dev/admin teleport map — a top-down "Google-Maps"-style overlay of the live
// 3D world. Reads a one-time geometry snapshot from the engine (water, roads,
// building footprints, places) to paint a static map, polls the live player
// pose for a "you are here" marker, and turns a click into an instant teleport.
//
// Gated by the caller (dev build OR admin); this component is purely presentation
// + input and holds no permission logic itself.
import React from 'react';
import { Ic } from '../../components/ui';
import { fitTransform, worldToCanvas, canvasToWorld, type FitTransform } from '../../lib/three/shared/devMapGeom';
import { hsl } from '../../lib/three/shared/helpers';

interface Place { id: string; type?: string; name?: string; hue?: number; x: number; z: number }
interface Snapshot {
  bounds: { r: number; fence?: number };
  water: number[][] | null;
  roads: { pts: number[][]; w?: number }[];
  buildings: { poly: number[][] }[];
  pois?: { x: number; z: number; kind: string; name?: string }[];
  barriers?: { pts: number[][]; kind: string }[];
  spawn: { x: number; z: number };
  places: Place[];
}
export interface DevMapApi {
  getMapSnapshot: () => Snapshot | null;
  getPlayerPose: () => { x: number; z: number; yaw: number } | null;
  teleport: (x: number, z: number) => void;
}

// Logical canvas size in CSS px (square). CSS clamps the element to the viewport;
// the backing store is multiplied by devicePixelRatio for crisp lines.
const SIZE = 700;

const placeColor = (p: Place): string =>
  p.type === 'shop' ? '#' + hsl(p.hue ?? 200, 0.5, 0.5).getHexString()
    : p.type === 'quests' ? '#d9a72a'
    : '#1f9e8a';

// Frame the whole city: at least the fence, but expanded to include every place
// and the player's current position so nothing of interest sits off-canvas.
function computeFitRadius(snap: Snapshot, pose: { x: number; z: number } | null): number {
  let r = snap.bounds.fence || snap.bounds.r || 100;
  for (const p of snap.places) r = Math.max(r, Math.hypot(p.x, p.z));
  if (pose) r = Math.max(r, Math.hypot(pose.x, pose.z));
  return r * 1.06;
}

// Paint the static layers (everything except the moving player) once.
function paintStatic(ctx: CanvasRenderingContext2D, snap: Snapshot, tf: FitTransform): void {
  const S = tf.size;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#e9ede3'; // land
  ctx.fillRect(0, 0, S, S);

  const poly = (pts: number[][]) => {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const { px, py } = worldToCanvas(pts[i][0], pts[i][1], tf);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };

  // water
  if (snap.water && snap.water.length >= 3) {
    poly(snap.water);
    ctx.fillStyle = '#a9d6e6';
    ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#7fb7cc'; ctx.stroke();
  }

  // roads — light casing under a white fill, like a street map
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const pass of [0, 1]) {
    for (const r of snap.roads) {
      const pts = r.pts;
      if (!pts || pts.length < 2) continue;
      const w = Math.max(1.1, (r.w && r.w > 0 ? r.w : 4) * tf.scale);
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const { px, py } = worldToCanvas(pts[i][0], pts[i][1], tf);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      if (pass === 0) { ctx.lineWidth = w + 1.6; ctx.strokeStyle = '#d7d0c0'; }
      else { ctx.lineWidth = w; ctx.strokeStyle = '#ffffff'; }
      ctx.stroke();
    }
  }

  // buildings
  ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(150,140,120,0.55)';
  for (const b of snap.buildings) {
    if (!b.poly || b.poly.length < 3) continue;
    poly(b.poly);
    ctx.fillStyle = '#dcd5c8';
    ctx.fill();
    ctx.stroke();
  }

  // barriers (Phase-0 review hook) — thin dashed lines
  if (snap.barriers && snap.barriers.length) {
    ctx.save();
    ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(120,90,60,0.7)';
    for (const b of snap.barriers) {
      if (!b.pts || b.pts.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < b.pts.length; i++) {
        const { px, py } = worldToCanvas(b.pts[i][0], b.pts[i][1], tf);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // pois (Phase-0 review hook) — small magenta squares
  if (snap.pois && snap.pois.length) {
    ctx.fillStyle = '#b3408a';
    for (const p of snap.pois) {
      const { px, py } = worldToCanvas(p.x, p.z, tf);
      ctx.fillRect(px - 2.5, py - 2.5, 5, 5);
    }
  }

  // places — coloured dot + label
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const p of snap.places) {
    const { px, py } = worldToCanvas(p.x, p.z, tf);
    ctx.beginPath(); ctx.arc(px, py, 4.5, 0, 7);
    ctx.fillStyle = placeColor(p); ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    if (p.name) {
      const label = p.name.length > 16 ? p.name.slice(0, 15) + '…' : p.name;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText(label, px, py + 6);
      ctx.fillStyle = '#2a2a2a'; ctx.fillText(label, px, py + 6);
    }
  }
}

export function DevMap({ api, onClose, lang }: { api: DevMapApi; onClose: () => void; lang: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [snap, setSnap] = React.useState<Snapshot | null>(null);
  const tfRef = React.useRef<FitTransform | null>(null);
  // Picked target (two-step: click to select, then confirm to teleport). Kept in
  // a ref too so the animation loop can draw the marker without re-subscribing.
  const [sel, setSel] = React.useState<{ x: number; z: number } | null>(null);
  const selRef = React.useRef<{ x: number; z: number } | null>(null);

  // Wait for the world to finish building (snapshot is null until then).
  React.useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const tryGet = () => {
      const s = api.getMapSnapshot();
      if (s) { setSnap(s); if (timer) { clearInterval(timer); timer = null; } }
    };
    tryGet();
    if (!snap) timer = setInterval(tryGet, 200);
    return () => { if (timer) clearInterval(timer); };
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  // Paint the static map once we have a snapshot, then animate the player marker.
  React.useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !snap) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    cv.width = SIZE * dpr; cv.height = SIZE * dpr;

    const fitR = computeFitRadius(snap, api.getPlayerPose());
    const tf = fitTransform(fitR, SIZE);
    tfRef.current = tf;

    // Static layers → an offscreen canvas, blitted each frame under the marker.
    const off = document.createElement('canvas');
    off.width = SIZE * dpr; off.height = SIZE * dpr;
    const octx = off.getContext('2d');
    if (octx) { octx.setTransform(dpr, 0, 0, dpr, 0, 0); paintStatic(octx, snap, tf); }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let raf = 0;
    const frame = () => {
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(off, 0, 0, SIZE, SIZE);
      // Picked target marker (orange crosshair) — drawn under the player so the
      // player arrow stays readable when teleporting onto the same spot.
      const s = selRef.current;
      if (s) {
        const { px, py } = worldToCanvas(s.x, s.z, tf);
        ctx.beginPath(); ctx.arc(px, py, 9, 0, 7);
        ctx.lineWidth = 2.5; ctx.strokeStyle = '#ff7a1a'; ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px - 13, py); ctx.lineTo(px + 13, py);
        ctx.moveTo(px, py - 13); ctx.lineTo(px, py + 13);
        ctx.lineWidth = 1.5; ctx.stroke();
      }

      const pose = api.getPlayerPose();
      if (pose) {
        const { px, py } = worldToCanvas(pose.x, pose.z, tf);
        // soft "accuracy" halo
        ctx.beginPath(); ctx.arc(px, py, 13, 0, 7);
        ctx.fillStyle = 'rgba(43,127,255,0.18)'; ctx.fill();
        // heading arrow (screen space: world +x → right, +z → down)
        const ang = Math.atan2(Math.cos(pose.yaw), Math.sin(pose.yaw)); // (sin yaw, cos yaw) as (x,z)
        const L = 11;
        const pt = (a: number, r: number) => ({ x: px + Math.cos(a) * r, y: py + Math.sin(a) * r });
        const tip = pt(ang, L), bl = pt(ang + 2.5, L * 0.75), br = pt(ang - 2.5, L * 0.75);
        ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(bl.x, bl.y); ctx.lineTo(br.x, br.y); ctx.closePath();
        ctx.fillStyle = '#2b7fff'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [snap]); // eslint-disable-line react-hooks/exhaustive-deps

  // Click PICKS a target (does not teleport yet); confirming below moves there.
  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current; const tf = tfRef.current;
    if (!cv || !tf) return;
    const rect = cv.getBoundingClientRect();
    const lx = ((e.clientX - rect.left) / rect.width) * SIZE;
    const ly = ((e.clientY - rect.top) / rect.height) * SIZE;
    const target = canvasToWorld(lx, ly, tf);
    selRef.current = target;
    setSel(target);
  };

  const confirm = () => {
    if (!sel) return;
    api.teleport(sel.x, sel.z);
    selRef.current = null;
    setSel(null);
  };

  const en = lang === 'en';
  return (
    <div className="v-devmap-overlay" role="dialog" aria-label={en ? 'Teleport map' : 'Bản đồ dịch chuyển'}>
      <div className="v-devmap-panel">
        <div className="v-devmap-head">
          <span className="v-devmap-title"><Ic name="map" size={16} /> {en ? 'Teleport map' : 'Bản đồ dịch chuyển'}</span>
          <button type="button" className="v-iconbtn" onClick={onClose} aria-label={en ? 'Close' : 'Đóng'}><Ic name="close" size={18} /></button>
        </div>
        <div className="v-devmap-canvas-wrap">
          <canvas
            ref={canvasRef}
            onClick={onCanvasClick}
            role="img"
            aria-label={en ? 'Click to pick a destination' : 'Bấm để chọn điểm đến'}
            className="v-devmap-canvas"
          />
          {!snap && <div className="v-devmap-loading">{en ? 'Loading map…' : 'Đang tải bản đồ…'}</div>}
        </div>
        {sel ? (
          <button type="button" className="v-devmap-confirm" onClick={confirm}>
            <Ic name="pin" size={16} /> {en ? 'Teleport here' : 'Dịch chuyển đến đây'}
          </button>
        ) : (
          <div className="v-devmap-hint">{en ? 'Click a spot to pick a destination' : 'Bấm vào một điểm để chọn nơi đến'}</div>
        )}
      </div>
    </div>
  );
}
