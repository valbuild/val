import type { ModuleFilePath } from "@valbuild/core";
import { isLiveSitePage, type ValDraft } from "./ValDraft";

const MODULE = "/content/home.val.ts" as ModuleFilePath;
const snapshot = { [MODULE]: { title: "published without a build" } };

/**
 * Content analytics counts the live site as a visitor gets it, and nothing
 * else: `ValProvider` starts the script only for such a page.
 */
describe("a page of the live site, as content analytics counts it", () => {
  test("is a page with no draft", () => {
    expect(isLiveSitePage(null)).toBe(true);
    expect(isLiveSitePage(undefined)).toBe(true);
  });

  test("is a page of a site serving a content version, which comes as a snapshot", () => {
    // Read as a proposal's once, which counted no visitor of any site that
    // had published content without a build.
    const draft: ValDraft = { sources: {}, snapshot, draftMode: false };
    expect(isLiveSitePage(draft)).toBe(true);
  });

  test("is not a draft mode render, which is an editor's", () => {
    expect(isLiveSitePage({ sources: {} })).toBe(false);
    expect(isLiveSitePage({ sources: {}, snapshot })).toBe(false);
  });

  test("is not a proposal's address, draft mode or not", () => {
    expect(
      isLiveSitePage({
        sources: {},
        snapshot,
        draftMode: false,
        atProposal: true,
      }),
    ).toBe(false);
    expect(isLiveSitePage({ sources: {}, snapshot, atProposal: true })).toBe(
      false,
    );
  });
});
