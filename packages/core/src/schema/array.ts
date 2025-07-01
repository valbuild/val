/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Schema,
  SchemaAssertResult,
  SelectorOfSchema,
  SerializedSchema,
} from ".";
import { RenderSelector, ReifiedRender } from "../render";
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
  ) {
    super();
  }

  validate(
    validationFunction: (src: Src) => false | string,
  ): ArraySchema<T, Src> {
    return new ArraySchema(this.item, this.opt, [
      ...this.customValidateFunctions,
      validationFunction,
    ]);
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    const assertRes = this.executeAssert(path, src);
    if (!assertRes.success) {
      return assertRes.errors;
    }
    if (assertRes.data === null) {
      return false;
    }
    let error: Record<SourcePath, ValidationError[]> = {};
    for (const [idx, i] of Object.entries(assertRes.data)) {
      const subPath = unsafeCreateSourcePath(path, Number(idx));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subError = this.item["executeValidate"](subPath, i as any);
      if (subError) {
        error = {
          ...subError,
          ...error,
        };
      }
    }

    if (Object.keys(error).length === 0) {
      return false;
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
    return new ArraySchema(this.item, true);
  }

  protected executeSerialize(): SerializedArraySchema {
    return {
      type: "array",
      item: this.item["executeSerialize"](),
      opt: this.opt,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
    };
  }

  private renderInput: {
    layout: "list";
    select: (input: { val: RenderSelector<T> }) => {
      title: string;
      subtitle?: string | null;
      image?: ImageSource | null;
    };
  } | null = null;

  protected override executeRender(
    sourcePath: SourcePath | ModuleFilePath,
    src: Src,
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
      const itemResult = this.item["executeRender"](subPath, itemSrc);
      for (const keyS in itemResult) {
        const key = keyS as SourcePath | ModuleFilePath;
        res[key] = itemResult[key];
      }
    }
    if (this.renderInput) {
      const { select, layout: layout } = this.renderInput;
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
            parent: "array",
            items: src.map((val) => {
              // NB NB: display is actually defined by the user
              const { title, subtitle, image } = select({ val });
              return { title, subtitle, image };
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
    layout: "list";
    select: (input: { val: RenderSelector<T> }) => {
      title: string;
      subtitle?: string | null;
      image?: ImageSource | null;
    };
  }) {
    this.renderInput = input;
    return this;
  }
}

export const array = <S extends Schema<SelectorSource>>(
  schema: S,
): ArraySchema<S, SelectorOfSchema<S>[]> => {
  return new ArraySchema(schema);
};
