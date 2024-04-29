import { inferSchema } from "./ValTypes";
import { ValEncodedString } from "@valbuild/react/stega";
import { initVal } from "./initVal";
import { describe } from "node:test";

const { s } = initVal();

describe("inferSchema", () => {
  // These tests are noops - we are verifying that the types are correct
  // #region richtext
  test("basic richtext", () => {
    const test = s.richtext({
      a: true,
    });
    type A = inferSchema<typeof test>;
    const t: A["options"]["a"] = true;
    expect(t).toBeDefined();
  });
  test("nested richtext", () => {
    const test = s.object({
      key: s.richtext({
        a: true,
      }),
    });
    type A = inferSchema<typeof test>;
    const t: A["key"]["options"]["a"] = true;
    expect(t).toBeDefined();
  });

  //#region image
  test("basic image", () => {
    const test = s.image();
    type A = inferSchema<typeof test>;
    const t: A["url"] = "" as ValEncodedString;
    expect(t).toBeDefined();
  });
  test("nested image", () => {
    const test = s.object({
      key: s.image(),
    });
    type A = inferSchema<typeof test>;
    const t: A["key"]["url"] = "" as ValEncodedString;
    expect(t).toBeDefined();
  });

  // #region file
  test("basic file", () => {
    const test = s.file();
    type A = inferSchema<typeof test>;
    const t: A["url"] = "" as ValEncodedString;
    expect(t).toBeDefined();
  });
  test("nested file", () => {
    const test = s.object({
      key: s.file(),
    });
    type A = inferSchema<typeof test>;
    const t: A["key"]["url"] = "" as ValEncodedString;
    expect(t).toBeDefined();
  });
});
