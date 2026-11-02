import {
  asksForCodeMode,
  codeModeNow,
  codeModeOffMessage,
  withCodeModeParam,
  withoutCodeModeParam,
} from "./codeMode";
import { commitRefusalOf, ProposalsApiError } from "./proposalsClient";

const NOW = Date.parse("2026-11-02T10:10:00.000Z");
const names = (id: string) => (id === "profile-kari" ? "Kari Nordmann" : null);

describe("codeModeNow", () => {
  test("on is on", () => {
    expect(
      codeModeNow(
        {
          codeMode: {
            on: true,
            changedBy: "profile-kari",
            changedAt: "2026-11-02T10:00:00.000Z",
          },
        },
        names,
        NOW,
      ),
    ).toEqual({ on: true });
  });

  test("off says who turned it off, and when", () => {
    const off = codeModeNow(
      {
        codeMode: {
          on: false,
          changedBy: "profile-kari",
          changedAt: "2026-11-02T10:00:00.000Z",
        },
      },
      names,
      NOW,
    );
    expect(off).toEqual({
      on: false,
      by: "Kari Nordmann",
      ago: "10 minutes ago",
    });
    if (off.on) throw new Error("on");
    expect(codeModeOffMessage(off)).toMatch(
      /^Code mode is off in this proposal: Kari Nordmann turned it off 10 minutes ago/,
    );
  });

  test("content older than code mode reads as never turned on", () => {
    const off = codeModeNow({}, names, NOW);
    expect(off).toEqual({ on: false, by: null, ago: null });
    if (off.on) throw new Error("on");
    expect(codeModeOffMessage(off)).toMatch(
      /^Code mode is not on in this proposal/,
    );
  });
});

describe("the code mode parameter", () => {
  test("goes on, is read, and comes off, leaving the rest of the address", () => {
    const at = withCodeModeParam("https://p.example.com/val/~/home?session=s1");
    expect(asksForCodeMode(at)).toBe(true);
    expect(withoutCodeModeParam(at)).toBe(
      "https://p.example.com/val/~/home?session=s1",
    );
    expect(asksForCodeMode("https://p.example.com/val")).toBe(false);
  });
});

/*
 * What home answers a refused Commit (valbuild/home `content/src/val/
 * proposalGit.ts`, `commitRefusal`): the Studio branches on `details.code`.
 */
describe("commitRefusalOf", () => {
  test("someone pushed: who, and their commit", () => {
    const refusal = commitRefusalOf(
      new ProposalsApiError(
        409,
        "Ada Lovelace pushed to val/p/0123456789abcdef0123 (3c4d5e6) at 2026-11-02 14:03 UTC. Val does not commit over a push it has not seen.",
        {
          statusCode: 409,
          message: "…",
          details: {
            code: "someone-pushed",
            branch: "val/p/0123456789abcdef0123",
            branchUrl:
              "https://github.com/acme/site/tree/val/p/0123456789abcdef0123",
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
              at: "2026-11-02T14:03:00.000Z",
            },
          },
        },
      ),
    );
    expect(refusal?.kind).toBe("someone-pushed");
    if (refusal?.kind !== "someone-pushed") throw new Error("not parsed");
    expect(refusal.pushed.theirs.author?.name).toBe("Ada Lovelace");
  });

  test("GitHub refusing for good links the branch; an unknown repository links nothing", () => {
    const refused = (branchUrl: string) =>
      commitRefusalOf(
        new ProposalsApiError(409, "GitHub refused the push.", {
          details: {
            code: "repository-refused",
            reason: "protected",
            branchUrl,
          },
        }),
      );
    expect(refused("https://github.com/acme/site/tree/x")).toMatchObject({
      kind: "repository-refused",
      branchUrl: "https://github.com/acme/site/tree/x",
    });
    expect(refused("")).toMatchObject({ branchUrl: null });
  });

  test("an answer that is not a refused commit is none", () => {
    expect(commitRefusalOf(new Error("fetch failed"))).toBeNull();
    expect(
      commitRefusalOf(new ProposalsApiError(500, "Oops", undefined)),
    ).toBeNull();
  });
});
