import {
  AnyRichTextOptions,
  FILE_REF_PROP,
  RichTextSource,
} from "@valbuild/core";

/**
 * Create something that looks like the val.richtext input
 *
 * **SHOULD ONLY BE USED IN TESTS / DEBUGGING**
 **/
export function stringifyRichTextSource({
  templateStrings,
  exprs,
}: RichTextSource<AnyRichTextOptions>): string {
  let lines = "";
  for (let i = 0; i < templateStrings.length; i++) {
    const line = templateStrings[i];
    const expr = exprs[i];
    lines += line;
    if (expr) {
      if (expr._type === "file") {
        lines += `\${val.file("${expr[FILE_REF_PROP]}", ${JSON.stringify(
          expr.metadata
        )})}`;
      } else if (expr._type === "link") {
        lines += `\${val.link("${expr.children[0]}", ${JSON.stringify({
          href: expr.href,
        })})}`;
      } else {
        throw Error("Unknown expr: " + JSON.stringify(expr, null, 2));
      }
    }
  }
  return lines;
}
