import { AllRichTextOptions, initVal, RichTextSource } from "@valbuild/core";

import { remirrorToRichTextSource } from "./remirrorToRichTextSource";
import { richTextToRemirror } from "./richTextToRemirror";

const { c } = initVal();
const cases: {
  description: string;
  input: RichTextSource<AllRichTextOptions>;
}[] = [
  {
    description: "basic",
    input: c.richtext`
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
    input: c.richtext`
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

Inline link: ${c.rt.link("**link**", { href: "https://link.com" })}

<br />

Block link:

${c.rt.link("**link**", { href: "https://link.com" })}

<br />

Block Image:

${c.rt.image("/public/test.jpg", {
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
    1. Formatted **list**<br />
Test 123
`,
  },
];

describe("isomorphic richtext <-> conversion", () => {
  test.each(cases)("$description", ({ input }) => {
    const inputSource = input;

    const res = remirrorToRichTextSource(richTextToRemirror(inputSource));
    expect(res).toStrictEqual(inputSource);
  });
});
