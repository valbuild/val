/* eslint-disable @typescript-eslint/no-unused-vars */
import { SelectorC, VAL_OR_EXPR } from ".";
import { object } from "../schema/object";
import { string } from "../schema/string";
import { array } from "../schema/array";
import { createSelector } from "./create";
import { SourcePath } from "../val";
import { RemoteSource } from "../Source";
import { evaluate } from "../expr/eval";
import * as expr from "../expr/expr";
import { result } from "../../fp";

describe("selector", () => {
  test("string", () => {
    const sourcePath = "/app/text" as SourcePath;
    const source = "text1";
    expect(createSelector(source, sourcePath)[VAL_OR_EXPR]()).toStrictEqual({
      val: "text1",
      valPath: "/app/text",
    });
  });

  test("remote string", () => {
    const sourcePath = "/app/text" as SourcePath;
    const source = {
      _ref: "/app/text",
      _type: "remote",
      _schema: string(),
    } as RemoteSource<string>;
    const res = createSelector(source, sourcePath)[VAL_OR_EXPR]();
    if (res instanceof expr.Expr) {
      expect(
        evaluate(res, (ref) => ({ "/app/text": "text1" }[ref]), [])
      ).toStrictEqual(result.ok("text1"));
    } else {
      expect(res).toStrictEqual({
        val: "text1",
        valPath: "/app/text",
      });
    }
  });

  test("string eq", () => {
    const sourcePath = "/app/text" as SourcePath;
    const source = "text1";
    expect(
      createSelector(source, sourcePath).eq("text1")[VAL_OR_EXPR]()
    ).toStrictEqual({
      val: true,
      valPath: undefined,
    });
  });

  test("remote string eq", () => {
    const sourcePath = "/app/text" as SourcePath;
    const source = {
      _ref: "/app/text",
      _type: "remote",
      _schema: string(),
    } as RemoteSource<string>;
    const res = createSelector(source, sourcePath).eq("text1")[VAL_OR_EXPR]();
    if (res instanceof expr.Expr) {
      expect(
        evaluate(res, (ref) => ({ "/app/text": "text1" }[ref]), [])
      ).toStrictEqual(result.ok(true));
    } else {
      expect(res).toStrictEqual({
        val: true,
      });
    }
  });

  test("string andThen noop", () => {
    const sourcePath = "/app/text" as SourcePath;
    const source = "text1";
    expect(
      createSelector(source, sourcePath)
        .andThen((f) => f)
        [VAL_OR_EXPR]()
    ).toStrictEqual({
      val: "text1",
      valPath: "/app/text",
    });
  });

  test("string andThen eq", () => {
    const sourcePath = "/app/text" as SourcePath;
    const source = "text1";
    expect(
      createSelector(source, sourcePath)
        .andThen((f) => f.eq("text1"))
        [VAL_OR_EXPR]()
    ).toStrictEqual({
      val: true,
      valPath: undefined,
    });
  });

  test("empty string andThen eq", () => {
    const sourcePath = "/app/text" as SourcePath;
    const source = "";
    expect(
      createSelector(source, sourcePath)
        .andThen((f) => f.eq("text1"))
        [VAL_OR_EXPR]()
    ).toStrictEqual({
      val: "",
      valPath: "/app/text",
    });
  });

  test("array", () => {
    const sourcePath = "/app/texts" as SourcePath;
    const source = ["text1", "text2"];
    expect(createSelector(source, sourcePath)[VAL_OR_EXPR]()).toStrictEqual([
      { val: "text1", valPath: "/app/texts.0" },
      { val: "text2", valPath: "/app/texts.1" },
    ]);
  });

  test("array literal", () => {
    const source = ["text1", "text2"];
    expect(createSelector(source)[VAL_OR_EXPR]()).toStrictEqual([
      { val: "text1", valPath: undefined },
      { val: "text2", valPath: undefined },
    ]);
  });

  test("array selector in literal", () => {
    const source = [
      "text1",
      createSelector("text2", "/app/texts.1" as SourcePath),
    ];
    expect(createSelector(source)[VAL_OR_EXPR]()).toStrictEqual([
      { val: "text1", valPath: undefined },
      { val: "text2", valPath: "/app/texts.1" },
    ]);
  });

  test("string andThen returns literal", () => {
    const sourcePath = "/app/text" as SourcePath;
    const source = "text1";
    expect(
      createSelector(source, sourcePath)
        .andThen((f) => [f, "text2", f.eq("text1")])
        [VAL_OR_EXPR]()
    ).toStrictEqual([
      {
        val: "text1",
        valPath: "/app/text",
      },
      {
        val: "text2",
        valPath: undefined,
      },
      {
        val: true,
        valPath: undefined,
      },
    ]);
  });

  test("string empty andThen", () => {
    const sourcePath = "/app/text" as SourcePath;
    const source = "";
    expect(
      createSelector(source, sourcePath)
        .andThen((f) => [f.eq("text1")])
        [VAL_OR_EXPR]()
    ).toStrictEqual({
      val: "",
      valPath: "/app/text",
    });
  });

  test("string eq", () => {
    const sourcePath = "/app/text" as SourcePath;
    const source = {
      _ref: "/app/text",
      _type: "remote",
      _schema: string(),
    } as RemoteSource<string>;
    const res = createSelector(source, sourcePath)
      .andThen((v) => "here")
      [VAL_OR_EXPR]();
    if (res instanceof expr.Expr) {
      expect(
        evaluate(res, (ref) => ({ "/app/text": "text1" }[ref]), [])
      ).toStrictEqual(result.ok("here"));
    } else {
      expect(res).toStrictEqual({
        val: "here",
        valPath: "/app/text",
      });
    }
  });
});
