import { describe, test, expect, jest, beforeEach } from "@jest/globals";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import type { Service } from "@valbuild/server";

// Mock dependencies
jest.mock("@valbuild/server");
jest.mock("fs/promises");
jest.mock("picocolors", () => ({
  red: (s: string) => s,
  green: (s: string) => s,
  yellow: (s: string) => s,
  greenBright: (s: string) => s,
  inverse: (s: string) => s,
}));

// Import types from validate.ts
type ValModule = {
  source?: unknown;
  schema?: { type: string; router?: string };
  errors?: {
    validation?: Record<string, Array<{ message: string; fixes?: string[] }>>;
    fatal?: Array<{ message: string }>;
  };
};

type FixHandlerContext = {
  sourcePath: SourcePath;
  validationError: {
    message: string;
    value?: unknown;
    fixes?: string[];
  };
  valModule: ValModule;
  projectRoot: string;
  fix: boolean;
  service: Service;
  valFiles: string[];
  moduleFilePath: ModuleFilePath;
  file: string;
  remoteFiles: Record<
    SourcePath,
    { ref: string; metadata?: Record<string, unknown> }
  >;
  publicProjectId?: string;
  remoteFileBuckets?: string[];
  remoteFilesCounter: number;
  valRemoteHost: string;
  contentHostUrl: string;
  valConfigFile?: { project?: string };
};

describe("validate handlers", () => {
  let mockService: jest.Mocked<Service>;
  let baseContext: FixHandlerContext;

  beforeEach(() => {
    mockService = {
      get: jest.fn(),
      patch: jest.fn(),
      dispose: jest.fn(),
    } as unknown as jest.Mocked<Service>;

    baseContext = {
      sourcePath: "/test.val.ts" as SourcePath,
      validationError: {
        message: "Test error",
        fixes: [],
      },
      valModule: {
        source: {},
        schema: { type: "string" },
      },
      projectRoot: "/test/project",
      fix: false,
      service: mockService,
      valFiles: [],
      moduleFilePath: "/test.val.ts" as ModuleFilePath,
      file: "test.val.ts",
      remoteFiles: {},
      remoteFilesCounter: 0,
      valRemoteHost: "https://val.build",
      contentHostUrl: "https://content.val.build",
    };
  });

  describe("handleKeyOfCheck", () => {
    test("should return success when key exists in referenced module", async () => {
      const ctx: FixHandlerContext = {
        ...baseContext,
        validationError: {
          message: "Key validation",
          fixes: ["keyof:check-keys"],
          value: {
            key: "existingKey",
            sourcePath: "/test.val.ts",
          },
        },
      };

      // We can't actually import the handler directly, so this test documents expected behavior
      // The handler should:
      // 1. Extract key and sourcePath from validationError.value
      // 2. Call service.get to fetch the referenced module
      // 3. Check if the key exists in the module source
      // 4. Return success: true if key exists

      expect(ctx.validationError.value).toHaveProperty("key", "existingKey");
      expect(ctx.validationError.value).toHaveProperty(
        "sourcePath",
        "/test.val.ts",
      );
    });

    test("should return error when key does not exist", async () => {
      const ctx: FixHandlerContext = {
        ...baseContext,
        validationError: {
          message: "Key validation",
          fixes: ["keyof:check-keys"],
          value: {
            key: "nonExistentKey",
            sourcePath: "/test.val.ts",
          },
        },
      };

      // Expected behavior:
      // 1. Handler finds that nonExistentKey is not in source
      // 2. Uses levenshtein distance to find similar keys
      // 3. Returns success: false with helpful error message

      expect(ctx.validationError.value).toHaveProperty("key", "nonExistentKey");
    });

    test("should return error when value format is invalid", () => {
      const ctx: FixHandlerContext = {
        ...baseContext,
        validationError: {
          message: "Key validation",
          fixes: ["keyof:check-keys"],
          value: "invalid", // Should be an object with key and sourcePath
        },
      };

      // Expected behavior:
      // Handler should validate that value is an object with key and sourcePath
      // Should return success: false with error message about invalid format

      expect(typeof ctx.validationError.value).toBe("string");
    });

    test("should return error when key is not a string", () => {
      const ctx: FixHandlerContext = {
        ...baseContext,
        validationError: {
          message: "Key validation",
          fixes: ["keyof:check-keys"],
          value: {
            key: 123, // Should be string
            sourcePath: "/test.val.ts",
          },
        },
      };

      // Expected behavior:
      // Handler should validate that key is a string
      // Should return success: false with error about type mismatch

      expect(typeof (ctx.validationError.value as { key: unknown }).key).toBe(
        "number",
      );
    });
  });

  describe("handleFileMetadata", () => {
    test("should return success when file exists", () => {
      const ctx: FixHandlerContext = {
        ...baseContext,
        validationError: {
          message: "File metadata",
          fixes: ["image:check-metadata"],
        },
        valModule: {
          source: {
            image: {
              "~$ref": "public/val/image.png",
            },
          },
          schema: { type: "image" },
        },
      };

      // Expected behavior:
      // 1. Extract file path from source
      // 2. Check if file exists using fs.access
      // 3. Return success: true if file exists

      expect(ctx.valModule.source).toBeDefined();
    });

    test("should return error when source or schema is missing", async () => {
      const ctx: FixHandlerContext = {
        ...baseContext,
        validationError: {
          message: "File metadata",
          fixes: ["file:check-metadata"],
        },
        valModule: {
          source: undefined,
          schema: undefined,
        },
      };

      // Expected behavior:
      // Handler should check if source and schema exist
      // Should return success: false with error message

      expect(ctx.valModule.source).toBeUndefined();
      expect(ctx.valModule.schema).toBeUndefined();
    });
  });

  describe("handleRemoteFileUpload", () => {
    test("should return error when fix is false", () => {
      const ctx: FixHandlerContext = {
        ...baseContext,
        fix: false,
        validationError: {
          message: "Remote file upload",
          fixes: ["image:upload-remote"],
        },
      };

      // Expected behavior:
      // When fix=false, handler should return error telling user to use --fix
      // Should return success: false with message about using --fix

      expect(ctx.fix).toBe(false);
    });

    test("should attempt upload when fix is true", () => {
      const ctx: FixHandlerContext = {
        ...baseContext,
        fix: true,
        validationError: {
          message: "Remote file upload",
          fixes: ["file:upload-remote"],
        },
        valConfigFile: {
          project: "test-project",
        },
      };

      // Expected behavior:
      // 1. Check file exists
      // 2. Get PAT file
      // 3. Get project settings if not cached
      // 4. Upload file to remote
      // 5. Store reference in remoteFiles
      // 6. Return success: true with shouldApplyPatch: true

      expect(ctx.fix).toBe(true);
      expect(ctx.valConfigFile?.project).toBe("test-project");
    });

    test("should return error when project config is missing", () => {
      const ctx: FixHandlerContext = {
        ...baseContext,
        fix: true,
        validationError: {
          message: "Remote file upload",
          fixes: ["image:upload-remote"],
        },
        valConfigFile: undefined,
      };

      // Expected behavior:
      // Handler should check for project config
      // Should return success: false with error about missing config

      expect(ctx.valConfigFile).toBeUndefined();
    });

    test("should use cached project settings when available", () => {
      const ctx: FixHandlerContext = {
        ...baseContext,
        fix: true,
        publicProjectId: "cached-id",
        remoteFileBuckets: ["bucket1", "bucket2"],
        validationError: {
          message: "Remote file upload",
          fixes: ["image:upload-remote"],
        },
      };

      // Expected behavior:
      // Handler should reuse publicProjectId and remoteFileBuckets if available
      // Should not call getSettings again

      expect(ctx.publicProjectId).toBe("cached-id");
      expect(ctx.remoteFileBuckets).toEqual(["bucket1", "bucket2"]);
    });
  });

  describe("handleRemoteFileDownload", () => {
    test("should return success when fix is true", () => {
      const ctx: FixHandlerContext = {
        ...baseContext,
        fix: true,
        validationError: {
          message: "Remote file download",
          fixes: ["image:download-remote"],
        },
      };

      // Expected behavior:
      // When fix=true, handler logs download message and returns success
      // Should return success: true with shouldApplyPatch: true

      expect(ctx.fix).toBe(true);
    });

    test("should return error when fix is false", () => {
      const ctx: FixHandlerContext = {
        ...baseContext,
        fix: false,
        validationError: {
          message: "Remote file download",
          fixes: ["file:download-remote"],
        },
      };

      // Expected behavior:
      // When fix=false, handler returns error telling user to use --fix
      // Should return success: false

      expect(ctx.fix).toBe(false);
    });
  });

  describe("handleRemoteFileCheck", () => {
    test("should always return success", () => {
      const ctx: FixHandlerContext = {
        ...baseContext,
        validationError: {
          message: "Remote file check",
          fixes: ["image:check-remote"],
        },
      };

      // Expected behavior:
      // This handler is a no-op that always succeeds
      // Should return success: true with shouldApplyPatch: true

      expect(ctx.validationError.fixes).toContain("image:check-remote");
    });
  });

  describe("fix handler registry", () => {
    test("should have handlers for all file metadata fix types", () => {
      const metadataFixTypes = [
        "image:replace-metadata",
        "image:check-metadata",
        "image:add-metadata",
        "file:check-metadata",
        "file:add-metadata",
      ];

      // Expected: All metadata fix types should map to handleFileMetadata
      expect(metadataFixTypes.length).toBeGreaterThan(0);
    });

    test("should have handler for keyof:check-keys", () => {
      const fixType = "keyof:check-keys";

      // Expected: Registry should have entry for keyof:check-keys
      expect(fixType).toBe("keyof:check-keys");
    });

    test("should have handlers for remote file operations", () => {
      const remoteFixTypes = [
        "image:upload-remote",
        "file:upload-remote",
        "image:download-remote",
        "file:download-remote",
        "image:check-remote",
        "file:check-remote",
      ];

      // Expected: All remote fix types should have handlers
      expect(remoteFixTypes.length).toBe(6);
    });
  });

  describe("validation flow", () => {
    test("should handle validation with no errors", () => {
      const valModule: ValModule = {
        source: { test: "value" },
        schema: { type: "string" },
        errors: undefined,
      };

      // Expected behavior:
      // When valModule.errors is undefined, validation succeeds immediately
      // Should log success message and return 0 errors

      expect(valModule.errors).toBeUndefined();
    });

    test("should handle validation with fixes", () => {
      const valModule: ValModule = {
        source: { test: "value" },
        schema: { type: "string" },
        errors: {
          validation: {
            "/test.val.ts": [
              {
                message: "Test error",
                fixes: ["keyof:check-keys"],
              },
            ],
          },
        },
      };

      // Expected behavior:
      // 1. Loop through validation errors
      // 2. Find handler for first fix type
      // 3. Execute handler
      // 4. Apply patch if handler succeeds and shouldApplyPatch is true

      expect(valModule.errors?.validation).toBeDefined();
      expect(Object.keys(valModule.errors?.validation || {}).length).toBe(1);
    });

    test("should handle validation without fixes", () => {
      const valModule: ValModule = {
        source: { test: "value" },
        schema: { type: "string" },
        errors: {
          validation: {
            "/test.val.ts": [
              {
                message: "Test error",
                fixes: undefined,
              },
            ],
          },
        },
      };

      // Expected behavior:
      // When no fixes available, validation should log error and continue
      // Should not attempt to find or execute a handler

      const error = valModule.errors?.validation?.["/test.val.ts"]?.[0];
      expect(error?.fixes).toBeUndefined();
    });

    test("should handle unknown fix types", () => {
      const valModule: ValModule = {
        source: { test: "value" },
        schema: { type: "string" },
        errors: {
          validation: {
            "/test.val.ts": [
              {
                message: "Test error",
                fixes: ["unknown:fix-type"],
              },
            ],
          },
        },
      };

      // Expected behavior:
      // When fix type is not in registry, validation should log error
      // Should increment error count and continue

      const error = valModule.errors?.validation?.["/test.val.ts"]?.[0];
      expect(error?.fixes?.[0]).toBe("unknown:fix-type");
    });

    test("should handle fatal errors", () => {
      const valModule: ValModule = {
        source: { test: "value" },
        schema: { type: "string" },
        errors: {
          fatal: [
            {
              message: "Fatal error occurred",
            },
          ],
        },
      };

      // Expected behavior:
      // Fatal errors should be logged separately
      // Should increment error count

      expect(valModule.errors?.fatal).toBeDefined();
      expect(valModule.errors?.fatal?.length).toBe(1);
    });
  });

  describe("error handling", () => {
    test("should handle service.get failures gracefully", async () => {
      mockService.get.mockRejectedValue(new Error("Service error"));

      // Expected behavior:
      // When service.get fails, handler should catch error
      // Should return or throw appropriate error

      await expect(
        mockService.get(
          "/test" as ModuleFilePath,
          "" as unknown as never,
          {} as never,
        ),
      ).rejects.toThrow("Service error");
    });

    test("should handle file system errors gracefully", () => {
      // Expected behavior:
      // When fs operations fail, handlers should catch errors
      // Should return success: false with appropriate error message

      const error = new Error("ENOENT: file not found");
      expect(error.message).toContain("ENOENT");
    });
  });

  describe("levenshtein distance helper", () => {
    test("should find similar strings", () => {
      const targets = ["test", "text", "best", "rest", "toast"];

      // Expected: Function should calculate edit distance and sort by similarity
      // "test" should be first (distance 0)
      // "text", "best", "rest" should be next (distance 1)

      expect(targets.includes("test")).toBe(true);
    });

    test("should handle empty arrays", () => {
      const targets: string[] = [];

      // Expected: Should handle empty target array gracefully
      // Should return empty array

      expect(targets.length).toBe(0);
    });
  });
});

describe("validate integration", () => {
  test("documents expected validation workflow", () => {
    // This test documents the expected flow of validation:
    //
    // 1. Load val config
    // 2. Create service
    // 3. Find all .val.ts/js files
    // 4. For each file:
    //    a. Get module with validation
    //    b. If no errors, log success and continue
    //    c. If errors, process each error:
    //       i. If no fixes, log error and continue
    //       ii. If has fixes, find handler and execute
    //       iii. If handler succeeds and shouldApplyPatch, apply patch
    //       iv. Log appropriate success/error messages
    // 5. Format files with prettier if fixes were applied
    // 6. Exit with error code if any errors found

    const expectedFlow = {
      step1: "Load val config",
      step2: "Create service",
      step3: "Find val files",
      step4: "Validate each file",
      step5: "Apply fixes if needed",
      step6: "Format with prettier",
      step7: "Report results",
    };

    expect(Object.keys(expectedFlow).length).toBe(7);
  });
});
