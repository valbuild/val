/**
 * The inline images of a rich text field moved to `@valbuild/shared/internal`,
 * because `val validate --fix` has to find them too: renaming a gallery key
 * rewrites every field that names it, and a rich text image is one. The
 * Studio's imports stay pointed here.
 */
export {
  forEachRichTextImage,
  richTextImageSchema,
} from "@valbuild/shared/internal";
