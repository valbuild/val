import { initVal, ModuleFilePath } from "@valbuild/core";
import { validateJsonValuesEntries } from "./validateJsonValues";

const { s, c } = initVal();
const modulePath = "/blogs.val.ts" as ModuleFilePath;

describe("validateJsonValuesEntries", () => {
  const schema = s.record(s.object({ title: s.string() })).jsonValues();

  test("returns no errors when all entry content is valid", async () => {
    const source = {
      "/a": c.json(
        () => Promise.resolve({ default: { title: "ok" } }),
        "sha-a",
      ),
      "/b": c.json(
        () => Promise.resolve({ default: { title: "ok2" } }),
        "sha-b",
      ),
    };
    const errors = await validateJsonValuesEntries(schema, source, modulePath);
    expect(errors).toEqual({});
  });

  test("reports validation errors for invalid entry content", async () => {
    const source = {
      "/a": c.json(
        () => Promise.resolve({ default: { title: "ok" } }),
        "sha-a",
      ),
      // wrong leaf type for title — caught by the deferred content validation
      "/bad": c.json(
        () => Promise.resolve({ default: { title: 123 } }),
        "sha-bad",
      ),
    };
    const errors = await validateJsonValuesEntries(schema, source, modulePath);
    const keys = Object.keys(errors);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((k) => k.includes("/bad"))).toBe(true);
  });

  test("reports a load error when the entry thunk rejects", async () => {
    const source = {
      "/boom": c.json(() => Promise.reject(new Error("disk gone")), "sha-boom"),
    };
    const errors = await validateJsonValuesEntries(schema, source, modulePath);
    const keys = Object.keys(errors);
    expect(keys.length).toBe(1);
    expect(errors[keys[0] as keyof typeof errors][0].message).toContain(
      "Could not load JSON entry",
    );
  });

  test("skips non-jsonValues records (no content loading)", async () => {
    const plainSchema = s.record(s.object({ title: s.string() }));
    let loaded = false;
    const source = {
      "/a": c.json(() => {
        loaded = true;
        return Promise.resolve({ default: { title: "ok" } });
      }, "sha-a"),
    };
    const errors = await validateJsonValuesEntries(
      plainSchema,
      source,
      modulePath,
    );
    expect(errors).toEqual({});
    expect(loaded).toBe(false);
  });
});
