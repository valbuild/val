import {
  FileSource,
  GalleryFileSource,
  isRemoteMediaPath,
} from "../source/media";
export type { FileMetadata } from "../source/file";

import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import { getValPath, ModulePath, SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";
import { Internal, ValModule } from "..";
import { ItemPreviewInput, PreviewItem, ReifiedPreview } from "../preview";
import { FieldRender } from "../render";
import { FilesetEntryMetadata } from "./fileset";
import { getSource } from "../module";
import { mimeTypeMatchesAccept } from "../mimeType";

export type FileOptions = {
  accept?: string;
};

export type SerializedFileSchema = {
  type: "file";
  /** Static layout config, carried whole in the serialized schema — see `render.ts`. */
  render?: FieldRender;
  /** Set when this schema declares a `preview`. The closure itself cannot serialize. */
  preview?: true;
  options?: FileOptions;
  remote?: boolean;
  opt: boolean;
  customValidate?: boolean;
  referencedModule?: string;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

export class FileSchema<Src extends FileSource | null> extends Schema<Src> {
  constructor(
    private readonly options?: FileOptions,
    private readonly opt: boolean = false,
    protected readonly isRemote: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
    private readonly moduleMetadata: Record<
      ModulePath,
      Record<string, FilesetEntryMetadata>
    > = {},
    private readonly isReadonly: boolean = false,
    private readonly isHidden: boolean = false,
    private readonly description?: string,
    private readonly renderInput: FieldRender | null = null,
    private readonly previewInput: ItemPreviewInput<Src> | null = null,
  ) {
    super();
  }

  /**
   * Describe this field.
   *
   * The description is shown next to the field's label in the Val editor, so
   * it is where you say what an editor needs to know but the field name cannot
   * carry. It also travels in the serialized schema, which is what the AI
   * assistant and the MCP tools read.
   *
   * Pass `null` to clear a description set earlier.
   *
   * @example
   * const schema = s.file().describe("The PDF offered for download");
   * export default c.define("/example.val.ts", schema, {
   *   path: "/public/val/example.pdf",
   *   mimeType: "application/pdf",
   * });
   */
  describe(description: string | null): FileSchema<Src> {
    return new FileSchema(
      this.options,
      this.opt,
      this.isRemote,
      this.customValidateFunctions,
      this.moduleMetadata,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
      this.renderInput,
      this.previewInput,
    );
  }

  /**
   * Store the file on Val's remote content host instead of in your repository.
   *
   * The bytes still go into the patch store when the file is uploaded — the
   * push to the remote host happens at publish. What changes is where the
   * published file lives: `path` becomes a remote URL rather than a path under
   * `/public`, so the repository does not grow with every upload.
   *
   * The `path` of a remote file is a URL on the content host, and it is not
   * something to write by hand: upload the file in the Studio, or write a
   * local path and let `npx val validate --fix` upload it and rewrite the
   * `path` to the ref below.
   *
   * @example
   * const schema = s.file({ accept: "application/pdf" }).remote();
   * export default c.define("/example.val.ts", schema, {
   *   path: "https://remote.val.build/file/p/my-project/b/01/v/1.0.0/h/8f2a1c/f/3b9d70/p/public/val/example.pdf",
   *   mimeType: "application/pdf",
   * });
   */
  remote(): FileSchema<Src> {
    return new FileSchema(
      this.options,
      this.opt,
      true,
      this.customValidateFunctions,
      this.moduleMetadata,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  /**
   * Add a custom validation rule to this field.
   *
   * The function is called with the field's value and returns `false` when the
   * value is fine, or a STRING with the message to show when it is not. Call it
   * more than once to add more rules — they all run, and every message is
   * reported.
   *
   * Write the check as a ternary, not as `ok || "message"`: that returns `true`
   * when the value is fine, and `true` is not one of the two answers.
   *
   * Validation runs in the Studio as you type, in `npx val validate` and
   * before a publish.
   *
   * The second argument carries the `path` of the field being validated, for
   * when the message needs to say where the problem is.
   *
   * @example
   * const schema = s.file().validate((val) =>
   *   val.path.endsWith(".pdf") ? false : "Must be a PDF",
   * );
   * export default c.define("/example.val.ts", schema, {
   *   path: "/public/val/example.pdf",
   *   mimeType: "application/pdf",
   * });
   */
  validate(validationFunction: CustomValidateFunction<Src>): FileSchema<Src> {
    return new FileSchema(
      this.options,
      this.opt,
      this.isRemote,
      [...this.customValidateFunctions, validationFunction],
      this.moduleMetadata,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    const customValidationErrors: ValidationError[] =
      this.executeCustomValidateFunctions(src, this.customValidateFunctions, {
        path,
      });
    if (this.opt && (src === null || src === undefined)) {
      return customValidationErrors.length > 0
        ? { [path]: customValidationErrors }
        : false;
    }
    if (src === null || src === undefined) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Non-optional file was null or undefined.`,
            value: src,
          },
        ],
      } as ValidationErrors;
    }
    if (typeof src.path !== "string") {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `File did not have a path string. Got: ${typeof src.path}`,
            value: src,
          },
        ],
      } as ValidationErrors;
    }
    // Remote-ness is a property of the path, not of a marker on the value:
    // anything outside /public is remote.
    const isRemotePath = isRemoteMediaPath(src.path);
    if (this.isRemote && !isRemotePath) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Expected a remote file, but got a local file.`,
            value: src,
            fixes: ["file:upload-remote"],
          },
        ],
      } as ValidationErrors;
    }
    if (this.isRemote && isRemotePath) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Remote file was not checked.`,
            value: src,
            fixes: ["file:check-remote"],
          },
        ],
      } as ValidationErrors;
    }
    if (!this.isRemote && isRemotePath) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Expected local file, but found remote.`,
            value: src,
            fixes: ["file:download-remote"],
          },
        ],
      } as ValidationErrors;
    }

    const galleryEntries = this.galleryEntries();
    if (galleryEntries) {
      if (src.mimeType !== undefined) {
        return {
          [path]: [
            ...customValidationErrors,
            {
              message: `A file from a gallery must not carry its own mimeType: it is stored in the gallery module.`,
              value: src,
            },
          ],
        } as ValidationErrors;
      }
      if (!(src.path in galleryEntries)) {
        return {
          [path]: [
            ...customValidationErrors,
            {
              message: `The gallery does not have a file at '${src.path}'.`,
              value: src,
            },
          ],
        } as ValidationErrors;
      }
      return customValidationErrors.length > 0
        ? ({ [path]: customValidationErrors } as ValidationErrors)
        : false;
    }

    const { accept } = this.options || {};
    const { mimeType } = src;

    if (accept && mimeType && !mimeType.includes("/")) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Invalid mime type format. Got: ${mimeType}`,
            value: src,
          },
        ],
      } as ValidationErrors;
    }

    if (accept && mimeType && mimeType.includes("/")) {
      if (!mimeTypeMatchesAccept(mimeType, accept)) {
        return {
          [path]: [
            ...customValidationErrors,
            {
              message: `Mime type mismatch. Found '${mimeType}' but schema accepts '${accept}'`,
              value: src,
            },
          ],
        } as ValidationErrors;
      }
    }

    const fileMimeType = Internal.filenameToMimeType(src.path);
    if (!fileMimeType) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Could not determine mime type from file extension. Got: ${src.path}`,
            value: src,
          },
        ],
      } as ValidationErrors;
    }

    // Guarded on `mimeType` being set, as `ImageSchema` guards the same check.
    // Without it, an absent mimeType reported "Mime type and file extension not
    // matching. Mime type is 'undefined'" -- with no fix attached, so no quick
    // fix was offered -- and the `file:add-metadata` branch below could never be
    // reached for any file whose extension is recognized, which is all of them
    // that get this far.
    if (mimeType && fileMimeType !== mimeType) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Mime type and file extension not matching. Mime type is '${mimeType}' but file extension is '${fileMimeType}'`,
            value: src,
          },
        ],
      } as ValidationErrors;
    }

    // The mime type read so far came from the filename. Whether it matches the
    // bytes can only be answered by reading the file, which this package
    // deliberately cannot do — so it is always handed on as a fix.
    if (mimeType !== undefined) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `File mimeType has not been checked against the file.`,
            value: src,
            fixes: ["file:check-metadata"],
          },
        ],
      } as ValidationErrors;
    }

    return {
      [path]: [
        ...customValidationErrors,
        {
          message: `File metadata is missing: mimeType.`,
          value: src,
          fixes: ["file:add-metadata"],
        },
      ],
    } as ValidationErrors;
  }

  /**
   * The entries of the gallery this field points at, or null when it is a
   * standalone field.
   */
  private galleryEntries(): Record<string, FilesetEntryMetadata> | null {
    const modulePaths = Object.keys(this.moduleMetadata);
    if (modulePaths.length === 0) {
      return null;
    }
    return this.moduleMetadata[modulePaths[0] as ModulePath];
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
              message: `Expected object, got '${typeof src}'`,
              typeError: true,
            },
          ],
        },
      };
    }
    if (!("path" in src) || typeof src.path !== "string") {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `A file must be an object with a 'path' (error type: missing_path)`,
              typeError: true,
            },
          ],
        },
      };
    }
    return {
      success: true,
      data: src,
    } as SchemaAssertResult<Src>;
  }

  nullable(): FileSchema<Src | null> {
    return new FileSchema<Src | null>(
      this.options,
      true,
      this.isRemote,
      this.customValidateFunctions as CustomValidateFunction<Src | null>[],
      this.moduleMetadata,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  readonly(isReadonly: boolean = true): FileSchema<Src> {
    return new FileSchema<Src>(
      this.options,
      this.opt,
      this.isRemote,
      this.customValidateFunctions,
      this.moduleMetadata,
      isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  hidden(isHidden: boolean = true): FileSchema<Src> {
    return new FileSchema<Src>(
      this.options,
      this.opt,
      this.isRemote,
      this.customValidateFunctions,
      this.moduleMetadata,
      this.isReadonly,
      isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
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

  /**
   * How this field is laid out in the editor when it is the item of an array
   * or record: `{ as: "inline" }` renders the field itself inside each row,
   * instead of a preview row that navigates to it.
   *
   * Static configuration, not a callback — see `render.ts`.
   *
   * @example
   * const schema = s.array(s.file().render({ as: "inline" }));
   * export default c.define("/example.val.ts", schema, [
   *   { path: "/public/val/example.pdf", mimeType: "application/pdf" },
   * ]);
   */
  render(input: FieldRender): FileSchema<Src> {
    return new FileSchema(
      this.options,
      this.opt,
      this.isRemote,
      this.customValidateFunctions,
      this.moduleMetadata,
      this.isReadonly,
      this.isHidden,
      this.description,
      input,
      this.previewInput,
    );
  }

  /**
   * How this VALUE is shown where a preview of it is needed — a row in a
   * sortable list, a reference dropdown, a search hit. Never how the field
   * itself is edited (that is `render`). See `preview.ts`.
   *
   * @example
   * const schema = s.array(
   *   s.file().preview(({ val }) => ({ title: val.path })),
   * );
   * export default c.define("/example.val.ts", schema, [
   *   { path: "/public/val/example.pdf", mimeType: "application/pdf" },
   * ]);
   */
  preview(select: ItemPreviewInput<Src>): FileSchema<Src> {
    return new FileSchema(
      this.options,
      this.opt,
      this.isRemote,
      this.customValidateFunctions,
      this.moduleMetadata,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      select,
    );
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

  protected executeSerialize(): SerializedSchema {
    const modulePaths = this.moduleMetadata
      ? Object.keys(this.moduleMetadata)
      : [];
    return {
      type: "file",
      render: this.renderInput ?? undefined,
      preview: this.previewInput ? true : undefined,
      options: this.options,
      opt: this.opt,
      remote: this.isRemote,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
      referencedModule:
        modulePaths.length > 0 ? (modulePaths[0] as string) : undefined,
      readonly: this.isReadonly,
      hidden: this.isHidden,
      description: this.description,
    };
  }

  protected executePreview(): ReifiedPreview {
    return {};
  }
}

/**
 * A file picked from a gallery. Its mime type lives in the gallery, so the
 * field carries only the path.
 */
export function file(
  galleryModule: ValModule<Record<string, FilesetEntryMetadata>>,
): FileSchema<GalleryFileSource>;
/** A file of its own, carrying its own mime type. */
export function file(options?: FileOptions): FileSchema<FileSource>;
export function file(
  options?: FileOptions | ValModule<Record<string, FilesetEntryMetadata>>,
): FileSchema<FileSource> | FileSchema<GalleryFileSource> {
  const isModule =
    !!options &&
    !!Internal.getValPath(
      options as ValModule<Record<string, FilesetEntryMetadata>>,
    );
  if (isModule) {
    const allModules: Record<string, Record<string, FilesetEntryMetadata>> = {};
    for (const valModule of [
      options as ValModule<Record<string, FilesetEntryMetadata>>,
    ]) {
      const modulePath = getValPath(valModule) as ModulePath | undefined;
      if (modulePath === undefined) {
        throw new Error(
          `Invalid argument passed to s.file(). Expected a ValModule constructed through c.define, but got an object without a valid module path.`,
        );
      }
      allModules[modulePath] = getSource(valModule) as Record<
        string,
        FilesetEntryMetadata
      >;
    }
    return new FileSchema<GalleryFileSource>({}, false, false, [], allModules);
  }
  return new FileSchema(options as FileOptions);
}
