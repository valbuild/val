import { initVal, Internal } from "@valbuild/core";
import { LinkSource } from "@valbuild/core/src/source/link";
import { fromLexical, toLexical } from "./components/RichTextEditor/conversion";

function testRt(s: TemplateStringsArray, ...exprs: LinkSource[]) {
  return [s, exprs] as const;
}

describe("richtext e2e", () => {
  test("isomorphism: links", async () => {
    const { val } = initVal();
    const a = testRt`# Title 1

heisann ${val.link("**google**", { href: "https://google.com" })}


gurba`;

    const input = Internal.convertRichTextSource(
      Internal.internalRichText(a[0], ...a[1])
    );
    console.log(JSON.stringify(input, null, 2));

    const output = Internal.richTextToTaggedStringTemplate(
      (await fromLexical(toLexical(input))).node
    );
    console.log(JSON.stringify(output, null, 2));

    expect(input).toEqual(output);
  });
});
