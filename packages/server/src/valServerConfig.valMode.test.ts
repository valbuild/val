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
      {
        VAL_MODE: undefined,
        VAL_ENV: undefined,
        VAL_API_KEY: undefined,
        VAL_SECRET: undefined,
      },
      async () => {
        const resolved = await initHandlerOptions("/api/val", {}, config);
        expect(resolved.mode).toBe("fs");
      },
    );
  });

  test("VAL_MODE= counts as unset, the way a shell means it", async () => {
    await withEnv(
      {
        VAL_MODE: "",
        VAL_ENV: undefined,
        VAL_API_KEY: undefined,
        VAL_SECRET: undefined,
      },
      async () => {
        const resolved = await initHandlerOptions("/api/val", {}, config);
        expect(resolved.mode).toBe("fs");
      },
    );
  });

  test("the same environment answers differently per call site", async () => {
    /*
     * Which is why a host with more than one Val server has to configure each
     * of them. `initValContent` builds one of its own, and the test that it
     * FORWARDS what it was given is in the tanstack package
     * (`initValContent.memoryMode.test.ts`) -- this one cannot see that, and
     * would pass with the forwarding removed.
     *
     * What it does pin is the property that makes the mistake possible: the
     * environment is the same for both calls, and the source is not.
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

/**
 * `VAL_ENV` says WHERE Val is running. `VAL_MODE` says which mode it is in.
 *
 * The platform sets the first and lets Val derive the second, because only the
 * first stays true when Val's internals move. It has already moved: this
 * variable meant `memory` while the Val app kept its own patch store, and now
 * means `http`, because the app's content is Val's own -- read over HTTP at a
 * commit, patched through the content API, with files uploaded straight to the
 * content host, exactly as for any other deployed app. Nothing on the platform
 * side had to change for that; `VAL_ENV=app` was already the whole statement.
 *
 * Unlike `VAL_MODE=memory`, this SELECTS the mode rather than only refusing a
 * fall-through, and it can because everything http mode needs is an env var.
 * What it must never do is fall through: an app whose `VAL_API_KEY` failed to
 * arrive has to be told that, not quietly put in `fs` mode and left to fail on
 * a lock file in a filesystem that is not there.
 */
describe("VAL_ENV", () => {
  /** Everything http mode needs, so a test can leave out exactly one thing. */
  const httpEnv = {
    VAL_ENV: "app",
    VAL_MODE: undefined,
    VAL_API_KEY: "key",
    VAL_SECRET: "secret",
    VAL_PROJECT: "org/project",
    VAL_GIT_COMMIT: "0000000000000000000000000000000000000000",
    VAL_GIT_BRANCH: "main",
  };
  const versions = { core: "0.0.0", next: "0.0.0" };

  test("VAL_ENV=app means http", async () => {
    await withEnv(httpEnv, async () => {
      const resolved = await initHandlerOptions(
        "/api/val",
        { versions },
        config,
      );
      expect(resolved.mode).toBe("http");
    });
  });

  test("...and hands http mode the repository it mirrors into", async () => {
    // The commit is the whole difference between mirroring this build's
    // content and overwriting somebody else's: producing the `.val.ts` a
    // publish commits starts by asking the content host for the file AT THIS
    // SHA, so a config that dropped it would patch a repository at a revision
    // the code was not built from.
    await withEnv(httpEnv, async () => {
      const resolved = await initHandlerOptions(
        "/api/val",
        { versions },
        config,
      );
      expect(resolved).toMatchObject({
        mode: "http",
        project: "org/project",
        git: {
          commit: "0000000000000000000000000000000000000000",
          branch: "main",
        },
      });
    });
  });

  test("HTTP MODE WITHOUT A REPOSITORY, which is now the normal case", async () => {
    /*
     * Credentials alone decide the mode.
     *
     * Both of these used to be required, which made a repository a
     * precondition for editing anything: a project whose content service is
     * the store of record -- it mints its own commit shas and knows the
     * project's branch -- had no commit to name, and every one of them either
     * threw at boot or fell through to `fs` mode and reached for a working
     * tree that was not there.
     */
    await withEnv(
      { ...httpEnv, VAL_GIT_COMMIT: undefined, VAL_GIT_BRANCH: undefined },
      async () => {
        const resolved = await initHandlerOptions(
          "/api/val",
          { versions },
          config,
        );
        expect(resolved.mode).toBe("http");
        expect("git" in resolved).toBe(false);
      },
    );
  });

  test("...but half a repository is refused", async () => {
    /*
     * A commit with no branch names a point with no line of work to publish
     * to; a branch with no commit names a line with no position in it. Either
     * alone is a half-configured repository, and left to resolve it would fail
     * at a publish instead of here -- where the thing that is missing can
     * still be named.
     */
    await withEnv({ ...httpEnv, VAL_GIT_BRANCH: undefined }, async () => {
      await expect(
        initHandlerOptions("/api/val", { versions }, config),
      ).rejects.toThrow(/branch/);
    });
    await withEnv({ ...httpEnv, VAL_GIT_COMMIT: undefined }, async () => {
      await expect(
        initHandlerOptions("/api/val", { versions }, config),
      ).rejects.toThrow(/commit/);
    });
  });

  test("a missing credential is refused, not turned into fs mode", async () => {
    /*
     * The reason this variable selects rather than hints.
     *
     * Inference reads an absent api key as "not a proxy" and resolves `fs`,
     * and `fs` mode in an isolate fails on `.val/patches.lock` -- a path, two
     * layers below the actual mistake, in a deployment nobody is watching.
     */
    await withEnv({ ...httpEnv, VAL_API_KEY: undefined }, async () => {
      await expect(
        initHandlerOptions("/api/val", { versions }, config),
      ).rejects.toThrow(/VAL_API_KEY/);
    });
  });

  test("...rather than resolving to anything at all", async () => {
    await withEnv({ ...httpEnv, VAL_API_KEY: undefined }, async () => {
      const resolved = await initHandlerOptions(
        "/api/val",
        { versions },
        config,
      ).catch(() => null);
      expect(resolved).toBeNull();
    });
  });

  test("...and the refusal says why the mode is http", async () => {
    // Somebody reading "must be set in proxy mode" on an app that never
    // mentioned a mode needs to be told which variable put it there, since it
    // is not in the file they are looking at.
    await withEnv({ ...httpEnv, VAL_API_KEY: undefined }, async () => {
      await expect(
        initHandlerOptions("/api/val", { versions }, config),
      ).rejects.toThrow(/VAL_ENV/);
    });
  });

  test.each([
    ["VAL_GIT_COMMIT", /VAL_GIT_COMMIT/],
    ["VAL_GIT_BRANCH", /VAL_GIT_BRANCH/],
    ["VAL_PROJECT", /project/],
  ])("a missing %s is named", async (name, expected) => {
    await withEnv({ ...httpEnv, [name]: undefined }, async () => {
      await expect(
        initHandlerOptions("/api/val", { versions }, config),
      ).rejects.toThrow(expected);
    });
  });

  test("some other VAL_ENV says nothing, and fs is still inferred", async () => {
    // Only 'app' means anything here. An environment named something else is
    // not an error -- `VAL_ENV` is a general name and Val does not own every
    // value of it.
    await withEnv(
      {
        VAL_ENV: "production",
        VAL_MODE: undefined,
        VAL_API_KEY: undefined,
        VAL_SECRET: undefined,
      },
      async () => {
        const resolved = await initHandlerOptions("/api/val", {}, config);
        expect(resolved.mode).toBe("fs");
      },
    );
  });

  test("an explicit VAL_MODE wins, including when it is wrong", async () => {
    // Somebody naming a mode outright has said something more specific than
    // somebody naming an environment, and a typo in the specific one has to be
    // refused rather than covered for by the general one.
    await withEnv({ ...httpEnv, VAL_MODE: "memry" }, async () => {
      await expect(
        initHandlerOptions("/api/val", { versions }, config),
      ).rejects.toThrow(/'memry'/);
    });
  });

  test("'http' is still not a value VAL_MODE accepts", async () => {
    /*
     * `VAL_ENV=app` names 'http' internally, and the refusal below is keyed on
     * WHICH variable spoke rather than on the value being unrecognised. Get
     * that wrong and `VAL_MODE=http` starts working -- a second spelling of
     * the same thing, in the variable whose documented values are 'memory' and
     * nothing else.
     */
    await withEnv(
      { ...httpEnv, VAL_ENV: undefined, VAL_MODE: "http" },
      async () => {
        await expect(
          initHandlerOptions("/api/val", { versions }, config),
        ).rejects.toThrow(/'http'/);
      },
    );
  });

  test("a host that hands over its source still gets memory", async () => {
    /*
     * `sourceFiles` is checked before the environment is consulted at all, and
     * that order is deliberate: a host holding its own source has settled the
     * question, and no env var should redirect it at a content service.
     *
     * It is also what keeps a build published by an older platform working. It
     * passes its source and gets the mode it was built for, on a Val that now
     * reads `VAL_ENV=app` as something else entirely.
     */
    await withEnv(httpEnv, async () => {
      const resolved = await initHandlerOptions(
        "/api/val",
        {
          versions,
          sourceFiles: { "/content/test.val.ts": "export default 1" },
        },
        config,
      );
      expect(resolved.mode).toBe("memory");
    });
  });
});
