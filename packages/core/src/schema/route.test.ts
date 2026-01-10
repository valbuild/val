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
            exclude: undefined,
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
            exclude: undefined,
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
        exclude: undefined,
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
        exclude: undefined,
        customValidate: false,
      },
      opt: false,
      customValidate: false,
    });
  });

  test("validate: should return validation error with exclude pattern", () => {
    const excludePattern = /^\/admin/;
    const schema = route().exclude(excludePattern);
    const src = "/admin/users";
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
            exclude: excludePattern,
          },
        },
      ],
    });
  });

  test("validate: should return validation error with both include and exclude", () => {
    const includePattern = /^\/api\//;
    const excludePattern = /^\/api\/internal\//;
    const schema = route().include(includePattern).exclude(excludePattern);
    const src = "/api/internal/secret";
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
            exclude: excludePattern,
          },
        },
      ],
    });
  });

  test("serialize: should serialize route schema with exclude pattern", () => {
    const schema = route().exclude(/^\/admin/);
    const res = schema["executeSerialize"]();
    expect(res).toEqual({
      type: "route",
      options: {
        include: undefined,
        exclude: {
          source: "^\\/admin",
          flags: "",
        },
        customValidate: false,
      },
      opt: false,
      customValidate: false,
    });
  });

  test("serialize: should serialize route schema with both include and exclude", () => {
    const schema = route()
      .include(/^\/api\//)
      .exclude(/^\/api\/internal\//);
    const res = schema["executeSerialize"]();
    expect(res).toEqual({
      type: "route",
      options: {
        include: {
          source: "^\\/api\\/",
          flags: "",
        },
        exclude: {
          source: "^\\/api\\/internal\\/",
          flags: "",
        },
        customValidate: false,
      },
      opt: false,
      customValidate: false,
    });
  });
});
