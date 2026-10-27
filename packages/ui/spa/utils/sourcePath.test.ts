import {
  Internal,
  ModuleFilePath,
  ModulePath,
  SourcePath,
} from "@valbuild/core";
import { concatModulePath, sourcePathOfChild } from "./sourcePath";

const MODULE = "/content/media.val.ts" as ModuleFilePath;

/**
 * How a child's source path is built.
 *
 * The rule is the module-path grammar: a string segment is JSON-quoted, an array
 * index is bare. It had five hand-rolled implementations, and the two that got
 * the module root wrong were wrong invisibly — an unquoted key parses as one
 * segment right up until the key contains a `.`, which is every key in a media
 * gallery and almost no key anywhere else.
 *
 * So the assertions worth having are the round trip (whatever is built has to
 * split back into the segment that went in) and the dotted key specifically.
 */
describe("sourcePathOfChild", () => {
  test("quotes a string key at the module root", () => {
    expect(sourcePathOfChild(MODULE, "title")).toBe(
      '/content/media.val.ts?p="title"',
    );
  });

  test("quotes a string key below the root", () => {
    expect(
      sourcePathOfChild(
        '/content/media.val.ts?p="hero"' as SourcePath,
        "title",
      ),
    ).toBe('/content/media.val.ts?p="hero"."title"');
  });

  test("leaves an array index bare", () => {
    // Bare on purpose: a quoted index is a different path, and nothing that
    // navigates to one can resolve it.
    expect(
      sourcePathOfChild('/content/page.val.ts?p="items"' as SourcePath, 0),
    ).toBe('/content/page.val.ts?p="items".0');
  });

  test("a key with a dot in it survives the round trip", () => {
    // The regression. Unquoted, `splitModulePath` reads this as the two segments
    // `/public/val/red-8x8_bfbd0` and `png`, and the module is not found.
    const ref = "/public/val/red-8x8_bfbd0.png";
    const path = sourcePathOfChild(MODULE, ref);
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(path);
    expect(moduleFilePath).toBe(MODULE);
    expect(Internal.splitModulePath(modulePath)).toEqual([ref]);
  });

  test("a key with a quote in it survives the round trip", () => {
    const key = 'a "quoted" key';
    const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
      sourcePathOfChild(MODULE, key),
    );
    expect(Internal.splitModulePath(modulePath)).toEqual([key]);
  });

  test("a parent that already ends in the separator takes the key directly", () => {
    // The search index walks from `moduleFilePath + "?p="`, so that every path
    // it produces has a module path. Joining with a `.` there gives `?p=."title"`.
    expect(
      sourcePathOfChild("/content/media.val.ts?p=" as SourcePath, "title"),
    ).toBe('/content/media.val.ts?p="title"');
  });
});

describe("concatModulePath", () => {
  test("an empty module path means the key is the first segment", () => {
    expect(concatModulePath(MODULE, "" as ModulePath, "title")).toBe(
      '/content/media.val.ts?p="title"',
    );
  });

  test("a non-empty module path is extended", () => {
    expect(concatModulePath(MODULE, '"hero"' as ModulePath, "title")).toBe(
      '/content/media.val.ts?p="hero"."title"',
    );
  });

  test("agrees with sourcePathOfChild at the root", () => {
    const ref = "/public/val/red-8x8_bfbd0.png";
    expect(concatModulePath(MODULE, "" as ModulePath, ref)).toBe(
      sourcePathOfChild(MODULE, ref),
    );
  });
});
