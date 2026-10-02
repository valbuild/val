import type {
  SerializedImageSchema,
  SerializedRichTextSchema,
  SourcePath,
} from "@valbuild/core";
import { sourcePathOfChild } from "./sourcePath";

/**
 * The image schema a rich text field's inline `img` nodes are validated with,
 * when it is a real schema rather than `img: true`.
 *
 * It is the only way a rich text field can point INTO a gallery
 * (`s.richtext({ img: s.image(galleryVal) })`), which is why every reference
 * scan has to ask: the field's own schema is `richtext`, not `image`, so a walk
 * that only looks for image leaves walks straight past the images in it.
 */
export function richTextImageSchema(
  schema: SerializedRichTextSchema,
): SerializedImageSchema | null {
  const img = schema.options?.img;
  return typeof img === "object" && img !== null ? img : null;
}

/**
 * Every inline image in a rich text value, at the path of its `src`.
 *
 * `src` is a media value (`{ path, … }`), so the path handed out is one a
 * patch can address — `field.0."children".1."src"` — and a rename rewrites
 * `[…, "src", "path"]` there with the same op it uses on an image field.
 * Images nest (a list item holds a paragraph holds the image), so the walk
 * follows `children` all the way down.
 */
export function forEachRichTextImage(
  path: SourcePath,
  source: unknown,
  visit: (srcPath: SourcePath, src: Record<string, unknown>) => void,
): void {
  if (!Array.isArray(source)) {
    return;
  }
  for (let index = 0; index < source.length; index++) {
    const node: unknown = source[index];
    if (typeof node !== "object" || node === null || Array.isArray(node)) {
      continue;
    }
    const nodePath = sourcePathOfChild(path, index);
    if ("tag" in node && node.tag === "img" && "src" in node) {
      const src = node.src;
      if (typeof src === "object" && src !== null && !Array.isArray(src)) {
        visit(sourcePathOfChild(nodePath, "src"), { ...src });
      }
    }
    if ("children" in node) {
      forEachRichTextImage(
        sourcePathOfChild(nodePath, "children"),
        node.children,
        visit,
      );
    }
  }
}
