// Vendors the Ready Player Me animation clips (+ a default/NPC avatar) into
// public/models/rpm/ so the world animates offline. Edit scripts/rpm-assets.json
// with real .glb URLs first, then run:  node scripts/fetch-rpm-assets.js
//
// Optional: at runtime the avatar loads from the RPM CDN and tolerates missing
// clips (it just holds idle), so this only matters for offline/production bundling.
// Requires Node 18+ (global fetch).
const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, 'rpm-assets.json');
const outDir = path.join(__dirname, '..', 'public', 'models', 'rpm');

async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) { console.error('[fetch-rpm] FAIL', res.status, url); return false; }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log('[fetch-rpm] saved', path.relative(outDir, dest), `(${Math.round(buf.length / 1024)} KB)`);
  return true;
}

async function main() {
  if (typeof fetch !== 'function') { console.error('[fetch-rpm] needs Node 18+ (global fetch)'); process.exit(1); }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = manifest.files || {};
  let ok = 0, skipped = 0;
  for (const [rel, url] of Object.entries(files)) {
    if (!url) { skipped++; continue; }
    if (await download(url, path.join(outDir, rel))) ok++;
  }
  console.log(`[fetch-rpm] done — ${ok} saved, ${skipped} skipped (no url). Edit scripts/rpm-assets.json to add more.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
