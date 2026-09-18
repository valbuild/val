import { initVal, type ValModules } from "@valbuild/core";
import { ValOpsMemory } from "./ValOpsMemory";
import { ValOpsFS } from "./ValOpsFS";
import { ValOpsHttp } from "./ValOpsHttp";

const { s, c, config } = initVal();

/**
 * Two questions, and for a while one flag answered both.
 *
 * `patchesAreLocal` says whether this store auto-saves or publishes -- a
 * BEHAVIOUR question, reported to the client as `mode` and keyed off by the UI.
 * `requiresAuth` says whether an unauthenticated request may write -- a
 * SECURITY question. With two implementations the answers coincided: `fs` is a
 * developer's own machine where no credential exists, `http` is remote. So
 * `getAuth` was written against `patchesAreLocal`, and it returned anonymous
 * SUCCESS -- `{ error: null }`, which all 29 routes treat as authorised -- for
 * a missing cookie, an invalid JWT, an unparseable payload, or no configured
 * secret.
 *
 * A third implementation pulls them apart. `ValOpsMemory`'s store is local,
 * which makes the first answer yes, and it is built to run DEPLOYED, which
 * makes the second answer no. Sharing one flag gave a deployed host an open
 * `/patches` and an open publish for anyone who could reach the port.
 *
 * These assertions are the contract, not the implementation: what matters is
 * that "local store" never again implies "no authentication".
 */

const valModules: ValModules = {
  config,
  modules: [
    {
      def: () =>
        Promise.resolve({
          default: c.define("/content/test.val.ts", s.string(), "hello"),
        }),
    },
  ],
};

const memory = (unsafelyAllowUnauthenticated?: boolean) =>
  new ValOpsMemory(valModules, {
    config,
    sourceFiles: { "/content/test.val.ts": "" },
    ...(unsafelyAllowUnauthenticated !== undefined
      ? { unsafelyAllowUnauthenticated }
      : {}),
  });

describe("memory mode authentication", () => {
  test("requires authentication by default", () => {
    expect(memory().requiresAuth).toBe(true);
  });

  test("a local patch store does not mean an open server", () => {
    const ops = memory();
    expect(ops.patchesAreLocal).toBe(true);
    expect(ops.requiresAuth).toBe(true);
  });

  test("the host can take the boundary itself, by name", () => {
    // Spelled out rather than inferred, and it warns -- see ValOpsMemory.
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(memory(true).requiresAuth).toBe(false);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  // Constructed rather than read off the prototype: these are class FIELDS, so
  // they exist per instance and a prototype read is `undefined` -- which passes
  // a loose assertion and tests nothing.
  test("fs mode still skips it: a developer's own machine", () => {
    const ops = new ValOpsFS("https://content.val.build", "/tmp", valModules, {
      config,
    });
    expect(ops.patchesAreLocal).toBe(true);
    expect(ops.requiresAuth).toBe(false);
  });

  test("http mode still requires it", () => {
    const ops = new ValOpsHttp(
      "https://content.val.build",
      "org/project",
      "0000000000000000000000000000000000000000",
      "main",
      { apiKey: "not-a-real-key" },
      valModules,
      { config },
    );
    expect(ops.patchesAreLocal).toBe(false);
    expect(ops.requiresAuth).toBe(true);
  });
});
