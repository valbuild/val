import type { Range, TextEdit } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";

/**
 * Narrow an edit down to the region that actually changed.
 *
 * A whole-document replacement would work, but it moves the cursor and shows up
 * as a full-file change in review. Trimming the common prefix and suffix keeps
 * the edit tight without needing a real diff algorithm.
 */
export function minimalTextEdit(
  before: string,
  after: string,
  document: TextDocument,
): TextEdit | undefined {
  if (before === after) {
    return undefined;
  }

  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before[prefix] === after[prefix]) {
    prefix++;
  }

  let suffix = 0;
  const maxSuffix = Math.min(before.length, after.length) - prefix;
  while (
    suffix < maxSuffix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }

  const range: Range = {
    start: document.positionAt(prefix),
    end: document.positionAt(before.length - suffix),
  };
  return { range, newText: after.slice(prefix, after.length - suffix) };
}
