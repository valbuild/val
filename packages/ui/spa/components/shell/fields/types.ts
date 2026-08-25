/**
 * Types for the media field designs.
 *
 * These mirror what Val actually stores, which is the whole point of the
 * exercise: `s.image()` keeps its metadata on the field, `s.images()` keeps
 * a record of entries keyed by file path, and `s.image(collection)` is a
 * field that points into one of those records. A design that does not know
 * which of the three it is showing will get the alt text wrong.
 */

/** Where a field's value came from, which decides what it can edit. */
export type MediaFieldSource =
  /** `s.image()` / `s.file()` — the field owns the file and its metadata. */
  | { kind: "own" }
  /**
   * `s.image(collection)` / `s.file(collection)` — the file belongs to a
   * collection module, and the field points at it.
   */
  | { kind: "collection"; name: string; moduleFilePath: string };

/** One image, as `s.images()` stores it plus what the file itself tells us. */
export type ImageEntry = {
  kind: "image";
  /** The `_ref`, e.g. "/public/val/images/hero_a1b2c.jpg". */
  ref: string;
  name: string;
  /** Resolved URL for display. */
  url: string;
  width: number;
  height: number;
  mimeType: string;
  /** Bytes. */
  size: number;
  alt: string | null;
  /** Focal point, 0–1 in each axis. Absent means the middle. */
  hotspot?: { x: number; y: number };
};

/** One non-image file. `s.files()` stores only the mime type. */
export type FileEntry = {
  kind: "file";
  ref: string;
  name: string;
  mimeType: string;
  size: number;
};

export type MediaEntry = ImageEntry | FileEntry;

/** A folder in the library, which is a directory prefix under the hood. */
export type MediaFolder = {
  /** Directory path, e.g. "/public/val/images/marketing". */
  path: string;
  name: string;
  itemCount: number;
};

/** The default focal point: dead centre, which is what a crop does anyway. */
export const CENTER_HOTSPOT: { x: number; y: number } = { x: 0.5, y: 0.5 };
