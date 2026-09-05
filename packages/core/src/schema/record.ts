import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SelectorOfSchema,
  SerializedSchema,
} from ".";
import {
  RecordPreview,
  ItemPreviewInput,
  PreviewItem,
  ReifiedPreview,
  PreviewScope,
} from "../preview";
import { splitModuleFilePathAndModulePath } from "../module";
import { FieldRender } from "../render";
import { ValRouter } from "../router";
import { SelectorSource } from "../selector";
import {
  createValPathOfItem,
  unsafeCreateSourcePath,
} from "../selector/SelectorProxy";
import { JsonOf, JsonSource, isJson } from "../source/json";
import { ExternalRecordSrc, isExternal } from "../source/external";
import { ModuleFilePath, SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";
import { splitRemoteRef } from "../remote/splitRemoteRef";
import { mimeTypeMatchesAccept } from "../mimeType";
import type { ImageEncodeOption } from "./image";

type MediaOptions = {
  type: "files" | "images";
  accept: string;
  directory: string;
  remote: boolean;
  altSchema?: Schema<SelectorSource>;
  /** Images only: how uploads are re-encoded in the browser. See `image.ts`. */
  encode?: ImageEncodeOption;
};

export type SerializedRecordSchema = {
  type: "record";
  item: SerializedSchema;
  key?: SerializedSchema;
  opt: boolean;
  /**
   * Set when this schema declares a `preview` — of the RECORD ITSELF as a
   * value. Whether its ENTRIES preview is carried by the item's serialized
   * schema. See `SerializedArraySchema`.
   */
  preview?: true;
  /** Static layout config, carried whole in the serialized schema — see `render.ts`. */
  render?: FieldRender;
  router?: string;
  customValidate?: boolean;
  // Optional media collection marker for files/images that are backed by a record
  mediaType?: "files" | "images";
  accept?: string;
  directory?: string;
  remote?: boolean;
  encode?: ImageEncodeOption;
  alt?: SerializedSchema;
  // When true, entry values are stored in separate lazily-loaded `*.val.json`
  // files (see `.jsonValues()`).
  jsonValues?: boolean;
  /**
   * The label from `.external(label)`. Its presence is what marks the record as
   * externally stored; the value names the binding a reader — or a model — can
   * grep for. See `source/external.ts`.
   */
  external?: string;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

/**
 * The source type of a `.jsonValues()` record: every entry value is EITHER a
 * lazily loaded {@link JsonSource} whose resolved content is the (loosened, see
 * {@link JsonOf}) item type, OR the item value written inline.
 *
 * Inline values are accepted by the TYPE on purpose: hand-authoring an entry
 * directly in the `.val.ts` (or copying one in from a non-jsonValues record) is
 * the natural first thing to write, and a type error there is a dead end — the
 * author cannot see what to write instead. Validation reports the inline entry
 * (`jsonValues:extract-entry`) and `val validate --fix` moves it into its own
 * `*.val.json`, so the mistake is caught and repaired instead of blocking
 * authoring.
 */
export type JsonValuesRecordSrc<
  T extends Schema<SelectorSource>,
  K extends Schema<string>,
> = Record<
  SelectorOfSchema<K>,
  JsonSource<JsonOf<SelectorOfSchema<T>>> | SelectorOfSchema<T>
>;

export class RecordSchema<
  T extends Schema<SelectorSource>,
  K extends Schema<string>,
  Src extends
    | Record<SelectorOfSchema<K>, SelectorOfSchema<T>>
    | JsonValuesRecordSrc<T, K>
    | ExternalRecordSrc
    | null,
  /**
   * Whether `.readonly()` was called. It rides in the type — not only in
   * `isReadonly` — because `.external()` freezes it into the source marker, and
   * the adapter's write methods are required or forbidden on the strength of it.
   */
  RO extends boolean = false,
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
    private readonly previewInput: ItemPreviewInput<Src> | null = null,
    private readonly renderInput: FieldRender | null = null,
    /**
     * Set by `.external(label)`; the entries live behind that adapter.
     *
     * LAST on purpose: every other `new RecordSchema(...)` in the codebase
     * passes its arguments positionally, so a new parameter anywhere else
     * silently shifts `previewInput` and `renderInput` at each of those call
     * sites.
     */
    private readonly externalLabel: string | null = null,
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
      this.previewInput,
      this.renderInput,
      this.externalLabel,
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
      this.previewInput,
      this.renderInput,
      this.externalLabel,
    );
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    let error: ValidationErrors = false;
    if (this.externalLabel !== null) {
      return this.validateExternal(path, src);
    }
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
    error = this.mergeValidationErrors(error, routerValidations);
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
          error = this.mergeValidationErrors(error, keyError);
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
        }
        error = this.mergeValidationErrors(error, keyErr);
        const entryErr = this.validateMediaEntry(subPath, elem);
        if (entryErr) {
          this.markKeyErrorsAtPath(entryErr, subPath);
        }
        error = this.mergeValidationErrors(error, entryErr);
      } else if (this.isJsonValues && isJson(elem)) {
        // jsonValues record, entry not loaded: the value is a lazy JsonSource
        // marker. Deep validation is deferred and run per-entry once the backing
        // `*.val.json` is loaded (server: validateJsonEntryContent; UI: the
        // loaded content is substituted and validated by the branch below).
      } else {
        // Falls through for a jsonValues record whose entry content is inlined
        // (loaded in the UI, or hand-authored): same as a plain record — validate
        // the value against the item schema.
        const subError = this.item["executeValidate"](
          subPath,
          elem as SelectorSource,
        );
        error = this.mergeValidationErrors(error, subError);
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
      // Local path in a remote gallery: needs to be uploaded to remote.
      const uploadRemoteFix =
        type === "images"
          ? ("images:upload-remote" as const)
          : ("files:upload-remote" as const);
      return {
        [path]: [
          {
            message: `Expected a remote ${
              type === "images" ? "image" : "file"
            }, but got a local path. Use Val tooling (CLI --fix, VS Code extension, or Val Studio) to upload it. Got: ${key}`,
            value: key,
            fixes: [uploadRemoteFix],
          },
        ],
      };
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

    if (!mimeTypeMatchesAccept(mimeType, accept)) {
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
      this.previewInput,
      this.renderInput,
      this.externalLabel,
    ) as RecordSchema<T, K, Src | null>;
  }

  /**
   * A record you can look at but not change.
   *
   * Returns `RO = true` so `.external()` can freeze it into the source marker.
   * That is why this must come BEFORE `.external()`: afterwards the value is a
   * `Schema`, and there is no `.readonly()` left to call — which is the error
   * the compiler gives, and a clearer one than a runtime throw.
   */
  readonly(): RecordSchema<T, K, Src, true> {
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
      this.previewInput,
      this.renderInput,
      this.externalLabel,
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
      this.previewInput,
      this.renderInput,
      this.externalLabel,
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
      this.previewInput,
      this.renderInput,
      this.externalLabel,
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
      this.previewInput,
      this.renderInput,
      this.externalLabel,
    );
  }

  /**
   * Store each entry's value in its own lazily-loaded `*.val.json` file instead
   * of inlining it in the `.val.ts` module. Entry values become
   * {@link JsonSource} thunks (`c.json(() => import("./entry.val.json"))`),
   * which lets the runtime, the Studio and validation work one entry at a time
   * so a record/router can scale to many thousands of entries.
   *
   * Not supported on image/file galleries (`s.images()` / `s.files()`).
   *
   * Only supported on a module's ROOT record/router — a `.jsonValues()` record
   * nested inside an object/array/record is rejected at startup with a module
   * error, because the single-entry fetch endpoint, the Studio's content
   * substitution and content validation are all root-only.
   */
  jsonValues(): RecordSchema<T, K, JsonValuesRecordSrc<T, K>> {
    if (this.mediaOptions) {
      throw new Error(
        ".jsonValues() cannot be used with image/file galleries (s.images()/s.files())",
      );
    }
    if (this.customValidateFunctions.length > 0) {
      // `.jsonValues()` changes the source shape to JsonSource entries, so a
      // validator typed against the previous Src cannot be carried over. Refusing
      // is the point: silently dropping it left the developer looking at a
      // `.validate(...)` in their source file that never ran anywhere.
      throw new Error(
        ".jsonValues() must come BEFORE .validate(): a validator added first is typed against the un-lazy source shape and cannot be carried over. Write s.record(...).jsonValues().validate(...) instead.",
      );
    }
    if (this.previewInput !== null) {
      // Same reasoning as the validator guard above: the record's own preview
      // closure is typed against the un-lazy source shape.
      throw new Error(
        ".jsonValues() must come BEFORE .preview(): a preview added first is typed against the un-lazy source shape and cannot be carried over. Write s.record(...).jsonValues().preview(...) instead.",
      );
    }
    // Explicit type args instead of a cast on the result: `previewInput` would
    // otherwise pin inference to `Src`, and the two record source shapes no
    // longer overlap enough for the old assertion.
    return new RecordSchema<T, K, JsonValuesRecordSrc<T, K>>(
      this.item,
      this.opt,
      // Empty by construction: the guard above rejects any that were registered.
      [],
      this.currentRouter,
      this.keySchema,
      this.mediaOptions,
      this.isReadonly,
      this.isHidden,
      this.description,
      true,
      // Null by construction: the guard above rejects any that was declared.
      null,
      this.renderInput,
      this.externalLabel,
    );
  }

  /**
   * Store this record's entries behind an adapter — a database, an HTTP API, a
   * bucket — instead of in the module.
   *
   * Available on every record-derived schema, which is `s.record()`,
   * `s.router()`, `s.images()` and `s.files()` alike: a router is a
   * `RecordSchema` with a `ValRouter`, a gallery one with media options, so all
   * four get external storage from this one method.
   *
   * `label` does not address the binding — the registry is keyed by module, and
   * so is the wire protocol. It exists so a reader of the schema can see what
   * backs it, and it is checked against the binding that claims it, so the two
   * cannot drift.
   *
   * Only supported on a module's ROOT record, exactly as `.jsonValues()` is: a
   * nested external record would leave a hole in the middle of a module's
   * source, and the Studio, patching and validation all assume a module's
   * source is complete apart from its entries.
   */
  external<L extends string>(
    label: L,
  ): RecordSchema<T, K, ExternalRecordSrc<SelectorOfSchema<T>, L, RO>, RO> {
    if (this.isJsonValues) {
      throw new Error(
        ".external() cannot be combined with .jsonValues(): entries live in one place or the other, not both.",
      );
    }
    if (!label) {
      throw new Error('.external() requires a label, e.g. .external("posts")');
    }
    return new RecordSchema<
      T,
      K,
      ExternalRecordSrc<SelectorOfSchema<T>, L, RO>,
      RO
    >(
      this.item,
      this.opt,
      // Empty by construction: a validator declared before `.external()` is
      // typed against the un-external source shape and cannot be carried over.
      [],
      this.currentRouter,
      this.keySchema,
      this.mediaOptions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.isJsonValues,
      null,
      this.renderInput,
      label,
    );
  }

  /**
   * An external record's source is either the `c.external()` marker or entries
   * still written inline in the `.val.ts`.
   *
   * Inline entries are NOT a type error (see `ExternalRecordWritableSrc`), so
   * this is where they surface: as an `external:upload` fix, per key, the way
   * `.jsonValues()` reports an un-extracted entry. Reporting per key rather than
   * once for the record is what lets the fix be applied to one entry, and what
   * puts the error at a path the editor can navigate to.
   */
  private validateExternal(path: SourcePath, src: Src): ValidationErrors {
    if (this.opt && (src === null || src === undefined)) {
      return false;
    }
    if (src === null || typeof src !== "object" || Array.isArray(src)) {
      return {
        [path]: [
          {
            message: `Expected the c.external() marker or inline entries, got '${
              src === null ? "null" : Array.isArray(src) ? "array" : typeof src
            }'`,
            value: src,
            schemaError: true,
          },
        ],
      };
    }
    if (isExternal(src)) {
      // The marker: the entries are the adapter's, and there is nothing here to
      // check. Their content is validated as it is read.
      return false;
    }
    let error: ValidationErrors = false;
    for (const key of Object.keys(src)) {
      const subPath = createValPathOfItem(path, key);
      if (!subPath) {
        continue;
      }
      error = this.appendValidationError(
        error,
        subPath,
        `Entry is written inline, but this record is .external("${this.externalLabel}"). Run 'val external upload' to move it into the store.`,
        (src as Record<string, unknown>)[key],
      );
      const errors = error as Record<SourcePath, ValidationError[]>;
      const last = errors[subPath][errors[subPath].length - 1];
      last.fixes = ["external:upload"];
    }
    return error;
  }

  private getRouterValidations(path: SourcePath, src: Src): ValidationErrors {
    if (isExternal(src)) {
      // The marker holds no entries, and its one enumerable property is `_type`
      // — which a router would happily reject as a bad route. The keys of an
      // external router are validated as they are READ, per key, by
      // {@link validateRecordKeys}: they are the store's, and the store is not
      // here.
      return false;
    }
    return this.validateRecordKeys(
      path,
      src === null || typeof src !== "object" ? [] : Object.keys(src),
    );
  }

  /**
   * Check entry KEYS against the record's router, if it has one.
   *
   * Separate from `executeValidate` because an external record's keys do not
   * arrive with its source: the source is a marker, and the keys come back a
   * page at a time from the adapter. Validating the whole key set at once would
   * mean validating nothing at all for such a record — which is worse than not
   * validating, because it LOOKS like a check.
   */
  validateRecordKeys(path: SourcePath, keys: string[]): ValidationErrors {
    if (!this.currentRouter) {
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
      keys,
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

  protected override executeCustomValidateAt(
    path: SourcePath,
    src: Src,
  ): ValidationError[] {
    return this.executeCustomValidateFunctions(
      src,
      this.customValidateFunctions,
      { path },
    );
  }

  protected executeSerialize(): SerializedRecordSchema {
    const result: SerializedRecordSchema = {
      type: "record",
      render: this.renderInput ?? undefined,
      item: this.item["executeSerialize"](),
      key: this.keySchema?.["executeSerialize"](),
      opt: this.opt,
      preview: this.previewInput ? true : undefined,
      router: this.currentRouter?.getRouterId(),
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
      jsonValues: this.isJsonValues ? true : undefined,
      external: this.externalLabel ?? undefined,
      readonly: this.isReadonly,
      hidden: this.isHidden,
      description: this.description,
    };
    if (this.mediaOptions) {
      result.mediaType = this.mediaOptions.type;
      result.accept = this.mediaOptions.accept;
      result.directory = this.mediaOptions.directory;
      result.remote = this.mediaOptions.remote;
      if (this.mediaOptions.encode !== undefined) {
        result.encode = this.mediaOptions.encode;
      }
      if (this.mediaOptions.altSchema) {
        result.alt = this.mediaOptions.altSchema["executeSerialize"]();
      }
    }
    return result;
  }

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

  protected override executePreview(
    sourcePath: SourcePath | ModuleFilePath,
    src: Src,
    scope?: PreviewScope,
  ): ReifiedPreview {
    const res: ReifiedPreview = {};
    if (src === null) {
      return res;
    }
    if (isExternal(src)) {
      // The entries are the adapter's; there is nothing here to preview.
      return res;
    }
    for (const key in src) {
      const itemSrc = src[key as unknown as SelectorOfSchema<K>];
      if (itemSrc === null || itemSrc === undefined) {
        continue;
      }
      if (isJson(itemSrc)) {
        // An un-loaded `.jsonValues()` entry: an opaque marker, not the item this
        // schema describes. Skipping it is what makes previewing a partially
        // loaded record work — the result comes out covering exactly the loaded
        // keys, and the caller shows a placeholder for the rest.
        continue;
      }
      const subPath = unsafeCreateSourcePath(sourcePath, key);
      if (scope !== undefined && !scope.wantsUnder(subPath)) {
        continue;
      }
      const itemResult = this.item["executePreview"](subPath, itemSrc, scope);
      for (const keyS in itemResult) {
        const key = keyS as SourcePath | ModuleFilePath;
        res[key] = itemResult[key];
      }
    }
    // The entries preview comes from the ITEM schema's own `preview` — the
    // container just runs it per entry. Asked as a fact rather than by running
    // the closure, so an empty record still previews as an empty record.
    if (this.item["declaresItemPreview"]()) {
      // See the same block in `array`: the whole record when the record is what
      // is being shown, only the wanted entries when it is not.
      const window =
        scope !== undefined && !scope.wants(sourcePath) ? scope : null;
      const items: RecordPreview["items"] = [];
      for (const [key, val] of Object.entries(src)) {
        if (isJson(val)) {
          continue; // as above: nothing to select from an un-loaded entry
        }
        if (val === null || val === undefined) {
          continue;
        }
        if (
          window !== null &&
          !window.wantsUnder(unsafeCreateSourcePath(sourcePath, key))
        ) {
          continue;
        }
        // Per KEY, not per record: the closure is user code, and one entry whose
        // data trips it up must not take out the whole list.
        try {
          // NB NB: display is actually defined by the user
          const item = this.item["executePreviewItem"](
            val as NonNullable<SelectorOfSchema<T>>,
          );
          if (item !== null) {
            const { title, subtitle, image } = item;
            items.push([key, { title, subtitle, image }]);
          }
        } catch (e) {
          res[unsafeCreateSourcePath(sourcePath, key)] = {
            status: "error",
            message: e instanceof Error ? e.message : "Unknown error",
          };
        }
      }
      res[sourcePath] = {
        status: "success",
        data: {
          parent: "record",
          items,
        },
      };
    }
    return res;
  }

  protected override executePreviewItem(
    src: NonNullable<Src>,
  ): PreviewItem | null {
    if (this.previewInput === null) {
      return null;
    }
    return this.previewInput({ val: src });
  }

  protected override declaresItemPreview(): boolean {
    return this.previewInput !== null;
  }

  /**
   * How this RECORD ITSELF is shown where a preview of it is needed — when it
   * is the item of another container, in search, in references. What its
   * entries show is the ITEM schema's `preview`, not this. Never how the field
   * is edited (that is `render`). See `preview.ts`.
   */
  preview(select: ItemPreviewInput<Src>): RecordSchema<T, K, Src> {
    return new RecordSchema(
      this.item,
      this.opt,
      this.customValidateFunctions,
      this.currentRouter,
      this.keySchema,
      this.mediaOptions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.isJsonValues,
      select,
      this.renderInput,
      this.externalLabel,
    );
  }

  /**
   * How this field is laid out in the editor when it is the item of an array
   * or record: `{ as: "inline" }` renders the field itself inside each row,
   * instead of a preview row that navigates to it.
   *
   * Static configuration, not a callback — see `render.ts`.
   */
  render(input: FieldRender): RecordSchema<T, K, Src> {
    return new RecordSchema(
      this.item,
      this.opt,
      this.customValidateFunctions,
      this.currentRouter,
      this.keySchema,
      this.mediaOptions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.isJsonValues,
      this.previewInput,
      input,
      this.externalLabel,
    );
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
