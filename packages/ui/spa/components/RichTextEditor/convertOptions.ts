import type { SerializedRichTextOptions } from "@valbuild/core";
import type { EditorFeatures } from "./types";

export function serializedRichTextOptionsToFeatures(
  options?: SerializedRichTextOptions,
): Partial<EditorFeatures> {
  if (!options) return {};
  const features: Partial<EditorFeatures> = {};

  features.bold = options.bold ?? false;
  features.italic = options.italic ?? false;
  features.strikethrough = options.lineThrough ?? false;

  features.h1 = options.h1 ?? false;
  features.h2 = options.h2 ?? false;
  features.h3 = options.h3 ?? false;
  features.h4 = options.h4 ?? false;
  features.h5 = options.h5 ?? false;
  features.h6 = options.h6 ?? false;
  features.bulletList = options.ul ?? false;
  features.orderedList = options.ol ?? false;

  features.link = !!options.a;
  features.image = !!options.img;

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
