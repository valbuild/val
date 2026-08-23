import {
  Schema,
  SchemaAssertResult,
  SelectorOfSchema,
  SerializedSchema,
} from ".";
import {
  ListArrayRender,
  RenderSelector,
  ReifiedRender,
  RenderScope,
} from "../render";
import { SelectorSource } from "../selector";
import { unsafeCreateSourcePath } from "../selector/SelectorProxy";
import { ImageSource } from "../source/image";
import { ModuleFilePath, SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

export type SerializedArraySchema = {
  type: "array";
  item: SerializedSchema;
  opt: boolean;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

type ArrayRenderInput<T extends Schema<SelectorSource>> = {
  as: "list";
  select: (input: { val: RenderSelector<T> }) => {
    title: string;
    subtitle?: string | null;
    image?: ImageSource | null;
  };
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
    private readonly renderInput: ArrayRenderInput<T> | null = null,
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
    return new ArraySchema(
      this.item,
      true,
      [],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
    );
  }

  readonly(): ArraySchema<T, Src> {
    return new ArraySchema(
      this.item,
      this.opt,
      this.customValidateFunctions,
      true,
      this.isHidden,
      this.description,
      this.renderInput,
    );
  }

  hidden(): ArraySchema<T, Src> {
    return new ArraySchema(
      this.item,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      true,
      this.description,
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
      item: this.item["executeSerialize"](),
      opt: this.opt,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
      readonly: this.isReadonly,
      hidden: this.isHidden,
      description: this.description,
    };
  }

  protected override executeRender(
    sourcePath: SourcePath | ModuleFilePath,
    src: Src,
    scope?: RenderScope,
  ): ReifiedRender {
    const res: ReifiedRender = {};
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
      const itemResult = this.item["executeRender"](subPath, itemSrc, scope);
      for (const keyS in itemResult) {
        const key = keyS as SourcePath | ModuleFilePath;
        res[key] = itemResult[key];
      }
    }
    if (this.renderInput) {
      const { select, as: layout } = this.renderInput;
      if (layout !== "list") {
        res[sourcePath] = {
          status: "error",
          message: "Unknown layout type: " + layout,
        };
      }
      // The whole list when the LIST is what is being shown; only the wanted
      // rows when it is not. `select` is the user's closure and the real expense
      // — a list view asks for the container and gets every row, a single field
      // asks for its own path and costs one call.
      // Non-null once, as a value, rather than a boolean the compiler cannot
      // tie back to `scope`: no scope and a scope that wants this exact path
      // both mean the whole list, and anything else is a window.
      const window =
        scope !== undefined && !scope.wants(sourcePath) ? scope : null;
      const items: ListArrayRender["items"] = [];
      for (let index = 0; index < src.length; index++) {
        if (
          window !== null &&
          !window.wantsUnder(unsafeCreateSourcePath(sourcePath, index))
        ) {
          continue;
        }
        // Per ITEM, not per list, matching what `record` already does: `select`
        // is user code, and one row whose data trips it up must not take out the
        // whole list. Before scoping, one throwing row produced an error at the
        // container and no items at all.
        try {
          // NB NB: display is actually defined by the user
          const { title, subtitle, image } = select({ val: src[index] });
          items.push([index, { title, subtitle, image }]);
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
          layout: "list",
          parent: "array",
          items,
        },
      };
    }
    return res;
  }

  render(input: ArrayRenderInput<T>): ArraySchema<T, Src> {
    return new ArraySchema(
      this.item,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      input,
    );
  }
}

export const array = <S extends Schema<SelectorSource>>(
  schema: S,
): ArraySchema<S, SelectorOfSchema<S>[]> => {
  return new ArraySchema(schema);
};
