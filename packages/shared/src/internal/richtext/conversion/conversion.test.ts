import {
  initVal,
  RichTextSource,
  AnyRichTextOptions,
  FILE_REF_PROP,
} from "@valbuild/core";

import { parseRichTextSource } from "./parseRichTextSource";
import { remirrorToRichTextSource } from "./remirrorToRichTextSource";
import { richTextToRemirror } from "./richTextToRemirror";

const { val } = initVal();
const cases: {
  description: string;
  input: RichTextSource<AnyRichTextOptions>;
}[] = [
  {
    description: "basic",
    input: val.richtext`
# Title 1

## Title 2

### Title 3

#### Title 4

##### Title 5

###### Title 6

Some paragraph. Another sentence.

Another paragraph.

Formatting: **bold**, _italic_, ~~line-through~~, ***bold and italic***.

- List 1
    1. List 1.1
    1. List 1.2
`,
  },
  {
    description: "all features",
    input: val.richtext`
# Title 1

Title 1 content.

## Title 2

Title 2 content.

### Title 3

Title 3 content.

#### Title 4

Title 4 content.

##### Title 5

###### Title 6

Some paragraph. Another sentence.

Another paragraph.

Formatting: **bold**, _italic_, ~~line-through~~, ***bold and italic***.

- List 1
    1. List 1.1
    1. List 1.2

Inline link: ${val.link("**link**", { href: "https://link.com" })}

<br />

Block link:

${val.link("**link**", { href: "https://link.com" })}

<br />

Block Image:

${val.file("/public/test.jpg", {
  width: 100,
  height: 100,
  sha256: "123",
  mimeType: "image/jpeg",
})}

<br />

<br />

- List 1
    1. List 1.1
    1. List 1.2
- List 2
- List 3
    1. Formatted **list**
Test 123
`,
  },
];

describe("isomorphic richtext <-> conversion", () => {
  test.each(cases)("$description", ({ input }) => {
    const inputSource = input;

    const res = remirrorToRichTextSource(
      richTextToRemirror(parseRichTextSource(inputSource))
    );
    const output = stringifyRichTextSource(res);
    // console.log("EOF>>" + output + "<<EOF");
    expect(stringifyRichTextSource(inputSource)).toStrictEqual(output);
  });
});

function stringifyRichTextSource({
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
