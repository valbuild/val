import { proposalChangesLabel } from "./ProposalSwitcher";

/*
 * What a list or a heading says a proposal holds. An upgrade stages
 * dependencies, never content, so its count is always 0: it says what it is.
 */
test("a proposal says how many changes it holds", () => {
  expect(proposalChangesLabel({ changes: 1 })).toBe("1 change");
  expect(proposalChangesLabel({ changes: 3 })).toBe("3 changes");
});

test("an upgrade says it is one, rather than 0 changes", () => {
  expect(proposalChangesLabel({ changes: 0, upgrade: true })).toBe("Upgrade");
});
