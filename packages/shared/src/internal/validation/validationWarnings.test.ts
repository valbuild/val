import { isValidationWarning } from "./validationWarnings";

describe("isValidationWarning", () => {
  test("a local file still to upload is a warning", () => {
    expect(isValidationWarning({ fixes: ["images:upload-remote"] })).toBe(true);
    expect(isValidationWarning({ fixes: ["video:upload-remote"] })).toBe(true);
  });

  test("an error with no fixes is not", () => {
    expect(isValidationWarning({})).toBe(false);
    expect(isValidationWarning({ fixes: [] })).toBe(false);
  });

  test("an error tagged with any other fix as well is not", () => {
    expect(
      isValidationWarning({
        fixes: ["image:upload-remote", "image:check-metadata"],
      }),
    ).toBe(false);
    expect(isValidationWarning({ fixes: ["image:download-remote"] })).toBe(
      false,
    );
  });
});
