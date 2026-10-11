import { randomProposalName } from "./proposalNames";

describe("randomProposalName", () => {
  test("is two words, the first capitalised", () => {
    for (let i = 0; i < 50; i++) {
      expect(randomProposalName()).toMatch(/^[A-Z][a-z]+ [a-z]+$/);
    }
  });

  test("stays in range at both ends of the random number", () => {
    expect(randomProposalName(() => 0)).toBe("Amber bay");
    expect(randomProposalName(() => 0.9999999)).toBe("Wide willow");
    // `Math.random` never returns 1, but a caller's own source might.
    expect(randomProposalName(() => 1)).toBe("Wide willow");
  });
});
