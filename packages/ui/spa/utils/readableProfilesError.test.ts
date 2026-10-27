import { readableProfilesError } from "./readableProfilesError";

/**
 * The message an editor is shown when their account will not load.
 *
 * Worth testing because the useful part is nested: the server reports its own
 * failure by quoting the upstream one, so the string that reaches the studio is
 * `Profiles failed: 404 {"statusCode":404,"message":"Project not found"}` and
 * only the last three words are actionable. Everything else here is an error
 * body in a shape the server did not promise — which, for an error body, is the
 * case that actually happens.
 */
describe("readableProfilesError", () => {
  test("unwraps the upstream message", () => {
    expect(
      readableProfilesError({
        message:
          'Profiles failed: 404 {"statusCode":404,"message":"Project not found"}',
      }),
    ).toBe("Project not found");
  });

  test("keeps a plain message as it is", () => {
    expect(readableProfilesError({ message: "Service unavailable" })).toBe(
      "Service unavailable",
    );
  });

  test("keeps a message whose brace is not JSON", () => {
    const message = "Could not reach {host}";
    expect(readableProfilesError({ message })).toBe(message);
  });

  test("keeps the outer message when the inner JSON has none", () => {
    const message = 'Profiles failed: 500 {"statusCode":500}';
    expect(readableProfilesError({ message })).toBe(message);
  });

  test("falls back when there is no message at all", () => {
    expect(readableProfilesError({ statusCode: 500 })).toBe(
      "Could not load profiles",
    );
    expect(readableProfilesError(null)).toBe("Could not load profiles");
    expect(readableProfilesError("nope")).toBe("Could not load profiles");
    expect(readableProfilesError({ message: 42 })).toBe(
      "Could not load profiles",
    );
  });
});
