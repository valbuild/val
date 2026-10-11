import { followCarryOver } from "./carryOver";
import type { ProposalJson } from "./proposalsClient";

const NAME = "0123456789abcdef0123";

const proposal = (overrides: Partial<ProposalJson>): ProposalJson => ({
  name: NAME,
  branch: `val/p/${NAME}`,
  displayName: "Spring",
  status: "merged",
  updatedAt: "2026-10-07T12:00:00.000Z",
  ...overrides,
});

test("after the merge, follows the carry-over to the proposal the later changes went to", async () => {
  const answers = [
    proposal({ carriedOver: false }),
    proposal({ carriedOver: true, continuedIn: "next" }),
  ];
  const asked: string[] = [];
  const carried = await followCarryOver({
    name: NAME,
    get: async (name) => {
      asked.push(name);
      return name === "next"
        ? proposal({
            name: "next",
            displayName: "Spring (2)",
            status: "open",
            changes: 3,
          })
        : answers.shift()!;
    },
    wait: async () => {},
  });
  expect(carried).toEqual({
    kind: "continued",
    proposal: expect.objectContaining({
      displayName: "Spring (2)",
      changes: 3,
    }),
  });
  expect(asked).toEqual([NAME, NAME, "next"]);
});

test("a merge with nothing written during it is finished, and an older content service says nothing", async () => {
  expect(
    await followCarryOver({
      name: NAME,
      get: async () => proposal({ carriedOver: true, continuedIn: null }),
    }),
  ).toEqual({ kind: "finished" });
  expect(
    await followCarryOver({ name: NAME, get: async () => proposal({}) }),
  ).toEqual({ kind: "unknown" });
});
