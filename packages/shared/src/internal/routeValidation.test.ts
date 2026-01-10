import {
  filterRoutesByPatterns,
  validateRoutePatterns,
  createRegExpFromPattern,
  type SerializedRegExpPattern,
} from "./routeValidation";

describe("routeValidation", () => {
  describe("filterRoutesByPatterns", () => {
    const routes = [
      "/",
      "/home",
      "/about",
      "/api/users",
      "/api/posts",
      "/api/internal/config",
      "/admin/dashboard",
      "/admin/users",
    ];

    it("should return all routes when no patterns provided", () => {
      const result = filterRoutesByPatterns(routes);
      expect(result).toEqual(routes);
    });

    it("should filter by include pattern", () => {
      const includePattern: SerializedRegExpPattern = {
        source: "^/api/",
        flags: "",
      };
      const result = filterRoutesByPatterns(routes, includePattern);
      expect(result).toEqual([
        "/api/users",
        "/api/posts",
        "/api/internal/config",
      ]);
    });

    it("should filter by exclude pattern", () => {
      const excludePattern: SerializedRegExpPattern = {
        source: "^/admin/",
        flags: "",
      };
      const result = filterRoutesByPatterns(routes, undefined, excludePattern);
      expect(result).toEqual([
        "/",
        "/home",
        "/about",
        "/api/users",
        "/api/posts",
        "/api/internal/config",
      ]);
    });

    it("should filter by both include and exclude patterns", () => {
      const includePattern: SerializedRegExpPattern = {
        source: "^/api/",
        flags: "",
      };
      const excludePattern: SerializedRegExpPattern = {
        source: "/internal/",
        flags: "",
      };
      const result = filterRoutesByPatterns(
        routes,
        includePattern,
        excludePattern,
      );
      expect(result).toEqual(["/api/users", "/api/posts"]);
    });

    it("should handle invalid include regex gracefully and log warning", () => {
      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
      const invalidPattern: SerializedRegExpPattern = {
        source: "[invalid",
        flags: "",
      };
      const result = filterRoutesByPatterns(routes, invalidPattern);
      expect(result).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Val] Invalid include pattern"),
        expect.stringContaining("Error:"),
        expect.stringContaining("All routes will be filtered out"),
      );
      consoleWarnSpy.mockRestore();
    });

    it("should handle invalid exclude regex gracefully and log warning", () => {
      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
      const invalidPattern: SerializedRegExpPattern = {
        source: "(unclosed",
        flags: "",
      };
      const result = filterRoutesByPatterns(routes, undefined, invalidPattern);
      expect(result).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Val] Invalid exclude pattern"),
        expect.stringContaining("Error:"),
        expect.stringContaining("All routes will be filtered out"),
      );
      consoleWarnSpy.mockRestore();
    });

    it("should handle case-insensitive patterns", () => {
      const includePattern: SerializedRegExpPattern = {
        source: "^/API/",
        flags: "i",
      };
      const result = filterRoutesByPatterns(routes, includePattern);
      expect(result).toEqual([
        "/api/users",
        "/api/posts",
        "/api/internal/config",
      ]);
    });
  });

  describe("validateRoutePatterns", () => {
    it("should validate successfully with no patterns", () => {
      const result = validateRoutePatterns("/home");
      expect(result).toEqual({ valid: true });
    });

    it("should validate successfully when include pattern matches", () => {
      const includePattern: SerializedRegExpPattern = {
        source: "^/api/",
        flags: "",
      };
      const result = validateRoutePatterns("/api/users", includePattern);
      expect(result).toEqual({ valid: true });
    });

    it("should fail validation when include pattern does not match", () => {
      const includePattern: SerializedRegExpPattern = {
        source: "^/api/",
        flags: "",
      };
      const result = validateRoutePatterns("/home", includePattern);
      expect(result).toEqual({
        valid: false,
        message: "Route '/home' does not match include pattern: /^/api//",
      });
    });

    it("should validate successfully when exclude pattern does not match", () => {
      const excludePattern: SerializedRegExpPattern = {
        source: "^/admin/",
        flags: "",
      };
      const result = validateRoutePatterns("/home", undefined, excludePattern);
      expect(result).toEqual({ valid: true });
    });

    it("should fail validation when exclude pattern matches", () => {
      const excludePattern: SerializedRegExpPattern = {
        source: "^/admin/",
        flags: "",
      };
      const result = validateRoutePatterns(
        "/admin/users",
        undefined,
        excludePattern,
      );
      expect(result).toEqual({
        valid: false,
        message: "Route '/admin/users' matches exclude pattern: /^/admin//",
      });
    });

    it("should validate with both include and exclude patterns", () => {
      const includePattern: SerializedRegExpPattern = {
        source: "^/api/",
        flags: "",
      };
      const excludePattern: SerializedRegExpPattern = {
        source: "/internal/",
        flags: "",
      };

      // Should pass: matches include, doesn't match exclude
      const result1 = validateRoutePatterns(
        "/api/users",
        includePattern,
        excludePattern,
      );
      expect(result1).toEqual({ valid: true });

      // Should fail: doesn't match include
      const result2 = validateRoutePatterns(
        "/home",
        includePattern,
        excludePattern,
      );
      expect(result2.valid).toBe(false);

      // Should fail: matches exclude
      const result3 = validateRoutePatterns(
        "/api/internal/config",
        includePattern,
        excludePattern,
      );
      expect(result3.valid).toBe(false);
    });

    it("should handle invalid include pattern", () => {
      const invalidPattern: SerializedRegExpPattern = {
        source: "[invalid",
        flags: "",
      };
      const result = validateRoutePatterns("/home", invalidPattern);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.message).toContain("Invalid include pattern");
      }
    });

    it("should handle invalid exclude pattern", () => {
      const invalidPattern: SerializedRegExpPattern = {
        source: "[invalid",
        flags: "",
      };
      const result = validateRoutePatterns("/home", undefined, invalidPattern);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.message).toContain("Invalid exclude pattern");
      }
    });
  });

  describe("createRegExpFromPattern", () => {
    it("should create RegExp from valid pattern", () => {
      const pattern: SerializedRegExpPattern = {
        source: "^/api/",
        flags: "i",
      };
      const regex = createRegExpFromPattern(pattern);
      expect(regex).toBeInstanceOf(RegExp);
      expect(regex?.test("/API/users")).toBe(true);
    });

    it("should return null for invalid pattern", () => {
      const pattern: SerializedRegExpPattern = {
        source: "[invalid",
        flags: "",
      };
      const regex = createRegExpFromPattern(pattern);
      expect(regex).toBeNull();
    });
  });
});
