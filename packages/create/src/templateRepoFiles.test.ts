import { mkdirSync, mkdtempSync, existsSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pruneTemplateRepoFiles } from "./templateRepoFiles";

/**
 * What a new project must NOT inherit from the template it came from.
 *
 * The property, not the list: a scaffolded project keeps its source and loses
 * the template repository's own CI. The list is one entry today and the test is
 * written so adding to it needs no new test.
 */
describe("pruneTemplateRepoFiles", () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "val-create-prune-"));
  });

  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  it("removes the template's own workflows", () => {
    mkdirSync(join(project, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(project, ".github", "workflows", "check.yml"),
      "name: x",
    );

    expect(pruneTemplateRepoFiles(project)).toEqual([".github"]);
    expect(existsSync(join(project, ".github"))).toBe(false);
  });

  it("leaves the project's own files alone", () => {
    mkdirSync(join(project, "src"), { recursive: true });
    writeFileSync(join(project, "src", "app.tsx"), "export default null;");
    writeFileSync(join(project, "package.json"), "{}");

    pruneTemplateRepoFiles(project);

    expect(existsSync(join(project, "src", "app.tsx"))).toBe(true);
    expect(existsSync(join(project, "package.json"))).toBe(true);
  });

  it("says nothing was removed when the template carries none of it", () => {
    writeFileSync(join(project, "package.json"), "{}");

    expect(pruneTemplateRepoFiles(project)).toEqual([]);
  });
});
