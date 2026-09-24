import { initVal } from "@valbuild/core";
import { ValOpsHttp } from "./ValOpsHttp";

/**
 * The `.val.ts` text a publish patches, for a build that embedded its source.
 *
 * A project with no repository has no other copy of that text -- content keeps
 * its content as Source -- so without this a save of one produced no files and
 * the build that followed carried none of the save's edits.
 */
describe("a build that embedded its own source", () => {
  const { config } = initVal();
  const text =
    'export default c.define("/content/page.val.ts", s.string(), "hi");\n';

  const ops = (projectSource?: Record<string, string>) =>
    new ValOpsHttp(
      // Unreachable on purpose: nothing here may ask the content service.
      "http://127.0.0.1:9",
      "org/project",
      null,
      { apiKey: "key" },
      { config, modules: [] },
      { config, ...(projectSource ? { projectSource } : {}) },
    );

  test("is where the text a publish patches comes from", async () => {
    const res = await ops({ "content/page.val.ts": text }).readProjectFile(
      "/content/page.val.ts",
    );
    expect(res).toEqual({ data: text });
  });

  test("a file it does not have is an error, not an empty module", async () => {
    const res = await ops({ "content/page.val.ts": text }).readProjectFile(
      "/content/other.val.ts",
    );
    expect(res.error?.message).toMatch(
      /not in the source this build was made from/,
    );
  });

  test("without one, a project with no repository still has no text", async () => {
    const res = await ops().readProjectFile("/content/page.val.ts");
    expect(res.error?.message).toMatch(/no repository/);
  });

  test("and says so, so the route can answer", () => {
    expect(ops({}).embedsSource()).toBe(true);
    expect(ops().embedsSource()).toBe(false);
  });
});
