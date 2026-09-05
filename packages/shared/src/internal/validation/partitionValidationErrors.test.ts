import type { SourcePath, ValidationError } from "@valbuild/core";
import { partitionValidationErrors } from "./partitionValidationErrors";

const sp = (s: string) => s as SourcePath;

describe("partitionValidationErrors", () => {
  test("errors with no fixes are surfaced", () => {
    const errors: Record<SourcePath, ValidationError[]> = {
      [sp("/content/page.val.ts")]: [{ message: "Required field" }],
    };
    const { surfaced, skipped } = partitionValidationErrors(errors);
    expect(surfaced).toEqual(errors);
    expect(skipped).toEqual({});
  });

  test("image:check-metadata is skipped", () => {
    const error: ValidationError = {
      message: "Image metadata missing",
      fixes: ["image:check-metadata"],
    };
    const { surfaced, skipped } = partitionValidationErrors({
      [sp("/content/page.val.ts")]: [error],
    });
    expect(surfaced).toEqual({});
    expect(skipped[sp("/content/page.val.ts")]).toEqual([error]);
  });

  test("file:check-metadata is skipped", () => {
    const error: ValidationError = {
      message: "File metadata missing",
      fixes: ["file:check-metadata"],
    };
    const { surfaced, skipped } = partitionValidationErrors({
      [sp("/content/page.val.ts")]: [error],
    });
    expect(surfaced).toEqual({});
    expect(skipped[sp("/content/page.val.ts")]).toEqual([error]);
  });

  test("images:check-unique-folder is skipped", () => {
    const error: ValidationError = {
      message: "Gallery directory must be unique",
      fixes: ["images:check-unique-folder"],
    };
    const { surfaced, skipped } = partitionValidationErrors({
      [sp("/content/gallery.val.ts")]: [error],
    });
    expect(surfaced).toEqual({});
    expect(skipped[sp("/content/gallery.val.ts")]).toEqual([error]);
  });

  test("images:check-all-files is skipped", () => {
    const error: ValidationError = {
      message: "Directory may have files not tracked",
      fixes: ["images:check-all-files"],
    };
    const { surfaced, skipped } = partitionValidationErrors({
      [sp("/content/gallery.val.ts")]: [error],
    });
    expect(surfaced).toEqual({});
    expect(skipped[sp("/content/gallery.val.ts")]).toEqual([error]);
  });

  test("image:upload-remote is skipped", () => {
    const error: ValidationError = {
      message: "Remote upload pending",
      fixes: ["image:upload-remote"],
    };
    const { surfaced, skipped } = partitionValidationErrors({
      [sp("/content/page.val.ts")]: [error],
    });
    expect(surfaced).toEqual({});
    expect(skipped[sp("/content/page.val.ts")]).toEqual([error]);
  });

  test("keyof:check-keys remnant is surfaced (defensive)", () => {
    const error: ValidationError = {
      message: "keyof not resolved",
      fixes: ["keyof:check-keys"],
    };
    const { surfaced, skipped } = partitionValidationErrors({
      [sp("/content/page.val.ts")]: [error],
    });
    expect(surfaced[sp("/content/page.val.ts")]).toEqual([error]);
    expect(skipped).toEqual({});
  });

  test("router:check-route remnant is surfaced (defensive)", () => {
    const error: ValidationError = {
      message: "route not resolved",
      fixes: ["router:check-route"],
    };
    const { surfaced, skipped } = partitionValidationErrors({
      [sp("/content/page.val.ts")]: [error],
    });
    expect(surfaced[sp("/content/page.val.ts")]).toEqual([error]);
    expect(skipped).toEqual({});
  });

  test("error with both a skippable and a non-skippable fix is surfaced", () => {
    const error: ValidationError = {
      message: "mixed fix set",
      fixes: ["image:check-metadata", "keyof:check-keys"],
    };
    const { surfaced, skipped } = partitionValidationErrors({
      [sp("/content/page.val.ts")]: [error],
    });
    expect(surfaced[sp("/content/page.val.ts")]).toEqual([error]);
    expect(skipped).toEqual({});
  });

  test("mixed bag splits per error", () => {
    const errors: Record<SourcePath, ValidationError[]> = {
      [sp("/content/page.val.ts")]: [
        { message: "real error" },
        { message: "image metadata", fixes: ["image:check-metadata"] },
        { message: "file metadata", fixes: ["file:check-metadata"] },
        { message: "gallery unique", fixes: ["images:check-unique-folder"] },
      ],
    };
    const { surfaced, skipped } = partitionValidationErrors(errors);
    expect(surfaced[sp("/content/page.val.ts")]).toHaveLength(1);
    expect(surfaced[sp("/content/page.val.ts")]?.[0]?.message).toBe(
      "real error",
    );
    expect(skipped[sp("/content/page.val.ts")]).toHaveLength(3);
  });

  test("source paths with no surfaced errors are absent from surfaced map", () => {
    const errors: Record<SourcePath, ValidationError[]> = {
      [sp("/content/page.val.ts")]: [
        { message: "img", fixes: ["image:check-metadata"] },
      ],
      [sp("/content/other.val.ts")]: [{ message: "real" }],
    };
    const { surfaced, skipped } = partitionValidationErrors(errors);
    expect(Object.keys(surfaced)).toEqual([sp("/content/other.val.ts")]);
    expect(Object.keys(skipped)).toEqual([sp("/content/page.val.ts")]);
  });
});
