import type { Patch } from "@valbuild/core/patch";
import type { InlineRichTextNode } from "@valbuild/shared/internal";
import type { EditorDocument } from "../RichTextEditor";

/**
 * The patch a richtext field writes when typing pauses: the whole document,
 * replacing the old one at the field's patch path.
 *
 * Its own function for the reason `stringFieldPatch` is, and with a second
 * caller that makes it matter: a richtext typed ON the page, in the preview
 * (`useCanvasInlineEdit`), is written with this too, so the two ways of
 * editing one field cannot come to write it differently.
 */
export function richTextFieldPatch(
  patchPath: string[],
  content: EditorDocument | readonly InlineRichTextNode[],
): Patch {
  return [
    {
      op: "replace",
      path: patchPath,
      value: content as unknown as Parameters<typeof JSON.stringify>[0],
    },
  ];
}
