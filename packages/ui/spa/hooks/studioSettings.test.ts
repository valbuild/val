import {
  isCommitMessageRequired,
  isTourOffered,
  readStudioSettings,
} from "./studioSettings";

describe("readStudioSettings", () => {
  test("reads both fields", () => {
    expect(
      readStudioSettings({
        studio: { tour: false, commitMessage: "required" },
      }),
    ).toEqual({ tour: false, commitMessage: "required" });
  });

  test("anything outside the enum is unset, not a guess", () => {
    expect(
      readStudioSettings({ studio: { commitMessage: "always" } }).commitMessage,
    ).toBeNull();
  });

  test("a missing section is all unset", () => {
    expect(readStudioSettings(undefined)).toEqual({
      tour: null,
      commitMessage: null,
    });
  });
});

describe("isCommitMessageRequired", () => {
  test("only an explicit 'required' asks", () => {
    expect(
      isCommitMessageRequired({ tour: null, commitMessage: "required" }),
    ).toBe(true);
    expect(
      isCommitMessageRequired({ tour: null, commitMessage: "automatic" }),
    ).toBe(false);
    expect(isCommitMessageRequired({ tour: null, commitMessage: null })).toBe(
      false,
    );
  });

  test("is independent of the tour", () => {
    expect(isTourOffered({ tour: null, commitMessage: "required" })).toBe(true);
  });
});
