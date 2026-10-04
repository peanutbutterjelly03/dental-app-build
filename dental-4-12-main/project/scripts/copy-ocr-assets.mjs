// Copies the OCR engine's runtime files into public/ocr/ so the app serves
// them itself (SEC-36, 2026-10-04). Without this, Tesseract.js fetched its
// worker, its WebAssembly core and the English language data from jsDelivr on
// every scan, unpinned. The copies come from packages pinned in
// package-lock.json (tesseract.js, tesseract.js-core, @tesseract.js-data/eng),
// so what runs is exactly what was installed.
//
// Runs before `dev` and `build` (package.json predev / prebuild). The output
// folder is git-ignored: ~11 MB of binaries stays out of the repository.
// Only the LSTM builds are copied: the app creates its worker with the default
// engine mode (LSTM only), so the other core builds are never requested.

import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'ocr');
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));

const files = [
  [join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'), join(out, 'worker.min.js')],
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']
    .map((f) => [join(pkgDir('tesseract.js-core'), f), join(out, 'core', f)]),
  [join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz'), join(out, 'lang', 'eng.traineddata.gz')],
];

for (const [from, to] of files) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}
console.log(`[copy-ocr-assets] ${files.length} OCR files copied to public/ocr/`);
