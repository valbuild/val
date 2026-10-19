import type { ModuleFilePath, PatchId } from "@valbuild/core";
import { describeChangesWithoutModule } from "./describeChangesWithoutModule";

const change = (patchId: string, moduleFilePath: string) => ({
  patchId: patchId as PatchId,
  moduleFilePath: moduleFilePath as ModuleFilePath,
});

describe("describeChangesWithoutModule", () => {
  it("says nothing when there is nothing to say", () => {
    expect(describeChangesWithoutModule([])).toBeNull();
  });

  it("names the file, and what the editor can do", () => {
    expect(
      describeChangesWithoutModule([change("p1", "/content/old.val.ts")]),
    ).toEqual({
      title: "An unpublished change is to a file that is not in the project",
      description:
        "/content/old.val.ts is not among the project's modules. If it was renamed or deleted, discard the change to publish the rest. If it is back, or only failed to load, the change applies again.",
    });
  });

  it("names each file once, however many changes it had", () => {
    expect(
      describeChangesWithoutModule([
        change("p1", "/a.val.ts"),
        change("p2", "/a.val.ts"),
        change("p3", "/b.val.ts"),
      ]),
    ).toEqual({
      title: "3 unpublished changes are to files that are not in the project",
      description:
        "/a.val.ts, /b.val.ts are not among the project's modules. If they were renamed or deleted, discard them to publish the rest. If they are back, or only failed to load, they apply again.",
    });
  });

  it("does not list a hundred files", () => {
    const changes = ["/a", "/b", "/c", "/d", "/e"].map((f, i) =>
      change(`p${i}`, `${f}.val.ts`),
    );
    expect(describeChangesWithoutModule(changes)?.description).toMatch(
      /^\/a\.val\.ts, \/b\.val\.ts, \/c\.val\.ts and 2 more are not among/,
    );
  });
});
