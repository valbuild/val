import { valProjectOf } from "./valProject";

describe("valProjectOf", () => {
  test("VAL_PROJECT wins over val.config", () => {
    expect(
      valProjectOf(
        { project: "valbuild/val-examples-tanstack" },
        { VAL_PROJECT: "local/demo" },
      ),
    ).toBe("local/demo");
  });

  test("val.config when VAL_PROJECT is unset or empty", () => {
    expect(valProjectOf({ project: "acme/site" }, {})).toBe("acme/site");
    expect(valProjectOf({ project: "acme/site" }, { VAL_PROJECT: " " })).toBe(
      "acme/site",
    );
    expect(valProjectOf({ project: "acme/site" }, undefined)).toBe("acme/site");
  });

  test("neither is no project", () => {
    expect(valProjectOf({}, {})).toBeUndefined();
    expect(valProjectOf(undefined, { VAL_PROJECT: "" })).toBeUndefined();
  });
});
