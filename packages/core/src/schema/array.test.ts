/* eslint-disable @typescript-eslint/no-explicit-any */

import { Schema } from ".";
import { SourcePath } from "../val";
import { array } from "./array";
import { number } from "./number";

describe("NumberSchema", () => {
  test("assert: should return true if src is a number", () => {
    const schema: Schema<{ test: string }> = {} as any;
    const a = schema.assert("foo" as SourcePath, [1]);
    if (a.success) {
      a.data;
    }
  });
  test("assert: should return false if src is a string", () => {});
});
