import { buildOnTheirPush } from "./buildOnTheirPush";
import { ProposalsApiError, type ProposalsClient } from "./proposalsClient";

/*
 * Every way content refuses taking in a push (valbuild/home's take-push
 * contract), and what the Studio offers for each: only an action that can
 * work. The answer that succeeds is driven end to end in
 * `scenarios/src/codeMode.scenario.test.ts` (C7-C10).
 */
const NAME = "0123456789abcdef0123";
const SHA = "3c4d5e6f7a8b9c0d1a2b3c4d5e6f7a8b9c0d1a2b";

const refusing = (error: unknown): Pick<ProposalsClient, "takePush"> => ({
  takePush: async () => {
    throw error;
  },
});
const refusal = (status: number, details?: Record<string, unknown>) =>
  new ProposalsApiError(status, `Refused with ${status}.`, {
    statusCode: status,
    message: `Refused with ${status}.`,
    ...(details !== undefined ? { details } : {}),
  });

describe("buildOnTheirPush", () => {
  test("their push moved again: the newer one, to build on instead", async () => {
    const outcome = await buildOnTheirPush(
      refusing(
        refusal(409, {
          code: "someone-pushed",
          branch: `val/p/${NAME}`,
          branchUrl: `https://github.com/acme/site/tree/val/p/${NAME}`,
          expected: "1a2b3c4",
          theirs: {
            sha: "4d5e6f7a8b9c0d1a2b3c4d5e6f7a8b9c0d1a2b3c",
            url: "https://github.com/acme/site/commit/4d5e6f7",
            message: "And a footer",
            author: { name: "Ada Lovelace", login: "ada", avatarUrl: null },
            at: null,
          },
        }),
      ),
      NAME,
      SHA,
    );
    expect(outcome).toMatchObject({
      status: "someone-pushed",
      who: "Ada Lovelace",
      ago: null,
      theirs: { sha: "4d5e6f7a8b9c0d1a2b3c4d5e6f7a8b9c0d1a2b3c" },
    });
  });

  test("nothing to take in: Commit or Publish again is what goes", async () => {
    expect(
      await buildOnTheirPush(
        refusing(refusal(409, { code: "nothing-to-take", tip: null })),
        NAME,
        SHA,
      ),
    ).toEqual({ status: "nothing-to-take", message: "Refused with 409." });
  });

  test.each([
    ["the proposal is busy committing", refusal(409, { code: "committing" })],
    [
      "GitHub could not be reached",
      refusal(502, { code: "github-unavailable", reason: "ETIMEDOUT" }),
    ],
    ["content failed", refusal(500)],
    ["Val could not be reached at all", new TypeError("fetch failed")],
  ])("%s: Try again", async (_, error) => {
    expect(await buildOnTheirPush(refusing(error), NAME, SHA)).toMatchObject({
      status: "failed",
      offer: "retry",
    });
  });

  test.each([
    ["signed out", refusal(401)],
    ["a credential that names nobody", refusal(403)],
  ])("%s: Sign in", async (_, error) => {
    expect(await buildOnTheirPush(refusing(error), NAME, SHA)).toMatchObject({
      status: "failed",
      offer: "sign-in",
    });
  });

  test.each([
    ["too many files", 409, { code: "too-many-files", count: 1204 }],
    ["unreadable", 409, { code: "unreadable", reason: "too large" }],
    ["not open", 409, { code: "not-open", status: "merged" }],
    ["a plan refusal", 402, undefined],
  ])(
    "%s: nothing a press here can change, so nothing is offered",
    async (_, status, details) => {
      expect(
        await buildOnTheirPush(refusing(refusal(status, details)), NAME, SHA),
      ).toEqual({
        status: "failed",
        message: `Refused with ${status}.`,
        offer: null,
      });
    },
  );
});
