import type { MediaItem } from "./types";

/** `0:04`, `1:02:03`: a length as a player shows it. */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** `MP4`, `HLS`, `PDF`: the type as a short label. */
export function typeLabel(item: Pick<MediaItem, "mimeType" | "isHls">): string {
  if (item.isHls) {
    return "HLS";
  }
  const subtype = item.mimeType.split("/")[1] ?? item.mimeType;
  return subtype.replace(/^x-/, "").split(/[.+;]/)[0].toUpperCase();
}

/** `640×360 · 0:04 · HLS`: what is known about the file, in one line. */
export function factsOf(item: MediaItem): string {
  return [
    item.width && item.height ? `${item.width}×${item.height}` : null,
    typeof item.duration === "number" ? formatDuration(item.duration) : null,
    item.isHls ? "HLS stream" : typeLabel(item),
  ]
    .filter(Boolean)
    .join(" · ");
}
