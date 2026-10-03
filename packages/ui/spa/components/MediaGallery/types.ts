import type { ReactNode } from "react";

/** What a gallery holds: `s.imageset()`, `s.videoset()` or `s.fileset()`. */
export type MediaKind = "images" | "videos" | "files";

/**
 * One entry of a gallery, as the gallery shows it.
 *
 * Already resolved: `url` is servable (a draft carries its `patch_id`), and
 * `name` is what a person calls the entry — an HLS stream's directory, not
 * `master.m3u8`. Nothing here reads a store, so the gallery renders the same
 * in a story as in the Studio.
 */
export type MediaItem = {
  /** The entry's key: its file path, or its remote ref. */
  ref: string;
  url: string;
  /** e.g. `team_51df2.mp4`, or `intro_05198` for a stream. */
  name: string;
  /** e.g. `/val/videos`. */
  folder: string;
  mimeType: string;
  width?: number;
  height?: number;
  /** Seconds. A video's. */
  duration?: number;
  description?: string | null;
  /** A still of a video, shown on its tile and as the player's poster. */
  thumbnailUrl?: string;
  /** An image's focal point. */
  hotspot?: { x: number; y: number };
  /** An HLS stream: played with hls.js where the browser cannot. */
  isHls?: boolean;
  /** Problems with the entry, shown on its tile and in the inspector. */
  errors?: string[];
  /** Problems with the description in particular. */
  descriptionErrors?: string[];
};

/** A file on its way in: shown as a tile of its own until it is an entry. */
export type MediaUpload = {
  id: string;
  name: string;
  phase: "reading" | "converting" | "uploading";
  /** 0 to 100, or null while it cannot be told. */
  progress: number | null;
};

export type MediaGalleryProps = {
  kind: MediaKind;
  items: MediaItem[];
  /** Files on their way in, shown first. */
  uploads?: MediaUpload[];
  /** The entry open in the inspector. */
  selectedRef: string | null;
  onSelect: (ref: string | null) => void;
  onUploadClick?: () => void;
  /** The upload cannot succeed yet (e.g. remote settings still loading). */
  uploadDisabled?: boolean;
  /** Files are being dragged over the gallery. */
  isDraggingOver?: boolean;
  onDescriptionChange?: (ref: string, description: string) => void;
  /**
   * Rename the entry to `newBase` (the name without its locked suffix).
   * Resolves to an error message, or null when it was renamed.
   */
  onRename?: (ref: string, newBase: string) => Promise<string | null>;
  onDelete?: (ref: string) => void;
  /**
   * Why the entry cannot be deleted right now — it is used somewhere, or the
   * places it is used are still being looked up — or null when it can.
   */
  deleteBlockedReason?: (item: MediaItem) => string | null;
  /** Where the entry is used: the Studio's references list. */
  renderUsage?: (item: MediaItem) => ReactNode;
  defaultView?: "grid" | "list";
  /** Nothing can be changed: no upload, rename, description or delete. */
  readonly?: boolean;
};
