import { Internal, initVal, modules } from ".";

const { s, c, config } = initVal();

describe("Internal.selfCheck", () => {
  test("the platform's upgrade page reaches the site's own Val's check here", async () => {
    const blog = c.define(
      "/content/blog.val.ts",
      s.record(s.object({ title: s.string().maxLength(10) })),
      {
        "post-1": { title: "A title that is longer than ten characters" },
      },
    );
    const result = await Internal.selfCheck(
      modules(config, [{ def: async () => ({ default: blog }) }]),
    );
    expect(result).toMatchObject({
      version: 1,
      modules: 1,
      errors: [
        { moduleFilePath: "/content/blog.val.ts", path: ["post-1", "title"] },
      ],
    });
  });
});
