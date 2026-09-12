import fs from "fs";
import os from "os";
import path from "path";
import { Internal, initVal } from "@valbuild/core";
import type {
  FileSchema,
  FileSource,
  ImageSchema,
  ImageSource,
  ModuleFilePath,
  SerializedImageSchema,
  SerializedSchema,
  SourcePath,
  ValidationError,
  ValidationErrors,
} from "@valbuild/core";
import { createValDiagnostics } from "./diagnostics";
import {
  isDeferredMediaMetadataCheck,
  isDeferredRemoteCheck,
  mediaCheckKey,
  resolveMediaChecks,
  type MediaCheckVerdict,
} from "./mediaChecks";
import type { ValModuleContent } from "./ValProject";

const { s } = initVal();

const MODULE_FILE_PATH = "/content/media.val.ts" as ModuleFilePath;
const SOURCE_PATH = MODULE_FILE_PATH as unknown as SourcePath;

/**
 * A 1x1 PNG. Small enough to inline, and `image-size` reads it, which is all
 * the adjudication needs from real bytes.
 */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8AAAAMBAQBBLXAyAAAAAElFTkSuQmCC",
  "base64",
);

type CoreVerdict = {
  errors: ValidationError[];
  schema: unknown;
  source: unknown;
};

/**
 * Run real core validation over a media value and hand back both the errors and
 * the serialized schema.
 *
 * The point of going through core rather than writing `ValidationError`
 * literals: these tests exist to check that
 * {@link isDeferredMediaMetadataCheck} agrees with
 * `ImageSchema.executeValidate` about which of its five `image:check-metadata`
 * errors is the unconditional placeholder. A literal would only check the
 * classifier against itself, and would keep passing after core changed.
 *
 * `executeValidate` and `executeSerialize` are reached by bracket access, as
 * they are from `@valbuild/server` (`ValOps`, `ValServer`).
 */
function validateImage(
  schema: ImageSchema<ImageSource>,
  source: ImageSource,
): CoreVerdict {
  const validation: ValidationErrors = schema["executeValidate"](
    SOURCE_PATH,
    source,
  );
  return {
    errors: validation === false ? [] : (validation[SOURCE_PATH] ?? []),
    schema: schema["executeSerialize"](),
    source,
  };
}

function validateFile(
  schema: FileSchema<FileSource>,
  source: FileSource,
): CoreVerdict {
  const validation: ValidationErrors = schema["executeValidate"](
    SOURCE_PATH,
    source,
  );
  return {
    errors: validation === false ? [] : (validation[SOURCE_PATH] ?? []),
    schema: schema["executeSerialize"](),
    source,
  };
}

/**
 * Narrow what `executeSerialize` hands back, which is the whole
 * `SerializedSchema` union, to the image schema `getValidationHash` wants.
 */
function asImageSchema(schema: SerializedSchema): SerializedImageSchema {
  if (schema.type !== "image") {
    throw Error(`Expected an image schema, got: ${schema.type}`);
  }
  return schema;
}

/** The single error core reported, failing loudly if it reported none or many. */
function onlyError(errors: ValidationError[]): ValidationError {
  expect(errors).toHaveLength(1);
  return errors[0];
}

describe("isDeferredMediaMetadataCheck: the five image errors core conflates", () => {
  /**
   * Core attaches `image:check-metadata` to five different errors. Four are
   * real findings about the mime type and must keep being shown; the fifth is a
   * placeholder that only means "nobody has read the file yet". Each case below
   * is driven through core, so the assertion is about core's actual output.
   */

  test("1. invalid mime type format is a real finding", () => {
    const { errors, schema } = validateImage(s.image({ accept: "image/png" }), {
      path: "/public/val/logo.png",
      width: 1,
      height: 1,
      mimeType: "png",
    });
    const error = onlyError(errors);
    expect(error.fixes).toContain("image:check-metadata");
    expect(isDeferredMediaMetadataCheck({ error, schema })).toBe(false);
  });

  test("2. a mime type the schema does not accept is a real finding", () => {
    const { errors, schema } = validateImage(
      s.image({ accept: "image/webp" }),
      {
        path: "/public/val/logo.png",
        width: 1,
        height: 1,
        mimeType: "image/png",
      },
    );
    const error = onlyError(errors);
    expect(error.fixes).toContain("image:check-metadata");
    expect(isDeferredMediaMetadataCheck({ error, schema })).toBe(false);
  });

  test("3. an extension with no known mime type is a real finding", () => {
    const { errors, schema } = validateImage(s.image(), {
      path: "/public/val/logo.unknownext",
      width: 1,
      height: 1,
      mimeType: "image/png",
    });
    const error = onlyError(errors);
    expect(error.fixes).toContain("image:check-metadata");
    expect(isDeferredMediaMetadataCheck({ error, schema })).toBe(false);
  });

  test("4. a mime type disagreeing with the extension is a real finding", () => {
    const { errors, schema } = validateImage(s.image(), {
      path: "/public/val/logo.png",
      width: 1,
      height: 1,
      mimeType: "image/jpeg",
    });
    const error = onlyError(errors);
    expect(error.fixes).toContain("image:check-metadata");
    expect(isDeferredMediaMetadataCheck({ error, schema })).toBe(false);
  });

  test("5. the fall-through IS the deferral", () => {
    const { errors, schema } = validateImage(s.image(), {
      path: "/public/val/logo.png",
      width: 1,
      height: 1,
      mimeType: "image/png",
    });
    const error = onlyError(errors);
    expect(error.fixes).toEqual(["image:check-metadata"]);
    expect(isDeferredMediaMetadataCheck({ error, schema })).toBe(true);
  });

  test("the deferral is what a wholly correct image gets, which is the bug", () => {
    // The reported symptom: a correct `s.image()` is still an error, on every
    // image in the project. Nothing about the value is wrong, so nothing but
    // reading the file can settle it.
    const { errors } = validateImage(s.image({ accept: "image/png" }), {
      path: "/public/val/logo.png",
      width: 944,
      height: 944,
      mimeType: "image/png",
      alt: "A logo",
    });
    expect(onlyError(errors).fixes).toEqual(["image:check-metadata"]);
  });

  test("a partially filled image is still the deferral, not a separate error", () => {
    // Core does not distinguish "mimeType missing" from "metadata unverified":
    // any one of the three being present takes the same branch. So this must be
    // adjudicated, and the adjudication is what notices the missing field.
    const { errors, schema } = validateImage(s.image(), {
      path: "/public/val/logo.png",
      width: 1,
      height: 1,
    });
    const error = onlyError(errors);
    expect(error.fixes).toEqual(["image:check-metadata"]);
    expect(isDeferredMediaMetadataCheck({ error, schema })).toBe(true);
  });

  test("wholly absent metadata is add-metadata, and is never deferred", () => {
    // Nothing is stored, so there is nothing to verify: the error stands on its
    // own and must keep being shown.
    const { errors, schema } = validateImage(s.image(), {
      path: "/public/val/logo.png",
    });
    const error = onlyError(errors);
    expect(error.fixes).toEqual(["image:add-metadata"]);
    expect(error.message).toBe(
      "Image metadata is missing: width, height and mimeType.",
    );
    expect(isDeferredMediaMetadataCheck({ error, schema })).toBe(false);
  });
});

describe("isDeferredMediaMetadataCheck: files", () => {
  /**
   * `FileSchema` tags only its fall-through, so `file:check-metadata` is
   * unambiguous and needs no re-derivation. These tests exist to notice if that
   * ever stops being true -- the classifier trusts it.
   */

  test("the fall-through IS the deferral", () => {
    const { errors, schema } = validateFile(s.file(), {
      path: "/public/val/doc.pdf",
      mimeType: "application/pdf",
    });
    const error = onlyError(errors);
    expect(error.fixes).toEqual(["file:check-metadata"]);
    expect(isDeferredMediaMetadataCheck({ error, schema })).toBe(true);
  });

  test("the four mime findings still carry no fixes at all", () => {
    const cases = [
      // accept set, mimeType has no "/"
      [s.file({ accept: "application/pdf" }), { mimeType: "pdf" }],
      // accept set and not satisfied
      [s.file({ accept: "image/png" }), { mimeType: "application/pdf" }],
      // extension with no known mime type
      [s.file(), { mimeType: "application/pdf", ext: ".unknownext" }],
      // mimeType disagreeing with the extension
      [s.file(), { mimeType: "image/png" }],
    ] as const;
    for (const [schema, spec] of cases) {
      const { errors } = validateFile(schema, {
        path: `/public/val/doc${"ext" in spec ? spec.ext : ".pdf"}`,
        mimeType: spec.mimeType,
      });
      expect(onlyError(errors).fixes).toBeUndefined();
    }
  });

  test("a missing mimeType is add-metadata, and is never deferred", () => {
    const { errors, schema } = validateFile(s.file(), {
      path: "/public/val/doc.pdf",
    });
    const error = onlyError(errors);
    expect(error.fixes).toEqual(["file:add-metadata"]);
    expect(error.message).toBe("File metadata is missing: mimeType.");
    expect(isDeferredMediaMetadataCheck({ error, schema })).toBe(false);
  });
});

describe("isDeferredMediaMetadataCheck: nothing to go on", () => {
  const deferral: ValidationError = {
    message: "Image metadata has not been checked against the file.",
    value: { path: "/public/val/logo.png" },
    fixes: ["image:check-metadata"],
  };

  test("an unrelated fix is not a metadata check", () => {
    expect(
      isDeferredMediaMetadataCheck({
        error: { ...deferral, fixes: ["image:check-remote"] },
        schema: { type: "image" },
      }),
    ).toBe(false);
  });

  test("an error with no fixes is not a metadata check", () => {
    expect(
      isDeferredMediaMetadataCheck({
        error: { message: "something else" },
        schema: { type: "image" },
      }),
    ).toBe(false);
  });

  test("an error with no media value keeps the error rather than assuming it is fine", () => {
    expect(
      isDeferredMediaMetadataCheck({
        error: { ...deferral, value: undefined },
        schema: { type: "image" },
      }),
    ).toBe(false);
  });

  test("an unresolvable schema still classifies from the value", () => {
    // Only `accept` lives on the schema, and a schema that failed to serialize
    // simply means there is no `accept` to check -- the filename and mimeType
    // conditions are still decidable, so this must not become noise.
    expect(
      isDeferredMediaMetadataCheck({
        error: {
          ...deferral,
          value: { path: "/public/val/logo.png", mimeType: "image/png" },
        },
        schema: undefined,
      }),
    ).toBe(true);
  });
});

describe("resolveMediaChecks", () => {
  let valRoot: string;

  const IMAGE_REF = "/public/val/logo.png";

  /**
   * `ValModuleContent` is what `Service.get` answers with. Only `source` and
   * `schema` are read from it here -- by `Internal.resolvePath` for the
   * classifier, and by `createFixPatch` for the comparison.
   */
  const contentFor = (source: unknown): ValModuleContent =>
    ({
      source,
      schema: s.image()["executeSerialize"](),
      errors: false,
      path: SOURCE_PATH,
    }) as ValModuleContent;

  const deferralFor = (value: unknown): ValidationError => ({
    message: "Image metadata has not been checked against the file.",
    value,
    fixes: ["image:check-metadata"],
  });

  const resolve = async (value: unknown) => {
    const error = deferralFor(value);
    const verdicts = await resolveMediaChecks({
      validation: { [SOURCE_PATH]: [error] },
      content: contentFor(value),
      valRoot,
    });
    return verdicts.get(mediaCheckKey(SOURCE_PATH, error));
  };

  const CORRECT = {
    path: IMAGE_REF,
    width: 1,
    height: 1,
    mimeType: "image/png",
  };

  beforeEach(() => {
    valRoot = fs.mkdtempSync(path.join(os.tmpdir(), "val-media-checks-"));
    fs.mkdirSync(path.join(valRoot, "public", "val"), { recursive: true });
    fs.writeFileSync(path.join(valRoot, IMAGE_REF), PNG_1X1);
  });

  afterEach(() => {
    fs.rmSync(valRoot, { recursive: true, force: true });
  });

  test("metadata that agrees with the file publishes nothing", async () => {
    // The whole point: this is the case that was warning on every image.
    expect(await resolve(CORRECT)).toEqual([]);
  });

  test("stale dimensions are reported, one finding per wrong field", async () => {
    const verdict = await resolve({
      path: IMAGE_REF,
      width: 800,
      height: 600,
      mimeType: "image/png",
    });
    expect(verdict).toHaveLength(2);
    // The CLI's own wording, because this is the CLI's own comparison.
    expect(verdict?.[0].message).toBe(
      "Image width is incorrect! Found: 800. Expected: 1",
    );
    expect(verdict?.[1].message).toBe(
      "Image height is incorrect! Found: 600. Expected: 1",
    );
  });

  test("a finding keeps the fix, so the quick fix and Warning severity survive", async () => {
    const verdict = await resolve({
      path: IMAGE_REF,
      width: 800,
      height: 600,
      mimeType: "image/png",
    });
    for (const finding of verdict ?? []) {
      expect(finding.fixes).toEqual(["image:check-metadata"]);
    }
  });

  test("a missing mimeType is reported as the mismatch it is", async () => {
    // This is the case the request was about: only what is actually absent or
    // wrong gets reported.
    const verdict = await resolve({ path: IMAGE_REF, width: 1, height: 1 });
    expect(verdict).toHaveLength(1);
    expect(verdict?.[0].message).toBe(
      "Image mimeType is incorrect! Found: <empty>. Expected: image/png",
    );
  });

  test("bytes that cannot be measured keep the placeholder", async () => {
    // `image-size` throws on bytes it cannot parse, so `createFixPatch` throws
    // too. There is nothing to say about the metadata, and inventing a second
    // opinion here would only disagree with what `val validate` reports.
    fs.writeFileSync(path.join(valRoot, IMAGE_REF), Buffer.from("not a png"));
    const verdict = await resolve({
      path: IMAGE_REF,
      width: 944,
      height: 944,
      mimeType: "image/png",
    });
    expect(verdict).toHaveLength(1);
    expect(verdict?.[0].message).toBe(
      "Image metadata has not been checked against the file.",
    );
  });

  test("an SVG with no intrinsic size keeps the placeholder", async () => {
    // `image-size` throws "Invalid SVG" for an SVG with no width, height or
    // viewBox -- which is a legitimate SVG, not a broken file. It must not be
    // reported as corrupt, and it must keep its fix.
    const svgRef = "/public/val/icon.svg";
    fs.writeFileSync(
      path.join(valRoot, svgRef),
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
    );
    const verdict = await resolve({
      path: svgRef,
      width: 10,
      height: 10,
      mimeType: "image/svg+xml",
    });
    expect(verdict).toHaveLength(1);
    expect(verdict?.[0].message).toBe(
      "Image metadata has not been checked against the file.",
    );
    expect(verdict?.[0].fixes).toEqual(["image:check-metadata"]);
  });

  test("a file that is not on disk keeps the placeholder", async () => {
    // `createValDiagnostics` reports this as `val/file-not-found` instead, so
    // this verdict must not have the last word on it.
    fs.rmSync(path.join(valRoot, IMAGE_REF));
    const verdict = await resolve(CORRECT);
    expect(verdict).toHaveLength(1);
    expect(verdict?.[0].message).toBe(
      "Image metadata has not been checked against the file.",
    );
  });

  test("a remote ref keeps the placeholder rather than being read from disk", async () => {
    const verdict = await resolve({
      path: "https://remote.val.build/file/p/abc/b/main/v/1/h/deadbeef/f/logo.png",
      width: 1,
      height: 1,
      mimeType: "image/png",
    });
    expect(verdict).toHaveLength(1);
  });

  test("a value that is not an object is not a deferral at all", async () => {
    // Nothing to re-derive core's conditions from, so the classifier declines
    // it and the error is published verbatim -- no verdict is even asked for.
    expect(await resolve("not an object")).toBeUndefined();
  });

  test("errors that are not deferrals get no verdict at all", async () => {
    const error: ValidationError = {
      message: "Image metadata is missing: width, height and mimeType.",
      value: { path: IMAGE_REF },
      fixes: ["image:add-metadata"],
    };
    const verdicts = await resolveMediaChecks({
      validation: { [SOURCE_PATH]: [error] },
      content: contentFor(error.value),
      valRoot,
    });
    expect(verdicts.size).toBe(0);
  });

  test("a file deleted between passes stops being accepted", async () => {
    expect(await resolve(CORRECT)).toEqual([]);
    fs.rmSync(path.join(valRoot, IMAGE_REF));
    expect(await resolve(CORRECT)).toHaveLength(1);
  });
});

describe("isDeferredRemoteCheck", () => {
  /**
   * Driven through core, like the metadata cases above: the claim being pinned
   * is that a remote image's ONLY error is the deferral, so no re-derivation of
   * core's conditions is needed to tell it apart from a real finding.
   */
  test("a remote image with a remote path defers, and says nothing else", () => {
    const { errors } = validateImage(s.image().remote(), {
      path: "https://remote.val.build/file/p/abc/b/v0/v/1/h/dead/f/beef/p/public/val/logo.png",
      width: 1,
      height: 1,
      mimeType: "image/png",
    });
    const error = onlyError(errors);
    expect(error.message).toBe("Remote image was not checked.");
    expect(error.fixes).toEqual(["image:check-remote"]);
    expect(isDeferredRemoteCheck(error)).toBe(true);
  });

  test("a remote file with a remote path defers the same way", () => {
    const { errors } = validateFile(s.file().remote(), {
      path: "https://remote.val.build/file/p/abc/b/v0/v/1/h/dead/f/beef/p/public/val/doc.pdf",
      mimeType: "application/pdf",
    });
    const error = onlyError(errors);
    expect(error.message).toBe("Remote file was not checked.");
    expect(isDeferredRemoteCheck(error)).toBe(true);
  });

  test("a remote schema holding a local path is a real finding, not a deferral", () => {
    const { errors } = validateImage(s.image().remote(), {
      path: "/public/val/logo.png",
      width: 1,
      height: 1,
      mimeType: "image/png",
    });
    const error = onlyError(errors);
    expect(error.fixes).toEqual(["image:upload-remote"]);
    expect(isDeferredRemoteCheck(error)).toBe(false);
  });

  test("a gallery's own remote check is a finding and is never adjudicated", () => {
    // `RecordSchema.validateMediaKey` emits `images:check-remote` only for a
    // key that is already wrong, and `createFixPatch` has no branch for it --
    // adjudicating one would come back empty and drop a real error.
    expect(
      isDeferredRemoteCheck({
        message: "Invalid remote URL format. Got: nope",
        fixes: ["images:check-remote"],
      }),
    ).toBe(false);
  });
});

describe("resolveMediaChecks: the remote-ref placeholder", () => {
  let valRoot: string;

  const REMOTE_HOST = "https://remote.val.build";
  const REMOTE_FILE_PATH = "public/val/logo.png";
  const PROJECT_ID = "abc123";
  const BUCKET = "v0";
  const CORE_VERSION = Internal.VERSION.core || "unknown";
  const FILE_HASH = Internal.remote.getFileHash(PNG_1X1);
  const SCHEMA = asImageSchema(s.image().remote()["executeSerialize"]());
  const METADATA = { width: 1, height: 1, mimeType: "image/png" };

  /**
   * A remote ref whose validation hash is computed from `metadata`.
   *
   * Pass the metadata the value actually carries and `checkRemoteRef` agrees
   * with the ref, which is the whole happy path and costs no network. Pass
   * anything else and the ref no longer adds up, which is the stale case.
   */
  const remoteRef = (metadata: Record<string, unknown>) =>
    Internal.remote.createRemoteRef(REMOTE_HOST, {
      publicProjectId: PROJECT_ID,
      coreVersion: CORE_VERSION,
      bucket: BUCKET,
      validationHash: Internal.remote.getValidationHash(
        CORE_VERSION,
        SCHEMA,
        "png",
        metadata,
        FILE_HASH,
        new TextEncoder(),
      ),
      fileHash: FILE_HASH,
      filePath: REMOTE_FILE_PATH,
    });

  const contentFor = (source: unknown): ValModuleContent =>
    ({
      source,
      schema: SCHEMA,
      errors: false,
      path: SOURCE_PATH,
    }) as ValModuleContent;

  const deferralFor = (value: unknown): ValidationError => ({
    message: "Remote image was not checked.",
    value,
    fixes: ["image:check-remote"],
  });

  const resolve = async (value: unknown) => {
    const error = deferralFor(value);
    const verdicts = await resolveMediaChecks({
      validation: { [SOURCE_PATH]: [error] },
      content: contentFor(value),
      valRoot,
      remoteHost: REMOTE_HOST,
    });
    return verdicts.get(mediaCheckKey(SOURCE_PATH, error));
  };

  beforeEach(() => {
    valRoot = fs.mkdtempSync(path.join(os.tmpdir(), "val-remote-checks-"));
  });

  afterEach(() => {
    fs.rmSync(valRoot, { recursive: true, force: true });
  });

  test("a ref that still adds up publishes nothing", async () => {
    // The reported bug: every remote image carried a permanent
    // "Remote image was not checked." No file is on disk and none is
    // downloaded -- the hashes settle it.
    expect(await resolve({ path: remoteRef(METADATA), ...METADATA })).toEqual(
      [],
    );
  });

  /**
   * A value whose metadata was edited after the ref was minted: the ref's
   * validation hash was computed from the real 1x1 bytes, the value now claims
   * 800x600, and the two cannot both be right.
   */
  const STALE_VALUE = {
    path: remoteRef(METADATA),
    width: 800,
    height: 600,
    mimeType: "image/png",
  };

  test("a stale ref is reported with the CLI's own wording", async () => {
    // Seeding the download cache is what keeps this offline: `checkRemoteRef`
    // reads `.val/remote-file-cache` before it reaches for the network, and
    // only a ref that no longer adds up gets that far at all.
    seedRemoteFileCache();
    const verdict = await resolve(STALE_VALUE);
    expect(verdict).toHaveLength(1);
    expect(verdict?.[0].message).toMatch(
      /^Remote ref: https:\/\/remote\.val\.build\/file\/p\/abc123\/.* is not valid\. Use the --fix flag to fix this issue\.$/,
    );
  });

  test("a finding carries no fix, so it is an Error and not a lightbulb", async () => {
    // `createFixPatch` clears `fixes` on it, no quick fix is registered for
    // `image:check-remote`, and dropping them is what matches the CLI's `✘`.
    seedRemoteFileCache();
    const verdict = await resolve(STALE_VALUE);
    expect(verdict?.[0].fixes).toBeUndefined();
  });

  test("a path that is not a remote ref at all is reported, not hidden", async () => {
    const verdict = await resolve({ path: "not-a-ref", ...METADATA });
    expect(verdict).toHaveLength(1);
    expect(verdict?.[0].message).toBe("Invalid remote ref: not-a-ref");
  });

  test("a check that could not be made keeps the placeholder", async () => {
    // `createFixPatch` resolves the source path to find the schema, and throws
    // on a path the source does not have. Claiming a ref is sound on no
    // evidence is the worse failure, so the placeholder stands.
    const value = { path: remoteRef(METADATA), ...METADATA };
    const error = deferralFor(value);
    const at = Internal.createValPathOfItem(SOURCE_PATH, "img") as SourcePath;
    const verdicts = await resolveMediaChecks({
      validation: { [at]: [error] },
      content: {
        source: {},
        schema: s.object({ img: s.image().remote() })["executeSerialize"](),
        errors: false,
        path: SOURCE_PATH,
      } as unknown as ValModuleContent,
      valRoot,
      remoteHost: REMOTE_HOST,
    });
    const verdict = verdicts.get(mediaCheckKey(at, error));
    expect(verdict).toHaveLength(1);
    expect(verdict?.[0].message).toBe("Remote image was not checked.");
  });

  /** The bytes `checkRemoteRef` would otherwise download, put where it looks. */
  function seedRemoteFileCache() {
    const dir = path.join(valRoot, ".val", "remote-file-cache");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${FILE_HASH}.png`), PNG_1X1);
  }
});

describe("createValDiagnostics: publishing a verdict", () => {
  const IMAGE_REF = "/public/val/logo.png";
  const VALUE = {
    path: IMAGE_REF,
    width: 800,
    height: 600,
    mimeType: "image/png",
  };
  const deferral: ValidationError = {
    message: "Image metadata has not been checked against the file.",
    value: VALUE,
    fixes: ["image:check-metadata"],
  };

  /** A module whose only error is the deferral, with no `valRoot` given. */
  const contentWith = (error: ValidationError): ValModuleContent =>
    ({
      source: VALUE,
      schema: s.image()["executeSerialize"](),
      errors: { validation: { [SOURCE_PATH]: [error] } },
      path: SOURCE_PATH,
    }) as unknown as ValModuleContent;

  const diagnose = (error: ValidationError, verdict?: MediaCheckVerdict) =>
    createValDiagnostics({
      moduleFilePath: MODULE_FILE_PATH,
      content: contentWith(error),
      text: "export default c.define('/content/media.val.ts', s.image(), {})",
      ...(verdict
        ? {
            mediaChecks: new Map([
              [mediaCheckKey(SOURCE_PATH, error), verdict],
            ]),
          }
        : {}),
    });

  test("an empty verdict publishes nothing", () => {
    // The reported bug: a correct image had a permanent warning on it.
    expect(diagnose(deferral, [])).toEqual([]);
  });

  test("a finding publishes a Warning that still carries its fix", () => {
    const diagnostics = diagnose(deferral, [
      {
        message: "Image width is incorrect! Found: 800. Expected: 944",
        fixes: ["image:check-metadata"],
        value: VALUE,
      },
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toBe(
      "Image width is incorrect! Found: 800. Expected: 944",
    );
    expect(diagnostics[0].severity).toBe(2); // Warning
    expect(diagnostics[0].code).toBe("val/validation");
    // The quick fix is built from `data.fixes`, so it has to survive.
    expect(diagnostics[0].data).toMatchObject({
      fixes: ["image:check-metadata"],
    });
  });

  test("one placeholder can publish several findings", () => {
    expect(
      diagnose(deferral, [
        { message: "Image width is incorrect! Found: 800. Expected: 944" },
        { message: "Image height is incorrect! Found: 600. Expected: 944" },
      ]),
    ).toHaveLength(2);
  });

  test("no verdict at all drops the placeholder", () => {
    // Same precedent as the gallery placeholders: a caller that cannot
    // adjudicate must not publish an unconditional warning, because a warning
    // that is always there is one nobody reads -- which is this whole bug.
    expect(diagnose(deferral)).toEqual([]);
  });

  test("an empty remote verdict publishes nothing either", () => {
    // The reported bug's other half: every remote image carried a permanent
    // "Remote image was not checked."
    const remote: ValidationError = {
      message: "Remote image was not checked.",
      value: {
        path: "https://remote.val.build/file/p/a/b/v0/v/1/h/d/f/e/p/public/val/logo.png",
      },
      fixes: ["image:check-remote"],
    };
    expect(diagnose(remote, [])).toEqual([]);
  });

  test("a stale remote ref publishes an Error with no quick fix", () => {
    const remote: ValidationError = {
      message: "Remote image was not checked.",
      value: {
        path: "https://remote.val.build/file/p/a/b/v0/v/1/h/d/f/e/p/public/val/logo.png",
      },
      fixes: ["image:check-remote"],
    };
    const diagnostics = diagnose(remote, [
      {
        message:
          "Remote ref: https://remote.val.build/file/p/a/b/v0/v/1/h/x/f/e/p/public/val/logo.png is not valid. Use the --fix flag to fix this issue.",
        value: remote.value,
      },
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toMatch(/is not valid\. Use the --fix flag/);
    expect(diagnostics[0].severity).toBe(1); // Error, as the CLI's `✘`
    expect(diagnostics[0].data).not.toMatchObject({
      fixes: expect.anything(),
    });
  });

  test("an error that is not a deferral is published without any verdict", () => {
    const real: ValidationError = {
      message: "Mime type mismatch. Found 'image/png' but schema accepts 'x'",
      value: VALUE,
      fixes: ["image:check-metadata"],
    };
    // A mimeType that disagrees with the extension: one of the four real
    // findings core tags with the same fix, so it must be published verbatim
    // rather than adjudicated away.
    const diagnostics = diagnose(
      { ...real, value: { ...VALUE, mimeType: "image/jpeg" } },
      undefined,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toBe(real.message);
  });
});
