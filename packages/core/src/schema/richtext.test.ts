import { richtext } from "./richtext_v2";

describe("richtext", () => {
  test("todo", () => {
    console.log(richtext`# Title 1
## Title 2

Paragraph 1 2 3 4 5

Words *italic* **bold** _underline_
`);
  });
});
