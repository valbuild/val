import { typecheckReport } from "./buildArtifacts";
import type {
  TypecheckResult,
  TypeErrorEntry,
} from "@valbuild/shared/typecheck";

function checked(
  errors: TypeErrorEntry[],
  missing: TypecheckResult["missing"] = [],
): Parameters<typeof typecheckReport>[0] {
  return {
    status: "checked",
    result: {
      errors,
      missing,
      programs: [],
      typescript: { version: "6.0.3", wanted: "6.0.3", reason: "project" },
      bundles: {
        scanned: 0,
        resolved: 0,
        files: 0,
        stubs: 0,
        bytes: 0,
        count: 0,
        rounds: 0,
      },
      timings: {
        layoutMs: 0,
        compilerMs: 0,
        typesMs: 0,
        checkMs: 0,
        totalMs: 0,
      },
    },
  };
}

const error = (n: number): TypeErrorEntry => ({
  file: "src/a.ts",
  line: n,
  column: 3,
  code: 2322,
  message: "Type 'string' is not assignable to type 'number'.\n  more",
  tsconfig: "tsconfig.json",
});

describe("typecheckReport", () => {
  test("nothing when it was turned off", () => {
    expect(typecheckReport({ status: "off" })).toEqual([]);
  });

  test("no errors", () => {
    expect(typecheckReport(checked([]))).toEqual([
      "Typechecked: no type errors.",
    ]);
  });

  test("each error where it is, its first line, and how to skip the check", () => {
    expect(
      typecheckReport(
        checked([
          error(1),
          { ...error(2), file: null, line: null, column: null },
        ]),
      ),
    ).toEqual([
      "warn: 2 type errors (published anyway; --no-typecheck skips the check):",
      "warn:   src/a.ts:1:3 TS2322 Type 'string' is not assignable to type 'number'.",
      "warn:   tsconfig.json TS2322 Type 'string' is not assignable to type 'number'.",
    ]);
  });

  test("a long list is cut, and says how much was left out", () => {
    const lines = typecheckReport(
      checked(Array.from({ length: 25 }, (_, i) => error(i + 1))),
    );
    expect(lines).toHaveLength(22);
    expect(lines.at(-1)).toBe("warn:   and 5 more");
  });

  test("packages without types are named, since errors about them may be wrong", () => {
    expect(
      typecheckReport(
        checked(
          [],
          [
            {
              name: "a",
              version: "1.0.0",
              integrity: null,
              code: "not-found",
              message: "a@1.0.0 is not installed here.",
              retryable: false,
            },
          ],
        ),
      ),
    ).toEqual([
      "Typechecked: no type errors.",
      "warn: the types of 1 package were not installed, so errors about it may be missing or wrong: a@1.0.0",
    ]);
  });
});
