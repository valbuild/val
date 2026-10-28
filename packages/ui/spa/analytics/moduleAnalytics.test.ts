import {
  compactNumber,
  indexContentViews,
  moduleAnalyticsOf,
  pathKey,
  rangeText,
  viewsText,
} from "./moduleAnalytics";
import type { ModuleFilePath, SourcePath } from "@valbuild/core";

const MODULE = "/content/blog.val.ts" as ModuleFilePath;
const at = (modulePath: string) => `${MODULE}?p=${modulePath}` as SourcePath;

describe("content analytics for a module", () => {
  const answer = {
    from: "2026-09-27",
    to: "2026-10-26",
    since: "2026-09-01T00:00:00.000Z",
    module: MODULE,
    live: { status: "live", asOf: "2026-10-26T12:00:00.000Z" },
    paths: [
      { path: at('"posts".0."title"'), rendered: 100, viewed: 80 },
      { path: at('"posts".0."body"'), rendered: 100, viewed: 30 },
      { path: at('"posts".1."title"'), rendered: 40, viewed: 10 },
      { path: at('"intro"'), rendered: 120, viewed: 120 },
    ],
    total: 4,
  };

  test("an item, a list and the module get the most any path inside them got", () => {
    const analytics = moduleAnalyticsOf(answer);
    expect(analytics?.byKey.get(pathKey(at('"posts".0')))).toEqual({
      rendered: 100,
      viewed: 80,
    });
    expect(analytics?.byKey.get(pathKey(at('"posts"')))).toEqual({
      rendered: 100,
      viewed: 80,
    });
    expect(analytics?.byKey.get(pathKey(MODULE))).toEqual({
      rendered: 120,
      viewed: 120,
    });
    expect(analytics?.byKey.get(pathKey(at('"posts".2')))).toBeUndefined();
  });

  test("what is directly inside a path, most seen first, as paths the Studio navigates to", () => {
    const analytics = moduleAnalyticsOf(answer);
    expect(analytics?.children.get(pathKey(at('"posts"')))).toEqual([
      { path: at('"posts".0'), rendered: 100, viewed: 80 },
      { path: at('"posts".1'), rendered: 40, viewed: 10 },
    ]);
    expect(
      analytics?.children.get(pathKey(MODULE))?.map((row) => row.path),
    ).toEqual([at('"intro"'), at('"posts"')]);
  });

  test("a record key is the same key, however the path quotes it", () => {
    const { byKey } = indexContentViews([
      { path: at('"2024"."title"'), rendered: 5, viewed: 2 },
    ]);
    expect(byKey.get(pathKey(at("2024")))).toEqual({ rendered: 5, viewed: 2 });
    expect(byKey.get(pathKey(at('"2024"')))).toEqual({
      rendered: 5,
      viewed: 2,
    });
  });

  test("nothing to show: analytics off, nothing counted, or not an answer", () => {
    expect(moduleAnalyticsOf({ ...answer, since: null })).toBeNull();
    expect(moduleAnalyticsOf({ ...answer, paths: [] })).toBeNull();
    expect(moduleAnalyticsOf({ code: "not-connected" })).toBeNull();
    expect(
      indexContentViews([{ path: "not a path", rendered: 1, viewed: 1 }]).byKey
        .size,
    ).toBe(0);
  });

  test("what the badge and its tooltip say", () => {
    expect(
      [980, 1_234, 34_567, 1_250_000, 12_000_000].map(compactNumber),
    ).toEqual(["980", "1.2k", "35k", "1.3M", "12M"]);
    const range = { from: "2026-09-27", to: "2026-10-26" };
    expect(rangeText(range, "2026-10-26")).toBe("the last 30 days");
    expect(rangeText(range, "2026-10-27")).toBe("27 Sept – 26 Oct");
    expect(
      viewsText({ rendered: 2_000, viewed: 1_234 }, range, "2026-10-26"),
    ).toBe(
      "Seen in 1,234 of the 2,000 page views it was on (62%), the last 30 days.",
    );
  });
});
