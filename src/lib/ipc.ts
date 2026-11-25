import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export interface FileEntry {
  path: string;
  name: string;
  size: number;
  modified: number;
}

export interface Listing {
  dir: string;
  entries: FileEntry[];
}

export interface ExifEntry {
  key: "make" | "model" | "lens" | "aperture" | "shutter" | "iso" | "focal" | "taken";
  value: string;
}

export interface FileInfo {
  size: number;
  modified: number | null;
  created: number | null;
  exif: ExifEntry[];
}

/** Metadata describing how a file was decoded (see `src-tauri/src/decode`). */
export interface DecodeMeta {
  format: string;
  source: "full" | "preview";
  detail: string | null;
  orientation: number;
  originalSize: [number, number] | null;
}

export interface FrameHeader extends DecodeMeta {
  kind: "native" | "pdf" | "encoded" | "pixels";
  mime: string | null;
  width: number | null;
  height: number | null;
}

export interface Frame {
  header: FrameHeader;
  payload: Uint8Array<ArrayBuffer>;
}

/** `[payload][header JSON][u32 LE header length]` — see `src-tauri/src/wire.rs`. */
function parseFrame(buffer: ArrayBuffer): Frame {
  const headerLength = new DataView(buffer).getUint32(buffer.byteLength - 4, true);
  const headerStart = buffer.byteLength - 4 - headerLength;
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, headerStart, headerLength)));
  return { header, payload: new Uint8Array(buffer, 0, headerStart) };
}

export const api = {
  decode: (path: string) => invoke<ArrayBuffer>("decode_image", { path }).then(parseFrame),
  thumbnail: (path: string, size: number) => invoke<ArrayBuffer>("thumbnail", { path, size }).then(parseFrame),
  listFolder: (path: string) => invoke<Listing>("list_folder", { path }),
  fileInfo: (path: string) => invoke<FileInfo>("file_info", { path }),
  moveToTrash: (path: string) => invoke<void>("move_to_trash", { path }),
  launchPath: () => invoke<string | null>("launch_path"),
  supportedExtensions: () => invoke<string[]>("supported_extensions"),
};

/** URL the WebView can load directly through Tauri's asset protocol. */
export const assetUrl = (path: string) => convertFileSrc(path);

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
