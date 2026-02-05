import { SourcePath } from "../val";
import { images, ImagesEntryMetadata } from "./images";
import { string } from "./string";

describe("ImagesSchema", () => {
  describe("assert", () => {
    test("should return success if src is a valid images object", () => {
      const schema = images({ accept: "image/webp" });
      const src: Record<string, ImagesEntryMetadata> = {
        "/public/val/test.webp": {
          width: 800,
          height: 600,
          mimeType: "image/webp",
          alt: "Test image",
        },
      };
      expect(schema["executeAssert"]("path" as SourcePath, src)).toEqual({
        success: true,
        data: src,
      });
    });

    test("should return error if src is null (non-nullable)", () => {
      const schema = images({ accept: "image/webp" });
      const result = schema["executeAssert"]("path" as SourcePath, null);
      expect(result.success).toEqual(false);
    });

    test("should return success if src is null (nullable)", () => {
      const schema = images({ accept: "image/webp" }).nullable();
      expect(schema["executeAssert"]("path" as SourcePath, null)).toEqual({
        success: true,
        data: null,
      });
    });

    test("should return error if src is not an object", () => {
      const schema = images({ accept: "image/webp" });
      const result = schema["executeAssert"]("path" as SourcePath, "test");
      expect(result.success).toEqual(false);
    });

    test("should return error if src is an array", () => {
      const schema = images({ accept: "image/webp" });
      const result = schema["executeAssert"]("path" as SourcePath, []);
      expect(result.success).toEqual(false);
    });
  });

  describe("validate", () => {
    test("should validate directory prefix", () => {
      const schema = images({
        accept: "image/webp",
        directory: "/public/val/images",
      });
      const src: Record<string, ImagesEntryMetadata> = {
        "/public/val/wrong/test.webp": {
          width: 800,
          height: 600,
          mimeType: "image/webp",
          alt: "Test image",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(result).toBeTruthy();
      expect(Object.values(result as object)[0][0].message).toContain(
        "must be within the /public/val/images/ directory",
      );
    });

    test("should accept valid directory prefix", () => {
      const schema = images({
        accept: "image/webp",
        directory: "/public/val/images",
      });
      const src: Record<string, ImagesEntryMetadata> = {
        "/public/val/images/test.webp": {
          width: 800,
          height: 600,
          mimeType: "image/webp",
          alt: "Test image",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      // Should not have directory error since path is valid
      if (result) {
        const errors = Object.values(result as object).flat();
        const hasDirError = errors.some((e: { message: string }) =>
          e.message.includes("directory"),
        );
        expect(hasDirError).toBe(false);
      }
    });

    test("should validate mimeType against accept pattern", () => {
      const schema = images({ accept: "image/webp" });
      const src: Record<string, ImagesEntryMetadata> = {
        "/public/val/test.png": {
          width: 800,
          height: 600,
          mimeType: "image/png",
          alt: "Test image",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(result).toBeTruthy();
      expect(Object.values(result as object)[0][0].message).toContain(
        "Mime type mismatch",
      );
    });

    test("should accept wildcard mimeType patterns", () => {
      const schema = images({ accept: "image/*" });
      const src: Record<string, ImagesEntryMetadata> = {
        "/public/val/test.png": {
          width: 800,
          height: 600,
          mimeType: "image/png",
          alt: "Test image",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      // Should not have mime type error (but may have metadata check error)
      if (result) {
        const errors = Object.values(result as object).flat();
        const hasMimeError = errors.some((e: { message: string }) =>
          e.message.includes("Mime type mismatch"),
        );
        expect(hasMimeError).toBe(false);
      }
    });

    test("should validate required width and height", () => {
      const schema = images({ accept: "image/webp" });
      const src = {
        "/public/val/test.webp": {
          mimeType: "image/webp",
          alt: "Test image",
        },
      };
      const result = schema["executeValidate"](
        "path" as SourcePath,
        src as unknown as Record<string, ImagesEntryMetadata>,
      );
      expect(result).toBeTruthy();
    });

    test("should validate alt with custom alt schema", () => {
      const schema = images({
        accept: "image/webp",
        alt: string().minLength(10),
      });
      const src: Record<string, ImagesEntryMetadata> = {
        "/public/val/test.webp": {
          width: 800,
          height: 600,
          mimeType: "image/webp",
          alt: "Short", // Less than 10 chars
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(result).toBeTruthy();
    });

    test("should allow null alt when using nullable alt schema", () => {
      const schema = images({
        accept: "image/webp",
        alt: string().nullable(),
      });
      const src: Record<string, ImagesEntryMetadata> = {
        "/public/val/test.webp": {
          width: 800,
          height: 600,
          mimeType: "image/webp",
          alt: null,
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      // Should not have alt-related errors
      if (result) {
        const errors = Object.values(result as object).flat();
        const hasAltError = errors.some(
          (e: { message: string }) =>
            e.message.includes("alt") || e.message.includes("string"),
        );
        expect(hasAltError).toBe(false);
      }
    });

    test("should use default directory /public/val", () => {
      const schema = images({ accept: "image/webp" });
      const src: Record<string, ImagesEntryMetadata> = {
        "/public/val/test.webp": {
          width: 800,
          height: 600,
          mimeType: "image/webp",
          alt: "Test",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      // Should not have directory error
      if (result) {
        const errors = Object.values(result as object).flat();
        const hasDirError = errors.some((e: { message: string }) =>
          e.message.includes("directory"),
        );
        expect(hasDirError).toBe(false);
      }
    });

    test("should validate hotspot if present", () => {
      const schema = images({ accept: "image/webp" });
      const src = {
        "/public/val/test.webp": {
          width: 800,
          height: 600,
          mimeType: "image/webp",
          alt: "Test",
          hotspot: { x: "invalid", y: 0.5 },
        },
      };
      const result = schema["executeValidate"](
        "path" as SourcePath,
        src as unknown as Record<string, ImagesEntryMetadata>,
      );
      expect(result).toBeTruthy();
    });
  });

  describe("serialization", () => {
    test("should serialize with correct type", () => {
      const schema = images({ accept: "image/webp" });
      const serialized = schema["executeSerialize"]();
      expect(serialized.type).toBe("images");
      expect(serialized.accept).toBe("image/webp");
      expect(serialized.directory).toBe("/public/val");
      expect(serialized.opt).toBe(false);
      expect(serialized.remote).toBe(false);
    });

    test("should serialize with custom directory", () => {
      const schema = images({
        accept: "image/png",
        directory: "/public/val/custom",
      });
      const serialized = schema["executeSerialize"]();
      expect(serialized.directory).toBe("/public/val/custom");
    });

    test("should serialize remote flag", () => {
      const schema = images({ accept: "image/webp" }).remote();
      const serialized = schema["executeSerialize"]();
      expect(serialized.remote).toBe(true);
    });

    test("should serialize nullable flag", () => {
      const schema = images({ accept: "image/webp" }).nullable();
      const serialized = schema["executeSerialize"]();
      expect(serialized.opt).toBe(true);
    });
  });

  describe("remote", () => {
    test("should create remote variant", () => {
      const schema = images({ accept: "image/webp" });
      const remoteSchema = schema.remote();
      expect(remoteSchema["executeSerialize"]().remote).toBe(true);
    });

    test("should reject remote URLs when remote is not enabled", () => {
      const schema = images({ accept: "image/webp" });
      const src: Record<string, ImagesEntryMetadata> = {
        "https://remote.val.build/file/p/proj123/b/01/v/1.0.0/h/abc123/f/def456/p/public/val/image.webp":
          {
            width: 800,
            height: 600,
            mimeType: "image/webp",
            alt: "Remote image",
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
      const schema = images({ accept: "image/webp" }).remote();
      const src: Record<string, ImagesEntryMetadata> = {
        "https://remote.val.build/file/p/proj123/b/01/v/1.0.0/h/abc123/f/def456/p/public/val/image.webp":
          {
            width: 800,
            height: 600,
            mimeType: "image/webp",
            alt: "Remote image",
          },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(result).toBeFalsy();
    });

    test("should accept local paths when remote is enabled", () => {
      const schema = images({
        accept: "image/webp",
        directory: "/public/val/images",
      }).remote();
      const src: Record<string, ImagesEntryMetadata> = {
        "/public/val/images/local.webp": {
          width: 800,
          height: 600,
          mimeType: "image/webp",
          alt: "Local image",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      // Should not have path errors
      if (result) {
        const errors = Object.values(result as object).flat();
        const hasPathError = errors.some(
          (e: { message: string }) =>
            e.message.includes("directory") || e.message.includes("Remote"),
        );
        expect(hasPathError).toBe(false);
      }
    });

    test("should accept mixed remote and local when remote is enabled", () => {
      const schema = images({
        accept: "image/webp",
        directory: "/public/val/images",
      }).remote();
      const src: Record<string, ImagesEntryMetadata> = {
        "/public/val/images/local.webp": {
          width: 800,
          height: 600,
          mimeType: "image/webp",
          alt: "Local image",
        },
        "https://remote.val.build/file/p/proj123/b/01/v/1.0.0/h/abc123/f/def456/p/public/val/images/remote.webp":
          {
            width: 1920,
            height: 1080,
            mimeType: "image/webp",
            alt: "Remote image",
          },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(result).toBeFalsy();
    });

    test("should reject invalid remote URLs", () => {
      const schema = images({ accept: "image/webp" }).remote();
      const src: Record<string, ImagesEntryMetadata> = {
        "not-a-valid-url": {
          width: 800,
          height: 600,
          mimeType: "image/webp",
          alt: "Invalid URL",
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
      const schema = images({
        accept: "image/webp",
        directory: "/public/val/images",
      }).remote();
      const src: Record<string, ImagesEntryMetadata> = {
        "/public/other/image.webp": {
          width: 800,
          height: 600,
          mimeType: "image/webp",
          alt: "Wrong directory",
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
      const schema = images({ accept: "image/webp" }).remote();
      const src: Record<string, ImagesEntryMetadata> = {
        "http://remote.val.build/file/p/proj123/b/01/v/1.0.0/h/abc123/f/def456/p/public/val/image.webp":
          {
            width: 800,
            height: 600,
            mimeType: "image/webp",
            alt: "HTTP image",
          },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(result).toBeFalsy();
    });

    test("should reject non-Val remote URLs", () => {
      const schema = images({ accept: "image/webp" }).remote();
      const src: Record<string, ImagesEntryMetadata> = {
        "https://example.com/image.webp": {
          width: 800,
          height: 600,
          mimeType: "image/webp",
          alt: "External image",
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
      const schema = images({
        accept: "image/webp",
        directory: "/public/val/images",
      }).remote();
      const src: Record<string, ImagesEntryMetadata> = {
        // Remote URL with public/val/other instead of public/val/images
        "https://remote.val.build/file/p/proj123/b/01/v/1.0.0/h/abc123/f/def456/p/public/val/other/image.webp":
          {
            width: 800,
            height: 600,
            mimeType: "image/webp",
            alt: "Wrong directory in remote",
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
      const schema = images({
        accept: "image/webp",
        directory: "/public/val/images",
      });
      const src: Record<string, ImagesEntryMetadata> = {
        "/wrong/path/image.webp": {
          width: 800,
          height: 600,
          mimeType: "image/webp",
          alt: "Wrong path",
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
      const schema = images({
        accept: "image/webp",
        directory: "/public",
      });
      const src: Record<string, ImagesEntryMetadata> = {
        "/public/image.webp": {
          width: 800,
          height: 600,
          mimeType: "image/webp",
          alt: "Public root image",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      // Should not have directory error
      if (result) {
        const errors = Object.values(result as object).flat();
        const hasDirError = errors.some((e: { message: string }) =>
          e.message.includes("directory"),
        );
        expect(hasDirError).toBe(false);
      }
    });

    test("should accept paths in subdirectories", () => {
      const schema = images({
        accept: "image/webp",
        directory: "/public/val",
      });
      const src: Record<string, ImagesEntryMetadata> = {
        "/public/val/nested/deep/image.webp": {
          width: 800,
          height: 600,
          mimeType: "image/webp",
          alt: "Nested image",
        },
      };
      const result = schema["executeValidate"]("path" as SourcePath, src);
      // Should not have directory error
      if (result) {
        const errors = Object.values(result as object).flat();
        const hasDirError = errors.some((e: { message: string }) =>
          e.message.includes("directory"),
        );
        expect(hasDirError).toBe(false);
      }
    });
  });

  describe("custom validation", () => {
    test("should support custom validation function", () => {
      const schema = images({ accept: "image/webp" }).validate((src) => {
        if (Object.keys(src ?? {}).length === 0) {
          return "At least one image is required";
        }
        return false;
      });
      const src: Record<string, ImagesEntryMetadata> = {};
      const result = schema["executeValidate"]("path" as SourcePath, src);
      expect(result).toBeTruthy();
      const errors = Object.values(result as object).flat();
      const hasCustomError = errors.some((e: { message: string }) =>
        e.message.includes("At least one image is required"),
      );
      expect(hasCustomError).toBe(true);
    });
  });
});
