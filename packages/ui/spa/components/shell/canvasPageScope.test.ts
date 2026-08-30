import { ModuleFilePath, SourcePath } from "@valbuild/core";
import {
  canvasModulesFromKey,
  canvasModulesKey,
  canvasShowsEditedContent,
} from "./canvasPageScope";

/**
 * When the canvas closes itself.
 *
 * The rule it replaces was "the selection is a page, or the canvas closes", and
 * the case it got wrong is the one the canvas exists for: clicking an element on
 * the page it is showing. Most content on a real page lives outside the page's
 * own route module, so picking a footer or an author's name resolved to a data
 * module — not a page — and shut the canvas. On a phone that is the whole
 * workspace rearranging itself in answer to a tap on some text, which is what
 * "it opens a broken page" looks like from the outside.
 */
describe("whether the canvas is still showing what is being edited", () => {
  const PAGE = "/app/page.val.ts" as ModuleFilePath;
  const AUTHORS = "/content/authors.val.ts" as ModuleFilePath;
  const SETTINGS = "/content/settings.val.ts" as ModuleFilePath;
  const onPage = canvasModulesFromKey(
    canvasModulesKey([
      `${PAGE}?p="/"."hero"."title"` as SourcePath,
      `${PAGE}?p="/"."text"` as SourcePath,
      `${AUTHORS}?p="freekh"."name"` as SourcePath,
    ]),
  );

  test("a page selection always keeps it", () => {
    expect(
      canvasShowsEditedContent({
        selectionKind: "page",
        editedPath: `${PAGE}?p="/"` as SourcePath,
        canvasModules: onPage,
      }),
    ).toBe(true);
  });

  test("keeps it for a module the page reported content from", () => {
    // The regression: an author's name is on the page, and the navigation files
    // its module under Data.
    expect(
      canvasShowsEditedContent({
        selectionKind: "data",
        editedPath: `${AUTHORS}?p="freekh"."name"` as SourcePath,
        canvasModules: onPage,
      }),
    ).toBe(true);
  });

  test("keeps it for a module with no row in the navigation at all", () => {
    expect(
      canvasShowsEditedContent({
        selectionKind: null,
        editedPath: `${AUTHORS}?p="freekh"` as SourcePath,
        canvasModules: onPage,
      }),
    ).toBe(true);
  });

  test("closes it for a module that is not on the page", () => {
    expect(
      canvasShowsEditedContent({
        selectionKind: "data",
        editedPath: `${SETTINGS}?p="siteName"` as SourcePath,
        canvasModules: onPage,
      }),
    ).toBe(false);
  });

  test("closes it where the route names nothing", () => {
    // The compare and errors views, and the empty state.
    expect(
      canvasShowsEditedContent({
        selectionKind: null,
        editedPath: null,
        canvasModules: onPage,
      }),
    ).toBe(false);
  });

  test("closes it while the page has reported nothing yet", () => {
    expect(
      canvasShowsEditedContent({
        selectionKind: "media",
        editedPath: `${AUTHORS}?p="freekh"` as SourcePath,
        canvasModules: canvasModulesFromKey(canvasModulesKey(undefined)),
      }),
    ).toBe(false);
  });

  /**
   * The key is what everything downstream is keyed on, so equal page contents
   * must produce an equal key — the page re-reports its elements whenever
   * anything on it moves, several times a second while it is being scrolled.
   */
  test("is the same key for the same modules, whatever the paths", () => {
    expect(
      canvasModulesKey([
        `${AUTHORS}?p="a"` as SourcePath,
        `${PAGE}?p="/"."b"` as SourcePath,
      ]),
    ).toBe(
      canvasModulesKey([
        `${PAGE}?p="/"."c"` as SourcePath,
        `${AUTHORS}?p="d"` as SourcePath,
        `${PAGE}?p="/"."b"` as SourcePath,
      ]),
    );
  });
});
