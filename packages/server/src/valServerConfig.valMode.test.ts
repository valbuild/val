import { initVal } from "@valbuild/core";
import { initHandlerOptions } from "./valServerConfig";

const { config } = initVal();

/**
 * `VAL_MODE=memory` is a claim about the HOST, not a switch.
 *
 * Memory mode needs the project's source, which nothing in an environment can
 * supply -- so an env var must never be able to turn it on. What it can do is
 * say that this environment has no disk, and make a host that forgot to pass
 * its source fail HERE, with a sentence, instead of two layers down in `fs`
 * mode with an `EPERM` on `.val/patches.lock`.
 *
 * The isolate this was written for is the reason: an app published to the
 * platform runs in a Worker with no working tree, and the fall-through to `fs`
 * mode was reported as a missing lock file -- a path, not a decision.
 */

const withEnv = async <T>(
  vars: Record<string, string | undefined>,
  body: () => Promise<T>,
): Promise<T> => {
  const before: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(vars)) {
    before[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await body();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

describe("VAL_MODE", () => {
  test("memory mode with no sourceFiles is refused, by name", async () => {
    await withEnv(
      { VAL_MODE: "memory", VAL_API_KEY: undefined, VAL_SECRET: undefined },
      async () => {
        await expect(
          initHandlerOptions("/api/val", {}, config),
        ).rejects.toThrow(/sourceFiles/);
      },
    );
  });

  test("...rather than falling through to the filesystem", async () => {
    // The whole point: without the guard this resolved to `fs` mode and only
    // failed later, when something tried to take a lock on a disk that is not
    // there.
    await withEnv(
      { VAL_MODE: "memory", VAL_API_KEY: undefined, VAL_SECRET: undefined },
      async () => {
        const resolved = await initHandlerOptions("/api/val", {}, config).catch(
          () => null,
        );
        expect(resolved).toBeNull();
      },
    );
  });

  test("a host that DID pass its source is unaffected", async () => {
    await withEnv({ VAL_MODE: "memory" }, async () => {
      const resolved = await initHandlerOptions(
        "/api/val",
        { sourceFiles: { "/content/test.val.ts": "export default 1" } },
        config,
      );
      expect(resolved.mode).toBe("memory");
    });
  });

  test("the source settles it even when the env disagrees", async () => {
    // `sourceFiles` is checked before the environment is consulted at all, so
    // an api key lying around cannot redirect a host that holds its own source
    // at a content service.
    await withEnv(
      { VAL_MODE: undefined, VAL_API_KEY: "key", VAL_SECRET: "secret" },
      async () => {
        const resolved = await initHandlerOptions(
          "/api/val",
          { sourceFiles: { "/content/test.val.ts": "export default 1" } },
          config,
        );
        expect(resolved.mode).toBe("memory");
      },
    );
  });

  test("an unset VAL_MODE still infers fs", async () => {
    await withEnv(
      { VAL_MODE: undefined, VAL_API_KEY: undefined, VAL_SECRET: undefined },
      async () => {
        const resolved = await initHandlerOptions("/api/val", {}, config);
        expect(resolved.mode).toBe("fs");
      },
    );
  });

  test("VAL_MODE= counts as unset, the way a shell means it", async () => {
    await withEnv(
      { VAL_MODE: "", VAL_API_KEY: undefined, VAL_SECRET: undefined },
      async () => {
        const resolved = await initHandlerOptions("/api/val", {}, config);
        expect(resolved.mode).toBe("fs");
      },
    );
  });

  test("the content readers are configured separately, and this catches it", async () => {
    /*
     * The reader has a Val server of ITS OWN.
     *
     * `initValContent` (TanStack) and `initValRsc` (Next) each call
     * `createValServer`, so passing `sourceFiles` to `initValServer` alone
     * leaves the readers inferring `fs` mode -- on a host with no filesystem,
     * a reader looking for a working tree that is not there. It went unnoticed
     * because a published read still worked.
     *
     * This asserts the shape that catches it: the same call with the source
     * and without it must not agree.
     */
    await withEnv({ VAL_MODE: "memory" }, async () => {
      const writer = await initHandlerOptions(
        "/api/val",
        { sourceFiles: { "/content/test.val.ts": "export default 1" } },
        config,
      );
      expect(writer.mode).toBe("memory");
      // What a reader that was not given the source does now.
      await expect(initHandlerOptions("/api/val", {}, config)).rejects.toThrow(
        /sourceFiles/,
      );
    });
  });

  test("a value Val does not know is refused rather than ignored", async () => {
    // Silently ignoring `VAL_MODE=memry` would put the app in `fs` mode, which
    // is the exact failure this variable exists to prevent.
    await withEnv({ VAL_MODE: "memry" }, async () => {
      await expect(initHandlerOptions("/api/val", {}, config)).rejects.toThrow(
        /'memry'/,
      );
    });
  });
});
