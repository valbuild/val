import { ModuleFilePath, PatchId, SourcePath } from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { PatchRecord } from "../../../stores/types";
import { changedPathsAmong } from "./changedFields";

const MODULE = "/app/page.val.ts" as ModuleFilePath;
const TITLE = '/app/page.val.ts?p="/"."title"' as SourcePath;
const HERO_IMAGE = '/app/page.val.ts?p="/"."hero"."image"' as SourcePath;
const FIRST_SECTION_TEXT =
  '/app/page.val.ts?p="/"."sections".0."text"' as SourcePath;
const FOOTER = '/app/footer.val.ts?p="text"' as SourcePath;
const PATHS = [TITLE, HERO_IMAGE, FIRST_SECTION_TEXT, FOOTER];

let n = 0;
function record(patch: Patch, extra: Partial<PatchRecord> = {}): PatchRecord {
  n++;
  return {
    patchId: `p${n}` as PatchId,
    moduleFilePath: MODULE,
    patch,
    ...extra,
  };
}

const changed = (records: PatchRecord[], published: PatchId[] = []) =>
  Array.from(changedPathsAmong(PATHS, records, new Set(published))).sort();

describe("changedPathsAmong", () => {
  test("an op on the field", () => {
    expect(
      changed([record([{ op: "replace", path: ["/", "title"], value: "x" }])]),
    ).toEqual([TITLE]);
  });

  test("an op above the field changes it", () => {
    expect(
      changed([record([{ op: "replace", path: ["/", "hero"], value: {} }])]),
    ).toEqual([HERO_IMAGE]);
  });

  test("an op below the field changes it", () => {
    expect(
      changed([
        record([
          { op: "replace", path: ["/", "hero", "image", "alt"], value: "x" },
        ]),
      ]),
    ).toEqual([HERO_IMAGE]);
  });

  test("a sibling with a shared prefix in its name does not", () => {
    expect(
      changed([record([{ op: "replace", path: ["/", "titles"], value: "x" }])]),
    ).toEqual([]);
  });

  test("both ends of a move", () => {
    expect(
      changed([
        record([
          { op: "move", from: ["/", "sections", "0"], path: ["/", "other"] },
        ]),
      ]),
    ).toEqual([FIRST_SECTION_TEXT]);
  });

  test("only within the patch's own module", () => {
    expect(
      changed([
        record([{ op: "replace", path: ["text"], value: "x" }], {
          moduleFilePath: "/app/footer.val.ts" as ModuleFilePath,
        }),
      ]),
    ).toEqual([FOOTER]);
  });

  test("published patches do not count", () => {
    const shipped = record(
      [{ op: "replace", path: ["/", "title"], value: "x" }],
      { appliedAt: { commitSha: "abc" } },
    );
    const publishedHere = record([
      { op: "replace", path: ["/", "hero"], value: {} },
    ]);
    expect(changed([shipped, publishedHere], [publishedHere.patchId])).toEqual(
      [],
    );
  });
});
