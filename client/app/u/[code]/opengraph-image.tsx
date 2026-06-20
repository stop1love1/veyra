// Dynamic share-card image for /u/:code — what unfurls on social/chat.
import { ImageResponse } from 'next/og';
import type { ApiPublicProfile } from '../../lib/api/client';

export const alt = 'Veyra share card';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api').replace(/\/+$/, '');

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  let p: ApiPublicProfile | null = null;
  try {
    const res = await fetch(`${API}/u/${encodeURIComponent(code)}`, { cache: 'no-store' });
    if (res.ok) p = (await res.json()) as ApiPublicProfile;
  } catch {
    /* fall through to the generic card */
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(160deg,#0c2b2c,#103c3a)',
          color: '#eafcf8',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: 34, letterSpacing: 8, color: '#5eead4', display: 'flex' }}>VEYRA</div>
        <div style={{ fontSize: 84, fontWeight: 800, marginTop: 14, display: 'flex' }}>
          {p ? p.name : 'Bước vào Veyra'}
        </div>
        {p && (
          <div style={{ fontSize: 44, color: '#5eead4', marginTop: 8, display: 'flex' }}>{p.rankName.vi}</div>
        )}
        {p && (
          <div style={{ display: 'flex', gap: 60, marginTop: 40, fontSize: 40 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontWeight: 800, display: 'flex' }}>{p.renown}</div>
              <div style={{ fontSize: 24, color: '#9fd', display: 'flex' }}>Danh vọng</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontWeight: 800, display: 'flex' }}>🔥 {p.streak}</div>
              <div style={{ fontSize: 24, color: '#9fd', display: 'flex' }}>ngày</div>
            </div>
          </div>
        )}
      </div>
    ),
    size,
  );
}
