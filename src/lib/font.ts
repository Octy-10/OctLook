import { api, assetUrl, type FontInfo } from "./ipc";

export interface LoadedFont {
  family: string;
  info: FontInfo | null;
  release(): void;
}

let faces = 0;

/** Registers a font file under a private family name; `release` unregisters it. */
export async function loadFont(path: string): Promise<LoadedFont> {
  const family = `octlook-font-${++faces}`;
  const face = new FontFace(family, `url("${assetUrl(path)}")`);
  const [info] = await Promise.all([api.fontInfo(path).catch(() => null), face.load()]);
  document.fonts.add(face);
  return { family, info, release: () => document.fonts.delete(face) };
}
