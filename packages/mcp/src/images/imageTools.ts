import fs from "node:fs/promises";
import path from "node:path";
import {
  Internal,
  type ImageMetadata,
  type ModuleFilePath,
  type SerializedImageSchema,
  type SerializedRecordSchema,
  type SerializedSchema,
} from "@valbuild/core";
import { getFileExt, type ValServerConfig } from "@valbuild/server";
import {
  ENCODE_MIME_TYPE_OF,
  buildImageGalleryPatch,
  fitWithin,
  isMimeTypeAccepted,
  isSkippedSource,
  chooseEncoded,
  resolveEncodeSettings,
  resolveSerializedSchemaAtPath,
  safeParsePatch,
  withExtension,
  type BuildResult,
  type EncodeSettings,
  type Patch,
} from "@valbuild/shared/internal";
import { z } from "zod";
import {
  defineTool,
  err,
  type ValToolDeps,
  type ValToolImpl,
} from "../tools/defineTool";
import {
  savePatch,
  type SavePatchResult,
  type UploadPatchFiles,
} from "../tools/writePath";
import { loadState } from "../tools/createValTools";
import type { ValToolError, ValToolResult } from "../tools/types";
import type { ValImageProcessor } from "./types";
import {
  buildRemoteRef,
  createRemoteSettingsLoader,
  resolveRemoteUploadTarget,
  type RemoteSettingsLoader,
} from "./remoteUploadTarget";

/**
 * Uploading an image over MCP.
 *
 * Not part of the default tool set, and constructed separately for a reason
 * that is about dependencies rather than about design: reading the dimensions
 * out of a JPEG and converting it to WebP needs an image library, and `sharp`
 * is a native dependency that would otherwise be installed by every project
 * that installs Val. So the host builds this one and hands it in — see
 * `createValTools`'s `extraTools`, and `@valbuild/mcp/sharp`.
 *
 * What it deliberately does NOT do: remote files. `s.image({ remote: true })`
 * uploads straight to Val's content host through a presigned nonce, which is
 * the one path in local mode that needs a personal access token
 * (`docs/plans/mcp.md` D.1). Refused with a message that says so rather than
 * half-implemented, because a remote ref whose bytes were never uploaded fails
 * a long way from here.
 */

const ModuleFilePathSchema = z
  .string()
  .describe('Path of the Val module, e.g. "/content/pages.val.ts".');

/**
 * How big an inline image may be, in bytes of decoded binary.
 *
 * Base64 arrives inside a JSON-RPC message that the host has already buffered,
 * so this is not the memory bound it looks like — the bound is on how much of
 * a model's context an image is worth spending, and on not writing a 200MB
 * file into `.val/patches` because an argument was malformed. A file on disk
 * is not subject to it: nothing had to carry those bytes to get here.
 */
const MAX_INLINE_BYTES = 20 * 1024 * 1024;

export function createValImageTools(
  processor: ValImageProcessor,
  options?: {
    /**
     * Where a remote image's project settings come from.
     *
     * Only tests pass this. It exists because the real loader talks to the
     * content host to learn a project's public id and bucket list, and a suite
     * that had to reach one would be testing the network rather than the ref
     * this builds from the answer.
     */
    loadRemoteSettings?: RemoteSettingsLoader;
  },
): ValToolImpl[] {
  /**
   * One settings loader per config, made on first use.
   *
   * Not made here, because the config arrives with the call: the host builds
   * these tools and hands them to `createValTools`, which is what knows how the
   * project is configured. Keyed by identity rather than remade every call so
   * that a gallery of twenty images asks the content host once — and so that
   * the same tools handed to two registries do not share one answer.
   */
  let loader: RemoteSettingsLoader | null = null;
  let loaderConfig: ValServerConfig | null = null;
  const settingsFor = (config: ValServerConfig): RemoteSettingsLoader => {
    if (options?.loadRemoteSettings) {
      return options.loadRemoteSettings;
    }
    if (loader === null || loaderConfig !== config) {
      loader = createRemoteSettingsLoader(config);
      loaderConfig = config;
    }
    return loader;
  };

  return [
    defineTool(
      {
        name: "upload_image",
        title: "Upload an image",
        description:
          "Upload an image file and put it in an image field, or add it to an image gallery module (one declared with s.images()). Give it either imageFilePath — a path to a file on the machine this app runs on — or imageBase64. The image is re-encoded first if the schema asks for that. Works for remotely stored images too (s.image({ remote: true })), which need the project to be connected to Val Build.",
        inputSchema: z.object({
          moduleFilePath: ModuleFilePathSchema,
          path: z
            .array(z.string())
            .default([])
            .describe(
              'Path of the image field within the module, e.g. ["hero","image"]. Leave empty when the module itself is an image gallery — the image is then added to it under a generated key.',
            ),
          imageFilePath: z
            .string()
            .optional()
            .describe(
              "Absolute path to an image file on the machine running this app. Prefer this over imageBase64: it does not have to travel through the conversation.",
            ),
          imageBase64: z
            .string()
            .optional()
            .describe(
              "The image itself, as a data URL or bare base64. Use only when there is no file to point at.",
            ),
          filename: z
            .string()
            .optional()
            .describe(
              "Name to base the stored filename on. Defaults to the name of imageFilePath. A content hash is appended either way, and the extension is taken from the bytes rather than from this.",
            ),
          alt: z
            .string()
            .optional()
            .describe("Alt text describing the image, for screen readers."),
        }),
        annotations: { idempotentHint: false },
      },
      async (args, deps) => {
        const modulePath = args.moduleFilePath as ModuleFilePath;
        const moduleSchema = deps.state.serializedSchemas[modulePath];
        if (!moduleSchema) {
          return err(
            "not-found",
            `No Val module at ${JSON.stringify(modulePath)}.`,
          );
        }

        const target = resolveTarget(deps, moduleSchema, args.path);
        if (target.status === "error") {
          return target.result;
        }

        if (target.altRequired && args.alt === undefined) {
          return err(
            "invalid-args",
            "This gallery requires alt text for every image, so pass `alt` — a short description of what the image shows, for people using a screen reader.",
          );
        }

        const read = await readInputImage(args);
        if (read.status === "error") {
          return read.result;
        }

        const prepared = await prepareImage(
          processor,
          read.bytes,
          read.filename,
          target.encode,
          target.accept,
        );
        if (prepared.status === "error") {
          return prepared.result;
        }

        const metadata: ImageMetadata = {
          width: prepared.width,
          height: prepared.height,
          mimeType: prepared.mimeType,
          ...(args.alt !== undefined ? { alt: args.alt } : {}),
        };
        const fileHash = Internal.getSHA256Hash(prepared.bytes);
        const dataUrl = `data:${prepared.mimeType};base64,${Buffer.from(
          prepared.bytes,
        ).toString("base64")}`;
        const generated = Internal.createFilename(
          dataUrl,
          prepared.filename,
          metadata,
          fileHash,
        );
        if (!generated) {
          return err(
            "internal",
            "Could not derive a filename for the uploaded image.",
          );
        }
        // Where the bytes live, always: a `/public/...` path in the patch
        // store. For a remote image the CONTENT points somewhere else, but the
        // bytes still land here and stay here until publish pushes them.
        const storedPath = `${target.directory}/${generated}`;
        const resolvedRef = await resolveRef(target, settingsFor(deps.config), {
          bytes: prepared.bytes,
          storedPath,
          generated,
          metadata,
        });
        if (resolvedRef.status === "error") {
          return resolvedRef;
        }
        const file: UploadedFile = {
          ref: resolvedRef.ref,
          storedPath,
          remote: target.remote !== null,
          dataUrl,
          metadata,
        };

        const saved =
          target.kind === "gallery"
            ? await uploadToGallery(
                deps,
                modulePath,
                target.gallerySchema,
                file,
              )
            : target.galleryBacked
              ? await uploadToGalleryBackedField(deps, {
                  fieldModule: modulePath,
                  fieldPath: args.path,
                  galleryModule: target.referencedModule as ModuleFilePath,
                  file,
                })
              : await uploadToField(deps, modulePath, args.path, file);
        if (saved.status === "error") {
          return saved;
        }

        return {
          status: "ok",
          data: {
            ...saved.data,
            filePath: file.ref,
            remote: file.remote,
            width: prepared.width,
            height: prepared.height,
            mimeType: prepared.mimeType,
            // Said out loud rather than left to be inferred from the mime
            // type: `encode` silently keeps the original when the conversion
            // would have made the file bigger, and "why is this still a PNG"
            // is otherwise unanswerable from the result.
            reEncoded: prepared.reEncoded,
          },
        };
      },
    ),
  ];
}

/**
 * What the content will point at: a local path, or a remote ref.
 *
 * The remote branch is the only thing in this tool that talks to the network,
 * and all it asks for is which project and which bucket. The bytes do not go to
 * the content host here — they go to the patch store like any other pending
 * file, and publish pushes them. See `docs/plans/mcp-remote-images.md` Part A.
 */
async function resolveRef(
  target: Extract<ImageTarget, { status: "ok" }>,
  loadSettings: RemoteSettingsLoader,
  file: {
    bytes: Uint8Array;
    storedPath: string;
    generated: string;
    metadata: ImageMetadata;
  },
): Promise<{ status: "ok"; ref: string } | ValToolError> {
  if (target.remote === null) {
    return { status: "ok", ref: file.storedPath };
  }
  const relative = file.storedPath.startsWith("/public/")
    ? file.storedPath.slice(1)
    : null;
  if (relative === null) {
    // `createRemoteRef` types the path as `public/${string}` and means it: the
    // ref encodes the path, and publish splits it back out to find the bytes.
    return err(
      "invalid-args",
      `A remote image has to be stored under /public, and this schema's directory is ${JSON.stringify(
        target.directory,
      )}.`,
    );
  }
  const resolved = await resolveRemoteUploadTarget(loadSettings);
  if (resolved.status !== "success") {
    return resolved;
  }
  return {
    status: "ok",
    ref: buildRemoteRef({
      target: resolved.target,
      bytes: file.bytes,
      filePath: relative as `public/${string}`,
      fileExt: getFileExt(file.generated),
      metadata: file.metadata,
      schema: target.remote.schema,
    }),
  };
}

/**
 * Where the image is going, and what the schema there says about it.
 *
 * Two shapes, and they are genuinely different rather than two spellings of
 * one: a gallery is a record keyed by file path, so an upload ADDS an entry
 * under a key it generates, while a field is a single value, so an upload
 * REPLACES it. Resolving both here keeps that difference in one place instead
 * of scattered through the handler.
 */
type ImageTarget =
  | {
      status: "ok";
      kind: "gallery";
      gallerySchema: SerializedSchema;
      directory: string;
      accept: string | undefined;
      encode: EncodeSettings | null;
      altRequired: boolean;
      remote: RemoteTarget | null;
    }
  | {
      status: "ok";
      kind: "field";
      referencedModule: string | undefined;
      galleryBacked: boolean;
      directory: string;
      accept: string | undefined;
      encode: EncodeSettings | null;
      altRequired: boolean;
      remote: RemoteTarget | null;
    }
  | { status: "error"; result: ValToolResult };

/**
 * That this image is stored remotely, and the schema its ref is hashed against.
 *
 * The schema is carried rather than looked up later because getting it wrong is
 * silent: the validation hash is baked into the ref, the validator recomputes it
 * from the schema it finds at the path, and a mismatch means a file that uploads
 * and then never validates. See `docs/plans/mcp-remote-images.md` Part D.
 */
type RemoteTarget = { schema: SerializedImageSchema };

/** The default in `createFilePatch`, and the same default here. */
const DEFAULT_DIRECTORY = "/public/val";

function resolveTarget(
  deps: ValToolDeps,
  moduleSchema: SerializedSchema,
  fieldPath: string[],
): ImageTarget {
  if (fieldPath.length === 0) {
    if (moduleSchema.type !== "record" || moduleSchema.mediaType !== "images") {
      return {
        status: "error",
        result: err(
          "invalid-args",
          `The module is not an image gallery (it is a ${moduleSchema.type}), so an image cannot be added to it directly. Give a path to the image field within it.`,
        ),
      };
    }
    return {
      status: "ok",
      kind: "gallery",
      gallerySchema: moduleSchema,
      directory: moduleSchema.directory ?? DEFAULT_DIRECTORY,
      accept: moduleSchema.accept,
      encode: resolveEncodeSettings(undefined, moduleSchema.encode),
      altRequired: altIsRequired(moduleSchema),
      remote: moduleSchema.remote
        ? { schema: galleryEntryImageSchema(moduleSchema) }
        : null,
    };
  }

  const resolved = resolveSerializedSchemaAtPath(moduleSchema, fieldPath);
  if (resolved.kind === "gallery-traversed") {
    return {
      status: "error",
      result: err(
        "invalid-args",
        "That path addresses an entry inside an image gallery. Upload to the gallery module itself, with an empty path — the key is generated from the image.",
      ),
    };
  }
  if (resolved.kind !== "leaf") {
    return {
      status: "error",
      result: err(
        "not-found",
        `No image field at ${JSON.stringify(fieldPath.join("."))} in this module.`,
      ),
    };
  }
  const schema = resolved.schema;
  if (schema.type !== "image") {
    return {
      status: "error",
      result: err(
        "invalid-args",
        `The value at ${JSON.stringify(
          fieldPath.join("."),
        )} is a ${schema.type}, not an image.`,
      ),
    };
  }
  // A gallery-backed field (`s.image(galleryVal)`) serializes with EMPTY
  // options, so `accept`, `directory` and `encode` all have to fall through to
  // the gallery or it would never honour what the gallery asked for. The
  // field's own option wins where it has one — this is `ImageField`'s
  // resolution order, and the two must not disagree.
  const referencedModule = schema.referencedModule;
  const gallerySchema = referencedModule
    ? deps.state.serializedSchemas[referencedModule as ModuleFilePath]
    : undefined;
  const galleryRecord =
    gallerySchema?.type === "record" ? gallerySchema : undefined;
  // Where the bytes end up is what decides which schema the ref is hashed
  // against. A gallery-backed field's image is a GALLERY entry — the field only
  // points at it — so it is the gallery's synthesized schema either way, and a
  // plain field is hashed against its own. `s.image(gallery)` has no `remote`
  // option of its own, so a gallery-backed field is remote exactly when its
  // gallery is.
  const remote: RemoteTarget | null = galleryRecord
    ? galleryRecord.remote
      ? { schema: galleryEntryImageSchema(galleryRecord) }
      : null
    : schema.remote
      ? { schema }
      : null;
  return {
    status: "ok",
    kind: "field",
    referencedModule,
    galleryBacked: referencedModule !== undefined,
    directory:
      schema.options?.directory ??
      galleryRecord?.directory ??
      DEFAULT_DIRECTORY,
    accept: schema.options?.accept ?? galleryRecord?.accept,
    encode: resolveEncodeSettings(
      schema.options?.encode,
      galleryRecord?.encode,
    ),
    // Only a gallery has an alt schema to satisfy. A plain `s.image()` field
    // stores `alt` if it is given and is fine without it.
    altRequired: galleryRecord ? altIsRequired(galleryRecord) : false,
    remote,
  };
}

/**
 * The image schema a gallery ENTRY is validated as.
 *
 * A gallery's item schema is an object (width/height/mimeType/alt), but the
 * remote ref's validation hash is computed over a `SerializedImageSchema` — so
 * one has to be synthesized, carrying the `accept` and `directory` of the record
 * that holds the entry. This is `handleRemoteGalleryFileUpload`'s synthesis, and
 * it has to stay identical to it: the CLI's `--fix` writes refs this way and the
 * check that validates them reads them the same way, so a third shape here would
 * bake a hash that can never match.
 */
function galleryEntryImageSchema(
  gallery: SerializedRecordSchema,
): SerializedImageSchema {
  return {
    type: "image",
    opt: false,
    options: {
      ...(gallery.accept ? { accept: gallery.accept } : {}),
      ...(gallery.directory ? { directory: gallery.directory } : {}),
    },
  };
}

/**
 * Does this gallery insist on alt text?
 *
 * `s.images()` gives `alt` a nullable string by default, and an entry written
 * without one stores `null`. A gallery that passed its own — `s.images({ alt:
 * s.string().minLength(4) })`, which the example app does — has made it
 * required, and an upload with no `alt` cannot satisfy it however it is
 * written. Asked here so the caller is told what to pass, rather than shown a
 * validation error about a null it never chose.
 */
function altIsRequired(gallerySchema: SerializedSchema): boolean {
  if (gallerySchema.type !== "record") {
    return false;
  }
  return gallerySchema.alt !== undefined && !gallerySchema.alt.opt;
}

/** The bytes to upload, from whichever of the two arguments was given. */
type ReadImage =
  | { status: "ok"; bytes: Uint8Array; filename: string | null }
  | { status: "error"; result: ValToolResult };

async function readInputImage(args: {
  imageFilePath?: string;
  imageBase64?: string;
  filename?: string;
}): Promise<ReadImage> {
  const hasPath = args.imageFilePath !== undefined;
  const hasBase64 = args.imageBase64 !== undefined;
  if (hasPath === hasBase64) {
    return {
      status: "error",
      result: err(
        "invalid-args",
        hasPath
          ? "Give either imageFilePath or imageBase64, not both."
          : "Give either imageFilePath — a path to a file on the machine this app runs on — or imageBase64.",
      ),
    };
  }

  if (args.imageFilePath !== undefined) {
    try {
      const bytes = await fs.readFile(args.imageFilePath);
      return {
        status: "ok",
        bytes: new Uint8Array(bytes),
        filename: args.filename ?? path.basename(args.imageFilePath),
      };
    } catch (error) {
      return {
        status: "error",
        result: err(
          "not-found",
          `Could not read ${JSON.stringify(args.imageFilePath)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      };
    }
  }

  const base64 = args.imageBase64 ?? "";
  // A data URL and a bare base64 string are both accepted, because a model
  // asked for "base64" produces either and neither is wrong.
  const comma = base64.startsWith("data:") ? base64.indexOf(",") : -1;
  const payload = comma === -1 ? base64 : base64.slice(comma + 1);
  let bytes: Buffer;
  try {
    bytes = Buffer.from(payload, "base64");
  } catch {
    return {
      status: "error",
      result: err("invalid-args", "imageBase64 is not valid base64."),
    };
  }
  if (bytes.length === 0) {
    return {
      status: "error",
      result: err("invalid-args", "imageBase64 decoded to no bytes at all."),
    };
  }
  if (bytes.length > MAX_INLINE_BYTES) {
    return {
      status: "error",
      result: err(
        "invalid-args",
        `That image is ${Math.round(
          bytes.length / (1024 * 1024),
        )}MB, over the ${MAX_INLINE_BYTES / (1024 * 1024)}MB limit for an inline image. Write it to a file and pass imageFilePath instead.`,
      ),
    };
  }
  return {
    status: "ok",
    bytes: new Uint8Array(bytes),
    filename: args.filename ?? null,
  };
}

type PreparedImage =
  | {
      status: "ok";
      bytes: Uint8Array;
      width: number;
      height: number;
      mimeType: string;
      filename: string | null;
      reEncoded: boolean;
    }
  | { status: "error"; result: ValToolResult };

/**
 * Read the image, and re-encode it when the schema asked for that.
 *
 * The conversion happens BEFORE the caller hashes anything, which is the whole
 * reason it is here rather than after the patch is built: the SHA-256 becomes
 * the filename suffix, the mime type picks the extension, and the width and
 * height are stored — so converting afterwards would make every one of those
 * describe a file that was never uploaded. Same rule as the browser's
 * `readImageFromFile`, and the decisions are literally the same functions.
 */
async function prepareImage(
  processor: ValImageProcessor,
  bytes: Uint8Array,
  filename: string | null,
  settings: EncodeSettings | null,
  accept: string | undefined,
): Promise<PreparedImage> {
  let original: Awaited<ReturnType<ValImageProcessor["read"]>>;
  try {
    original = await processor.read(bytes);
  } catch (error) {
    return {
      status: "error",
      result: err(
        "internal",
        `Could not read the image: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    };
  }
  if (!original) {
    return {
      status: "error",
      result: err(
        "invalid-args",
        "Those bytes are not an image, or not one this app's image library can read.",
      ),
    };
  }
  const asIs: PreparedImage = {
    status: "ok",
    bytes,
    width: original.width,
    height: original.height,
    mimeType: original.mimeType,
    filename,
    reEncoded: false,
  };
  if (settings === null) {
    return refuseUnaccepted(asIs, accept);
  }
  const targetMimeType = ENCODE_MIME_TYPE_OF[settings.type];
  if (!isMimeTypeAccepted(targetMimeType, accept)) {
    // `accept` wins: it is what validation checks the STORED mimeType against,
    // so converting to a type it forbids would upload a file the schema
    // reports as invalid the moment it lands.
    return refuseUnaccepted(asIs, accept);
  }
  const resizeTo = fitWithin(
    original.width,
    original.height,
    settings.maxWidth,
    settings.maxHeight,
  );
  if (isSkippedSource(original.mimeType, targetMimeType, resizeTo !== null)) {
    return refuseUnaccepted(asIs, accept);
  }

  let encoded: Awaited<ReturnType<ValImageProcessor["encode"]>>;
  try {
    encoded = await processor.encode(bytes, {
      mimeType: targetMimeType,
      quality: settings.quality,
      resizeTo,
    });
  } catch {
    // A failed optimisation must never become a failed upload.
    return refuseUnaccepted(asIs, accept);
  }
  if (!encoded) {
    return refuseUnaccepted(asIs, accept);
  }
  // Read back before deciding, so the comparison is against what the encoder
  // ACTUALLY produced rather than what it said it would: `canvas.toBlob`
  // answers an unsupported type with a PNG rather than with null, and the same
  // trust gap is worth closing on this side. It is also the honest source for
  // the stored dimensions — a width one pixel off what is in the file is the
  // kind of thing nobody notices until a layout depends on it.
  let converted: Awaited<ReturnType<ValImageProcessor["read"]>>;
  try {
    converted = await processor.read(encoded.bytes);
  } catch {
    return refuseUnaccepted(asIs, accept);
  }
  if (
    !converted ||
    !chooseEncoded({
      originalSize: bytes.length,
      encodedSize: encoded.bytes.length,
      encodedType: converted.mimeType,
      targetMimeType,
      needsDownscale: resizeTo !== null,
    })
  ) {
    return refuseUnaccepted(asIs, accept);
  }
  return refuseUnaccepted(
    {
      status: "ok",
      bytes: encoded.bytes,
      width: converted.width,
      height: converted.height,
      mimeType: converted.mimeType,
      filename:
        filename === null ? null : withExtension(filename, settings.type),
      reEncoded: true,
    },
    accept,
  );
}

/**
 * Refuse an image the schema says it does not store — checked on the FINAL
 * bytes, never on the ones that arrived.
 *
 * The order is the whole point, and getting it backwards breaks the one
 * combination `accept` and `encode` exist to serve together:
 * `s.image({ accept: "image/webp", encode: { type: "webp" } })` means "I store
 * webp, and I will convert what you give me". Checking the SOURCE against
 * `accept` refuses the PNG that the conversion was there to turn into a webp —
 * so the check belongs after the conversion, on what is actually stored.
 *
 * That the check happens at all is the one thing here the Studio does not do,
 * and it is not a difference of opinion about `accept`. `ImageSchema` reports a
 * mismatch with `fixes: ["image:check-metadata"]`, which
 * `partitionValidationErrors` treats as server-repairable and therefore
 * non-blocking — so nothing downstream would refuse this. The Studio does not
 * need it to: its file picker carries `accept`, so a person cannot choose one.
 * An agent has no picker, and this is it.
 */
function refuseUnaccepted(
  prepared: Extract<PreparedImage, { status: "ok" }>,
  accept: string | undefined,
): PreparedImage {
  if (isMimeTypeAccepted(prepared.mimeType, accept)) {
    return prepared;
  }
  return {
    status: "error",
    result: err(
      "validation-failed",
      `This field only accepts ${accept}, and the image ${
        prepared.reEncoded ? "converts to" : "is"
      } ${prepared.mimeType}. Convert it yourself first, or add \`encode\` to the schema so Val converts uploads for you.`,
    ),
  };
}

/**
 * An uploaded image, and where it is going to live.
 *
 * Two paths, because a remote image has two. `ref` is what the content refers
 * to — a `/public/...` path locally, a `remote.val.build` URL remotely — and it
 * is what the patch stores. `storedPath` is where the BYTES go, which is the
 * patch store in both cases and always a `/public/...` path: a remote ref is a
 * URL that encodes one, and the store keys files by the path, not the URL.
 *
 * They are the same string for a local image, and separating them anyway is
 * what stops the remote branch being a set of ad-hoc splits at each use.
 */
type UploadedFile = {
  ref: string;
  storedPath: string;
  remote: boolean;
  dataUrl: string;
  metadata: ImageMetadata;
};

/** Add the image to a gallery module: it is a record keyed by the file path. */
async function uploadToGallery(
  deps: ValToolDeps,
  galleryModule: ModuleFilePath,
  gallerySchema: SerializedSchema,
  file: UploadedFile,
): Promise<SavePatchResult> {
  const built = buildImageGalleryPatch(
    {
      filePath: file.ref,
      imageKey: file.dataUrl,
      metadata: file.metadata,
    },
    gallerySchema,
  );
  if (built.kind !== "ok") {
    return fromBuildResult(built);
  }
  const { patchOps, uploadFiles } = splitFileOps(built.patch, deps, file);
  return savePatch(deps, galleryModule, patchOps, { uploadFiles });
}

/** Put the image in a field of its own: `replace` the value, `file` carries the bytes. */
async function uploadToField(
  deps: ValToolDeps,
  fieldModule: ModuleFilePath,
  fieldPath: string[],
  file: UploadedFile,
): Promise<SavePatchResult> {
  const built = safeParsePatch([
    {
      op: "replace",
      path: fieldPath,
      value: { path: file.ref, ...file.metadata },
    },
    {
      op: "file",
      path: fieldPath,
      filePath: file.ref,
      value: file.dataUrl,
      metadata: file.metadata,
      remote: false,
    },
  ]);
  if (built.kind !== "ok") {
    return fromBuildResult(built);
  }
  const { patchOps, uploadFiles } = splitFileOps(built.patch, deps, file);
  return savePatch(deps, fieldModule, patchOps, { uploadFiles });
}

/**
 * `s.image(galleryVal)`: two modules, and the gallery goes first.
 *
 * The field carries only the path — the dimensions and the mime type live in
 * the gallery, and a second copy on the field is how two copies of one fact get
 * to disagree. So the bytes and the metadata are written to the gallery, and
 * then the field is pointed at them.
 *
 * The order is not a preference. `s.image(gallery)` validates that the gallery
 * HAS an entry for the path the field names, so a field written first refers to
 * something that does not exist yet and the write is refused — correctly, by
 * the same check that would catch a typo'd path.
 */
async function uploadToGalleryBackedField(
  deps: ValToolDeps,
  target: {
    fieldModule: ModuleFilePath;
    fieldPath: string[];
    galleryModule: ModuleFilePath;
    file: UploadedFile;
  },
): Promise<SavePatchResult> {
  const gallerySchema = deps.state.serializedSchemas[target.galleryModule];
  if (!gallerySchema) {
    return err(
      "not-found",
      `This field takes its images from ${target.galleryModule}, and there is no Val module there.`,
    );
  }
  const savedEntry = await uploadToGallery(
    deps,
    target.galleryModule,
    gallerySchema,
    target.file,
  );
  if (savedEntry.status === "error") {
    return savedEntry;
  }

  // Re-read, because the gallery has just changed and `deps.state` is the
  // snapshot from before it did. Validating the field against that snapshot
  // would look for the entry that was written a moment ago and not find it.
  const reloaded = await loadState(deps.ops);
  if (reloaded.status === "error") {
    return reloaded.result;
  }
  const fresh: ValToolDeps = { ...deps, state: reloaded.state };

  const built = safeParsePatch([
    {
      op: "replace",
      path: target.fieldPath,
      // No `file` op and no metadata: the bytes are already in the gallery
      // patch above, and the gallery is where everything about them lives.
      value: { path: target.file.ref },
    },
  ]);
  if (built.kind !== "ok") {
    return fromBuildResult(built);
  }
  // "report", not "reject", and this is the one place in the image tool that
  // needs the distinction. `s.image(gallery)` validates that the gallery HAS an
  // entry for the path — but the schema's copy of the gallery is snapshotted
  // when the module is evaluated, so it shows the PUBLISHED gallery and cannot
  // see the entry written a moment ago. The pair is valid the instant both are
  // published, which is the same "invalid by construction, resolves as
  // intended" case `empty_at_path` reports rather than refuses. Rejecting here
  // would make a gallery-backed field unfillable by any agent, forever.
  const savedField = await savePatch(fresh, target.fieldModule, built.patch, {
    onInvalid: "report",
  });
  if (savedField.status === "error") {
    return {
      status: "error",
      code: savedField.code,
      // The image IS in the gallery, so reporting only that the second write
      // failed would leave the caller thinking nothing happened.
      message: `The image was uploaded and added to the gallery ${target.galleryModule}, but ${target.fieldModule} could not be pointed at it: ${savedField.message}`,
    };
  }
  return savedField;
}

/**
 * Take the bytes out of the patch, and hand back the upload that puts them
 * back.
 *
 * A patch that reaches the store must never carry binary data: the server
 * never reads a `file` op's value as data, so base64 left in one produces NO
 * file and fails silently — the patch applies, the source points at a path,
 * and nothing is there. The hash that replaces it is the only thing in the
 * patch that says WHICH bytes the op meant. This is `splitPatchFileOps` from
 * the Studio, in the one place server-side that needs it.
 */
function splitFileOps(
  patch: Patch,
  deps: ValToolDeps,
  file: UploadedFile,
): { patchOps: Patch; uploadFiles: UploadPatchFiles } {
  const { ref, storedPath, remote, dataUrl, metadata } = file;
  const textEncoder = new TextEncoder();
  const patchOps: Patch = patch.map((op) =>
    op.op === "file" && typeof op.value === "string"
      ? { ...op, value: Internal.getSHA256Hash(textEncoder.encode(op.value)) }
      : op,
  );
  const uploadFiles: UploadPatchFiles = async ({ patchId, parentRef }) => {
    // `storedPath`, not the ref: the patch store keys files by path, and a
    // remote ref is a URL that encodes one. This is the same split the Studio
    // makes before it POSTs — and it is what lets publish find these bytes
    // again, because `saveOrUploadFiles` reads them back by the path it splits
    // out of the ref.
    const saved = await deps.ops.saveBase64EncodedBinaryFileFromPatch(
      storedPath,
      parentRef,
      patchId,
      dataUrl,
      "image",
      metadata,
    );
    if (saved.error) {
      return {
        status: "error",
        result: err(
          "internal",
          `Could not store the uploaded image: ${saved.error.message}`,
        ),
      };
    }
    // Where the bytes now are, so the speculative validation that runs next
    // looks in the patch rather than on disk — the file is not committed to the
    // working tree, and will not be until this patch is published.
    return {
      status: "ok",
      // Keyed by the REF, which is what `analyzePatches` will key the real
      // patch by once it exists — the file op carries the ref, not the path.
      files: { [ref]: { patchId, remote, isDelete: false } },
    };
  };
  return { patchOps, uploadFiles };
}

function fromBuildResult(
  built: Exclude<BuildResult, { kind: "ok" }>,
): ValToolError {
  if (built.kind === "wrong-tool") {
    return err(
      "invalid-args",
      `${built.reason} Use the ${built.suggestedTool} tool instead.`,
    );
  }
  return err("invalid-args", built.message);
}
