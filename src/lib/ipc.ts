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

/** How a file is presented (see `format::Category`): images get the editing stage, the rest their own viewers. */
export type Category = "image" | "video" | "audio" | "text" | "font";

/** Metadata describing how a file was decoded (see `src-tauri/src/decode`). */
export interface DecodeMeta {
  format: string;
  category: Category;
  source: "full" | "preview";
  detail: string | null;
  orientation: number;
  originalSize: [number, number] | null;
  /** Why only an embedded preview could be shown, when the decoder knows. */
  note: string | null;
}

export interface DefaultApp {
  name: string;
  /** PNG bytes of the app icon; empty when it could not be read. */
  icon: number[];
}

export interface TextFile {
  text: string;
  encoding: string;
  /** Only the first 2 MB were read. */
  truncated: boolean;
}

export interface FontInfo {
  family: string | null;
  style: string | null;
  version: string | null;
  designer: string | null;
  glyphs: number;
  faces: number;
  cjk: boolean;
}

/** Resident mode (Windows): Space preview from Explorer, and starting with the system. */
export interface ResidentSettings {
  spacePreview: boolean;
  autostart: boolean;
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
  /** Up to `limit` bytes (2 MB at most) of a text file. */
  readText: (path: string, limit?: number) => invoke<TextFile>("read_text", { path, limit }),
  fontInfo: (path: string) => invoke<FontInfo>("font_info", { path }),
  defaultApp: (path: string) => invoke<DefaultApp | null>("default_app", { path }),
  openWithDefault: (path: string) => invoke<void>("open_with_default", { path }),
  moveToTrash: (path: string) => invoke<void>("move_to_trash", { path }),
  launchPath: () => invoke<string | null>("launch_path"),
  supportedExtensions: () => invoke<string[]>("supported_extensions"),
  residentSettings: () => invoke<ResidentSettings>("resident_settings"),
  setSpacePreview: (on: boolean) => invoke<ResidentSettings>("set_space_preview", { on }),
  setAutostart: (on: boolean) => invoke<ResidentSettings>("set_autostart", { on }),
  /** Sizes the Space preview to its file (`width` × `height` CSS px, chrome included) and shows it. */
  quicklookPresent: (width: number, height: number) => invoke<void>("quicklook_present", { width, height }),
  quicklookClose: () => invoke<void>("quicklook_close"),
  openInMain: (path: string) => invoke<void>("open_in_main", { path }),
  /** Hands the Space preview's file to a window of its own that stays until closed. */
  quicklookPin: (path: string) => invoke<void>("quicklook_pin", { path }),
  /** Text in the canvas, recognised offline (PP-OCRv5). Body layout `[RGBA pixels][u32 LE width]`. */
  recognizeText(canvas: HTMLCanvasElement) {
    const { width, height } = canvas;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
    const body = new Uint8Array(pixels.length + 4);
    body.set(pixels);
    new DataView(body.buffer).setUint32(pixels.length, width, true);
    return invoke<string>("recognize_text", body);
  },
  /** Body layout `[data][UTF-8 path][u32 LE path length]` — see `wire::split_path`. */
  async writeFile(path: string, data: Blob) {
    const tail = new TextEncoder().encode(path);
    const body = new Uint8Array(data.size + tail.length + 4);
    body.set(new Uint8Array(await data.arrayBuffer()));
    body.set(tail, data.size);
    new DataView(body.buffer).setUint32(body.length - 4, tail.length, true);
    await invoke<void>("write_file", body);
  },
};

/** URL the WebView can load directly through Tauri's asset protocol. */
export const assetUrl = (path: string) => convertFileSrc(path);

/** Object URL for an encoded image frame; the caller revokes it. */
export const frameUrl = ({ header, payload }: Frame) => URL.createObjectURL(new Blob([payload], { type: header.mime ?? "" }));

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
