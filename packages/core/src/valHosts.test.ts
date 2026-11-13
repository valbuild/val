import { DEFAULT_VAL_REMOTE_HOST } from "./schema/remote";
import { DEFAULT_APP_HOST, DEFAULT_CONTENT_HOST, valHostsOf } from "./valHosts";

describe("valHostsOf", () => {
  test("nothing set is val.build", () => {
    expect(valHostsOf({})).toEqual({
      content: DEFAULT_CONTENT_HOST,
      remote: DEFAULT_VAL_REMOTE_HOST,
      admin: DEFAULT_APP_HOST,
    });
    expect(valHostsOf(undefined)).toEqual(valHostsOf({}));
  });

  test("VAL_HOST names a self-hosted engine, which serves all three", () => {
    expect(valHostsOf({ VAL_HOST: "https://val.acme.com/" })).toEqual({
      content: "https://val.acme.com",
      remote: "https://val.acme.com",
      admin: "https://val.acme.com",
    });
  });

  test("each host's own variable still wins, with VAL_HOST or without", () => {
    expect(
      valHostsOf({
        VAL_HOST: "https://val.acme.com",
        VAL_CONTENT_URL: "http://localhost:4000/",
        VAL_REMOTE_HOST: "https://files.acme.com",
        VAL_BUILD_URL: "http://localhost:3000",
      }),
    ).toEqual({
      content: "http://localhost:4000",
      remote: "https://files.acme.com",
      admin: "http://localhost:3000",
    });
    expect(valHostsOf({ VAL_CONTENT_URL: "http://localhost:4000" })).toEqual({
      content: "http://localhost:4000",
      remote: DEFAULT_VAL_REMOTE_HOST,
      admin: DEFAULT_APP_HOST,
    });
  });

  test("an empty variable is unset, as CI sends a missing secret", () => {
    expect(valHostsOf({ VAL_HOST: "", VAL_CONTENT_URL: " " })).toEqual(
      valHostsOf({}),
    );
  });
});
