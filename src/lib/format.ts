const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 || value >= 100 ? 0 : 1)} ${UNITS[unit]}`;
}

const dateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });

export const formatDate = (millis: number) => dateFormat.format(millis);

export const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
