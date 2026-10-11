import type { Schema } from "../schema";
import { FileSchema } from "../schema/file";
import { ImageSchema } from "../schema/image";
import { VideoSchema } from "../schema/video";
import { ValViewSchema } from "../schema/view";
import type { SelectorSource } from "../selector";

const cache = new WeakMap<object, Map<string, unknown>>();

/**
 * The PUBLISHED entries of every gallery a module's fields pick from — an
 * `s.image(galleryVal)`, `s.file(filesVal)` or `s.video(videosVal)` — by the
 * gallery's module path.
 *
 * A gallery-backed value names its file and nothing else that is the
 * gallery's, so a reader has to look the entry up (`fillFromGallery`). In
 * draft mode the reader has every module's draft source to look in; outside
 * it, nothing — and the page got a set-backed video with no type, size,
 * poster or description, and an image with no dimensions. But the field's
 * schema was built from the gallery module (`s.video(videosVal)` reads it at
 * definition), so the published entries are already here, on the schema
 * instance. This is where they are read from.
 *
 * Stops at a view: the module it points at is read on its own, with its own
 * galleries.
 */
export function galleriesOf(
  schema: Schema<SelectorSource> | undefined,
): Map<string, unknown> {
  if (schema === undefined) {
    return new Map();
  }
  const cached = cache.get(schema);
  if (cached) {
    return cached;
  }
  const galleries = new Map<string, unknown>();
  const seen = new Set<unknown>();
  function walk(node: unknown): void {
    if (typeof node !== "object" || node === null || seen.has(node)) {
      return;
    }
    seen.add(node);
    if (node instanceof ValViewSchema) {
      return;
    }
    if (node instanceof ImageSchema) {
      for (const [modulePath, entries] of Object.entries(
        node["moduleMetadata"],
      )) {
        galleries.set(modulePath, entries);
      }
      return;
    }
    if (node instanceof FileSchema) {
      for (const [modulePath, entries] of Object.entries(
        node["moduleMetadata"],
      )) {
        galleries.set(modulePath, entries);
      }
      return;
    }
    if (node instanceof VideoSchema) {
      const gallery = node["gallery"];
      if (gallery && gallery.entries !== null) {
        galleries.set(gallery.modulePath, gallery.entries);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }
    for (const value of Object.values(node)) {
      walk(value);
    }
  }
  walk(schema);
  cache.set(schema, galleries);
  return galleries;
}
