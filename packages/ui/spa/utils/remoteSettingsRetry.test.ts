import {
  REMOTE_SETTINGS_MAX_ATTEMPTS,
  shouldRetryRemoteSettings,
} from "./remoteSettingsRetry";

describe("shouldRetryRemoteSettings", () => {
  test("a signed-out answer is not asked again", () => {
    expect(shouldRetryRemoteSettings(401, 1)).toBe(false);
  });
  test("a project setting is not asked again", () => {
    expect(shouldRetryRemoteSettings(400, 1)).toBe(false);
  });
  test("no answer, or the server failing, is asked again", () => {
    expect(shouldRetryRemoteSettings(null, 1)).toBe(true);
    expect(shouldRetryRemoteSettings(500, 1)).toBe(true);
    expect(shouldRetryRemoteSettings(503, 1)).toBe(true);
  });
  test("until the attempts run out", () => {
    expect(
      shouldRetryRemoteSettings(500, REMOTE_SETTINGS_MAX_ATTEMPTS - 1),
    ).toBe(true);
    expect(shouldRetryRemoteSettings(500, REMOTE_SETTINGS_MAX_ATTEMPTS)).toBe(
      false,
    );
  });
});
