import fs from "node:fs";
import path from "node:path";
import {
  CTX,
  ITEMS_PATH,
  PAGES_PATH,
  callErr,
  callOk,
  setup,
} from "./toolsFixture";

/**
 * What the writing tools do to the project, seen through the registry's `call`.
 *
 * The property most of these are really about is that a refused write stores
 * *nothing*. An agent that half-applies a change is worse than one that cannot
 * write at all, because the damage is invisible until someone publishes.
 */

/** How many unpublished changes the project has, as the tools report them. */
async function patchCount(
  tools: Awaited<ReturnType<typeof setup>>["tools"],
): Promise<number> {
  const patches = await callOk(tools, "get_patches", {});
  if (!Array.isArray(patches)) {
    throw new Error("get_patches did not return a list");
  }
  return patches.length;
}

describe("create_patch", () => {
  test("saves a valid change and reports the patch it created", async () => {
    const { tools } = setup();

    const res = await callOk(tools, "create_patch", {
      moduleFilePath: PAGES_PATH,
      patch: [{ op: "replace", path: ["home", "title"], value: "Renamed" }],
    });

    expect(res).toEqual({
      patchId: expect.any(String),
      moduleFilePath: PAGES_PATH,
      createdAt: expect.any(String),
      unresolvedValidationErrors: null,
    });
    expect(await patchCount(tools)).toBe(1);
  });

  test("the change is visible to the next read", async () => {
    const { tools } = setup();

    await callOk(tools, "create_patch", {
      moduleFilePath: PAGES_PATH,
      patch: [{ op: "replace", path: ["home", "title"], value: "Renamed" }],
    });

    // Pending patches applied, as the Studio would show them — not the last
    // published state. An agent that could not see its own last edit would keep
    // redoing it.
    const source = await callOk(tools, "get_source", {
      moduleFilePath: PAGES_PATH,
    });
    expect(source).toMatchObject({ home: { title: "Renamed" } });
  });

  test("a change that would break the content is refused, and stores nothing", async () => {
    const { tools } = setup();

    // The fixture requires at least two characters.
    const res = await callErr(tools, "create_patch", {
      moduleFilePath: PAGES_PATH,
      patch: [{ op: "replace", path: ["home", "title"], value: "x" }],
    });

    expect(res.code).toBe("validation-failed");
    expect(res.message).toContain("nothing was saved");
    // The load-bearing half of the assertion: refusing and then saving anyway
    // would pass a test that only checked the error.
    expect(await patchCount(tools)).toBe(0);
  });

  test("a change of the wrong type is refused", async () => {
    const { tools } = setup();

    // Applying this succeeds — JSON Patch does not know the schema — so it is
    // the speculative validation that has to catch it.
    const res = await callErr(tools, "create_patch", {
      moduleFilePath: PAGES_PATH,
      patch: [
        { op: "replace", path: ["home", "order"], value: "not a number" },
      ],
    });

    expect(res.code).toBe("validation-failed");
    expect(await patchCount(tools)).toBe(0);
  });

  test("a patch that does not fit the content is invalid-args, not validation-failed", async () => {
    const { tools } = setup();

    // Different failure, different advice: the patch never applied, so there is
    // no invalid result to describe — the caller addressed something that is
    // not there.
    const res = await callErr(tools, "create_patch", {
      moduleFilePath: PAGES_PATH,
      patch: [{ op: "replace", path: ["nope", "title"], value: "Renamed" }],
    });

    expect(res.code).toBe("invalid-args");
    expect(await patchCount(tools)).toBe(0);
  });

  test("a file operation is refused as unsupported", async () => {
    const { tools } = setup();

    const res = await callErr(tools, "create_patch", {
      moduleFilePath: PAGES_PATH,
      patch: [
        {
          op: "file",
          path: ["home", "image"],
          filePath: "/public/val/x.png",
          value: "data:image/png;base64,AAAA",
          remote: false,
        },
      ],
    });

    expect(res.code).toBe("unsupported");
    expect(await patchCount(tools)).toBe(0);
  });

  test("a malformed file operation is still refused as unsupported", async () => {
    const { tools } = setup();

    // `remote` is missing, so parsing the patch would fail first. Being told
    // that files are not supported is more use than a schema error about the
    // shape of something that was never going to be allowed.
    const res = await callErr(tools, "create_patch", {
      moduleFilePath: PAGES_PATH,
      patch: [
        {
          op: "file",
          path: ["home", "image"],
          filePath: "/public/val/x.png",
          value: "data:image/png;base64,AAAA",
        },
      ],
    });

    expect(res.code).toBe("unsupported");
  });

  test("an unknown module is refused", async () => {
    const { tools } = setup();

    const res = await callErr(tools, "create_patch", {
      moduleFilePath: "/test/nope.val.ts",
      patch: [{ op: "replace", path: ["home", "title"], value: "Renamed" }],
    });

    expect(res.code).toBe("not-found");
  });
});

describe("empty_at_path", () => {
  test("saves an incomplete entry and lists what still needs filling in", async () => {
    const { tools } = setup();

    const res = await callOk(tools, "empty_at_path", {
      moduleFilePath: PAGES_PATH,
      destinationPath: ["fresh"],
    });

    // Not rejected: an empty entry is invalid by construction on any schema with
    // a required non-empty field, so rejecting would make this tool useless on
    // exactly the schemas it exists for. The errors come back as a to-do list.
    expect(res).toMatchObject({
      moduleFilePath: PAGES_PATH,
      unresolvedValidationErrors: expect.stringContaining(
        "at least 2 characters",
      ),
    });
    expect(await patchCount(tools)).toBe(1);
  });

  test("filling the entry in afterwards clears the to-do list", async () => {
    const { tools } = setup();

    await callOk(tools, "empty_at_path", {
      moduleFilePath: PAGES_PATH,
      destinationPath: ["fresh"],
    });
    const res = await callOk(tools, "create_patch", {
      moduleFilePath: PAGES_PATH,
      patch: [{ op: "replace", path: ["fresh", "title"], value: "Fresh" }],
    });

    // The scaffold-then-fill flow end to end: create_patch would have refused
    // this module a moment ago, and now accepts it because the entry is
    // complete.
    expect(res).toMatchObject({ unresolvedValidationErrors: null });
  });

  test("a path the schema does not allow is refused", async () => {
    const { tools } = setup();

    const res = await callErr(tools, "empty_at_path", {
      moduleFilePath: ITEMS_PATH,
      destinationPath: ["nope", "deeper"],
    });

    expect(res.code).toBe("invalid-args");
    expect(await patchCount(tools)).toBe(0);
  });
});

describe("a module that is already broken", () => {
  test("an unrelated edit to it still goes through", async () => {
    const { tools } = setup();

    // Scaffolding leaves the module with a blocking error, which is the state a
    // real project reaches on its own -- a missing image file, say.
    await callOk(tools, "empty_at_path", {
      moduleFilePath: PAGES_PATH,
      destinationPath: ["fresh"],
    });

    // Refusing here would make every module with any pre-existing problem
    // permanently read-only: nobody could fix a typo in a file that also holds
    // a broken reference.
    const res = await callOk(tools, "create_patch", {
      moduleFilePath: PAGES_PATH,
      patch: [{ op: "replace", path: ["home", "title"], value: "Renamed" }],
    });
    expect(res).toMatchObject({ moduleFilePath: PAGES_PATH });
  });

  test("a new break in it is still refused", async () => {
    const { tools } = setup();

    await callOk(tools, "empty_at_path", {
      moduleFilePath: PAGES_PATH,
      destinationPath: ["fresh"],
    });

    // The gate is "do not make it worse", not "anything goes once one thing is
    // wrong".
    const res = await callErr(tools, "create_patch", {
      moduleFilePath: PAGES_PATH,
      patch: [{ op: "replace", path: ["home", "title"], value: "x" }],
    });
    expect(res.code).toBe("validation-failed");
    // The pre-existing problem is not reported as though this change caused it.
    expect(res.message).not.toContain('"fresh"');
  });
});

describe("duplicate_source", () => {
  test("copies an entry to a new key", async () => {
    const { tools } = setup();

    await callOk(tools, "duplicate_source", {
      moduleFilePath: PAGES_PATH,
      sourcePath: ["home"],
      destinationPath: ["home-copy"],
    });

    const source = await callOk(tools, "get_source", {
      moduleFilePath: PAGES_PATH,
    });
    expect(source).toMatchObject({
      home: { title: "Home", order: 1 },
      "home-copy": { title: "Home", order: 1 },
    });
  });

  test("copying onto an existing key is refused", async () => {
    const { tools } = setup();

    const res = await callErr(tools, "duplicate_source", {
      moduleFilePath: PAGES_PATH,
      sourcePath: ["home"],
      destinationPath: ["about"],
    });

    expect(res.code).toBe("invalid-args");
    expect(await patchCount(tools)).toBe(0);
  });
});

describe("annotations", () => {
  test("the writing tools do not claim to be read-only", () => {
    const { tools } = setup();
    const byName = new Map(tools.list().map((d) => [d.name, d]));

    for (const name of [
      "create_patch",
      "duplicate_source",
      "empty_at_path",
      "remove_image_gallery_entry",
    ]) {
      // A host may auto-approve on the strength of readOnlyHint, so claiming it
      // here would be a lie with consequences.
      expect(byName.get(name)?.annotations?.readOnlyHint).not.toBe(true);
    }
  });

  test("removing a gallery entry is flagged destructive", () => {
    const { tools } = setup();
    const byName = new Map(tools.list().map((d) => [d.name, d]));

    // It deletes content and the file behind it, so a host that asks for
    // confirmation should ask here and nowhere else among these.
    expect(
      byName.get("remove_image_gallery_entry")?.annotations?.destructiveHint,
    ).toBe(true);
    expect(byName.get("create_patch")?.annotations?.destructiveHint).not.toBe(
      true,
    );
  });
});

describe("authorless writes in local mode", () => {
  test("a patch is saved with no author", async () => {
    const { tools } = setup();

    await callOk(tools, "create_patch", {
      moduleFilePath: PAGES_PATH,
      patch: [{ op: "replace", path: ["home", "title"], value: "Renamed" }],
    });

    const patches = await callOk(tools, "get_patches", {});
    // Exactly as the Studio does locally. The app cannot resolve a credential to
    // a profile, so asserting an author would be a claim it has not checked.
    expect(patches).toMatchObject([{ authorId: null, published: false }]);
    expect(CTX.auth).toBeNull();
  });
});

describe("a module whose pending patch will not apply", () => {
  /**
   * Break a stored patch so it no longer applies.
   *
   * Rewriting the record on disk is the only honest way to reach this: a patch
   * that applied when it was created only stops applying once something moves
   * underneath it, which is exactly the state a unit test cannot arrange by
   * calling the tools. The layout is `architecture/patch-store.md`.
   */
  function breakStoredPatch(rootDir: string): void {
    const patchesDir = path.join(rootDir, ".val", "patches");
    const entries = fs
      .readdirSync(patchesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory());
    expect(entries).toHaveLength(1);
    const recordPath = path.join(patchesDir, entries[0].name, "patch.json");
    const record = JSON.parse(fs.readFileSync(recordPath, "utf-8"));
    // A path that is not there, so applying it fails rather than doing nothing.
    record.patch = [
      { op: "replace", path: ["nope", "title"], value: "Whatever" },
    ];
    fs.writeFileSync(recordPath, JSON.stringify(record));
  }

  test("get_patches says the change does not apply, and why", async () => {
    const { tools, rootDir } = setup();
    await callOk(tools, "create_patch", {
      moduleFilePath: PAGES_PATH,
      patch: [{ op: "replace", path: ["home", "title"], value: "Renamed" }],
    });
    breakStoredPatch(rootDir);

    // Otherwise a module's content silently differs from what publishing would
    // produce and nothing anywhere says why.
    const patches = await callOk(tools, "get_patches", {});
    expect(patches).toMatchObject([
      { appliesCleanly: false, applyError: expect.any(String) },
    ]);
  });

  test("writing to it is refused", async () => {
    const { tools, rootDir } = setup();
    await callOk(tools, "create_patch", {
      moduleFilePath: PAGES_PATH,
      patch: [{ op: "replace", path: ["home", "title"], value: "Renamed" }],
    });
    breakStoredPatch(rootDir);

    // The state to validate against is wrong: the sources for this module lack
    // the pending change, so a patch built on them would be based on content
    // that will never exist.
    const res = await callErr(tools, "create_patch", {
      moduleFilePath: PAGES_PATH,
      patch: [{ op: "replace", path: ["about", "title"], value: "Renamed" }],
    });
    expect(res.message).toContain("will not apply");
  });

  test("another module is still writable", async () => {
    const { tools, rootDir } = setup();
    await callOk(tools, "create_patch", {
      moduleFilePath: PAGES_PATH,
      patch: [{ op: "replace", path: ["home", "title"], value: "Renamed" }],
    });
    breakStoredPatch(rootDir);

    // Scoped to the module that is actually affected. One bad patch must not
    // make the whole project read-only.
    const res = await callOk(tools, "create_patch", {
      moduleFilePath: ITEMS_PATH,
      patch: [{ op: "replace", path: ["0", "label"], value: "Renamed" }],
    });
    expect(res).toMatchObject({ moduleFilePath: ITEMS_PATH });
  });
});
