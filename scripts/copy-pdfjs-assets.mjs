// Copies pdf.js runtime assets (CMaps, standard fonts, ICC profiles, wasm
// image decoders) into public/ so they ship with the app and work offline.
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const root = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const out = join(import.meta.dirname, "..", "public", "pdfjs");
rmSync(out, { recursive: true, force: true });
for (const dir of ["cmaps", "standard_fonts", "iccs", "wasm"]) {
  cpSync(join(root, dir), join(out, dir), { recursive: true });
}
console.log(`pdf.js assets → ${out}`);
