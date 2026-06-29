import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SelectorOfSchema,
  SerializedSchema,
} from ".";
import { RenderSelector, ReifiedRender } from "../render";
import { splitModuleFilePathAndModulePath } from "../module";
import { ValRouter } from "../router";
import { SelectorSource } from "../selector";
import {
  createValPathOfItem,
  unsafeCreateSourcePath,
} from "../selector/SelectorProxy";
import { ImageSource } from "../source/image";
import { JsonOf, JsonSource, isJson } from "../source/json";
import { RemoteSource } from "../source/remote";
import { ModuleFilePath, SourcePath } from "../val";
import { ImageMetadata } from "./image";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";
import { splitRemoteRef } from "../remote/splitRemoteRef";

type MediaOptions = {
  type: "files" | "images";
  accept: string;
  directory: string;
  remote: boolean;
  altSchema?: Schema<SelectorSource>;
};

export type SerializedRecordSchema = {
  type: "record";
  item: SerializedSchema;
  key?: SerializedSchema;
  opt: boolean;
  router?: string;
  customValidate?: boolean;
  // Optional media collection marker for files/images that are backed by a record
  mediaType?: "files" | "images";
  accept?: string;
  directory?: string;
  remote?: boolean;
  alt?: SerializedSchema;
  // When true, entry values are stored in separate lazily-loaded `*.val.json`
  // files (see `.jsonValues()`).
  jsonValues?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

/**
 * The source type of a `.jsonValues()` record: every entry value is a lazily
 * loaded {@link JsonSource} whose resolved content is the (loosened, see
 * {@link JsonOf}) item type.
 */
export type JsonValuesRecordSrc<
  T extends Schema<SelectorSource>,
  K extends Schema<string>,
> = Record<SelectorOfSchema<K>, JsonSource<JsonOf<SelectorOfSchema<T>>>>;

export class RecordSchema<
  T extends Schema<SelectorSource>,
  K extends Schema<string>,
  Src extends
    | Record<SelectorOfSchema<K>, SelectorOfSchema<T>>
    | JsonValuesRecordSrc<T, K>
    | null,
> extends Schema<Src> {
  constructor(
    private readonly item: T,
    private readonly opt: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
    private readonly currentRouter: ValRouter | null = null,
    private readonly keySchema: Schema<string> | null = null,
    private readonly mediaOptions?: MediaOptions,
    private readonly isReadonly: boolean = false,
    private readonly isHidden: boolean = false,
    private readonly description?: string,
    /** When true, entry values are lazily loaded {@link JsonSource} thunks. */
    private readonly isJsonValues: boolean = false,
  ) {
    super();
  }

  describe(description: string | null): RecordSchema<T, K, Src> {
    return new RecordSchema(
      this.item,
      this.opt,
      this.customValidateFunctions,
      this.currentRouter,
      this.keySchema,
      this.mediaOptions,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
      this.isJsonValues,
    );
  }

  validate(
    validationFunction: (src: Src) => false | string,
  ): RecordSchema<T, K, Src> {
    return new RecordSchema(
      this.item,
      this.opt,
      [...this.customValidateFunctions, validationFunction],
      this.currentRouter,
      this.keySchema,
      this.mediaOptions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.isJsonValues,
    );
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    let error: ValidationErrors = false;
    const customValidationErrors: ValidationError[] =
      this.executeCustomValidateFunctions(src, this.customValidateFunctions, {
        path,
      });
    if (this.opt && (src === null || src === undefined)) {
      return customValidationErrors.length > 0
        ? { [path]: customValidationErrors }
        : false;
    }
    if (src === null) {
      return {
        [path]: [
          ...customValidationErrors,
          { message: `Expected 'object', got 'null'` },
        ],
      } as ValidationErrors;
    }
    if (typeof src !== "object") {
      return {
        [path]: [
          ...customValidationErrors,
          { message: `Expected 'object', got '${typeof src}'` },
        ],
      } as ValidationErrors;
    }
    if (Array.isArray(src)) {
      return {
        [path]: [
          ...customValidationErrors,
          { message: `Expected 'object', got 'array'` },
        ],
      } as ValidationErrors;
    }
    const routerValidations = this.getRouterValidations(path, src);
    if (routerValidations) {
      return routerValidations;
    }
    for (const customValidationError of customValidationErrors) {
      error = this.appendValidationError(
        error,
        path,
        customValidationError.message,
        src,
        customValidationError.schemaError,
      );
    }
    if (this.mediaOptions) {
      const checkFix =
        this.mediaOptions.type === "images"
          ? ("images:check-unique-folder" as const)
          : ("files:check-unique-folder" as const);
      const uniqueCheckError: ValidationError = {
        message: `Gallery directory '${this.mediaOptions.directory}' must be unique across all galleries`,
        value: {
          directory: this.mediaOptions.directory,
          type: this.mediaOptions.type,
        },
        fixes: [checkFix],
      };
      if (error) {
        if (error[path]) {
          error[path] = [...error[path], uniqueCheckError];
        } else {
          error = { ...error, [path]: [uniqueCheckError] };
        }
      } else {
        error = { [path]: [uniqueCheckError] };
      }
      const allFilesCheckFix =
        this.mediaOptions.type === "images"
          ? ("images:check-all-files" as const)
          : ("files:check-all-files" as const);
      const allFilesCheckError: ValidationError = {
        message: `Directory '${this.mediaOptions.directory}' may have files not tracked by this gallery`,
        value: {
          directory: this.mediaOptions.directory,
          type: this.mediaOptions.type,
        },
        fixes: [allFilesCheckFix],
      };
      if (error[path]) {
        error[path] = [...error[path], allFilesCheckError];
      } else {
        error = { ...error, [path]: [allFilesCheckError] };
      }
    }
    Object.entries(src).forEach(([key, elem]) => {
      if (this.keySchema) {
        const keyPath = createValPathOfItem(path, key);
        if (!keyPath) {
          throw new Error(
            `Internal error: could not create path at ${
              !path && typeof path === "string" ? "<empty string>" : path
            } for key validation`, // Should! never happen
          );
        }
        const keyError = this.keySchema["executeValidate"](keyPath, key);
        if (keyError) {
          keyError[keyPath] = keyError[keyPath].map((err) => ({
            ...err,
            keyError: true,
          }));
          if (error) {
            if (error[keyPath]) {
              error[keyPath] = [...error[keyPath], ...keyError[keyPath]];
            } else {
              error[keyPath] = keyError[keyPath];
            }
          } else {
            error = keyError;
          }
        }
      }

      const subPath = createValPathOfItem(path, key);
      if (!subPath) {
        error = this.appendValidationError(
          error,
          path,
          `Internal error: could not create path at ${
            !path && typeof path === "string" ? "<empty string>" : path
          } at key ${elem}`, // Should! never happen
          src,
        );
      } else if (this.mediaOptions) {
        // Media collection: validate key (path/URL) and entry (metadata).
        // Gallery entries are keyed by their file path and the metadata is
        // derived, so surface entry errors on the key rather than the value.
        const keyErr = this.validateMediaKey(subPath, key);
        if (keyErr) {
          this.markKeyErrorsAtPath(keyErr, subPath);
          error = error ? { ...error, ...keyErr } : keyErr;
        }
        const entryErr = this.validateMediaEntry(subPath, elem);
        if (entryErr) {
          this.markKeyErrorsAtPath(entryErr, subPath);
          error = error ? { ...error, ...entryErr } : entryErr;
        }
      } else if (this.isJsonValues) {
        // jsonValues record: the value is a lazily-loaded JsonSource marker.
        // Only assert the marker shape here; the deep content validation is
        // deferred and run per-entry by the server (validateJsonEntryContent)
        // once the backing `*.val.json` is loaded.
        if (!isJson(elem)) {
          error = this.appendValidationError(
            error,
            subPath,
            `Expected a c.json(...) entry, got '${
              elem === null ? "null" : typeof elem
            }'`,
            elem,
            true,
          );
        }
      } else {
        const subError = this.item["executeValidate"](
          subPath,
          elem as SelectorSource,
        );
        if (subError && error) {
          error = {
            ...subError,
            ...error,
          };
        } else if (subError) {
          error = subError;
        }
      }
    });
    return error;
  }

  private isRemoteUrl(url: string): boolean {
    return url.startsWith("https://") || url.startsWith("http://");
  }

  /** Marks the validation errors reported at `path` as key errors (in place). */
  private markKeyErrorsAtPath(errors: ValidationErrors, path: SourcePath) {
    if (errors && errors[path]) {
      errors[path] = errors[path].map((err) => ({ ...err, keyError: true }));
    }
  }

  private validateMediaKey(path: SourcePath, key: string): ValidationErrors {
    if (!this.mediaOptions) {
      return false;
    }
    const { directory, remote: isRemote, type } = this.mediaOptions;
    const mediaLabel = type === "images" ? "images" : "files";
    const checkRemoteFix =
      type === "images" ? "images:check-remote" : "files:check-remote";

    const isRemoteUrl = this.isRemoteUrl(key);
    const isLocalPath = key === directory || key.startsWith(directory + "/");

    if (isRemote) {
      // When remote is enabled, accept either remote URLs or local paths
      if (isRemoteUrl) {
        // Validate remote URL format using splitRemoteRef
        const remoteResult = splitRemoteRef(key);
        if (remoteResult.status === "error") {
          return {
            [path]: [
              {
                message: `Invalid remote URL format. Use Val tooling (CLI, VS Code extension, or Val Studio) to upload ${mediaLabel}. Got: ${key}`,
                value: key,
                fixes: [checkRemoteFix],
              },
            ],
          };
        }
        // Check that the file path in the remote URL matches our directory constraint
        const remotePath = "/" + remoteResult.filePath;
        if (
          remotePath !== directory &&
          !remotePath.startsWith(directory + "/")
        ) {
          return {
            [path]: [
              {
                message: `Remote file path '${remotePath}' is not in expected directory '${directory}'. Use Val tooling to upload ${mediaLabel} to the correct directory.`,
                value: key,
                fixes: [checkRemoteFix],
              },
            ],
          };
        }
        return false;
      }
      if (!isLocalPath) {
        return {
          [path]: [
            {
              message: `Expected a remote URL (https://...) or a local path starting with ${directory}/. Got: ${key}`,
              value: key,
            },
          ],
        };
      }
    } else {
      // When remote is disabled, only accept local paths
      if (isRemoteUrl) {
        return {
          [path]: [
            {
              message: `Remote URLs are not allowed. Use .remote() to enable remote ${mediaLabel}. Got: ${key}`,
              value: key,
              fixes: [checkRemoteFix],
            },
          ],
        };
      }
      if (!isLocalPath) {
        return {
          [path]: [
            {
              message: `File path must be within the ${directory}/ directory. Got: ${key}`,
              value: key,
            },
          ],
        };
      }
    }

    return false;
  }

  private validateMediaEntry(
    path: SourcePath,
    entry: unknown,
  ): ValidationErrors {
    if (!this.mediaOptions) {
      return false;
    }
    const { type, accept, altSchema } = this.mediaOptions;

    if (typeof entry !== "object" || entry === null) {
      return {
        [path]: [
          { message: `Expected 'object', got '${typeof entry}'`, value: entry },
        ],
      };
    }

    const entryObj = entry as Record<string, unknown>;
    const errors: ValidationError[] = [];

    if (type === "images") {
      // Validate width
      if (typeof entryObj.width !== "number" || entryObj.width <= 0) {
        errors.push({
          message: `Expected 'width' to be a positive number, got '${entryObj.width}'`,
          value: entry,
        });
      }

      // Validate height
      if (typeof entryObj.height !== "number" || entryObj.height <= 0) {
        errors.push({
          message: `Expected 'height' to be a positive number, got '${entryObj.height}'`,
          value: entry,
        });
      }
    }

    // Validate mimeType
    if (typeof entryObj.mimeType !== "string") {
      errors.push({
        message: `Expected 'mimeType' to be a string, got '${typeof entryObj.mimeType}'`,
        value: entry,
      });
    } else {
      const mimeTypeError = this.validateMediaMimeType(
        entryObj.mimeType,
        accept,
      );
      if (mimeTypeError) {
        errors.push({ message: mimeTypeError, value: entry });
      }
    }

    if (type === "images") {
      // Validate hotspot if present
      if (entryObj.hotspot !== undefined) {
        const hs = entryObj.hotspot as Record<string, unknown>;
        if (
          typeof entryObj.hotspot !== "object" ||
          typeof hs.x !== "number" ||
          typeof hs.y !== "number"
        ) {
          errors.push({
            message: `Hotspot must be an object with x and y as numbers.`,
            value: entry,
          });
        }
      }

      // Validate alt using the alt schema
      const altPath = createValPathOfItem(path, "alt");
      if (altPath && altSchema) {
        const altError = altSchema["executeValidate"](
          altPath,
          entryObj.alt as SelectorSource,
        );
        if (altError) {
          return errors.length > 0 ? { ...altError, [path]: errors } : altError;
        }
      }
    }

    if (errors.length > 0) {
      return { [path]: errors };
    }

    return false;
  }

  private validateMediaMimeType(
    mimeType: string,
    accept: string,
  ): string | null {
    if (!mimeType.includes("/")) {
      return `Invalid mime type format. Got: '${mimeType}'`;
    }

    const acceptedTypes = accept.split(",").map((type) => type.trim());

    const isValidMimeType = acceptedTypes.some((acceptedType) => {
      if (acceptedType === "*/*") {
        return true;
      }
      if (acceptedType === "image/*") {
        return mimeType.startsWith("image/");
      }
      if (acceptedType.endsWith("/*")) {
        const baseType = acceptedType.slice(0, -2);
        return mimeType.startsWith(baseType);
      }
      return acceptedType === mimeType;
    });

    if (!isValidMimeType) {
      return `Mime type mismatch. Found '${mimeType}' but schema accepts '${accept}'`;
    }

    return null;
  }

  protected executeAssert(
    path: SourcePath,
    src: unknown,
  ): SchemaAssertResult<Src> {
    if (this.opt && src === null) {
      return {
        success: true,
        data: src,
      } as SchemaAssertResult<Src>;
    }
    if (src === null) {
      return {
        success: false,
        errors: {
          [path]: [
            { message: `Expected 'object', got 'null'`, typeError: true },
          ],
        },
      };
    }
    if (typeof src !== "object") {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Expected 'object', got '${typeof src}'`,
              typeError: true,
            },
          ],
        },
      };
    }
    if (Array.isArray(src)) {
      return {
        success: false,
        errors: {
          [path]: [
            { message: `Expected 'object', got 'array'`, typeError: true },
          ],
        },
      };
    }
    return {
      success: true,
      data: src,
    } as SchemaAssertResult<Src>;
  }

  nullable(): RecordSchema<T, K, Src | null> {
    return new RecordSchema(
      this.item,
      true,
      this.customValidateFunctions,
      this.currentRouter,
      this.keySchema,
      this.mediaOptions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.isJsonValues,
    ) as RecordSchema<T, K, Src | null>;
  }

  readonly(): RecordSchema<T, K, Src> {
    return new RecordSchema(
      this.item,
      this.opt,
      this.customValidateFunctions,
      this.currentRouter,
      this.keySchema,
      this.mediaOptions,
      true,
      this.isHidden,
      this.description,
      this.isJsonValues,
    );
  }

  hidden(): RecordSchema<T, K, Src> {
    return new RecordSchema(
      this.item,
      this.opt,
      this.customValidateFunctions,
      this.currentRouter,
      this.keySchema,
      this.mediaOptions,
      this.isReadonly,
      true,
      this.description,
      this.isJsonValues,
    );
  }

  router(router: ValRouter): RecordSchema<T, K, Src> {
    return new RecordSchema(
      this.item,
      this.opt,
      this.customValidateFunctions,
      router,
      this.keySchema,
      this.mediaOptions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.isJsonValues,
    );
  }

  remote(): RecordSchema<T, K, Src> {
    return new RecordSchema(
      this.item,
      this.opt,
      this.customValidateFunctions,
      this.currentRouter,
      this.keySchema,
      this.mediaOptions ? { ...this.mediaOptions, remote: true } : undefined,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.isJsonValues,
    );
  }

  /**
   * Store each entry's value in its own lazily-loaded `*.val.json` file instead
   * of inlining it in the `.val.ts` module. Entry values become
   * {@link JsonSource} thunks (`c.json(() => import("./entry.val.json"), sha)`),
   * which lets the runtime, the Studio and validation work one entry at a time
   * so a record/router can scale to many thousands of entries.
   *
   * Not supported on image/file galleries (`s.images()` / `s.files()`).
   */
  jsonValues(): RecordSchema<T, K, JsonValuesRecordSrc<T, K>> {
    if (this.mediaOptions) {
      throw new Error(
        ".jsonValues() cannot be used with image/file galleries (s.images()/s.files())",
      );
    }
    return new RecordSchema(
      this.item,
      this.opt,
      // custom validate functions are typed against the previous Src; drop them
      // since the source shape changes to JsonSource entries.
      [],
      this.currentRouter,
      this.keySchema,
      this.mediaOptions,
      this.isReadonly,
      this.isHidden,
      this.description,
      true,
    ) as RecordSchema<T, K, JsonValuesRecordSrc<T, K>>;
  }

  private getRouterValidations(path: SourcePath, src: Src): ValidationErrors {
    if (!this.currentRouter) {
      return false;
    }
    if (src === null) {
      return false;
    }
    const [moduleFilePath, modulePath] = splitModuleFilePathAndModulePath(path);
    if (modulePath) {
      return {
        [path]: [
          {
            message: `This field was configured as a router, but it is not defined at the root of the module`,
            schemaError: true,
          },
        ],
      };
    }
    const routerValidationErrors = this.currentRouter.validate(
      moduleFilePath,
      Object.keys(src),
    );
    if (routerValidationErrors.length > 0) {
      return Object.fromEntries(
        routerValidationErrors.map(
          (validation): [SourcePath, ValidationError[]] => {
            if (!validation.error.urlPath) {
              return [
                path,
                [
                  {
                    message: `Router validation error: ${validation.error.message} has no url path`,
                    schemaError: true,
                  },
                ],
              ];
            }
            const subPath = createValPathOfItem(path, validation.error.urlPath);
            if (!subPath) {
              throw new Error(
                `Internal error: could not create path at ${
                  !path && typeof path === "string" ? "<empty string>" : path
                } for router validation`, // Should! never happen
              );
            }
            return [
              subPath,
              [
                {
                  message: validation.error.message,
                  value: validation.error.urlPath,
                  keyError: true,
                },
              ],
            ];
          },
        ),
      );
    }
    return false;
  }

  protected executeSerialize(): SerializedRecordSchema {
    const result: SerializedRecordSchema = {
      type: "record",
      item: this.item["executeSerialize"](),
      key: this.keySchema?.["executeSerialize"](),
      opt: this.opt,
      router: this.currentRouter?.getRouterId(),
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
      jsonValues: this.isJsonValues ? true : undefined,
      readonly: this.isReadonly,
      hidden: this.isHidden,
      description: this.description,
    };
    if (this.mediaOptions) {
      result.mediaType = this.mediaOptions.type;
      result.accept = this.mediaOptions.accept;
      result.directory = this.mediaOptions.directory;
      result.remote = this.mediaOptions.remote;
      if (this.mediaOptions.altSchema) {
        result.alt = this.mediaOptions.altSchema["executeSerialize"]();
      }
    }
    return result;
  }

  private renderInput: {
    layout: "list";
    select: (input: { key: string; val: RenderSelector<T> }) => {
      title: string;
      subtitle?: string | null;
      image?: ImageSource | RemoteSource<ImageMetadata> | null;
    };
  } | null = null;

  /**
   * Validate the loaded content of a single `.jsonValues()` entry against the
   * item schema. The server calls this once it has loaded the backing
   * `*.val.json` for an entry (the deep validation that `executeValidate`
   * defers).
   */
  validateJsonEntryContent(
    path: SourcePath,
    content: SelectorSource,
  ): ValidationErrors {
    return this.item["executeValidate"](path, content);
  }

  protected override executeRender(
    sourcePath: SourcePath | ModuleFilePath,
    src: Src,
  ): ReifiedRender {
    const res: ReifiedRender = {};
    if (src === null) {
      return res;
    }
    if (this.isJsonValues) {
      // jsonValues entries are not inlined, so there is no per-entry source to
      // render at the record level. Rendering happens per entry once loaded.
      return res;
    }
    for (const key in src) {
      const itemSrc = src[key as unknown as SelectorOfSchema<K>];
      if (itemSrc === null || itemSrc === undefined) {
        continue;
      }
      const subPath = unsafeCreateSourcePath(sourcePath, key);
      const itemResult = this.item["executeRender"](subPath, itemSrc);
      for (const keyS in itemResult) {
        const key = keyS as SourcePath | ModuleFilePath;
        res[key] = itemResult[key];
      }
    }
    if (this.renderInput) {
      const { select: prepare, layout: layout } = this.renderInput;
      if (layout !== "list") {
        res[sourcePath] = {
          status: "error",
          message: "Unknown layout type: " + layout,
        };
      }
      try {
        res[sourcePath] = {
          status: "success",
          data: {
            layout: "list",
            parent: "record",
            items: Object.entries(src).map(([key, val]) => {
              // NB NB: display is actually defined by the user
              const { title, subtitle, image } = prepare({
                key,
                val: val as SelectorOfSchema<T>,
              });
              return [key, { title, subtitle, image }];
            }),
          },
        };
      } catch (e) {
        res[sourcePath] = {
          status: "error",
          message: e instanceof Error ? e.message : "Unknown error",
        };
      }
    }
    return res;
  }

  render(input: {
    as: "list";
    select: (input: { key: string; val: RenderSelector<T> }) => {
      title: string;
      subtitle?: string | null;
      image?: ImageSource | RemoteSource<ImageMetadata> | null;
    };
  }) {
    this.renderInput = {
      layout: input.as,
      select: input.select,
    };
    return this;
  }
}

// Overload: with key schema
export function record<
  K extends Schema<string>,
  S extends Schema<SelectorSource>,
>(
  key: K,
  schema: S,
): RecordSchema<S, K, Record<SelectorOfSchema<K>, SelectorOfSchema<S>>>;

// Overload: without key schema
export function record<S extends Schema<SelectorSource>>(
  schema: S,
): RecordSchema<S, Schema<string>, Record<string, SelectorOfSchema<S>>>;

// Implementation
export function record<
  K extends Schema<string>,
  S extends Schema<SelectorSource>,
>(
  keyOrSchema: K | S,
  schema?: S,
): RecordSchema<S, K, Record<SelectorOfSchema<K>, SelectorOfSchema<S>>> {
  if (schema) {
    // Two-argument call: first is key schema, second is value schema
    return new RecordSchema(schema, false, [], null, keyOrSchema as K);
  } else {
    // One-argument call: only value schema
    return new RecordSchema(keyOrSchema as S, false, [], null, null);
  }
}
