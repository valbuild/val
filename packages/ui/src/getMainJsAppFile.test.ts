import { getMainJsAppFile } from "./getMainJsAppFile";

describe("getMainJsAppFile", () => {
  describe("successful cases", () => {
    it("should return the main index file when only one exists", () => {
      const jsFiles = ["/assets/index-BZSASjkd.js"];
      const result = getMainJsAppFile(jsFiles);
      expect(result).toBe("/assets/index-BZSASjkd.js");
    });

    it("should return the main index file when worker files exist", () => {
      const jsFiles = [
        "/assets/index-BZSASjkd.js",
        "/assets/search.worker-BlMohPkR.js",
      ];
      const result = getMainJsAppFile(jsFiles);
      expect(result).toBe("/assets/index-BZSASjkd.js");
    });

    it("should return the main index file when multiple worker files exist", () => {
      const jsFiles = [
        "/assets/index-abc123.js",
        "/assets/search.worker-def456.js",
        "/assets/other.worker-ghi789.js",
      ];
      const result = getMainJsAppFile(jsFiles);
      expect(result).toBe("/assets/index-abc123.js");
    });

    it("should handle index files with different hash patterns", () => {
      const jsFiles = [
        "/assets/index-A1B2C3D4.js",
        "/assets/worker-E5F6G7H8.js",
      ];
      const result = getMainJsAppFile(jsFiles);
      expect(result).toBe("/assets/index-A1B2C3D4.js");
    });
  });

  describe("error cases", () => {
    it("should throw error when no index files are found", () => {
      const jsFiles = [
        "/assets/search.worker-BlMohPkR.js",
        "/assets/other-file.js",
      ];
      expect(() => getMainJsAppFile(jsFiles)).toThrow();
    });

    it("should throw error when no files are provided", () => {
      const jsFiles: string[] = [];
      expect(() => getMainJsAppFile(jsFiles)).toThrow();
    });

    it("should throw error when multiple index files are found", () => {
      const jsFiles = ["/assets/index-abc123.js", "/assets/index-def456.js"];
      expect(() => getMainJsAppFile(jsFiles)).toThrow();
    });

    it("should throw error when multiple index files exist along with worker files", () => {
      const jsFiles = [
        "/assets/index-abc123.js",
        "/assets/index-def456.js",
        "/assets/search.worker-ghi789.js",
      ];
      expect(() => getMainJsAppFile(jsFiles)).toThrow();
    });

    it("should handle index files in nested paths", () => {
      const jsFiles = [
        "/api/val/static/assets/index-xyz789.js",
        "/api/val/static/assets/search.worker-abc123.js",
      ];
      expect(() => getMainJsAppFile(jsFiles)).toThrow();
    });
  });

  describe("edge cases", () => {
    it("should only match files that start with 'index-'", () => {
      const jsFiles = [
        "/assets/index-abc123.js",
        "/assets/myindex-def456.js",
        "/assets/index.js",
        "/assets/search.worker-BlMohPkR.js",
      ];
      const result = getMainJsAppFile(jsFiles);
      expect(result).toBe("/assets/index-abc123.js");
    });

    it("should handle files with 'index-' in the middle of the path", () => {
      const jsFiles = [
        "/assets/some-index-file.js",
        "/assets/index-abc123.js",
        "/assets/worker.js",
      ];
      const result = getMainJsAppFile(jsFiles);
      expect(result).toBe("/assets/index-abc123.js");
    });
  });

  describe("regression test for search.worker issue", () => {
    it("should not fail when search.worker file is present (original bug)", () => {
      // This is the exact scenario that caused the original error:
      // "Val UI files missing (error: multiple .js files found:
      //  /assets/index-BZSASjkd.js ,/assets/search.worker-BlMohPkR.js)"
      const jsFiles = [
        "/assets/index-BZSASjkd.js",
        "/assets/search.worker-BlMohPkR.js",
      ];

      // Should not throw an error
      expect(() => getMainJsAppFile(jsFiles)).not.toThrow();

      // Should return the main index file
      const result = getMainJsAppFile(jsFiles);
      expect(result).toBe("/assets/index-BZSASjkd.js");
    });
  });
});
