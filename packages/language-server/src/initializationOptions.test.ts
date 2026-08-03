import type { InitializeParams } from "vscode-languageserver/node";
import { applyEnvOverrides, parseInitializationOptions } from "./server";
import { PROTOCOL_VERSION, type ValInitializationOptions } from "./protocol";

function params(overrides: Partial<InitializeParams> = {}): InitializeParams {
  return {
    processId: null,
    rootUri: null,
    capabilities: {},
    workspaceFolders: null,
    ...overrides,
  } as InitializeParams;
}

describe("parseInitializationOptions", () => {
  test("reads the options a Val-aware client sends", () => {
    const options: ValInitializationOptions = {
      client: { name: "vscode-val-build", version: "2.0.0" },
      supportedProtocolVersions: { min: 1, max: PROTOCOL_VERSION },
      valRoot: "/work/my-site",
      env: { VAL_CONTENT_URL: "https://content.example.test" },
    };
    expect(
      parseInitializationOptions(params({ initializationOptions: options })),
    ).toEqual(options);
  });

  test("falls back to the first workspace folder when valRoot is absent", () => {
    const result = parseInitializationOptions(
      params({
        workspaceFolders: [
          { uri: "file:///work/my-site", name: "my-site" },
          { uri: "file:///work/other", name: "other" },
        ],
      }),
    );
    expect(result.valRoot).toBe("/work/my-site");
  });

  test("falls back to rootPath, then cwd", () => {
    expect(
      parseInitializationOptions(params({ rootPath: "/work/legacy" })).valRoot,
    ).toBe("/work/legacy");
    expect(parseInitializationOptions(params()).valRoot).toBe(process.cwd());
  });

  test("assumes the narrowest protocol range for a client that sends none", () => {
    // A bare LSP client (a hand-written Neovim config, say) knows nothing about
    // our handshake. Assuming v1 keeps it working rather than failing to start.
    expect(
      parseInitializationOptions(params()).supportedProtocolVersions,
    ).toEqual({
      min: 1,
      max: 1,
    });
  });

  test("uses clientInfo when the client sends no client field", () => {
    const result = parseInitializationOptions(
      params({ clientInfo: { name: "Neovim", version: "0.11.0" } }),
    );
    expect(result.client).toEqual({ name: "Neovim", version: "0.11.0" });
  });

  test("reports an unknown client rather than throwing", () => {
    expect(parseInitializationOptions(params()).client).toEqual({
      name: "unknown",
      version: null,
    });
  });
});

describe("applyEnvOverrides", () => {
  const KEYS = ["VAL_CONTENT_URL", "VAL_REMOTE_HOST", "VAL_BUILD_URL"] as const;
  let original: Record<string, string | undefined>;

  beforeEach(() => {
    original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  });

  function options(
    env: ValInitializationOptions["env"],
  ): ValInitializationOptions {
    return {
      client: { name: "test", version: null },
      supportedProtocolVersions: { min: 1, max: PROTOCOL_VERSION },
      valRoot: "/tmp/x",
      env,
    };
  }

  test("forwards VAL_* overrides into the environment", () => {
    applyEnvOverrides(
      options({
        VAL_CONTENT_URL: "https://content.example.test",
        VAL_REMOTE_HOST: "https://remote.example.test",
      }),
    );
    expect(process.env.VAL_CONTENT_URL).toBe("https://content.example.test");
    expect(process.env.VAL_REMOTE_HOST).toBe("https://remote.example.test");
  });

  test("leaves the environment alone when no overrides are sent", () => {
    process.env.VAL_CONTENT_URL = "https://preexisting.example.test";
    applyEnvOverrides(options(undefined));
    expect(process.env.VAL_CONTENT_URL).toBe(
      "https://preexisting.example.test",
    );
  });

  test("ignores empty values instead of blanking the environment", () => {
    process.env.VAL_BUILD_URL = "https://preexisting.example.test";
    applyEnvOverrides(options({ VAL_BUILD_URL: "" }));
    expect(process.env.VAL_BUILD_URL).toBe("https://preexisting.example.test");
  });
});
