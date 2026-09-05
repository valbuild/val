import {
  Schema,
  SchemaAssertResult,
  SelectorOfSchema,
  SerializedSchema,
} from ".";
import {
  ArrayPreview,
  ItemPreviewInput,
  PreviewItem,
  ReifiedPreview,
  PreviewScope,
} from "../preview";
import { FieldRender } from "../render";
import { SelectorSource } from "../selector";
import { unsafeCreateSourcePath } from "../selector/SelectorProxy";
import { ModuleFilePath, SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

export type SerializedArraySchema = {
  type: "array";
  /** Static layout config, carried whole in the serialized schema — see `render.ts`. */
  render?: FieldRender;
  item: SerializedSchema;
  opt: boolean;
  /**
   * Set when this schema declares a `preview` — of the ARRAY ITSELF as a
   * value, for when it is the item of another container. Whether this array's
   * ROWS preview is carried by the ITEM's serialized schema, where the closure
   * is declared.
   *
   * The preview itself cannot be serialized — it is a user closure — but whether
   * one EXISTS can be, and that is worth carrying: it lets the non-host side
   * skip asking the host to preview a module that cannot produce one. Measured
   * in a browser: mounting 260 fields across 141 modules spent ~2.3ms of 3.1ms
   * calling `executePreview` on modules that returned nothing.
   */
  preview?: true;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

export class ArraySchema<
  T extends Schema<SelectorSource>,
  Src extends SelectorOfSchema<T>[] | null,
> extends Schema<Src> {
  constructor(
    private readonly item: T,
    private readonly opt: boolean = false,
    private readonly customValidateFunctions: ((
      src: Src,
    ) => false | string)[] = [],
    private readonly isReadonly: boolean = false,
    private readonly isHidden: boolean = false,
    private readonly description?: string,
    private readonly previewInput: ItemPreviewInput<Src> | null = null,
    private readonly renderInput: FieldRender | null = null,
  ) {
    super();
  }

  describe(description: string | null): ArraySchema<T, Src> {
    return new ArraySchema(
      this.item,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
      this.previewInput,
      this.renderInput,
    );
  }

  validate(
    validationFunction: (src: Src) => false | string,
  ): ArraySchema<T, Src> {
    return new ArraySchema(
      this.item,
      this.opt,
      [...this.customValidateFunctions, validationFunction],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.renderInput,
    );
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    const assertRes = this.executeAssert(path, src);
    if (!assertRes.success) {
      return assertRes.errors;
    }
    if (assertRes.data === null) {
      return false;
    }
    let error: ValidationErrors = false;
    for (const [idx, i] of Object.entries(assertRes.data)) {
      const subPath = unsafeCreateSourcePath(path, Number(idx));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subError = this.item["executeValidate"](subPath, i as any);
      error = this.mergeValidationErrors(error, subError);
    }
    return error;
  }

  protected executeAssert(
    path: SourcePath,
    src: unknown,
  ): SchemaAssertResult<Src> {
    if (src === null && this.opt) {
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
            { message: "Expected 'array', got 'null'", typeError: true },
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
    } else if (!Array.isArray(src)) {
      return {
        success: false,
        errors: {
          [path]: [
            { message: `Expected object of type 'array'`, typeError: true },
          ],
        },
      };
    }
    return {
      success: true,
      data: src,
    } as SchemaAssertResult<Src>;
  }

  nullable(): ArraySchema<T, Src | null> {
    // Explicit type args: `previewInput` would otherwise pin inference to `Src`.
    return new ArraySchema<T, Src | null>(
      this.item,
      true,
      [],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.renderInput,
    );
  }

  readonly(isReadonly: boolean = true): ArraySchema<T, Src> {
    return new ArraySchema(
      this.item,
      this.opt,
      this.customValidateFunctions,
      isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.renderInput,
    );
  }

  hidden(isHidden: boolean = true): ArraySchema<T, Src> {
    return new ArraySchema(
      this.item,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      isHidden,
      this.description,
      this.previewInput,
      this.renderInput,
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

  protected executeSerialize(): SerializedArraySchema {
    return {
      type: "array",
      render: this.renderInput ?? undefined,
      item: this.item["executeSerialize"](),
      opt: this.opt,
      preview: this.previewInput ? true : undefined,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
      readonly: this.isReadonly,
      hidden: this.isHidden,
      description: this.description,
    };
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
    for (let i = 0; i < src.length; i++) {
      const key = i;
      const itemSrc = src[key];
      if (itemSrc === null || itemSrc === undefined) {
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
    // The rows preview comes from the ITEM schema's own `preview` — the
    // container just runs it per row. Asked as a fact rather than by running
    // the closure, so an empty list still previews as an empty list.
    if (this.item["declaresItemPreview"]()) {
      // The whole list when the LIST is what is being shown; only the wanted
      // rows when it is not. The user's closure is the real expense — a list
      // view asks for the container and gets every row, a single field asks for
      // its own path and costs one call.
      // Non-null once, as a value, rather than a boolean the compiler cannot
      // tie back to `scope`: no scope and a scope that wants this exact path
      // both mean the whole list, and anything else is a window.
      const window =
        scope !== undefined && !scope.wants(sourcePath) ? scope : null;
      const items: ArrayPreview["items"] = [];
      for (let index = 0; index < src.length; index++) {
        const itemSrc = src[index];
        if (itemSrc === null || itemSrc === undefined) {
          continue;
        }
        if (
          window !== null &&
          !window.wantsUnder(unsafeCreateSourcePath(sourcePath, index))
        ) {
          continue;
        }
        // Per ITEM, not per list: the closure is user code, and one row whose
        // data trips it up must not take out the whole list. Before scoping,
        // one throwing row produced an error at the container and no items at
        // all.
        try {
          // NB NB: display is actually defined by the user
          const item = this.item["executePreviewItem"](itemSrc);
          if (item !== null) {
            const { title, subtitle, image } = item;
            items.push([index, { title, subtitle, image }]);
          }
        } catch (e) {
          res[unsafeCreateSourcePath(sourcePath, index)] = {
            status: "error",
            message: e instanceof Error ? e.message : "Unknown error",
          };
        }
      }
      res[sourcePath] = {
        status: "success",
        data: {
          parent: "array",
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
   * How this ARRAY ITSELF is shown where a preview of it is needed — when it
   * is the item of another container, in search, in references. What its rows
   * show is the ITEM schema's `preview`, not this. Never how the field is
   * edited (that is `render`). See `preview.ts`.
   */
  preview(select: ItemPreviewInput<Src>): ArraySchema<T, Src> {
    return new ArraySchema(
      this.item,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      select,
      this.renderInput,
    );
  }

  /**
   * How this field is laid out in the editor when it is the item of an array
   * or record: `{ as: "inline" }` renders the field itself inside each row,
   * instead of a preview row that navigates to it.
   *
   * Static configuration, not a callback — see `render.ts`.
   */
  render(input: FieldRender): ArraySchema<T, Src> {
    return new ArraySchema(
      this.item,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      input,
    );
  }
}

export const array = <S extends Schema<SelectorSource>>(
  schema: S,
): ArraySchema<S, SelectorOfSchema<S>[]> => {
  return new ArraySchema(schema);
};
