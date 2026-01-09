import { SourcePath } from "../val";
import { route } from "./route";

describe("RouteSchema", () => {
  test("assert: should return success if src is a route value (string)", () => {
    const schema = route();
    const src = "/home";
    const res = schema["executeAssert"]("path" as SourcePath, src);
    expect(res).toEqual({
      success: true,
      data: src,
    });
  });

  test("assert: should return success for nullable route when src is null", () => {
    const schema = route().nullable();
    const src = null;
    const res = schema["executeAssert"]("path" as SourcePath, src);
    expect(res).toEqual({
      success: true,
      data: src,
    });
  });

  test("assert: should return error if src is not a string", () => {
    const schema = route();
    const src = 123;
    const res = schema["executeAssert"]("path" as SourcePath, src);
    expect(res).toEqual({
      success: false,
      errors: {
        path: [
          {
            message: `Expected 'string', got 'number'`,
            typeError: true,
          },
        ],
      },
    });
  });

  test("validate: should return validation error with router:check-route fix", () => {
    const schema = route();
    const src = "/test";
    const res = schema["executeValidate"]("path" as SourcePath, src);
    expect(res).toEqual({
      path: [
        {
          fixes: ["router:check-route"],
          message: `Did not validate route (router). This error (router:check-route) should typically be processed by Val internally. Seeing this error most likely means you have a Val version mismatch.`,
          value: {
            route: src,
            sourcePath: "path",
            include: undefined,
          },
        },
      ],
    });
  });

  test("validate: should return validation error with include pattern", () => {
    const includePattern = /^\/(home|about)$/;
    const schema = route().include(includePattern);
    const src = "/contact";
    const res = schema["executeValidate"]("path" as SourcePath, src);
    expect(res).toEqual({
      path: [
        {
          fixes: ["router:check-route"],
          message: `Did not validate route (router). This error (router:check-route) should typically be processed by Val internally. Seeing this error most likely means you have a Val version mismatch.`,
          value: {
            route: src,
            sourcePath: "path",
            include: includePattern,
          },
        },
      ],
    });
  });

  test("serialize: should serialize route schema", () => {
    const schema = route();
    const res = schema["executeSerialize"]();
    expect(res).toEqual({
      type: "route",
      options: {
        include: undefined,
        customValidate: false,
      },
      opt: false,
      customValidate: false,
    });
  });

  test("serialize: should serialize route schema with include pattern", () => {
    const schema = route().include(/^\/(home|about)$/);
    const res = schema["executeSerialize"]();
    expect(res).toEqual({
      type: "route",
      options: {
        include: {
          source: "^\\/(home|about)$",
          flags: "",
        },
        customValidate: false,
      },
      opt: false,
      customValidate: false,
    });
  });
});
