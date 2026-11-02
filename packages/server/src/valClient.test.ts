import { initVal, modules } from "@valbuild/core";
import { VAL_CLIENT_HEADER } from "@valbuild/shared/internal";
import { ValOpsHttp } from "./ValOpsHttp";
import { getSettings } from "./getSettings";
import { VERSION } from "./version";

/**
 * Every request to Val Build says which `@valbuild/server` sent it.
 *
 * Without that Val Build cannot tell which versions are still out there, and
 * so cannot tell whether an old endpoint is still called by anyone. These pin
 * the two helpers most requests are built from; the header itself is spread in
 * from `VAL_CLIENT_HEADERS` at every call site.
 */

const EXPECTED = `@valbuild/server@${VERSION}`;

function headerOf(init: RequestInit | undefined): string | null {
  return new Headers(init?.headers).get(VAL_CLIENT_HEADER);
}

let fetchSpy: jest.SpiedFunction<typeof fetch>;

beforeEach(() => {
  fetchSpy = jest
    .spyOn(global, "fetch")
    .mockImplementation(async () =>
      Response.json({ patches: [], commits: [] }),
    );
});

afterEach(() => {
  fetchSpy.mockRestore();
});

test("the value names the package and its version", () => {
  expect(EXPECTED).toMatch(/^@valbuild\/server@\d+\.\d+\.\d+/);
});

test("ValOpsHttp sends it, beside the credential", async () => {
  const { config } = initVal();
  const ops = new ValOpsHttp(
    "https://content.example",
    "acme/site",
    { commit: "commit-sha", branch: "main" },
    { apiKey: "key" },
    modules(config, []),
  );
  await ops.fetchPatches({ excludePatchOps: true });
  expect(fetchSpy).toHaveBeenCalled();
  for (const [, init] of fetchSpy.mock.calls) {
    expect(headerOf(init)).toBe(EXPECTED);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer key");
  }
});

test("getSettings sends it, with a PAT as with an api key", async () => {
  await getSettings("acme/site", { pat: "pat" }, "https://content.example");
  await getSettings("acme/site", { apiKey: "key" }, "https://content.example");
  expect(fetchSpy).toHaveBeenCalledTimes(2);
  for (const [, init] of fetchSpy.mock.calls) {
    expect(headerOf(init)).toBe(EXPECTED);
  }
});
