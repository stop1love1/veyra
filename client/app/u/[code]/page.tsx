// Public share card for a referral code: /u/:code — server-rendered so links
// unfurl on social (the sibling opengraph-image.tsx supplies the preview image).
import type { Metadata } from 'next';
import type { ApiPublicProfile } from '../../lib/api/client';

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api').replace(/\/+$/, '');

async function fetchProfile(code: string): Promise<ApiPublicProfile | null> {
  try {
    const res = await fetch(`${API}/u/${encodeURIComponent(code)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as ApiPublicProfile;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const p = await fetchProfile(code);
  const title = p ? `${p.name} · ${p.rankName.vi} ở Veyra` : 'Veyra';
  const description = p
    ? `${p.renown} Danh vọng · 🔥 ${p.streak} ngày · Vào Veyra cùng mình!`
    : 'Bước vào thế giới mua sắm Veyra.';
  return { title, description, openGraph: { title, description }, twitter: { card: 'summary_large_image', title, description } };
}

export default async function PublicCard({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const p = await fetchProfile(code);
  const join = `/?ref=${encodeURIComponent(code)}`;

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'linear-gradient(160deg,#0c2b2c,#103c3a)', fontFamily: 'Be Vietnam Pro, system-ui, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 380, background: '#fff', borderRadius: 22, padding: 28, boxShadow: '0 24px 60px rgba(0,0,0,.35)', textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.12em', color: '#0f766e', textTransform: 'uppercase' }}>Veyra</div>
        {p ? (
          <>
            <div style={{ width: 72, height: 72, borderRadius: '50%', margin: '18px auto 12px', background: `hsl(${p.avatarHue} 60% 55%)` }} />
            <div style={{ fontSize: 22, fontWeight: 800, color: '#0f2e2c' }}>{p.name}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f766e', marginTop: 2 }}>{p.rankName.vi}</div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 18, margin: '18px 0', color: '#334' }}>
              <div><div style={{ fontSize: 20, fontWeight: 800 }}>{p.renown}</div><div style={{ fontSize: 11, color: '#789' }}>Danh vọng</div></div>
              <div><div style={{ fontSize: 20, fontWeight: 800 }}>🔥 {p.streak}</div><div style={{ fontSize: 11, color: '#789' }}>ngày</div></div>
              <div><div style={{ fontSize: 20, fontWeight: 800 }}>{p.referralCount}</div><div style={{ fontSize: 11, color: '#789' }}>đã mời</div></div>
            </div>
          </>
        ) : (
          <div style={{ margin: '24px 0', color: '#0f2e2c', fontSize: 16 }}>Bước vào thế giới mua sắm Veyra.</div>
        )}
        <a href={join} style={{ display: 'block', background: 'linear-gradient(180deg,#14b8a6,#0f766e)', color: '#042320', fontWeight: 800, padding: '14px', borderRadius: 999, textDecoration: 'none', fontSize: 16 }}>
          Vào Veyra
        </a>
        <div style={{ fontSize: 11, color: '#9ab', marginTop: 12, fontFamily: 'Space Mono, monospace' }}>Mã mời: {code}</div>
      </div>
    </main>
  );
}
