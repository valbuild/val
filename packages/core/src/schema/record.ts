import {
  Schema,
  SchemaAssertResult,
  SelectorOfSchema,
  SerializedSchema,
} from ".";
import { ReifiedPreview } from "../preview";
import { SelectorSource } from "../selector";
import { createValPathOfItem } from "../selector/SelectorProxy";
import { ImageSource } from "../source/image";
import { SourcePath } from "../val";
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
    as: "card";
    display: (input: { key: string; val: PreviewSelector<T> }) => {
      title: string;
      subtitle?: string | null;
      image?: ImageSource | null;
    };
  } | null = null;
  protected override executePreview(src: Src): ReifiedPreview {
    if (src === null) {
      return {
        status: "success",
        data: {
          renderType: "auto",
          schemaType: "record",
          items: null,
        },
      };
    }
    if (!this.previewInput) {
      const items: Record<string, ReifiedPreview> = {};
      for (const key of Object.keys(src)) {
        const itemPreview = this.item["executePreview"](src[key]);
        items[key] = itemPreview;
      }

      return {
        status: "success",
        data: {
          renderType: "auto",
          schemaType: "record",
          items: items,
        },
      };
    }
    const { display, as: type } = this.previewInput;
    if (type !== "card") {
      return {
        status: "error",
        message: "Unknown preview type",
      };
    }
    try {
      return {
        status: "success",
        data: {
          renderType: "card",
          schemaType: "record",
          items: Object.entries(src).map(([key, val]) => {
            // NB NB: display is actually defined by the user
            const { title, subtitle, image } = display({ key, val });
            return [key, { title, subtitle, image }];
          }),
        },
      };
    } catch (e) {
      return {
        status: "error",
        message: e instanceof Error ? e.message : "Unknown error",
      };
    }
  }

  preview(input: {
    as: "card";
    display: (input: { key: string; val: PreviewSelector<T> }) => {
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
