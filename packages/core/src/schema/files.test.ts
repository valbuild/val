import { SourcePath } from "../val";
import { files, FilesEntryMetadata, SerializedFilesSchema } from "./files";

// Strip deferred-check errors (require CLI/filesystem context, not schema validation)
function filterCheckErrors(
  result: false | Record<string, { message: string; fixes?: string[] }[]> | undefined,
) {
  if (!result) return result;
  const checkFixes = ["files:check-unique-folder", "files:check-all-files"];
  const filtered: Record<string, { message: string; fixes?: string[] }[]> = {};
  for (const [key, errors] of Object.entries(result)) {
    const nonCheck = errors.filter(
      (e) => !e.fixes?.some((f) => checkFixes.includes(f)),
    );
    if (nonCheck.length > 0) filtered[key] = nonCheck;
  }
  return Object.keys(filtered).length > 0 ? filtered : false;
}

describe("FilesSchema", () => {
  describe("assert", () => {
    test("should return success if src is a valid files object", () => {
      const schema = files({ accept: "application/pdf" });
      const src: Record<string, FilesEntryMetadata> = {
        "/public/val/document.pdf": {
          mimeType: "application/pdf",
        },
      };
      expect(schema["executeAssert"]("path" as SourcePath, src)).toEqual({
        success: true,
        data: src,
      });
    });

    test("should return error if src is null (non-nullable)", () => {
      const schema = files({ accept: "application/pdf" });
      const result = schema["executeAssert"]("path" as SourcePath, null);
      expect(result.success).toEqual(false);
    });

    test("should return success if src is null (nullable)", () => {
      const schema = files({ accept: "application/pdf" }).nullable();
      expect(schema["executeAssert"]("path" as SourcePath, null)).toEqual({
        success: true,
        data: null,
      });
    });

    test("should return error if src is not an object", () => {
      const schema = files({ accept: "application/pdf" });
      const result = schema["executeAssert"]("path" as SourcePath, "test");
      expect(result.success).toEqual(false);
    });

    test("should return error if src is an array", () => {
      const schema = files({ accept: "application/pdf" });
      const result = schema["executeAssert"]("path" as SourcePath, []);
      expect(result.success).toEqual(false);
    });
  });

  describe("validate", () => {
    test("should validate directory prefix", () => {
      const schema = files({
        accept: "application/pdf",
        directory: "/public/val/documents",
      });
      const src: Record<string, FilesEntryMetadata> = {
        "/public/val/wrong/document.pdf": {
          mimeType: "application/pdf",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(result).toBeTruthy();
      const allErrors = Object.values(result as object).flat();
      const dirError = allErrors.find((e: { message: string }) =>
        e.message.includes("must be within"),
      );
      expect(dirError).toBeTruthy();
      expect((dirError as { message: string }).message).toContain(
        "must be within the /public/val/documents/ directory",
      );
    });

    test("should accept valid directory prefix", () => {
      const schema = files({
        accept: "application/pdf",
        directory: "/public/val/documents",
      });
      const src: Record<string, FilesEntryMetadata> = {
        "/public/val/documents/report.pdf": {
          mimeType: "application/pdf",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      // Should not have directory error
      const filteredResult0 = filterCheckErrors(result);
      if (filteredResult0) {
        const errors = Object.values(filteredResult0 as object).flat();
        const hasDirError = errors.some((e: { message: string }) =>
          e.message.includes("directory"),
        );
        expect(hasDirError).toBe(false);
      }
    });

    test("should validate mimeType against accept pattern", () => {
      const schema = files({ accept: "application/pdf" });
      const src: Record<string, FilesEntryMetadata> = {
        "/public/val/document.docx": {
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(result).toBeTruthy();
      const allErrors = Object.values(result as object).flat();
      const mimeError = allErrors.find((e: { message: string }) =>
        e.message.includes("Mime type mismatch"),
      );
      expect(mimeError).toBeTruthy();
      expect((mimeError as { message: string }).message).toContain(
        "Mime type mismatch",
      );
    });

    test("should accept wildcard mimeType patterns", () => {
      const schema = files({ accept: "application/*" });
      const src: Record<string, FilesEntryMetadata> = {
        "/public/val/document.pdf": {
          mimeType: "application/pdf",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      // Should not have mime type error
      if (result) {
        const errors = Object.values(result as object).flat();
        const hasMimeError = errors.some((e: { message: string }) =>
          e.message.includes("Mime type mismatch"),
        );
        expect(hasMimeError).toBe(false);
      }
    });

    test("should accept any mimeType with */*", () => {
      const schema = files({ accept: "*/*" });
      const src: Record<string, FilesEntryMetadata> = {
        "/public/val/anything.xyz": {
          mimeType: "application/octet-stream",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      // Should not have mime type error
      if (result) {
        const errors = Object.values(result as object).flat();
        const hasMimeError = errors.some((e: { message: string }) =>
          e.message.includes("Mime type mismatch"),
        );
        expect(hasMimeError).toBe(false);
      }
    });

    test("should use default directory /public/val", () => {
      const schema = files({ accept: "application/pdf" });
      const src: Record<string, FilesEntryMetadata> = {
        "/public/val/document.pdf": {
          mimeType: "application/pdf",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      // Should not have directory error
      const filteredResult1 = filterCheckErrors(result);
      if (filteredResult1) {
        const errors = Object.values(filteredResult1 as object).flat();
        const hasDirError = errors.some((e: { message: string }) =>
          e.message.includes("directory"),
        );
        expect(hasDirError).toBe(false);
      }
    });

    test("should accept /public as directory", () => {
      const schema = files({
        accept: "application/pdf",
        directory: "/public",
      });
      const src: Record<string, FilesEntryMetadata> = {
        "/public/document.pdf": {
          mimeType: "application/pdf",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      // Should not have directory error
      const filteredResult2 = filterCheckErrors(result);
      if (filteredResult2) {
        const errors = Object.values(filteredResult2 as object).flat();
        const hasDirError = errors.some((e: { message: string }) =>
          e.message.includes("directory"),
        );
        expect(hasDirError).toBe(false);
      }
    });

    test("should validate mimeType is a string", () => {
      const schema = files({ accept: "application/pdf" });
      const src = {
        "/public/val/document.pdf": {
          mimeType: 123,
        },
      };
      const result = schema["executeValidate"](
        "path" as SourcePath,
        src as unknown as Record<string, FilesEntryMetadata>,
      );
      expect(result).toBeTruthy();
    });
  });

  describe("serialization", () => {
    test("should serialize with correct type", () => {
      const schema = files({ accept: "application/pdf" });
      const serialized = schema["executeSerialize"]();
      expect(serialized.type).toBe("record");
      expect((serialized as SerializedFilesSchema).mediaType).toBe("files");
      expect(serialized.accept).toBe("application/pdf");
      expect(serialized.directory).toBe("/public/val");
      expect(serialized.opt).toBe(false);
      expect(serialized.remote).toBe(false);
    });

    test("should serialize with custom directory", () => {
      const schema = files({
        accept: "application/pdf",
        directory: "/public/val/custom",
      });
      const serialized = schema["executeSerialize"]();
      expect(serialized.directory).toBe("/public/val/custom");
    });

    test("should serialize remote flag", () => {
      const schema = files({ accept: "application/pdf" }).remote();
      const serialized = schema["executeSerialize"]();
      expect(serialized.remote).toBe(true);
    });

    test("should serialize nullable flag", () => {
      const schema = files({ accept: "application/pdf" }).nullable();
      const serialized = schema["executeSerialize"]();
      expect(serialized.opt).toBe(true);
    });
  });

  describe("remote", () => {
    test("should create remote variant", () => {
      const schema = files({ accept: "application/pdf" });
      const remoteSchema = schema.remote();
      expect(remoteSchema["executeSerialize"]().remote).toBe(true);
    });

    test("should reject remote URLs when remote is not enabled", () => {
      const schema = files({ accept: "application/pdf" });
      const src: Record<string, FilesEntryMetadata> = {
        "https://remote.val.build/file/p/proj123/b/01/v/1.0.0/h/abc123/f/def456/p/public/val/document.pdf":
          {
            mimeType: "application/pdf",
          },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(result).toBeTruthy();
      const errors = Object.values(result as object).flat();
      const hasRemoteError = errors.some((e: { message: string }) =>
        e.message.includes("Remote URLs are not allowed"),
      );
      expect(hasRemoteError).toBe(true);
    });

    test("should accept remote URLs when remote is enabled", () => {
      const schema = files({ accept: "application/pdf" }).remote();
      const src: Record<string, FilesEntryMetadata> = {
        "https://remote.val.build/file/p/proj123/b/01/v/1.0.0/h/abc123/f/def456/p/public/val/document.pdf":
          {
            mimeType: "application/pdf",
          },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(filterCheckErrors(result)).toBeFalsy();
    });

    test("should accept local paths when remote is enabled", () => {
      const schema = files({
        accept: "application/pdf",
        directory: "/public/val/documents",
      }).remote();
      const src: Record<string, FilesEntryMetadata> = {
        "/public/val/documents/local.pdf": {
          mimeType: "application/pdf",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      // Should not have path errors
      const filteredResult3 = filterCheckErrors(result);
      if (filteredResult3) {
        const errors = Object.values(filteredResult3 as object).flat();
        const hasPathError = errors.some(
          (e: { message: string }) =>
            e.message.includes("directory") || e.message.includes("Remote"),
        );
        expect(hasPathError).toBe(false);
      }
    });

    test("should accept mixed remote and local when remote is enabled", () => {
      const schema = files({
        accept: "application/pdf",
        directory: "/public/val/documents",
      }).remote();
      const src: Record<string, FilesEntryMetadata> = {
        "/public/val/documents/local.pdf": {
          mimeType: "application/pdf",
        },
        "https://remote.val.build/file/p/proj123/b/01/v/1.0.0/h/abc123/f/def456/p/public/val/documents/remote.pdf":
          {
            mimeType: "application/pdf",
          },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(filterCheckErrors(result)).toBeFalsy();
    });

    test("should reject invalid remote URLs", () => {
      const schema = files({ accept: "application/pdf" }).remote();
      const src: Record<string, FilesEntryMetadata> = {
        "not-a-valid-url": {
          mimeType: "application/pdf",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(result).toBeTruthy();
      const errors = Object.values(result as object).flat();
      const hasUrlError = errors.some((e: { message: string }) =>
        e.message.includes("Expected a remote URL"),
      );
      expect(hasUrlError).toBe(true);
    });

    test("should reject paths outside directory when remote is enabled but path is not a URL", () => {
      const schema = files({
        accept: "application/pdf",
        directory: "/public/val/documents",
      }).remote();
      const src: Record<string, FilesEntryMetadata> = {
        "/public/other/document.pdf": {
          mimeType: "application/pdf",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(result).toBeTruthy();
      const errors = Object.values(result as object).flat();
      const hasError = errors.some((e: { message: string }) =>
        e.message.includes("Expected a remote URL"),
      );
      expect(hasError).toBe(true);
    });

    test("should accept http URLs when remote is enabled", () => {
      const schema = files({ accept: "application/pdf" }).remote();
      const src: Record<string, FilesEntryMetadata> = {
        "http://remote.val.build/file/p/proj123/b/01/v/1.0.0/h/abc123/f/def456/p/public/val/document.pdf":
          {
            mimeType: "application/pdf",
          },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(filterCheckErrors(result)).toBeFalsy();
    });

    test("should reject non-Val remote URLs", () => {
      const schema = files({ accept: "application/pdf" }).remote();
      const src: Record<string, FilesEntryMetadata> = {
        "https://example.com/document.pdf": {
          mimeType: "application/pdf",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(result).toBeTruthy();
      const errors = Object.values(result as object).flat();
      const hasInvalidFormatError = errors.some((e: { message: string }) =>
        e.message.includes("Invalid remote URL format"),
      );
      expect(hasInvalidFormatError).toBe(true);
    });

    test("should reject remote URLs with wrong directory in path", () => {
      const schema = files({
        accept: "application/pdf",
        directory: "/public/val/documents",
      }).remote();
      const src: Record<string, FilesEntryMetadata> = {
        // Remote URL with public/val/other instead of public/val/documents
        "https://remote.val.build/file/p/proj123/b/01/v/1.0.0/h/abc123/f/def456/p/public/val/other/document.pdf":
          {
            mimeType: "application/pdf",
          },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(result).toBeTruthy();
      const errors = Object.values(result as object).flat();
      const hasDirectoryError = errors.some((e: { message: string }) =>
        e.message.includes("not in expected directory"),
      );
      expect(hasDirectoryError).toBe(true);
    });
  });

  describe("directory validation", () => {
    test("should reject paths with wrong prefix", () => {
      const schema = files({
        accept: "application/pdf",
        directory: "/public/val/documents",
      });
      const src: Record<string, FilesEntryMetadata> = {
        "/wrong/path/document.pdf": {
          mimeType: "application/pdf",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(result).toBeTruthy();
      const errors = Object.values(result as object).flat();
      const hasDirError = errors.some((e: { message: string }) =>
        e.message.includes("directory"),
      );
      expect(hasDirError).toBe(true);
    });

    test("should accept paths with exact directory match", () => {
      const schema = files({
        accept: "application/pdf",
        directory: "/public",
      });
      const src: Record<string, FilesEntryMetadata> = {
        "/public/document.pdf": {
          mimeType: "application/pdf",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      // Should not have directory error
      const filteredResult4 = filterCheckErrors(result);
      if (filteredResult4) {
        const errors = Object.values(filteredResult4 as object).flat();
        const hasDirError = errors.some((e: { message: string }) =>
          e.message.includes("directory"),
        );
        expect(hasDirError).toBe(false);
      }
    });

    test("should accept paths in subdirectories", () => {
      const schema = files({
        accept: "application/pdf",
        directory: "/public/val",
      });
      const src: Record<string, FilesEntryMetadata> = {
        "/public/val/nested/deep/document.pdf": {
          mimeType: "application/pdf",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      // Should not have directory error
      const filteredResult5 = filterCheckErrors(result);
      if (filteredResult5) {
        const errors = Object.values(filteredResult5 as object).flat();
        const hasDirError = errors.some((e: { message: string }) =>
          e.message.includes("directory"),
        );
        expect(hasDirError).toBe(false);
      }
    });
  });

  describe("custom validation", () => {
    test("should support custom validation function", () => {
      const schema = files({ accept: "application/pdf" }).validate((src) => {
        if (Object.keys(src ?? {}).length === 0) {
          return "At least one file is required";
        }
        return false;
      });
      const src: Record<string, FilesEntryMetadata> = {};
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(result).toBeTruthy();
      const errors = Object.values(result as object).flat();
      const hasCustomError = errors.some((e: { message: string }) =>
        e.message.includes("At least one file is required"),
      );
      expect(hasCustomError).toBe(true);
    });
  });

  describe("accept patterns", () => {
    test("should accept comma-separated mime types", () => {
      const schema = files({ accept: "application/pdf, application/msword" });
      const src1: Record<string, FilesEntryMetadata> = {
        "/public/val/document.pdf": {
          mimeType: "application/pdf",
        },
      };
      const src2: Record<string, FilesEntryMetadata> = {
        "/public/val/document.doc": {
          mimeType: "application/msword",
        },
      };
      const result1 = schema["executeValidate"]("path" as SourcePath, src1);
      const result2 = schema["executeValidate"]("path" as SourcePath, src2);
      // Neither should have mime type errors
      [result1, result2].forEach((result) => {
        if (result) {
          const errors = Object.values(result as object).flat();
          const hasMimeError = errors.some((e: { message: string }) =>
            e.message.includes("Mime type mismatch"),
          );
          expect(hasMimeError).toBe(false);
        }
      });
    });

    test("should reject mime types not in accept list", () => {
      const schema = files({ accept: "application/pdf, application/msword" });
      const src: Record<string, FilesEntryMetadata> = {
        "/public/val/document.txt": {
          mimeType: "text/plain",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(result).toBeTruthy();
      const errors = Object.values(result as object).flat();
      const hasMimeError = errors.some((e: { message: string }) =>
        e.message.includes("Mime type mismatch"),
      );
      expect(hasMimeError).toBe(true);
    });
  });
});
