import { result } from "@valbuild/core/fp";
import { patchModuleText } from "./patchModuleText";

const MODULE = `import { s, c } from "../val.config";

export default c.define(
  "/content/home.val.ts",
  s.object({ title: s.string(), testimonials: s.array(s.string()) }),
  {
    title: "Clothes that outlast the season",
    testimonials: [],
  },
);
`;

describe("a patch written into a module's file", () => {
  test("changes the content and nothing around it", async () => {
    const patched = await patchModuleText(MODULE, [
      { op: "replace", path: ["title"], value: "Worn for years" },
      {
        op: "add",
        path: ["testimonials", "0"],
        value: "Eleven years old, and darned twice.",
      },
    ]);
    if (result.isErr(patched)) throw new Error(patched.error);
    expect(patched.value).toContain('title: "Worn for years"');
    expect(patched.value).toContain('"Eleven years old, and darned twice."');
    expect(patched.value).toContain(
      "s.object({ title: s.string(), testimonials: s.array(s.string()) })",
    );
    expect(
      patched.value.startsWith('import { s, c } from "../val.config";'),
    ).toBe(true);
  });

  test("says why, when the patch does not fit the content", async () => {
    const patched = await patchModuleText(MODULE, [
      { op: "replace", path: ["missing", "deeper"], value: "x" },
    ]);
    expect(result.isErr(patched)).toBe(true);
  });

  test("points at the entry's own file, for a module that keeps entries in .val.json", async () => {
    const patched = await patchModuleText(
      `${MODULE}\n// posts: s.record(post).jsonValues()\n`,
      [{ op: "replace", path: ["posts", "a", "title"], value: "x" }],
    );
    if (!result.isErr(patched)) throw new Error("expected an error");
    expect(patched.error).toContain("write_files");
  });
});
