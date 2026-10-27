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

  /**
   * A collection KEY that is wrong as a key: a remote URL in a gallery that
   * is not `.remote()`, one that does not parse, one outside the gallery's
   * directory. Nothing repairs it on save, and `--fix` will not either — only
   * a person knows whether the key or the gallery's options are the mistake.
   * Hiding it also took it off the publish gate, so it went out unseen.
   */
  test.each([
    "images:check-remote",
    "files:check-remote",
    "videos:check-remote",
  ] as const)("%s is surfaced: nothing repairs a bad key", (fix) => {
    const error: ValidationError = {
      message: "Remote URLs are not allowed. Use .remote()",
      value: "https://remote.val.build/file/p/x",
      fixes: [fix],
      keyError: true,
    };
    const { surfaced, skipped } = partitionValidationErrors({
      [sp('/content/images.val.ts?p="https://remote.val.build/file/p/x"')]: [
        error,
      ],
    });
    expect(surfaced).toEqual({
      [sp('/content/images.val.ts?p="https://remote.val.build/file/p/x"')]: [
        error,
      ],
    });
    expect(skipped).toEqual({});
  });

  test.each(["image:check-remote", "file:check-remote"] as const)(
    "%s stays skipped: it is core's 'not checked' marker on every remote value",
    (fix) => {
      const error: ValidationError = {
        message: "Remote image was not checked.",
        fixes: [fix],
      };
      const { surfaced } = partitionValidationErrors({
        [sp("/content/page.val.ts")]: [error],
      });
      expect(surfaced).toEqual({});
    },
  );

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
