import { initVal, type ModuleFilePath } from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import type { JSONValue } from "@valbuild/core/patch";
import { validateAgainstCurrentSchema } from "./validateAgainstCurrentSchema";
import type { ValOps, Schemas } from "../ValOps";

const { s } = initVal();

const path = "/content/page.val.ts" as ModuleFilePath;

/**
 * The real validateSources, over a schema map we control - so these tests
 * exercise the actual schema check rather than a stand-in for it.
 */
function opsWith(schemas: Schemas): ValOps {
  const { ValOps: ValOpsClass } =
    jest.requireActual<typeof import("../ValOps")>("../ValOps");
  const ops = Object.create(ValOpsClass.prototype) as ValOps;
  Object.defineProperty(ops, "getSchemas", {
    value: async () => schemas,
  });
  return ops;
}

async function check(schemas: Schemas, source: JSONValue) {
  const res = await validateAgainstCurrentSchema(opsWith(schemas), {
    [path]: source,
  });
  if (result.isErr(res)) {
    throw new Error(`expected ok, got ${JSON.stringify(res.error)}`);
  }
  return res.value.problems[path] ?? [];
}

describe("validateAgainstCurrentSchema", () => {
  test("a value that still fits is restorable", async () => {
    const schemas: Schemas = {
      [path]: s.object({ title: s.string(), count: s.number() }),
    };
    expect(await check(schemas, { title: "a", count: 1 })).toEqual([]);
  });

  // The case the whole gate exists for: the schema moved on.
  test("blocks a value whose type the schema has changed", async () => {
    const schemas: Schemas = {
      [path]: s.object({ count: s.number() }),
    };
    const problems = await check(schemas, { count: "used to be a string" });
    expect(problems.map((p) => p.kind)).toContain("schema-mismatch");
  });

  // Validation does not always object to an extra key, but restoring one
  // silently reintroduces a field somebody deliberately removed.
  test("blocks a field the schema no longer defines", async () => {
    const schemas: Schemas = {
      [path]: s.object({ title: s.string() }),
    };
    const problems = await check(schemas, { title: "a", removedField: "x" });
    const unknown = problems.filter((p) => p.kind === "unknown-field");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({ key: "removedField" });
  });

  test("finds an unknown field nested inside an array item", async () => {
    const schemas: Schemas = {
      [path]: s.object({ items: s.array(s.object({ n: s.number() })) }),
    };
    const problems = await check(schemas, {
      items: [{ n: 1 }, { n: 2, gone: true }],
    });
    expect(problems.filter((p) => p.kind === "unknown-field")).toHaveLength(1);
  });

  // Record keys are author-chosen, so an unfamiliar one is data, not drift.
  test("does not treat record keys as unknown fields", async () => {
    const schemas: Schemas = {
      [path]: s.record(s.object({ n: s.number() })),
    };
    const problems = await check(schemas, {
      anythingTheAuthorTyped: { n: 1 },
    });
    expect(problems.filter((p) => p.kind === "unknown-field")).toEqual([]);
  });

  test("reports a module that no longer exists as module-removed", async () => {
    const problems = await check({}, { title: "a" });
    expect(problems.map((p) => p.kind)).toEqual(["module-removed"]);
  });
});
