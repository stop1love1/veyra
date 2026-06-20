// Copies the three.js DRACO glTF decoder into public/draco/ so Next.js serves it
// statically at /draco/. DRACOLoader.setDecoderPath('/draco/') then finds it.
// Run once after install:  node scripts/copy-draco.js   (also wired as npm script)
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco', 'gltf');
const dst = path.join(__dirname, '..', 'public', 'draco');

fs.mkdirSync(dst, { recursive: true });
for (const f of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) {
  const from = path.join(src, f);
  if (!fs.existsSync(from)) { console.warn('[copy-draco] missing', from); continue; }
  fs.copyFileSync(from, path.join(dst, f));
  console.log('[copy-draco] copied', f);
}
console.log('[copy-draco] done →', dst);
