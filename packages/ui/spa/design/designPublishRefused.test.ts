import { StudioPublishError } from "@valbuild/shared/publish";
import { designPublishRefused } from "./designPublishRefused";
import { proposalStudioUrl } from "./designTabUrl";

const NAME = "3f9c1e7a2b4d6c8e0a1b";
const STUDIO = proposalStudioUrl(`https://${NAME}--nordic.valstart.dev/`);

/** Content's `someone-pushed`, as a refused Publish carries it. */
const someonePushed = new StudioPublishError(
  409,
  `Ada Lovelace pushed to val/p/${NAME} (3c4d5e6).`,
  {
    statusCode: 409,
    message: "…",
    details: {
      code: "someone-pushed",
      branch: `val/p/${NAME}`,
      branchUrl: `https://github.com/acme/site/tree/val/p/${NAME}`,
      expected: "1a2b3c4",
      theirs: {
        sha: "3c4d5e6f7a8b9c0d1a2b3c4d5e6f7a8b9c0d1a2b",
        url: "https://github.com/acme/site/commit/3c4d5e6",
        message: "Fix the hero's spacing",
        author: {
          name: "Ada Lovelace",
          email: null,
          login: "ada",
          avatarUrl: null,
        },
        at: null,
      },
    },
  },
);

describe("Publish from the design tab, refused", () => {
  test("someone pushed: who and their commit, and Open the proposal -- not Try again", () => {
    const state = designPublishRefused(
      someonePushed.message,
      someonePushed,
      STUDIO,
    );
    expect(state).toEqual({
      kind: "someone-pushed-on-site",
      refused: {
        branch: `val/p/${NAME}`,
        branchUrl: `https://github.com/acme/site/tree/val/p/${NAME}`,
        who: "Ada Lovelace",
        ago: null,
        commit: {
          sha: "3c4d5e6f7a8b9c0d1a2b3c4d5e6f7a8b9c0d1a2b",
          url: "https://github.com/acme/site/commit/3c4d5e6",
          message: "Fix the hero's spacing",
        },
        during: "publish",
      },
      proposalStudio: `https://${NAME}--nordic.valstart.dev/val`,
    });
  });

  test("someone pushed, before the proposal's address is known: still no Try again", () => {
    expect(
      designPublishRefused(someonePushed.message, someonePushed, null),
    ).toMatchObject({ kind: "someone-pushed-on-site", proposalStudio: null });
  });

  test("GitHub refused the commit for good: where to see why, not Try again", () => {
    const refused = new StudioPublishError(409, "GitHub refused the push.", {
      details: {
        code: "repository-refused",
        reason: "protected",
        branchUrl: `https://github.com/acme/site/tree/val/p/${NAME}`,
      },
    });
    expect(designPublishRefused(refused.message, refused, STUDIO)).toEqual({
      kind: "failed",
      message: "GitHub refused the push.",
      seeWhy: {
        label: "Open the branch",
        url: `https://github.com/acme/site/tree/val/p/${NAME}`,
      },
    });
  });

  test("anything else is said as it is, with Try again", () => {
    expect(
      designPublishRefused(
        "fetch failed",
        new TypeError("fetch failed"),
        STUDIO,
      ),
    ).toEqual({ kind: "failed", message: "fetch failed" });
    // GitHub busy: pressing again can help.
    const busy = new StudioPublishError(502, "GitHub could not be reached.", {
      details: { code: "github-unavailable" },
    });
    expect(designPublishRefused(busy.message, busy, STUDIO)).toEqual({
      kind: "failed",
      message: "GitHub could not be reached.",
    });
  });
});
