import { Internal, type ModuleFilePath, type SourcePath } from "@valbuild/core";
import { buildRestoreVerdict } from "./restorability";
import type { HistoryError } from "./HistoryError";

const moduleFilePath = "/content/page.val.ts" as ModuleFilePath;
const root = moduleFilePath as unknown as SourcePath;
const at = (...keys: (string | number)[]): SourcePath =>
  keys.reduce<SourcePath>(
    (path, key) => Internal.createValPathOfItem(path, key) ?? path,
    root,
  );

const mismatch = (sourcePath: SourcePath): HistoryError => ({
  kind: "schema-mismatch",
  moduleFilePath,
  sourcePath,
  errors: [{ message: "type changed" }],
});

describe("buildRestoreVerdict", () => {
  test("nothing wrong is restorable", () => {
    expect(
      buildRestoreVerdict({
        moduleFilePath,
        paths: [at("title")],
        failures: [],
      }),
    ).toEqual({ status: "restorable" });
  });

  // The point of scoping by path: one broken field must not refuse the rest.
  test("a mismatch elsewhere does not block this selection", () => {
    const verdict = buildRestoreVerdict({
      moduleFilePath,
      paths: [at("title")],
      failures: [mismatch(at("count"))],
    });
    expect(verdict.status).toBe("restorable");
  });

  test("a mismatch on the selected path blocks it", () => {
    const verdict = buildRestoreVerdict({
      moduleFilePath,
      paths: [at("count")],
      failures: [mismatch(at("count"))],
    });
    expect(verdict.status).toBe("blocked");
  });

  // Restoring a parent writes its children, so a broken child blocks it.
  test("a mismatch under the selected path blocks it", () => {
    const verdict = buildRestoreVerdict({
      moduleFilePath,
      paths: [at("meta")],
      failures: [mismatch(at("meta", "author"))],
    });
    expect(verdict.status).toBe("blocked");
  });

  // The quoting is what makes prefix matching safe.
  test("a sibling whose name merely starts the same way does not block", () => {
    const verdict = buildRestoreVerdict({
      moduleFilePath,
      paths: [at("title")],
      failures: [mismatch(at("titleExtra"))],
    });
    expect(verdict.status).toBe("restorable");
  });

  test("the module root covers everything in the module", () => {
    const verdict = buildRestoreVerdict({
      moduleFilePath,
      paths: [root],
      failures: [mismatch(at("count"))],
    });
    expect(verdict.status).toBe("blocked");
  });

  test("an empty selection means the whole module", () => {
    const verdict = buildRestoreVerdict({
      moduleFilePath,
      paths: [],
      failures: [mismatch(at("count"))],
    });
    expect(verdict.status).toBe("blocked");
  });

  // No trustworthy source to restore FROM: nothing in the module is safe.
  test("an unreplayable patch blocks regardless of selection", () => {
    const verdict = buildRestoreVerdict({
      moduleFilePath,
      paths: [at("title")],
      failures: [
        {
          kind: "patch-not-applicable",
          patchId: "p1" as never,
          moduleFilePath,
          message: "no",
        },
      ],
    });
    expect(verdict.status).toBe("blocked");
  });
});
