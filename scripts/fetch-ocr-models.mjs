// Downloads the PP-OCRv5 mobile models (Apache-2.0, published by PaddlePaddle)
// into src-tauri/resources/ocr, where the installer bundles them. Files already
// present with the right checksum are kept; set HF_ENDPOINT to use a mirror.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HUB = process.env.HF_ENDPOINT ?? "https://huggingface.co";
const DIR = join(import.meta.dirname, "..", "src-tauri", "resources", "ocr");
const MODELS = [
  ["det.onnx", "PaddlePaddle/PP-OCRv5_mobile_det_onnx", "a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d"],
  ["rec.onnx", "PaddlePaddle/PP-OCRv5_mobile_rec_onnx", "da72dc72ca4dc220df0dfde68c1dedc31c58d3e76a25871122e5056227d50092"],
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

for (const [file, repo, digest] of MODELS) {
  const target = join(DIR, file);
  if (existsSync(target) && sha256(readFileSync(target)) === digest) continue;
  const url = `${HUB}/${repo}/resolve/main/inference.onnx`;
  console.log(`OCR model ← ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== digest) throw new Error(`${file}: checksum mismatch, refusing to bundle it`);
  writeFileSync(target, bytes);
}
