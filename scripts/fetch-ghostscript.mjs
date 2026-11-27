// Ghostscript (AGPL-3.0, Artifex) renders EPS/PostScript for the viewer. On
// Windows its command-line program and DLL are taken from the official
// installer into src-tauri/resources/gs, where the installer bundles them
// (fonts and init files are compiled into the DLL). Files already present
// with the right checksums are kept. macOS builds compile their own in CI.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

if (process.platform !== "win32") process.exit(0);

const VERSION = "10080";
const INSTALLER = {
  url: `https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs${VERSION}/gs${VERSION}w64.exe`,
  sha256: "52a91b8bf09298788d7a57b9206127026c23eacd75405f0a131e26dc381dce50",
};
/** [path inside the installer, bundled name, sha256] */
const FILES = [
  ["bin/gswin64c.exe", "gswin64c.exe", "9b29d3b5128c6d53bb4e9eee77e3919d05038cdfdd8e07697af4d9c319f9d5ad"],
  ["bin/gsdll64.dll", "gsdll64.dll", "a134ed0d3af749bdab93c66029180e676d36d9cc624c192ea287f73c891fb0af"],
  ["doc/COPYING", "COPYING", null],
];
const DIR = join(import.meta.dirname, "..", "src-tauri", "resources", "gs");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const present = ([, name, digest]) => {
  const target = join(DIR, name);
  return existsSync(target) && (!digest || sha256(readFileSync(target)) === digest);
};

if (!FILES.every(present)) {
  console.log(`Ghostscript ← ${INSTALLER.url}`);
  const response = await fetch(INSTALLER.url);
  if (!response.ok) throw new Error(`${INSTALLER.url}: HTTP ${response.status}`);
  const installer = Buffer.from(await response.arrayBuffer());
  if (sha256(installer) !== INSTALLER.sha256) throw new Error("Ghostscript installer: checksum mismatch, refusing to bundle it");

  // The installer is an NSIS archive: 7-Zip (compiled to WebAssembly) opens it on any machine.
  const { default: SevenZip } = await import("7z-wasm");
  const zip = await SevenZip({ print: () => {}, printErr: () => {} });
  zip.FS.writeFile("gs.exe", installer);
  zip.callMain(["x", "gs.exe", "-oout", ...FILES.map(([inner]) => inner)]);
  mkdirSync(DIR, { recursive: true });
  for (const [inner, name, digest] of FILES) {
    const bytes = zip.FS.readFile(`out/${inner}`);
    if (digest && sha256(bytes) !== digest) throw new Error(`${name}: checksum mismatch, refusing to bundle it`);
    writeFileSync(join(DIR, name), bytes);
  }
}
