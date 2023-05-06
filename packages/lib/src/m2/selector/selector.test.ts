/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  AsVal,
  Selector,
  SelectorC,
  SelectorOf,
  SelectorSource,
  VAL_OR_EXPR,
} from ".";
import { string } from "../schema/string";
import { array } from "../schema/array";
import { createSelector } from "./create";
import { SourcePath, Val } from "../val";
import { RemoteSource, Source } from "../Source";
import { evaluate } from "../expr/eval";
import * as expr from "../expr/expr";
import { result } from "../../fp";
import { Schema } from "../schema";

const modules = {
  "/app/text": "text1",
  "/app/texts": ["text1", "text2"],
  "/app/empty": "",
};
const remoteModules: {
  [key in keyof TestModules]: RemoteSource<TestModules[key]>;
} = {
  "/app/text": remoteSource("/app/text", string()),
  "/app/texts": remoteSource("/app/texts", array(string())),
  "/app/empty": remoteSource("/app/empty", string()),
};

const SelectorModuleTestCases: {
  description: string;
  input: (remote: boolean) => Selector<Source>;
  expected: Expected;
}[] = [
  // NOTE: all expected values for REMOTE should be changed (to return Vals)
  {
    description: "string module lookup",
    input: (remote) => testModule("/app/text", remote),
    expected: {
      val: "text1",
      valPath: "/app/text",
    },
  },
  {
    description: "basic eq",
    input: (remote) => testModule("/app/text", remote).eq("text1"),
    expected: {
      val: true,
      valPath: undefined,
    },
  },
  {
    description: "andThen noop",
    input: (remote) => testModule("/app/text", remote).andThen((v) => v),
    expected: {
      val: "text1",
      valPath: "/app/text",
    },
  },
  {
    description: "array module lookup",
    input: (remote) => testModule("/app/texts", remote),
    expected: [
      { val: "text1", valPath: "/app/texts.0" },
      { val: "text2", valPath: "/app/texts.1" },
    ],
  },
  {
    description: "string andThen eq",
    input: (remote) =>
      testModule("/app/text", remote).andThen((v) => v.eq("text1")),
    expected: {
      val: true,
      valPath: undefined,
    },
  },
  {
    description: "empty string andThen eq",
    input: (remote) =>
      testModule("/app/empty", remote).andThen((v) => v.eq("text1")),
    expected: {
      val: "",
      valPath: "/app/empty",
    },
  },
  {
    description: "string andThen array literal",
    input: (remote) =>
      testModule("/app/text", remote).andThen((v) => [v, "text2"]),
    expected: [
      { val: "text1", valPath: "/app/text" },
      { val: "text2", valPath: undefined },
    ],
  },
  {
    description: "array map noop",
    input: (remote) => testModule("/app/texts", remote).map((v) => v),
    expected: [
      { val: "text1", valPath: "/app/text" },
      { val: "text2", valPath: undefined },
    ],
  },
];

const RemoteAndLocaleSelectorModuleTestCases = SelectorModuleTestCases.flatMap(
  (testCase) => [
    {
      input: testCase.input(false),
      description: `local ${testCase.description}`,
      expected: testCase.expected,
      remote: false,
    },
    // {
    //   input: testCase.input(true),
    //   description: `remote ${testCase.description}`,
    //   expected: testCase.expected,
    //   remote: true,
    // },
  ]
);

describe("selector", () => {
  test.each(RemoteAndLocaleSelectorModuleTestCases)(
    "$description",
    ({ input, expected, remote }) => {
      if (input instanceof Error) {
        throw input;
      }
      // TODO: ideally we should be able to use the same test cases for both remote and local
      if (!remote) {
        const localeRes = (input as unknown as AsVal<Source>)[VAL_OR_EXPR]();
        expect(localeRes).toStrictEqual(expected);
      } else {
        const remoteRes = (input as unknown as AsVal<Source>)[VAL_OR_EXPR]();
        if (remoteRes instanceof expr.Expr) {
          expect(
            evaluate(
              remoteRes,
              (ref) => modules[ref as keyof typeof modules],
              []
            )
          ).toStrictEqual(result.ok(expected.val)); // TODO: remote should also return vals, currently they return the value
        } else {
          expect(remoteRes).toStrictEqual(expect.any(expr.Expr));
        }
      }
    }
  );
});
type TestModules = typeof modules;

type Expected = any; // TODO: should be Val | Expr

function testModule<P extends keyof TestModules>(
  sourcePath: P,
  remote: boolean
): SelectorOf<TestModules[P]> {
  try {
    return createSelector(
      remote ? remoteModules[sourcePath] : modules[sourcePath],
      sourcePath as SourcePath
    );
  } catch (e) {
    // avoid failing all test suite failure on test case creation, instead returns error and throws it inside the test
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return e as any;
  }
}

function remoteSource<P extends keyof TestModules>(
  ref: P,
  schema: Schema<TestModules[P]>
): RemoteSource<TestModules[P]> {
  return {
    _ref: ref,
    _type: "remote",
    _schema: schema,
  } as RemoteSource<TestModules[P]>;
}
