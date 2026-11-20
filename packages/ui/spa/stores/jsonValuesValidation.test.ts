import {
  initVal,
  type Json,
  type JsonSource,
  type ModuleFilePath,
  type SourcePath,
  type ValidationErrors,
} from "@valbuild/core";
import { createSystem } from "./createSystem";
import { RecordingActivity } from "./activity";
import type { FetchJsonEntries } from "./react/jsonEntriesBatch";
import { SchemaValidator } from "../validation/validateModule";

/**
 * Validating a `.jsonValues()` record as its entries arrive.
 *
 * Every batch of entries moves the record's source, so it is stale after
 * each, and it was validated WHOLE every time: every loaded entry sent across
 * the worker seam and walked again. At 10,000 posts the structured clone
 * alone was 172 ms of main-thread time per batch
 * (`scenarios/measure/results.md`). The record's own checks are validated on
 * a shell of its keys, and each entry only when it is new
 * (`ValidationStore.validateEntriesRecord`). These pin that the answer is the
 * one validating it whole gives, and what it costs.
 */

const { c, s } = initVal();
const POSTS = "/posts.val.ts" as ModuleFilePath;

/** A post's title: every third is too short to be one. */
const titleOfPost = (i: number) => (i % 3 === 0 ? "x" : `Post ${i}`);

function postsModule(keys: string[]) {
  const source: Record<string, JsonSource<{ title: string }>> = {};
  for (const key of keys) {
    source[key] = c.json<{ title: string }>(() =>
      Promise.resolve({ default: { title: "never read" } }),
    );
  }
  return c.define(
    "/posts.val.ts",
    s
      .record(
        // A key that is not a post's path is the record's own error.
        s.string().regexp(/^\/posts\/\d+$/),
        s.object({ title: s.string().minLength(3) }),
      )
      .jsonValues(),
    source,
  );
}

function keysOf(n: number): string[] {
  const keys = Array.from({ length: n }, (_, i) => `/posts/${i}`);
  // One key the key schema refuses, among the posts.
  return [...keys.slice(0, 2), "not-a-post", ...keys.slice(2)];
}

function setup(n: number) {
  const keys = keysOf(n);
  const fetchJsonEntries: FetchJsonEntries = async (_module, asked) =>
    Object.fromEntries(
      asked.map((key) => {
        const i = Number(key.slice("/posts/".length));
        const content = {
          title: Number.isNaN(i) ? "Not a post" : titleOfPost(i),
        };
        return [key, { status: "ok", content }];
      }),
    );
  /** What each schema validation was handed: the seam's cost. */
  const sent: Json[] = [];
  const validator = new SchemaValidator();
  let seq = 0;
  const activity = new RecordingActivity(() => ++seq);
  const system = createSystem({
    activity,
    fetchJsonEntries,
    fetchPatches: async () => ({ patches: [] }),
    hostBridge: {
      preview: async () => ({ status: "unknown-module" }),
      customValidate: async () => ({ status: "validated", errors: false }),
    },
    schemaValidation: {
      validate: async (moduleFilePath, source, schema, version) => {
        sent.push(source as Json);
        return validator.validate(moduleFilePath, source, schema, version);
      },
    },
  });
  system.host.receive([postsModule(keys)]);
  /** The record validated WHOLE, as it was before: what the answer must be. */
  const whole = (): ValidationErrors => {
    const schema = system.schemaStore.get(POSTS);
    const source = system.sourceStore.moduleSource(POSTS);
    if (schema === undefined || source === undefined) {
      throw new Error("no module");
    }
    return new SchemaValidator().validate(POSTS, source, schema, "whole");
  };
  const errors = async () => {
    const result = await system.validationStore.validate(POSTS);
    if (result.status !== "validated") throw new Error(result.status);
    return result.errors;
  };
  return { system, keys, sent, activity, whole, errors };
}

/**
 * What a person is shown of an error. Not its `value`: an error on the
 * record itself carries the record it was computed for, which is now the
 * shell of its keys rather than every entry.
 */
function shown(errors: ValidationErrors) {
  if (errors === false) return {};
  return Object.fromEntries(
    Object.entries(errors)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, list]) => [
        path,
        list
          .map((error) => ({
            message: error.message,
            keyError: error.keyError ?? false,
            fixes: error.fixes ?? [],
          }))
          .sort((a, b) => a.message.localeCompare(b.message)),
      ]),
  );
}

function titlePath(key: string): SourcePath {
  return `/posts.val.ts?p="${key}"."title"` as SourcePath;
}

describe("a .jsonValues() record validated as its entries arrive", () => {
  test("says what validating it whole says, loaded or not", async () => {
    const { system, keys, whole, errors } = setup(9);
    // Nothing loaded: the record's own errors and nothing of an entry.
    expect(shown(await errors())).toEqual(shown(whole()));

    await system.sourceStore.loadEntries(POSTS, keys.slice(0, 4));
    expect(shown(await errors())).toEqual(shown(whole()));

    await system.sourceStore.loadAllEntries(POSTS);
    const all = await errors();
    expect(shown(all)).toEqual(shown(whole()));
    // And it found something to agree about: posts 0, 3 and 6, and the key.
    expect(Object.keys(shown(all))).toEqual(
      expect.arrayContaining([
        titlePath("/posts/0"),
        titlePath("/posts/3"),
        titlePath("/posts/6"),
        '/posts.val.ts?p="not-a-post"',
      ]),
    );
  });

  test("a batch costs its own entries, not the ones before it", async () => {
    const { system, keys, sent, activity, errors } = setup(30);
    await system.sourceStore.loadEntries(POSTS, keys.slice(0, 20));
    await errors();
    const before = activity.position();
    const sentBefore = sent.length;

    await system.sourceStore.loadEntries(POSTS, keys.slice(20, 25));
    await errors();

    expect(
      activity.total("validation:validate-entries", { since: before }),
    ).toBe(5);
    // One thing crossed the seam: the five that came. The record's keys did
    // not move, so its own checks were not sent again.
    const crossed = sent.slice(sentBefore);
    expect(crossed).toHaveLength(1);
    expect(Object.keys(crossed[0] ?? {}).sort()).toEqual(
      keys.slice(20, 25).sort(),
    );
  });

  test("an edit to one entry validates that entry, and its error goes with it", async () => {
    const { system, keys, activity, errors, whole } = setup(9);
    await system.sourceStore.loadAllEntries(POSTS);
    expect(Object.keys(shown(await errors()))).toContain(titlePath("/posts/3"));
    const before = activity.position();

    await system.patchStore.createPatch(POSTS, [
      { op: "replace", path: ["/posts/3", "title"], value: "Fixed it" },
    ]);
    const after = await errors();

    expect(
      activity.total("validation:validate-entries", { since: before }),
    ).toBe(1);
    expect(Object.keys(shown(after))).not.toContain(titlePath("/posts/3"));
    expect(shown(after)).toEqual(shown(whole()));
    expect(keys).toContain("/posts/3");
  });

  test("a key that leaves takes its entry's errors with it", async () => {
    const { system, errors, whole } = setup(9);
    await system.sourceStore.loadAllEntries(POSTS);
    await system.patchStore.createPatch(POSTS, [
      { op: "remove", path: ["/posts/0"] },
    ]);
    const after = await errors();
    expect(Object.keys(shown(after))).not.toContain(titlePath("/posts/0"));
    expect(shown(after)).toEqual(shown(whole()));
  });
});

describe("the walk for custom validators", () => {
  // It goes through the whole source, every loaded entry included, and a
  // schema that declares no `.validate(...)` has nothing for it to find.
  test("is not made for a schema that declares none", async () => {
    const { system, activity, errors } = setup(9);
    await system.sourceStore.loadAllEntries(POSTS);
    await errors();
    expect(activity.count("validation:collect-custom-targets")).toBe(0);
  });

  test("is made where one is declared, at any depth", async () => {
    const declared = c.define(
      "/declared.val.ts",
      s.object({
        nested: s.array(
          s.object({
            name: s.string().validate((v) => (v === "" ? "Empty" : false)),
          }),
        ),
      }),
      { nested: [{ name: "Ada" }] },
    );
    let seq = 0;
    const activity = new RecordingActivity(() => ++seq);
    const system = createSystem({
      activity,
      fetchPatches: async () => ({ patches: [] }),
      hostBridge: {
        preview: async () => ({ status: "unknown-module" }),
        customValidate: async () => ({ status: "validated", errors: false }),
      },
    });
    system.host.receive([declared]);
    const result = await system.validationStore.validate(
      "/declared.val.ts" as ModuleFilePath,
    );
    expect(result).toMatchObject({
      status: "validated",
      customValidatePaths: ['/declared.val.ts?p="nested".0."name"'],
    });
    expect(activity.count("validation:collect-custom-targets")).toBe(1);
  });
});
