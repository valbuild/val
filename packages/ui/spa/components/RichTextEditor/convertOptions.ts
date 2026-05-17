import type { SerializedRichTextOptions } from "@valbuild/core";
import type { EditorFeatures } from "./types";

export function serializedRichTextOptionsToFeatures(
  options?: SerializedRichTextOptions,
): Partial<EditorFeatures> {
  if (!options) return {};
  const features: Partial<EditorFeatures> = {};

  if (options.style) {
    features.bold = options.style.bold ?? false;
    features.italic = options.style.italic ?? false;
    features.strikethrough = options.style.lineThrough ?? false;
  }
  if (options.block) {
    features.h1 = options.block.h1 ?? false;
    features.h2 = options.block.h2 ?? false;
    features.h3 = options.block.h3 ?? false;
    features.h4 = options.block.h4 ?? false;
    features.h5 = options.block.h5 ?? false;
    features.h6 = options.block.h6 ?? false;
    features.bulletList = options.block.ul ?? false;
    features.orderedList = options.block.ol ?? false;
  }
  if (options.inline) {
    features.link = !!options.inline.a;
    features.image = !!options.inline.img;
  }

  features.hardBreak = true;
  features.fixedToolbar = true;
  features.floatingToolbar = false;
  features.gutter = false;
  features.code = false;
  features.blockquote = false;
  features.codeBlock = false;
  features.details = false;
  features.button = false;

  return features;
}
