import {
  Schema,
  SchemaAssertResult,
  SelectorOfSchema,
  SerializedSchema,
} from ".";
import { ReifiedPreview } from "../preview";
import { SelectorSource } from "../selector";
import {
  createValPathOfItem,
  unsafeCreateSourcePath,
} from "../selector/SelectorProxy";
import { ImageSource } from "../source/image";
import { ModuleFilePath, SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedRecordSchema = {
  type: "record";
  item: SerializedSchema;
  opt: boolean;
};

export class RecordSchema<
  T extends Schema<SelectorSource>,
  Src extends Record<string, SelectorOfSchema<T>> | null,
> extends Schema<Src> {
  constructor(
    readonly item: T,
    readonly opt: boolean = false,
  ) {
    super();
  }

  validate(path: SourcePath, src: Src): ValidationErrors {
    let error: ValidationErrors = false;

    if (this.opt && (src === null || src === undefined)) {
      return false;
    }
    if (src === null) {
      return {
        [path]: [{ message: `Expected 'object', got 'null'` }],
      } as ValidationErrors;
    }
    if (typeof src !== "object") {
      return {
        [path]: [{ message: `Expected 'object', got '${typeof src}'` }],
      } as ValidationErrors;
    }
    if (Array.isArray(src)) {
      return {
        [path]: [{ message: `Expected 'object', got 'array'` }],
      } as ValidationErrors;
    }
    Object.entries(src).forEach(([key, elem]) => {
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
      } else {
        const subError = this.item.validate(subPath, elem as SelectorSource);
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

  assert(path: SourcePath, src: unknown): SchemaAssertResult<Src> {
    if (this.opt && src === null) {
      return {
        success: true,
        data: src,
      } as SchemaAssertResult<Src>;
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

  nullable(): Schema<Src | null> {
    return new RecordSchema(this.item, true) as Schema<Src | null>;
  }

  serialize(): SerializedRecordSchema {
    return {
      type: "record",
      item: this.item.serialize(),
      opt: this.opt,
    };
  }

  private previewInput: {
    layout: "list";
    prepare: (input: { key: string; val: PreviewSelector<T> }) => {
      title: string;
      subtitle?: string | null;
      image?: ImageSource | null;
    };
  } | null = null;

  protected override executePreview(
    sourcePath: SourcePath | ModuleFilePath,
    src: Src,
  ): ReifiedPreview {
    const res: ReifiedPreview = {};
    if (src === null) {
      return res;
    }
    for (const key in src) {
      const itemSrc = src[key];
      if (itemSrc === null || itemSrc === undefined) {
        continue;
      }
      const subPath = unsafeCreateSourcePath(sourcePath, key);
      const itemResult = this.item["executePreview"](subPath, itemSrc);
      for (const keyS in itemResult) {
        const key = keyS as SourcePath | ModuleFilePath;
        res[key] = itemResult[key];
      }
    }
    if (this.previewInput) {
      const { prepare: prepare, layout: layout } = this.previewInput;
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
            items: Object.entries(src).map(([key, val]) => {
              // NB NB: display is actually defined by the user
              const { title, subtitle, image } = prepare({ key, val });
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

  preview(input: {
    layout: "list";
    prepare: (input: { key: string; val: PreviewSelector<T> }) => {
      title: string;
      subtitle?: string | null;
      image?: ImageSource | null;
    };
  }) {
    this.previewInput = input;
    return this;
  }
}

// TODO: improve this so that we do not get RawString and string, only string. Are there other things?
type PreviewSelector<T extends Schema<SelectorSource>> =
  T extends Schema<infer S> ? S : never;

export const record = <S extends Schema<SelectorSource>>(
  schema: S,
): RecordSchema<S, Record<string, SelectorOfSchema<S>>> => {
  return new RecordSchema(schema);
};
