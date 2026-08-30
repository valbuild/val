import {
  CTX,
  ITEMS_PATH,
  PAGES_PATH,
  callErr,
  callOk,
  setup,
} from "./toolsFixture";

/**
 * What the read-only tools do, seen through the registry's `call`.
 *
 * The project they read is in `toolsFixture.ts`, shared with the write suite.
 */

/**
 * The seven read-only tools, which are what this suite is about.
 *
 * Asserted as a subset rather than as the whole registry: `createValTools` also
 * registers the write tools, and pinning a total here would make this suite fail
 * every time one is added — which is a fact about the registry's size, not about
 * whether the read tools still work.
 */
const READ_TOOL_NAMES = [
  "count_entries",
  "get_all_schema",
  "get_patches",
  "get_record_keys",
  "get_source",
  "get_source_path_from_route",
  "validate_content",
];

describe("the tool registry's catalogue", () => {
  test("lists all seven read tools, described, and flagged read-only", () => {
    const { tools } = setup();
    const definitions = tools.list();

    for (const definition of definitions) {
      // A host shows this to a model, which is the only thing that decides
      // whether the tool gets called at all.
      expect(definition.description.length).toBeGreaterThan(0);
    }

    const byName = new Map(definitions.map((d) => [d.name, d]));
    for (const name of READ_TOOL_NAMES) {
      const definition = byName.get(name);
      if (!definition) {
        throw new Error(`Tool ${name} is not registered`);
      }
      // Honest annotation: none of these write, and a host may auto-approve on
      // the strength of that.
      expect(definition.annotations?.readOnlyHint).toBe(true);
      expect(definition.annotations?.destructiveHint).not.toBe(true);
    }
  });

  test("listJsonSchema gives JSON Schema, with no zod leaking through", () => {
    const { tools } = setup();
    const definitions = tools.listJsonSchema();

    expect(definitions.map((d) => d.name)).toEqual(
      expect.arrayContaining(READ_TOOL_NAMES),
    );
    for (const definition of definitions) {
      expect(definition.inputSchema).toMatchObject({ type: "object" });
      // The point of the JSON variant: it survives a trip over a wire.
      expect(JSON.parse(JSON.stringify(definition))).toEqual(definition);
    }

    // The schemas describe the arguments the tools actually take.
    const byName = new Map(definitions.map((d) => [d.name, d.inputSchema]));
    expect(byName.get("get_source")).toMatchObject({
      properties: { moduleFilePath: { type: "string" } },
      required: ["moduleFilePath"],
    });
    expect(byName.get("get_all_schema")).toMatchObject({ properties: {} });
    // An argument with a default is optional on the wire, and says so.
    expect(byName.get("get_record_keys")).toMatchObject({
      properties: { path: { type: "array", items: { type: "string" } } },
      required: ["moduleFilePath"],
    });
  });
});

describe("get_all_schema", () => {
  test("returns the modules that exist", async () => {
    const { tools } = setup();
    const data = await callOk(tools, "get_all_schema", {});

    expect(Object.keys(data as Record<string, unknown>).sort()).toEqual([
      ITEMS_PATH,
      PAGES_PATH,
    ]);
    expect(data).toMatchObject({
      [PAGES_PATH]: { type: "record" },
      [ITEMS_PATH]: { type: "array" },
    });
  });
});

describe("get_source", () => {
  test("returns a module's content", async () => {
    const { tools } = setup();

    expect(
      await callOk(tools, "get_source", { moduleFilePath: PAGES_PATH }),
    ).toEqual({
      home: { title: "Home", order: 1 },
      about: { title: "About", order: 2 },
    });
    expect(
      await callOk(tools, "get_source", { moduleFilePath: ITEMS_PATH }),
    ).toEqual([{ label: "First" }, { label: "Second" }]);
  });

  test("an unknown module is not-found, and the message names the real ones", async () => {
    const { tools } = setup();
    const { code, message } = await callErr(tools, "get_source", {
      moduleFilePath: "/test/nope.val.ts",
    });

    expect(code).toBe("not-found");
    // What makes the error recoverable rather than a dead end: a model that
    // guessed the path can see the ones it could have used.
    expect(message).toContain(PAGES_PATH);
    expect(message).toContain(ITEMS_PATH);
  });
});

describe("get_record_keys", () => {
  test("lists a record's keys", async () => {
    const { tools } = setup();

    expect(
      await callOk(tools, "get_record_keys", { moduleFilePath: PAGES_PATH }),
    ).toEqual({ kind: "record", keys: ["home", "about"], total: 2 });
  });

  test("lists an object's fields", async () => {
    const { tools } = setup();

    // Records and objects both, matching the Studio tool of the same name: a
    // caller reaching for the keys of one should not have to know which it has.
    expect(
      await callOk(tools, "get_record_keys", {
        moduleFilePath: PAGES_PATH,
        path: ["home"],
      }),
    ).toEqual({ kind: "object", keys: ["title", "order"], total: 2 });
  });

  test("pages with limit and offset, and reports the unpaged total", async () => {
    const { tools } = setup();

    // `total` is what tells a short page from the end of the record.
    expect(
      await callOk(tools, "get_record_keys", {
        moduleFilePath: PAGES_PATH,
        limit: 1,
      }),
    ).toEqual({ kind: "record", keys: ["home"], total: 2 });
    expect(
      await callOk(tools, "get_record_keys", {
        moduleFilePath: PAGES_PATH,
        limit: 1,
        offset: 1,
      }),
    ).toEqual({ kind: "record", keys: ["about"], total: 2 });
  });

  test("a negative offset is rejected rather than read from the end", async () => {
    const { tools } = setup();

    // `slice(-1)` would return the LAST key while `total` implied it was the
    // first page, so this has to fail rather than clamp silently.
    expect(
      (
        await callErr(tools, "get_record_keys", {
          moduleFilePath: PAGES_PATH,
          offset: -1,
        })
      ).code,
    ).toBe("invalid-args");
  });

  test("an array is refused, and the error names the tool to use", async () => {
    const { tools } = setup();

    const onArray = await callErr(tools, "get_record_keys", {
      moduleFilePath: ITEMS_PATH,
      path: [],
    });
    expect(onArray.code).toBe("invalid-args");
    expect(onArray.message).toContain("count_entries");
  });

  test("a path that exists but holds no entries is invalid-args, not not-found", async () => {
    const { tools } = setup();

    // The distinction earns its keep here: the path is right and the type is
    // wrong, so a caller should reach for another tool rather than go looking
    // for the path again.
    const onString = await callErr(tools, "get_record_keys", {
      moduleFilePath: PAGES_PATH,
      path: ["home", "title"],
    });
    expect(onString.code).toBe("invalid-args");

    const onMissing = await callErr(tools, "get_record_keys", {
      moduleFilePath: PAGES_PATH,
      path: ["nope"],
    });
    expect(onMissing.code).toBe("not-found");
  });

  test("an unknown module is not-found", async () => {
    const { tools } = setup();
    expect(
      (
        await callErr(tools, "get_record_keys", {
          moduleFilePath: "/test/nope.val.ts",
        })
      ).code,
    ).toBe("not-found");
  });
});

describe("count_entries", () => {
  test("counts a record, an array and an object", async () => {
    const { tools } = setup();

    expect(
      await callOk(tools, "count_entries", { moduleFilePath: PAGES_PATH }),
    ).toEqual({ kind: "record", count: 2 });
    expect(
      await callOk(tools, "count_entries", { moduleFilePath: ITEMS_PATH }),
    ).toEqual({ kind: "array", count: 2 });
    // An object's fields count, and get_record_keys will list the same set —
    // the two tools agree on what an object is, so asking "how many" and then
    // "which ones" does not get a number followed by a refusal.
    expect(
      await callOk(tools, "count_entries", {
        moduleFilePath: PAGES_PATH,
        path: ["home"],
      }),
    ).toEqual({ kind: "object", count: 2 });
  });

  test("a value with nothing to count is an error", async () => {
    const { tools } = setup();

    const onString = await callErr(tools, "count_entries", {
      moduleFilePath: PAGES_PATH,
      path: ["home", "title"],
    });
    expect(onString.code).toBe("invalid-args");
    expect(onString.message).toContain("no entries to count");
  });
});

describe("validate_content", () => {
  test("clean fixture content is valid, and the result is JSON", async () => {
    const { tools } = setup();
    const res = await tools.call("validate_content", {}, CTX);

    if (res.status !== "ok") {
      throw new Error(`validate_content failed: ${res.code}: ${res.message}`);
    }
    expect(res.data).toEqual({
      valid: true,
      errors: {},
      // Always present, so a caller never has to tell absent from empty.
      unreadableModules: [],
    });
    // The whole reason the result type is `Json`: a host has to be able to put
    // it on a wire without knowing what is in it.
    expect(JSON.parse(JSON.stringify(res))).toEqual(res);
  });

  test("scoping to one module also validates", async () => {
    const { tools } = setup();

    expect(
      await callOk(tools, "validate_content", { moduleFilePath: PAGES_PATH }),
    ).toMatchObject({ valid: true });
  });
});

describe("get_patches", () => {
  test("a project with nothing pending has no patches", async () => {
    const { tools } = setup();

    expect(await callOk(tools, "get_patches", {})).toEqual([]);
  });
});

describe("get_source_path_from_route", () => {
  test("a route no module renders is not-found", async () => {
    const { tools } = setup();
    // Neither fixture has a router, so nothing can render this.
    const { code, message } = await callErr(
      tools,
      "get_source_path_from_route",
      { route: "/blog/does-not-exist" },
    );

    expect(code).toBe("not-found");
    expect(message).toContain("/blog/does-not-exist");
  });
});

describe("dispatch", () => {
  test("an unknown tool name is unknown-tool, and lists what there is", async () => {
    const { tools } = setup();
    const { code, message } = await callErr(tools, "delete_everything", {});

    expect(code).toBe("unknown-tool");
    expect(message).toContain("get_all_schema");
  });

  test("arguments the schema rejects are invalid-args", async () => {
    const { tools } = setup();

    // Missing a required argument.
    expect((await callErr(tools, "get_source", {})).code).toBe("invalid-args");
    // Present, but the wrong type.
    expect(
      (await callErr(tools, "get_source", { moduleFilePath: 42 })).code,
    ).toBe("invalid-args");
    // Wrong type inside an array argument.
    expect(
      (
        await callErr(tools, "get_record_keys", {
          moduleFilePath: PAGES_PATH,
          path: ["ok", 7],
        })
      ).code,
    ).toBe("invalid-args");
    // A validation failure says which argument was wrong.
    expect(
      (await callErr(tools, "get_source", { moduleFilePath: 42 })).message,
    ).toContain("moduleFilePath");
  });

  test("omitted arguments are accepted where the schema has a default", async () => {
    const { tools } = setup();

    // `args` of undefined is parsed as `{}`, which is what a host sends for a
    // tool that takes nothing.
    const res = await tools.call("get_all_schema", undefined, CTX);
    expect(res.status).toBe("ok");
  });
});
