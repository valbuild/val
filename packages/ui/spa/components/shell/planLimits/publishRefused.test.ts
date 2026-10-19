import { parseStudioAccess, publishRefused } from "./studioAccess";
import { studioAccessBody, type AccessFixture } from "./fixtures/planFixtures";

/**
 * Whether the Studio may publish -- and so whether it offers a site update,
 * which is a publish. Read off the same `/access` bodies the plan notices are
 * tested against.
 */
const refused = (state: AccessFixture) => {
  const access = parseStudioAccess(studioAccessBody(state, "editor"));
  if (access === null) throw new Error(`${state} did not parse`);
  return publishRefused(access);
};

describe("publishRefused", () => {
  test("allows a plan that publishes", () => {
    expect(refused("access-pro")).toBe(false);
    expect(refused("access-hosted-trial")).toBe(false);
  });

  test("refuses where the project's plan refuses a publish", () => {
    expect(refused("access-hosted-trial-publishes-used")).toBe(true);
  });

  test("refuses where the organization is read-only", () => {
    expect(refused("access-pro-payment-failed")).toBe(true);
  });
});
