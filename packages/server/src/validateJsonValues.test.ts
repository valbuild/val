import { initVal, ModuleFilePath, RecordSchema } from "@valbuild/core";
import { validateJsonValuesEntries } from "./validateJsonValues";

const { s, c } = initVal();
const modulePath = "/blogs.val.ts" as ModuleFilePath;

/**
 * The same schema as a SECOND copy of `@valbuild/core` would hand it over: same
 * own fields, same methods, a prototype chain rebuilt from fresh objects so no
 * constructor identity survives.
 *
 * This is what `npx @valbuild/cli` / `pnpm dlx` actually produce. The project's
 * `*.val.ts` are evaluated by `loadValModules` with a `require` rooted at the
 * project, so the schemas come from the project's `@valbuild/core`, while the
 * tool runs its own copy from the temporary install.
 */
function fromAnotherRealm<T extends object>(value: T): T {
  const chain: object[] = [];
  for (
    let proto = Object.getPrototypeOf(value);
    proto && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto)
  ) {
    chain.push(proto);
  }
  let rebuilt: object = Object.prototype;
  for (const proto of chain.reverse()) {
    rebuilt = Object.create(rebuilt, Object.getOwnPropertyDescriptors(proto));
  }
  // `Object.create` is typed `any`, so this needs no assertion.
  const copy: T = Object.create(
    rebuilt,
    Object.getOwnPropertyDescriptors(value),
  );
  return copy;
}

describe("validateJsonValuesEntries", () => {
  const schema = s.record(s.object({ title: s.string() })).jsonValues();

  test("returns no errors when all entry content is valid", async () => {
    const source = {
      "/a": c.json(() => Promise.resolve({ default: { title: "ok" } })),
      "/b": c.json(() => Promise.resolve({ default: { title: "ok2" } })),
    };
    const { errors } = await validateJsonValuesEntries(
      schema,
      source,
      modulePath,
    );
    expect(errors).toEqual({});
  });

  test("reports validation errors for invalid entry content", async () => {
    const source = {
      "/a": c.json(() => Promise.resolve({ default: { title: "ok" } })),
      // wrong leaf type for title — caught by the deferred content validation
      "/bad": c.json(() => Promise.resolve({ default: { title: 123 } })),
    };
    const { errors } = await validateJsonValuesEntries(
      schema,
      source,
      modulePath,
    );
    const keys = Object.keys(errors);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((k) => k.includes("/bad"))).toBe(true);
  });

  test("reports a load error when the entry thunk rejects", async () => {
    const source = {
      "/boom": c.json(() => Promise.reject(new Error("disk gone"))),
    };
    const { errors } = await validateJsonValuesEntries(
      schema,
      source,
      modulePath,
    );
    const keys = Object.keys(errors);
    expect(keys.length).toBe(1);
    expect(errors[keys[0] as keyof typeof errors][0].message).toContain(
      "Could not load JSON entry",
    );
  });

  test("reports an entry written inline in the .val.ts as fixable", async () => {
    const source = {
      "/a": c.json(() => Promise.resolve({ default: { title: "ok" } })),
      // hand-authored inline instead of c.json(() => import(...))
      "/inline": { title: "legal shape, wrong place" },
    };
    const { errors } = await validateJsonValuesEntries(
      schema,
      source,
      modulePath,
    );
    const keys = Object.keys(errors);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain("/inline");
    const [error] = errors[keys[0] as keyof typeof errors];
    expect(error.fixes).toEqual(["jsonValues:extract-entry"]);
    expect(error.message).toContain("written inline");
  });

  // A record from a second copy of `@valbuild/core`. `instanceof RecordSchema`
  // is false for it, and the guard that used to ask that question failed OPEN —
  // `npx @valbuild/cli validate` reported a module with entries written inline
  // as VALID, applied no fix, and a CI gate on it went green.
  describe("a record built by another copy of @valbuild/core", () => {
    const foreign = fromAnotherRealm(schema);

    test("the fixture really is foreign", () => {
      expect(schema instanceof RecordSchema).toBe(true);
      expect(foreign instanceof RecordSchema).toBe(false);
      // ...and identical in every way the check actually depends on.
      expect(foreign.constructor.name).toBe("RecordSchema");
      expect(foreign["executeSerialize"]()).toEqual(
        schema["executeSerialize"](),
      );
    });

    test("still reports an entry written inline as fixable", async () => {
      const source = {
        "/a": c.json(() => Promise.resolve({ default: { title: "ok" } })),
        "/inline": { title: "legal shape, wrong place" },
      };
      const { errors } = await validateJsonValuesEntries(
        foreign,
        source,
        modulePath,
      );
      const keys = Object.keys(errors);
      expect(keys).toHaveLength(1);
      expect(keys[0]).toContain("/inline");
      expect(errors[keys[0] as keyof typeof errors][0].fixes).toEqual([
        "jsonValues:extract-entry",
      ]);
    });

    test("still validates loaded entry content", async () => {
      const source = {
        "/bad": c.json(() => Promise.resolve({ default: { title: 123 } })),
      };
      const { errors } = await validateJsonValuesEntries(
        foreign,
        source,
        modulePath,
      );
      expect(Object.keys(errors).some((k) => k.includes("/bad"))).toBe(true);
    });

    test("a foreign NON-jsonValues record is still skipped", async () => {
      const foreignPlain = fromAnotherRealm(
        s.record(s.object({ title: s.string() })),
      );
      let loaded = false;
      const source = {
        "/a": c.json(() => {
          loaded = true;
          return Promise.resolve({ default: { title: "ok" } });
        }),
      };
      const { errors } = await validateJsonValuesEntries(
        foreignPlain,
        source,
        modulePath,
      );
      expect(errors).toEqual({});
      expect(loaded).toBe(false);
    });
  });

  test("skips non-jsonValues records (no content loading)", async () => {
    const plainSchema = s.record(s.object({ title: s.string() }));
    let loaded = false;
    const source = {
      "/a": c.json(() => {
        loaded = true;
        return Promise.resolve({ default: { title: "ok" } });
      }),
    };
    const { errors } = await validateJsonValuesEntries(
      plainSchema,
      source,
      modulePath,
    );
    expect(errors).toEqual({});
    expect(loaded).toBe(false);
  });

  test("ROOT-ONLY contract: a nested jsonValues record is not visited", async () => {
    // Pins the documented limitation. Nested `.jsonValues()` records are
    // rejected up front as module errors (findNestedJsonValuesRecords), so they
    // never reach here — but if that guard is relaxed without making this a
    // recursive visitor, nested entries silently get NO content validation.
    const nestedSchema = s.object({
      pages: s.record(s.object({ title: s.string() })).jsonValues(),
    });
    let loaded = false;
    const source = {
      pages: {
        // invalid content: would be an error if it were visited
        "/a": c.json(() => {
          loaded = true;
          return Promise.resolve({ default: { title: 123 } });
        }),
      },
    };
    const { errors } = await validateJsonValuesEntries(
      nestedSchema,
      source,
      modulePath,
    );
    expect(errors).toEqual({});
    expect(loaded).toBe(false);
  });
});
