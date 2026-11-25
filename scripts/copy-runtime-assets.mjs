// Copies third-party runtime assets into public/ so they ship with the app
// and work offline: pdf.js (CMaps, standard fonts, ICC profiles, wasm image
// decoders).
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = (name) => dirname(require.resolve(`${name}/package.json`));
const target = (name) => {
  const out = join(import.meta.dirname, "..", "public", name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  return out;
};

const pdfjs = target("pdfjs");
for (const dir of ["cmaps", "standard_fonts", "iccs", "wasm"]) {
  cpSync(join(pkg("pdfjs-dist"), dir), join(pdfjs, dir), { recursive: true });
}

console.log(`runtime assets → ${dirname(pdfjs)}`);
