import path from "path";
import { Internal } from "@valbuild/core";
import { loadValModules } from "./loadValModules";

const fixtureRoot = path.join(__dirname, "..", "test", "jsonValues-fixture");

describe("loadValModules with .jsonValues() + c.json", () => {
  test("loads the module without invoking entry thunks (stays lazy)", async () => {
    const valModules = loadValModules(fixtureRoot);
    expect(valModules.modules).toHaveLength(1);

    const mod = (await valModules.modules[0].def()).default;
    const source = Internal.getSource(mod) as Record<string, unknown>;
    const entry = source["/blogs/test"] as {
      _type: string;
      _sha: string;
      _import: () => Promise<{ default: unknown }>;
    };

    // The entry is a json marker, not the loaded content.
    expect(Internal.isJson(entry)).toBe(true);
    expect(entry._type).toBe("json");
    expect(entry._sha).toBe("testsha123");
    expect(typeof entry._import).toBe("function");
  });

  test("invoking the entry thunk loads the backing *.val.json", async () => {
    const valModules = loadValModules(fixtureRoot);
    const mod = (await valModules.modules[0].def()).default;
    const source = Internal.getSource(mod) as Record<string, unknown>;
    const entry = source["/blogs/test"] as {
      _import: () => Promise<{ default: unknown }>;
    };

    const loaded = await entry._import();
    expect(loaded.default).toEqual({ title: "Hello from JSON" });
  });
});
