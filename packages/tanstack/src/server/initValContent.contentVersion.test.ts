import type { ModuleFilePath } from "@valbuild/core";
import type { ValContentVersion, ValProposal } from "@valbuild/server";
import {
  CONTENT_APPLIED_GLOBAL,
  draftBase,
  markContentApplied,
  snapshotForReaders,
} from "./initValContent";

/**
 * A content version: the site's content, served by a build that bundles an
 * older one (valbuild/home `docs/hosted-publishing.md`, step 2). The readers
 * render from it the way they render a proposal's saved content: as the
 * snapshot over the bundle.
 */

const PAGE = "/app/page.val.ts" as ModuleFilePath;

const version: ValContentVersion = {
  id: "e".repeat(64),
  job: "J-7",
  commit: "c7",
  modules: { [PAGE]: { title: "Published since the build" } },
  files: {},
};

const proposal: ValProposal = {
  name: "0123456789abcdef0123",
  branch: "val/p/0123456789abcdef0123",
  commit: "save-1",
  modules: { [PAGE]: { title: "Saved in the proposal" } },
  files: {},
};

describe("what the readers render over the bundle", () => {
  test("a content version's Source, for what it holds", () => {
    expect(snapshotForReaders({ contentVersion: version })).toEqual({
      [PAGE]: { title: "Published since the build" },
    });
  });

  test("at a proposal's address, the proposal's saves over the version", () => {
    const FOOTER = "/app/footer.val.ts" as ModuleFilePath;
    expect(
      snapshotForReaders({
        proposal,
        contentVersion: {
          ...version,
          modules: { ...version.modules, [FOOTER]: { text: "Published" } },
        },
      }),
    ).toEqual({
      [PAGE]: { title: "Saved in the proposal" },
      [FOOTER]: { text: "Published" },
    });
  });

  test("nothing, when the platform hands over neither", () => {
    expect(snapshotForReaders({})).toBeUndefined();
    expect(snapshotForReaders(undefined)).toBeUndefined();
  });
});

describe("saying the version was applied", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, CONTENT_APPLIED_GLOBAL);
  });

  test("names the version on the isolate, for the platform to read back", () => {
    markContentApplied({ contentVersion: version });
    expect(Reflect.get(globalThis, CONTENT_APPLIED_GLOBAL)).toBe(version.id);
  });

  test("at a proposal's address too, where the version is under the proposal's saves", () => {
    markContentApplied({ proposal, contentVersion: version });
    expect(Reflect.get(globalThis, CONTENT_APPLIED_GLOBAL)).toBe(version.id);
  });

  test("not when there is no version", () => {
    markContentApplied({ proposal });
    expect(Reflect.get(globalThis, CONTENT_APPLIED_GLOBAL)).toBeUndefined();
  });
});

/*
 * What the Studio's overlay starts from on a draft page (`ValDraft.base`): the
 * layers the server's own draft starts from, as the server stores them. After
 * a content-only publish the bundle holds the text from before it, so an
 * overlay that started from the bundle put that text back on the page.
 */
describe("the base a draft page hands the Studio's overlay", () => {
  test("a content version's Source, for what it holds", () => {
    expect(draftBase({ contentVersion: version })).toEqual({
      [PAGE]: { title: "Published since the build" },
    });
  });

  test("at a proposal's address, the proposal's saves over the version", () => {
    expect(draftBase({ proposal, contentVersion: version })).toEqual({
      [PAGE]: { title: "Saved in the proposal" },
    });
  });

  test("nothing, when the page serves the bundle's own content", () => {
    expect(draftBase({})).toBeUndefined();
    expect(draftBase(undefined)).toBeUndefined();
  });
});
